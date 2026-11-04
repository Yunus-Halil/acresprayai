// Corn V1 (2026-11-04): the production corn read. One photograph in; rows, crop identity and findings out, each with
// the evidence behind it.
//
// Two independent reads of where the rows run:
//   - the green read (adaptive.ts: the frame judged region by region, each region read by the stage reader it calls
//     for; bands, weed candidates, gaps, field edges, the seedling layer);
//   - the plant read (greenPoints.ts -> plantRows.ts rowsFromPoints: individual plants located on the soil, rows only
//     where many of them line up in parallel, evenly spaced lines). It needs no model; a plant detector's positions
//     (MaSC, a server tier not shipped in V1) can be passed in its place.
// Measured 2026-11-04 on hand-labelled maize from other people's fields (docs/research/corn-v1-2026-11-04.md): the green
// read alone draws about half its rows on the soil between the maize rows on unfamiliar frames; the plant read puts
// them on the plants. On our own flights the two agree.
//
// Fusion (the plant read leads where it holds rows, the green read stands where the plants cannot be told apart):
//   - a plant row is drawn where it stands; it is "agreed" when the green read has a row on it too;
//   - a green row is kept only where no plant row lies within a row spacing of it (canopy, rows past the plant read);
//     where a plant row lies beside it, off its line, the green row is dropped: the plants contradict it.
// Confidence per row (measured on labelled maize, 2026-11-04): high when both reads agree; when a plant DETECTOR's rows
// alone hold it in the main planting (false 2-4 %); or when the green read alone holds it well where the green is the
// right instrument (rows grown into bands, a late canopy with no plants located). Medium otherwise: plants located on
// the green alone (false 17-30 %: the same pixels as the green read), a green row alone over seedlings.
//
// Crop identity (three classes, never more than the evidence holds):
//   - corn: the field was entered as corn, the row is high confidence in the main planting, and, when the pixel size is
//     known, the planting's spacing is one corn is planted at. Nothing in V1 tells corn from another row crop by its
//     look: MaSC boxes sugar beet and soybean seedlings as corn, the shape of a lone plant does not separate maize from
//     beet (measured), so "corn" rests on the operator's entry and the geometry agreeing;
//   - probable crop: any other planted row (one read only, a second planting, a spacing corn is not planted at);
//   - unknown vegetation: green on no row that is not a confident weed candidate.
// Findings never come from a questionable row:
//   - a weed candidate is reported only off every row's line and beside a corn row; on a row's line it is the crop,
//     elsewhere it is unknown vegetation;
//   - a stand gap is reported only where both reads see nothing: a gap in a green row the plant read agrees with (or a
//     corn row the green holds alone), with no plant position on the row's line inside it; every other gap is withheld.
// Decision support only: nothing here decides a treatment.
import type { PhotoPixels } from "../photoScout/pattern";
import { adaptiveAsRead, readCornAdaptive, type AdaptiveRead, type AdaptiveRow } from "./adaptive";
import { plantPointsFromGreen } from "./greenPoints";
import { distToLine, rowsFromPoints, type PlantPoint, type PlantRowsResult } from "./plantRows";
import type { RowCropGap, RowCropOptions, RowCropParams, RowCropRead, RowCropRow, RowCropStage, RowCropWeed } from "./readRowCrop";

export const CORN_V1_VERSION = 1;

export const CORN_V1 = {
  /** A plant row and a green row are the same row where they lie within this share of the row spacing ... */
  sameRowShare: 0.25,
  /** ... over at least this share of the plant row's length. */
  agreeShare: 0.5,
  /** A green row piece kept beside the plant rows is at least this many row spacings long. */
  minPiecePitches: 1.5,
  /** A green row alone is high confidence at establishment or mid with at least this share of its strips on green ... */
  bandSupport: 0.8,
  /** ... and on a late canopy (no plants located in the photo) with at least this share. */
  canopySupport: 0.5,
  /** A weed candidate within this share of the spacing of a row's line stands on the row: the crop. */
  onRowShare: 0.2,
  /** A weed candidate is a finding only with a corn row within this many row spacings. */
  weedRowReachPitches: 1.5,
  /** A gap is withheld when a plant position lies within this share of the spacing of the row's line inside it (its
   * first and last tenth left out: the plants that bound it). */
  gapPlantShare: 0.15,
  /** A neighbouring plant row at a planting's spacing within this share of it. */
  pitchTol: 0.2,
  /** With a known pixel size the planting's spacing is checked against the crop's planted spacings: within the
   * profile's tolerance (never less than this share) it fits; outside it a note says so ... */
  minSpacingTol: 0.08,
  /** ... and below the first share of the narrowest or above the second of the widest it is a spacing corn is never
   * planted at: no row is corn (drilled soybean, cereals). Weak evidence by nature: corn is planted at 38 to 91 cm. */
  spacingOutside: [0.75, 1.25] as [number, number],
};

