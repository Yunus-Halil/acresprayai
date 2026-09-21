// Turning regions, flags and blobs into one ranked review queue.
//
// Four signals, each named on the candidate that carries it:
//
//   region     touching not-average tiles, grown into one shape with an area.
//              This is how a dry third of a field arrives as ONE thing.
//   tile       a single not-average tile too small to be a region. A point.
//   off-row    a plant further from the nearest fitted centreline than the
//              in-row band. Pure geometry: no appearance, no classifier.
//   outlier    a plant unlike the field's own plant population in size or
//              colour. This is what finds the one big weed among small corn
//              when the canopy has defeated the row fit.
//
// A plant inside a region is not a second candidate for being there; it is a
// candidate only if it is off-row or an outlier in its own right. That is what
// stops a patch from arriving as a storm of dots.
//
// Headland tiles are excluded BEFORE scoring, not after. End rows and turn
// strips break the row grid and hold most early false positives; excluding
// them afterwards would let them shape the ranking first.
//
// Nothing here produces a verdict. No field, label or string in this module
// describes a candidate as a weed; there is a test for that.
import type { LatLng2 } from "../geo";
import { type BlobBaseline, blobBaseline, scoreBlob } from "./blobs";
import { distanceToRowM } from "./rows";
import type { AnalysisTile, Blob, Candidate, CandidateKind, Region, RowModel, ScoutParams, TileFlag } from "./types";

/** Ceiling on the queue handed to the UI. The rest is still counted. */
export const MAX_CANDIDATES = 500;

export type RankInput = {
  blobs: Blob[];
  tiles: AnalysisTile[];
  flags: TileFlag[];
  regions: Region[];
  rows: RowModel | null;
  params: Pick<ScoutParams, "bandFrac" | "anomalyZ" | "blobZ" | "rowSpacingM" | "minRegionTiles">;
};

export type RankResult = {
  candidates: Candidate[];
  /** Candidates that existed but fell past MAX_CANDIDATES. */
  overflow: number;
  /** Blobs excluded for sitting in headland tiles. */
  headlandExcluded: number;
  /** The plant population baseline, for the describer. */
  plants: BlobBaseline | null;
};

const clip01 = (v: number) => Math.max(0, Math.min(1, v));

const empty = (id: string, tileId: string, centroid: LatLng2, kind: CandidateKind, score: number): Candidate => ({
  id, tileId, centroid, kind, score,
  distanceToRowM: null, rowConfidence: null,
  anomalyZ: null, anomalyFeature: null,
  blobZ: null, blobZFeature: null,
  blob: null, region: null, areaM2: 0,
  feedback: null, estimate: null,
  chip: null, chipSpanM: null, chipGsdM: null,
});

