// Turning blobs and flags into a ranked review queue.
//
// Two signals, kept separate and named on every candidate:
//
//   off-row   the blob sits further from the nearest fitted centreline than
//             the in-row band. Pure geometry: no appearance, no classifier.
//             Score is the normalised off-row distance.
//   outlier   the blob's tile read as not-average against the field's own
//             baseline. Score is how far past the flag threshold the tile sat.
//
// Headland tiles are excluded BEFORE scoring, not after. End rows and turn
// strips break the row grid and hold most early false positives; excluding
// them afterwards would let them shape the ranking first.
//
// Nothing here produces a verdict. No field, label or string in this module
// describes a candidate as a weed; there is a test for that.
import type { LatLng2 } from "../geo";
import { distanceToRowM } from "./rows";
import type { AnalysisTile, Blob, Candidate, CandidateKind, RowModel, ScoutParams, TileFlag } from "./types";

/** Ceiling on the queue handed to the UI. The rest is still counted. */
export const MAX_CANDIDATES = 500;

export type RankInput = {
  blobs: Blob[];
  tiles: AnalysisTile[];
  flags: TileFlag[];
  rows: RowModel | null;
  params: Pick<ScoutParams, "bandFrac" | "anomalyZ" | "rowSpacingM">;
};

export type RankResult = {
  candidates: Candidate[];
  /** Candidates that existed but fell past MAX_CANDIDATES. */
  overflow: number;
  /** Blobs excluded for sitting in headland tiles. */
  headlandExcluded: number;
};

const clip01 = (v: number) => Math.max(0, Math.min(1, v));

export function rankCandidates(input: RankInput): RankResult {
  const { blobs, tiles, flags, rows, params } = input;
  const tileById = new Map(tiles.map(t => [t.id, t]));
  const flagByTile = new Map(flags.map(f => [f.tileId, f]));
  const pitch = rows?.usable ? rows.medianPitchM : params.rowSpacingM;
  const bandM = params.bandFrac * pitch;
  const halfPitch = pitch / 2;

  const out: Candidate[] = [];
  let headlandExcluded = 0;
  const tilesWithBlobs = new Set<string>();

  for (const blob of blobs) {
    const tile = tileById.get(blob.tileId);
    if (!tile) continue;
    if (tile.headland) { headlandExcluded++; continue; }
    tilesWithBlobs.add(tile.id);

    const d = rows ? distanceToRowM(rows, blob.centroid) : null;
    const offRow = d !== null && Math.abs(d) > bandM;
    const offRowScore = offRow ? clip01((Math.abs(d!) - bandM) / Math.max(1e-6, halfPitch - bandM)) : 0;

    const flag = flagByTile.get(tile.id) ?? null;
    const outlierScore = flag ? clip01((flag.z - params.anomalyZ) / Math.max(1e-6, params.anomalyZ)) : 0;

    if (!offRow && !flag) continue;
    const kind: CandidateKind = offRow && flag
      ? "off-row and outlier"
      : offRow ? "off-row vegetation" : "field outlier";
    let score = Math.max(offRowScore, outlierScore);
    if (offRow && flag) score = clip01(score + 0.1);
    // A blob cut by the raster edge has a displaced centroid; its geometry is
    // not to be trusted, so it ranks below whole blobs of the same score.
    if (blob.touchesBorder) score *= 0.5;

    out.push({
      id: `c-${blob.id}`,
      tileId: tile.id,
      centroid: blob.centroid,
      kind,
      score,
      distanceToRowM: d,
      rowConfidence: rows?.usable ? rows.confidence : null,
      anomalyZ: flag?.z ?? null,
      anomalyFeature: flag?.feature ?? null,
      blob,
      chip: null,
      chipSpanM: null,
      chipGsdM: null,
    });
  }

  // Flagged tiles with no vegetation at all are still "not average" ground:
  // bare patches, standing water, residue. They enter the queue as the tile.
  for (const flag of flags) {
    const tile = tileById.get(flag.tileId);
    if (!tile || tile.headland || tilesWithBlobs.has(tile.id)) continue;
    out.push({
      id: `c-tile-${tile.id}`,
      tileId: tile.id,
      centroid: tile.centroid,
      kind: "field outlier",
      score: clip01((flag.z - params.anomalyZ) / Math.max(1e-6, params.anomalyZ)),
      distanceToRowM: null,
      rowConfidence: rows?.usable ? rows.confidence : null,
      anomalyZ: flag.z,
      anomalyFeature: flag.feature,
      blob: null,
      chip: null,
      chipSpanM: null,
      chipGsdM: null,
    });
  }

  out.sort((a, b) => b.score - a.score);
  const overflow = Math.max(0, out.length - MAX_CANDIDATES);
  return { candidates: out.slice(0, MAX_CANDIDATES), overflow, headlandExcluded };
}

/** One line describing why a candidate is in the queue. Never a verdict. */
export function describeCandidate(c: Candidate): string {
  const parts: string[] = [];
  if (c.distanceToRowM !== null && (c.kind === "off-row vegetation" || c.kind === "off-row and outlier")) {
    parts.push(`${(Math.abs(c.distanceToRowM) * 100).toFixed(0)} cm off the nearest row`);
  }
  if (c.anomalyZ !== null && c.anomalyFeature) {
    parts.push(`${c.anomalyFeature} ${c.anomalyZ.toFixed(1)} typical deviations from the field`);
  }
  if (c.blob) {
    parts.push(`${(c.blob.equivDiameterM * 100).toFixed(0)} cm across`);
  } else {
    parts.push("no vegetation in the tile");
  }
  return parts.join(", ");
}

/** Bounding box, in metres about the centroid, that a chip should cover. */
export function chipSpanM(c: Candidate, minSpanM = 1.0): number {
  if (!c.blob) return Math.max(minSpanM, 3);
  return Math.max(minSpanM, c.blob.equivDiameterM * 4);
}

export const latLngKey = (p: LatLng2) => `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`;