export type CornIdentity = "corn" | "probable crop";
export type CornRowEvidence = "both reads agree" | "plant read only" | "green read only";
export type CornV1Row = {
  points: [number, number][];
  evidence: CornRowEvidence;
  confidence: "high" | "medium";
  identity: CornIdentity;
  /** Why the identity is what it is (shown beside the row). */
  why: string;
  /** The green read's row behind it (an index into green.rows), when there is one. */
  greenRow: number | null;
  /** Plants the plant read placed on it. */
  plants: number;
  stage: RowCropStage | null;
  /** In the photo's main planting (not a second planting beside it). */
  mainPlanting: boolean;
};
export type CornV1WeedVerdict = "weed candidate" | "crop on a row" | "unknown vegetation";
export type CornV1Gap = RowCropGap & { greenRow: number; verdict: "stand gap" | "withheld"; why?: string };

export type CornV1Read = {
  version: number;
  green: AdaptiveRead;
  plants: { source: "green" | "detector"; points: PlantPoint[]; rows: PlantRowsResult; ms: number };
  rows: CornV1Row[];
  /** Every green-read weed candidate with what V1 makes of it (index matches green.weeds). */
  weedVerdicts: { index: number; verdict: CornV1WeedVerdict; why: string }[];
  gaps: CornV1Gap[];
  /** Whether "corn" could be said at all, and why not. */
  identity: { entered: string | null; spacingChecked: boolean; spacingFits: boolean | null; spacingImpossible: boolean; spacingM: number | null; mainPitchPx: number | null };
  summary: {
    cornRows: number; probableRows: number; agreedRows: number; plantOnlyRows: number; greenOnlyRows: number; greenRowsDropped: number;
    weeds: number; cropOnRow: number; unknownVegetation: number;
    gaps: number; gapsWithheld: number; gapLengthM: number;
    ms: { green: number; plants: number; fusion: number; total: number };
  };
  notes: string[];
};

export type CornV1Options = RowCropOptions & {
  /** The crop the operator entered for the field ("corn" makes corn rows possible; anything else gives planted rows only). */
  enteredCrop?: string | null;
  /** Plant positions from a detector (photo pixels) in place of the plants read from the green. */
  detectorPoints?: PlantPoint[] | null;
};

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
const densify = (l: [number, number][], step: number): [number, number][] => {
  if (l.length < 2) return l;
  const out: [number, number][] = [l[0]];
  for (let i = 1; i < l.length; i++) { const [ax, ay] = l[i - 1], [bx, by] = l[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step)); for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]); }
  return out;
};
const lengthOf = (l: [number, number][]) => { let s = 0; for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]); return s; };

/** The green read's main row spacing, photo pixels: its largest plan's measured pitch, else the plan's prior. */
export function greenPitchPx(ad: AdaptiveRead): number | null {
  const p = ad.plans.filter(q => q.read).sort((u, v) => v.ownedShare - u.ownedShare)[0];
  if (!p) return null;
  const r = p.read!;
  return r.pitchM && Number.isFinite(r.gsdM) && r.gsdM > 0 ? r.pitchM / r.gsdM : p.pitchPx;
}