export function rankCandidates(input: RankInput): RankResult {
  const { blobs, tiles, flags, regions, rows, params } = input;
  const tileById = new Map(tiles.map(t => [t.id, t]));
  const flagByTile = new Map(flags.map(f => [f.tileId, f]));
  const regionByTile = new Map<string, Region>();
  for (const r of regions) for (const id of r.tileIds) regionByTile.set(id, r);
  const pitch = rows?.usable ? rows.medianPitchM : params.rowSpacingM;
  const bandM = params.bandFrac * pitch;
  const halfPitch = pitch / 2;
  const T = params.anomalyZ;

  const out: Candidate[] = [];
  let headlandExcluded = 0;

  // Regions. Ranked by how far past the threshold they sit and how much ground
  // they cover, so a faint but field-sized patch and a small but blazing one
  // both make the top of the list.
  for (const r of regions) {
    const sureness = clip01((r.meanStrength - 0.6 * T) / (1.4 * T));
    const size = clip01(Math.log10(Math.max(1, r.tileCount)) / 2);   // 1 tile -> 0, 100 tiles -> 1
    const c = empty(`c-${r.id}`, r.tileIds[0], r.centroid, "not-average region", clip01(0.6 * sureness + 0.4 * size));
    c.region = r;
    c.areaM2 = r.areaM2;
    c.anomalyZ = r.meanStrength;
    c.anomalyFeature = r.drivers[0]?.feature ?? null;
    c.rowConfidence = rows?.usable ? rows.confidence : null;
    out.push(c);
  }

  // The plant population, over every blob outside the headland.
  const interior = blobs.filter(b => {
    const t = tileById.get(b.tileId);
    if (!t) return false;
    if (t.headland) { headlandExcluded++; return false; }
    return true;
  });
  const plants = blobBaseline(interior);

  const tilesWithPlantCandidate = new Set<string>();
  for (const blob of interior) {
    // A plant cut by the imagery edge has a displaced centroid and a truncated
    // size; every measurement on it is wrong in a way nothing downstream can
    // detect. Not a candidate. The sweep never hands these over; the base
    // pass can.
    if (blob.touchesBorder) continue;
    const tile = tileById.get(blob.tileId)!;
    const d = blob.distanceToRowM !== undefined
      ? blob.distanceToRowM
      : rows ? distanceToRowM(rows, blob.centroid) : null;
    const rowConf = blob.rowConfidence ?? (rows?.usable ? rows.confidence : null);
    const offRow = d !== null && d !== undefined && Math.abs(d) > bandM;
    const offRowScore = offRow ? clip01((Math.abs(d!) - bandM) / Math.max(1e-6, halfPitch - bandM)) : 0;

    const bs = plants ? scoreBlob(blob, plants, params.blobZ) : null;
    const outlier = !!bs && bs.strength >= params.blobZ;
    const outlierScore = outlier ? clip01((bs!.strength - params.blobZ) / params.blobZ) : 0;

    if (!offRow && !outlier) continue;
    const kind: CandidateKind = offRow && outlier ? "off-row and outlier" : offRow ? "off-row vegetation" : "vegetation outlier";
    let score = Math.max(offRowScore, outlierScore);
    if (offRow && outlier) score = clip01(score + 0.1);
    // A plant that is only "off-row" by a weak fit is ranked below one the fit is sure about.
    if (offRow && !outlier && rowConf != null && rowConf < 0.5) score *= 0.7;

    const c = empty(`c-${blob.id}`, tile.id, blob.centroid, kind, score);
    c.distanceToRowM = d ?? null;
    c.rowConfidence = rowConf;
    c.blob = blob;
    c.areaM2 = blob.areaM2;
    c.blobZ = bs?.strength ?? null;
    c.blobZFeature = bs?.feature ?? null;
    const flag = flagByTile.get(tile.id);
    if (flag) { c.anomalyZ = flag.z; c.anomalyFeature = flag.feature; }
    tilesWithPlantCandidate.add(tile.id);
    out.push(c);
  }

  // Single not-average tiles that did not grow into a region and hold no
  // plant candidate: still "not average things", shown as the tile.
  for (const flag of flags) {
    const tile = tileById.get(flag.tileId);
    if (!tile || tile.headland || regionByTile.has(tile.id) || tilesWithPlantCandidate.has(tile.id)) continue;
    const c = empty(`c-tile-${tile.id}`, tile.id, tile.centroid, "field outlier", clip01((flag.z - T) / T));
    c.anomalyZ = flag.z;
    c.anomalyFeature = flag.feature;
    c.rowConfidence = rows?.usable ? rows.confidence : null;
    // The largest plant in the tile, if any, so the chip has something to centre on.
    let biggest: Blob | null = null;
    for (const b of interior) if (b.tileId === tile.id && (!biggest || b.areaM2 > biggest.areaM2)) biggest = b;
    if (biggest) { c.blob = biggest; c.centroid = biggest.centroid; c.areaM2 = biggest.areaM2; }
    out.push(c);
  }

  out.sort((a, b) => b.score - a.score);
  const overflow = Math.max(0, out.length - MAX_CANDIDATES);
  return { candidates: out.slice(0, MAX_CANDIDATES), overflow, headlandExcluded, plants };
}

/** One line describing why a candidate is in the queue. Never a verdict. */
export function describeCandidate(c: Candidate): string {
  const parts: string[] = [];
  if (c.region) {
    parts.push(`${c.region.klass}, ${c.region.tileCount} tiles`);
    const d = c.region.drivers[0];
    if (d) parts.push(`${d.feature} ${d.z > 0 ? "above" : "below"} the field by ${Math.abs(d.z).toFixed(1)}`);
    return parts.join(", ");
  }
  if (c.distanceToRowM !== null && (c.kind === "off-row vegetation" || c.kind === "off-row and outlier")) {
    parts.push(`${(Math.abs(c.distanceToRowM) * 100).toFixed(0)} cm off the nearest row`);
  }
  if (c.blobZ !== null && c.blobZFeature && (c.kind === "vegetation outlier" || c.kind === "off-row and outlier")) {
    parts.push(`${c.blobZFeature} ${c.blobZ.toFixed(1)} deviations from the field's plants`);
  }
  if (c.kind === "field outlier" && c.anomalyZ !== null && c.anomalyFeature) {
    parts.push(`${c.anomalyFeature} ${c.anomalyZ.toFixed(1)} typical deviations from the field`);
  }
  if (c.blob) parts.push(`${(c.blob.equivDiameterM * 100).toFixed(0)} cm across`);
  else parts.push("no vegetation in the tile");
  return parts.join(", ");
}

/** Ground metres a chip should cover for a candidate. */
export function chipSpanM(c: Candidate, minSpanM = 1.0): number {
  if (c.region) {
    const lats = c.region.rings[0]?.map(p => p.lat) ?? [];
    const lngs = c.region.rings[0]?.map(p => p.lng) ?? [];
    if (!lats.length) return 10;
    const spanLat = (Math.max(...lats) - Math.min(...lats)) * 111_320;
    const spanLng = (Math.max(...lngs) - Math.min(...lngs)) * 111_320 * Math.cos((c.centroid.lat * Math.PI) / 180);
    return Math.min(60, Math.max(6, Math.max(spanLat, spanLng) * 1.2));
  }
  if (!c.blob) return Math.max(minSpanM, 3);
  return Math.max(minSpanM, c.blob.equivDiameterM * 4);
}

export const latLngKey = (p: LatLng2) => `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`;