/** Fuse a green read with plant positions (the pure part of readCornV1, for tests and the bench). */
export function fuseCornV1(ad: AdaptiveRead, points: PlantPoint[], params: Pick<RowCropParams, "gsdM" | "spacingsM" | "pitchToleranceShare">, o: { enteredCrop?: string | null; source?: "green" | "detector"; plantsMs?: number; greenMs?: number } = {}): CornV1Read {
  const t0 = Date.now(), notes: string[] = [];
  const B = rowsFromPoints(points);
  const pr = greenPitchPx(ad), p = B.pitchPx ?? pr ?? null;
  const mainPlan = ad.plans.filter(q => q.read).sort((u, v) => v.ownedShare - u.ownedShare)[0]?.id ?? null;
  const planStage = (plan: number) => ad.plans.find(q => q.id === plan)?.stage ?? null;

  // Spacing check: only with a known pixel size (an assumed scale is the spacing itself).
  const entered = o.enteredCrop ?? null;
  const gsd = ad.scaleBasis === "given" ? ad.gsdM : null;
  const mainPitchPx = B.rows.length ? B.pitchPx : pr;
  const spacingM = gsd && mainPitchPx ? mainPitchPx * gsd : null;
  const spacingFits = spacingM != null ? params.spacingsM.some(sp => Math.abs(spacingM - sp) <= Math.max(params.pitchToleranceShare, CORN_V1.minSpacingTol) * sp) : null;
  // Only a spacing corn is never planted at rules corn out: the pixel size from a flight height is rarely better than
  // 10-20 % (the Utah set's stated pixel puts its 76 cm rows at 109 cm), so a spacing between corn's own is only noted.
  const spacingImpossible = spacingM != null && params.spacingsM.length > 0 && (spacingM < CORN_V1.spacingOutside[0] * Math.min(...params.spacingsM) || spacingM > CORN_V1.spacingOutside[1] * Math.max(...params.spacingsM));

  const rows: CornV1Row[] = [];
  const greenRows: AdaptiveRow[] = ad.rows;
  // Plant rows: agreed when a green row lies on them over half their length.
  const agreedGreen = new Set<number>();
  const plantRowGreen: (number | null)[] = [];
  if (p) for (const r of B.rows) {
    const s = densify(r.points, Math.max(4, p / 4));
    let best: number | null = null, bestShare = 0;
    greenRows.forEach((g, gi) => {
      if (g.points.length < 2) return;
      const share = s.filter(([x, y]) => distToLine(g.points, x, y) <= CORN_V1.sameRowShare * p).length / s.length;
      if (share > bestShare) { bestShare = share; best = gi; }
    });
    const agreed = bestShare >= CORN_V1.agreeShare ? best : null;
    if (agreed != null) agreedGreen.add(agreed);
    plantRowGreen.push(agreed);
  }
  // A plant row belongs to the main planting when a neighbouring plant row lies one or two of the main spacings away.
  const p0 = B.pitchesPx[0] ?? B.pitchPx;
  const acrossOffset = (a: [number, number][], b: [number, number][]) => { const m = a[a.length >> 1]; return distToLine(b, m[0], m[1]); };
  const inMainPlanting = (i: number) => !!p0 && B.rows.some((q, j) => { if (j === i) return false; const o = acrossOffset(B.rows[i].points, q.points), k = Math.round(o / p0); return k >= 1 && k <= 2 && Math.abs(o / p0 - k) <= CORN_V1.pitchTol; });
  B.rows.forEach((r, i) => {
    const gi = plantRowGreen[i];
    const stage = gi != null ? planStage(greenRows[gi].plan) : null;
    const main = inMainPlanting(i);
    // Plant rows alone are trusted from a detector (MaSC's rows were false 2-4 % of the time on MatchPlant and MSDD),
    // not from plants located on the green (17-30 %: the same pixels the green read sees, its specks included).
    const high = gi != null || (main && o.source === "detector");
    rows.push({ points: r.points, evidence: gi != null ? "both reads agree" : "plant read only", confidence: high ? "high" : "medium", identity: "probable crop", why: "", greenRow: gi, plants: r.members.length, stage, mainPlanting: gi != null ? greenRows[gi].plan === mainPlan : main });
  });
  // Green rows: pieces where no plant row lies within a row spacing.
  let dropped = 0;
  greenRows.forEach((g, gi) => {
    if (g.points.length < 2) return;
    if (agreedGreen.has(gi)) return; // drawn as the plant row it agrees with
    const pieces: [number, number][][] = [];
    if (!p || !B.rows.length) pieces.push(g.points);
    else {
      const d = densify(g.points, p / 2); let run: [number, number][] = [];
      const flush = () => { if (run.length >= 2 && lengthOf(run) >= CORN_V1.minPiecePitches * (pr ?? p)) pieces.push(run); run = []; };
      for (const q of d) { if (B.rows.some(r => distToLine(r.points, q[0], q[1]) <= p)) flush(); else run.push(q); }
      flush();
    }
    if (!pieces.length) { dropped++; return; }
    // Alone, a green row stands as high confidence only where the green read is the right instrument and holds it well
    // (measured on labelled maize, 2026-11-04, green rows no plant row confirms): rows grown into bands (establishment,
    // mid: the plants touch and cannot be located one by one) on green over CORN_V1.bandSupport of their strips, right
    // 47 times in 51; a late canopy only where no plants could be located in the photo at all (late reads beside located
    // plants were 0 right in 11: seedling frames misjudged as canopy). Never an emergence row alone: there the plants
    // are what the read is about, and its lines on other people's seedling frames were right 47 times in 211.
    const stage = planStage(g.plan);
    const high = ((stage === "establishment" || stage === "mid") && g.supportShare >= CORN_V1.bandSupport) || (stage === "late" && !B.rows.length && g.supportShare >= CORN_V1.canopySupport);
    for (const piece of pieces) rows.push({ points: piece, evidence: "green read only", confidence: high ? "high" : "medium", identity: "probable crop", why: "", greenRow: gi, plants: 0, stage, mainPlanting: g.plan === mainPlan });
  });

  // Identity.
  for (const r of rows) {
    if (entered !== "corn") { r.why = entered ? `the field is entered as ${entered}` : "no crop entered for the field"; continue; }
    if (!r.mainPlanting) { r.why = "a second planting beside the main one: its crop is not confirmed"; continue; }
    if (r.confidence !== "high") { r.why = r.evidence === "plant read only" ? (o.source === "detector" ? "plants line up here but not at the planting's spacing" : "plants located on the green line up here, but the green read holds no row on them") : "the green read alone, where it is not the right instrument (seedlings) or holds the row weakly"; continue; }
    if (spacingImpossible) { r.why = `the row spacing (${Math.round(spacingM! * 100)} cm) is not one corn is ever planted at`; continue; }
    r.identity = "corn";
    r.why = r.evidence === "both reads agree" ? "entered as corn; the plants and the green agree on the row" : r.evidence === "plant read only" ? "entered as corn; the plants line up at the planting's spacing (the green read missed the row)" : "entered as corn; the green holds the row well and nothing contradicts it";
  }
  const cornRows = rows.filter(r => r.identity === "corn");

  // Weed candidates.
  const weedVerdicts: CornV1Read["weedVerdicts"] = [];
  ad.weeds.forEach((w, i) => {
    if (w.verdict !== "weed candidate") return;
    if (w.tier === "small green") { weedVerdicts.push({ index: i, verdict: "unknown vegetation", why: "smaller than nearly all the crop's own seedlings" }); return; }
    const tolOn = p ? CORN_V1.onRowShare * p : 0;
    if (p && rows.some(r => distToLine(r.points, w.x, w.y) <= tolOn)) { weedVerdicts.push({ index: i, verdict: "crop on a row", why: "on a planted row's line" }); return; }
    const reach = (pr ?? p ?? 0) * CORN_V1.weedRowReachPitches;
    if (reach && cornRows.some(r => distToLine(r.points, w.x, w.y) <= reach)) { weedVerdicts.push({ index: i, verdict: "weed candidate", why: "off every row, beside a corn row" }); return; }
    weedVerdicts.push({ index: i, verdict: "unknown vegetation", why: rows.some(r => distToLine(r.points, w.x, w.y) <= reach) ? "beside rows whose crop or line is not confirmed" : "no row in reach" });
  });

  // Gaps: only on green rows the plant read agrees with (or a canopy row standing as corn), with no plant inside.
  const gaps: CornV1Gap[] = [];
  const tolGap = p ? CORN_V1.gapPlantShare * p : 0;
  greenRows.forEach((g, gi) => {
    for (const gap of g.gaps) {
      const agreed = rows.some(r => r.greenRow === gi && r.evidence === "both reads agree" && r.identity === "corn");
      const canopyCorn = rows.some(r => r.greenRow === gi && r.evidence === "green read only" && r.identity === "corn");
      if (gap.kind === "uncertain") { gaps.push({ ...gap, greenRow: gi, verdict: "withheld", why: "the photo cannot tell here (dim, rim or noisy)" }); continue; }
      if (!agreed && !canopyCorn) { gaps.push({ ...gap, greenRow: gi, verdict: "withheld", why: "not a corn row both reads support" }); continue; }
      const L = Math.hypot(gap.x2 - gap.x1, gap.y2 - gap.y1);
      const inside = points.some(q => {
        const t = ((q.x - gap.x1) * (gap.x2 - gap.x1) + (q.y - gap.y1) * (gap.y2 - gap.y1)) / (L * L || 1);
        if (t < 0.1 || t > 0.9) return false;
        return Math.hypot(q.x - gap.x1 - t * (gap.x2 - gap.x1), q.y - gap.y1 - t * (gap.y2 - gap.y1)) <= tolGap;
      });
      if (inside) { gaps.push({ ...gap, greenRow: gi, verdict: "withheld", why: "a plant stands on the row's line inside it" }); continue; }
      gaps.push({ ...gap, greenRow: gi, verdict: "stand gap" });
    }
  });

  const kept = gaps.filter(g => g.verdict === "stand gap");
  if (entered === "corn" && spacingImpossible) notes.push(`The rows are ${Math.round(spacingM! * 100)} cm apart, a spacing corn is never planted at: every row is a planted row with its crop not confirmed, and no weeds or gaps are reported. Check the crop entered, or the flight height if the spacing looks wrong.`);
  else if (entered === "corn" && spacingFits === false) notes.push(`The rows measure ${Math.round(spacingM! * 100)} cm apart at the pixel size used, not one of corn's usual spacings: check the flight height (or the crop entered). Rows are still called corn.`);
  if (!B.rows.length) notes.push(points.length ? "The plants located on the soil do not line up in rows here (a canopy, or too few): the green read's rows stand alone." : "No plants could be located on the soil: the green read's rows stand alone.");
  notes.push("Corn is said only where the field is entered as corn and the plants and the green agree on the row: nothing in this read tells corn from another row crop by its look.");
  const fusionMs = Date.now() - t0;
  return {
    version: CORN_V1_VERSION, green: ad,
    plants: { source: o.source ?? "green", points, rows: B, ms: o.plantsMs ?? 0 },
    rows, weedVerdicts, gaps,
    identity: { entered, spacingChecked: spacingFits != null, spacingFits, spacingImpossible, spacingM, mainPitchPx: mainPitchPx ?? null },
    summary: {
      cornRows: cornRows.length, probableRows: rows.length - cornRows.length,
      agreedRows: rows.filter(r => r.evidence === "both reads agree").length, plantOnlyRows: rows.filter(r => r.evidence === "plant read only").length, greenOnlyRows: rows.filter(r => r.evidence === "green read only").length, greenRowsDropped: dropped,
      weeds: weedVerdicts.filter(v => v.verdict === "weed candidate").length, cropOnRow: weedVerdicts.filter(v => v.verdict === "crop on a row").length, unknownVegetation: weedVerdicts.filter(v => v.verdict === "unknown vegetation").length,
      gaps: kept.length, gapsWithheld: gaps.length - kept.length, gapLengthM: Math.round(kept.reduce((s, g) => s + g.lengthM, 0) * 1000) / 1000,
      ms: { green: o.greenMs ?? 0, plants: o.plantsMs ?? 0, fusion: fusionMs, total: (o.greenMs ?? 0) + (o.plantsMs ?? 0) + fusionMs },
    },
    notes,
  };
}

/** Corn V1 over one photograph. */
export function readCornV1(px: PhotoPixels, params: RowCropParams, opts: CornV1Options = {}): CornV1Read {
  const t0 = Date.now();
  const ad = readCornAdaptive(px, params, opts);
  const t1 = Date.now();
  const points = opts.detectorPoints ?? plantPointsFromGreen(px).points;
  const t2 = Date.now();
  return fuseCornV1(ad, points, params, { enteredCrop: opts.enteredCrop ?? params.crop?.id ?? null, source: opts.detectorPoints ? "detector" : "green", greenMs: t1 - t0, plantsMs: t2 - t1 });
}

/**
 * Corn V1 as one RowCropRead for Photo Scout's overlay and summary: corn rows as rows, planted rows whose crop is not
 * confirmed in `probableRows`; weed candidates only where V1 reports them; everything withheld drawn grey (not judged).
 * Bands, plants, field edges and the seedling layer are the green read's.
 */
export function cornV1AsRead(v: CornV1Read): RowCropRead {
  const base = adaptiveAsRead(v.green);
  const gsd = Number.isFinite(base.gsdM) && base.gsdM > 0 ? base.gsdM : null;
  const verdictOf = new Map(v.weedVerdicts.map(w => [w.index, w]));
  const weeds: RowCropWeed[] = [];
  const withheld: RowCropRead["excluded"] = [];
  v.green.weeds.forEach((w, i) => {
    const vd = verdictOf.get(i);
    if (!vd) return; // not a candidate in the green read: already drawn by adaptiveAsRead as excluded
    const { plan: _p, verdict: _v, ...rest } = w;
    if (vd.verdict === "weed candidate" || (vd.verdict === "unknown vegetation" && w.tier === "small green")) weeds.push({ ...rest, id: weeds.length + 1 });
    else withheld.push({ hull: w.hull, areaM2: w.areaM2, reason: vd.verdict === "crop on a row" ? "on a planted row's line: the crop, not a weed" : `unknown vegetation: ${vd.why}` });
  });
  const gapsByRow = new Map<number, RowCropGap[]>();
  for (const g of v.gaps) if (g.verdict === "stand gap") { const { greenRow, verdict: _v, why: _w, ...gap } = g; gapsByRow.set(greenRow, [...(gapsByRow.get(greenRow) ?? []), gap]); }
  const withheldGaps = v.gaps.filter(g => g.verdict === "withheld");
  const toRow = (r: CornV1Row, id: number): RowCropRow => {
    const g = r.greenRow != null ? v.green.rows[r.greenRow] : null;
    const lengthM = gsd ? Math.round(lengthOf(r.points) * gsd * 1000) / 1000 : 0;
    return {
      id, k: g?.k ?? id, points: r.points, lengthM, supportShare: g?.supportShare ?? 1, bandHalfWidthM: g?.bandHalfWidthM ?? 0, greenShare: g?.greenShare ?? 0,
      gaps: r.greenRow != null && r.identity === "corn" ? gapsByRow.get(r.greenRow) ?? [] : [],
      plants: g?.plants ?? null, plantPoints: g?.plantPoints ?? null,
      ...(g?.possiblePoints ? { possiblePoints: g.possiblePoints } : {}), ...(g?.uncertainPoints ? { uncertainPoints: g.uncertainPoints } : {}), ...(g?.missingPoints && r.identity === "corn" ? { missingPoints: g.missingPoints } : {}),
      identity: r.identity, evidence: r.evidence,
    };
  };
  // A green row drawn in pieces shares its gaps once: only its first piece carries them.
  const seen = new Set<number>();
  const rows = v.rows.map((r, i) => { const row = toRow(r, i + 1); if (r.greenRow != null) { if (seen.has(r.greenRow)) { row.gaps = []; row.missingPoints = undefined; } seen.add(r.greenRow); } return row; });
  const reported = weeds.filter(w => w.tier !== "small green");
  return {
    ...base,
    rows,
    weeds,
    excluded: [...base.excluded, ...withheld],
    cornV1: {
      version: v.version, plantSource: v.plants.source, plants: v.plants.points.length,
      cornRows: v.summary.cornRows, probableRows: v.summary.probableRows, agreedRows: v.summary.agreedRows, plantOnlyRows: v.summary.plantOnlyRows, greenOnlyRows: v.summary.greenOnlyRows, greenRowsDropped: v.summary.greenRowsDropped,
      cropOnRow: v.summary.cropOnRow, unknownVegetation: v.summary.unknownVegetation, gapsWithheld: withheldGaps.length,
      withheldGaps: withheldGaps.map(({ greenRow: _g, verdict: _v, ...g }) => g),
      spacingFits: v.identity.spacingFits, spacingImpossible: v.identity.spacingImpossible, entered: v.identity.entered,
    },
    summary: {
      ...base.summary,
      rows: rows.length, totalRowLengthM: Math.round(rows.reduce((s, r) => s + r.lengthM, 0) * 1000) / 1000,
      weeds: reported.length, weedAreaM2: Math.round(reported.reduce((s, w) => s + w.areaM2, 0) * 1000) / 1000,
      ...(base.summary.escapes != null ? { escapes: reported.filter(w => w.sizeClass === "escape").length } : {}),
      gaps: v.summary.gaps, gapLengthM: v.summary.gapLengthM,
      ms: base.summary.ms + v.summary.ms.plants + v.summary.ms.fusion,
    },
    notes: [...v.notes, ...base.notes],
  };
}
