// The adaptive corn reader: one photograph in, one read out, no growth stage asked for.
//
// Recognise the structure first (assess.ts: what each part of the photo shows and how the rows run), understand how it
// is planted second (one direction for the field, a pitch per planting), and only then decide what the photo
// justifies saying, region by region. The stage readers stay the specialists they are.
//
// How the regions are read (v2, 2026-11-03). Every stage reader is built around the whole frame: the emergence reader
// straightens the lens about the frame's centre and follows rows into its dim rim, the establishment reader cuts rows
// at the field's edge from the neighbouring rows, both judge the frame's border. A region cut out of the frame and read
// on its own broke all of that (photograph 100 of the emergence set: one seedling field split around a sparse middle
// into two crops, each straightened about the wrong centre; rows crossed and the rim's corn became weeds). So a region
// is never cut out. Each distinct reading the regions call for (a stage at a planting's pitch: a "plan") reads the
// whole frame once, with the field's direction and that pitch as a prior it refines within a few degrees and percent;
// then every cell of the frame is owned by one plan (its region's, or where the assessment saw no structure, the plan
// whose rows run through it) and each plan's findings are kept only in the cells it owns. A photo of one planting at
// one stage is one plan: the stage reader's own read, its geometry kept from a verge's or a second planting's pull.
//
// Where nothing owns a cell the photo shows no readable rows there and its green is reported uncertain, never a
// finding; where a reader dropped a row, green standing on that row's lattice line is corn whose row was not held,
// never a weed (Yunus, 2026-11-03: "small corn plants in weak or incomplete rows must not automatically become weeds
// simply because the row detector failed to retain their row").
import type { PhotoPixels } from "../photoScout/pattern";
import { ASSESS, assessField, type CropState, type FieldAssessment } from "./assess";
import { DEFAULT_ROW_CROP_PARAMS, readRowCrop, type RowCropExcluded, type RowCropFieldEnd, type RowCropOptions, type RowCropParams, type RowCropRead, type RowCropRow, type RowCropStage, type RowCropWeed } from "./readRowCrop";

export const ADAPTIVE_READ_VERSION = 2;

export const ADAPTIVE = {
  /** A readable region smaller than this many cells does not call for a plan of its own (too little for a reader's rows). */
  minRegionCells: 2,
  /** A second reading (another stage or planting beside the main one) needs regions of at least this many cells. */
  minSecondaryCells: 4,
  /**
   * Corn in one field differs by about one growth band across a frame (seedlings beside V4 corn, V7 rows beside a
   * nearly closed canopy). A region two or more bands from the main reading (a closed canopy beside seedlings) is a
   * verge, a lawn or another field: measured 2026-11-03, the mown and wild grass verges of the emergence photographs
   * read as closed canopy at 39 to 176 cm "spacings" and a late reader traced rows through them. Such a region is read
   * only when it is at least this share of the main reading's cells (a field of its own, not a strip beside this one).
   */
  stageJumpShare: 0.5,
  /** A cell no region owns is owned by the plan with at least this many row points in it (about a metre of row). */
  minRowPointsToOwn: 2,
  /**
   * Unsupported rows. A weed candidate whose across position sits within this share of the pitch of an empty lattice
   * slot (a slot between or beyond the kept rows where no row was held) ...
   */
  slotTol: 0.15,
  /** ... is corn on an unsupported row when at least this many candidates share the slot in the plan's ground ... */
  minSlotPatches: 3,
  /** ... and each is at least this share of the region's typical plant (equivalent diameter) across. */
  minPlantShare: 0.5,
  /** Lattice slots looked at beyond the outermost kept row. */
  slotsBeyond: 2,
};

const STAGES: RowCropStage[] = ["emergence", "establishment", "mid", "late"];
export const STAGE_OF: Partial<Record<CropState, RowCropStage>> = { seedlings: "emergence", rows: "establishment", canopy: "mid", closed: "late" };

export type AdaptiveVerdict = "weed candidate" | "corn on an unsupported row" | "uncertain: no readable rows";
export type AdaptiveWeed = RowCropWeed & { plan: number; verdict: AdaptiveVerdict };
export type AdaptiveRow = RowCropRow & { plan: number; /** Pieces of one row line share it. */ line?: number };
export type AdaptiveUncertain = { reason: string; /** Cell rectangles, photo pixels. */ cells: [number, number, number, number][]; areaShare: number };
export type UnsupportedRow = { plan: number; /** The slot's line across the plan's ground, photo pixels. */ line: [[number, number], [number, number]]; patches: number };

/** One reading of the whole frame: a stage reader at one planting's pitch, for the regions that call for it. */
export type AdaptivePlan = {
  id: number; stage: RowCropStage; cluster: number; pitchPx: number;
  /** The assessment's regions it reads. */
  regions: number[];
  /** Share of the frame's cells it owns. */
  ownedShare: number;
  /** The reader's whole-frame result (before ownership), or null when it failed. */
  read: RowCropRead | null;
  why?: string;
  ms: number;
};

export type AdaptiveRead = {
  version: number;
  width: number; height: number;
  assessment: FieldAssessment;
  gsdM: number | null;
  scaleBasis: FieldAssessment["scaleBasis"];
  directionDeg: number | null;
  /** The plantings' pitches, metres (at the scale above). */
  pitchesM: number[];
  plans: AdaptivePlan[];
  /** Per assessment cell: the plan that owns it, or -1. */
  owner: number[];
  rows: AdaptiveRow[];
  weeds: AdaptiveWeed[];
  excluded: (RowCropExcluded & { plan: number })[];
  fieldEnds: (RowCropFieldEnd & { plan: number })[];
  fieldLines: [number, number][][];
  seedlingPoints: [number, number][];
  uncertain: AdaptiveUncertain[];
  unsupportedRows: UnsupportedRow[];
  summary: {
    /** Row lines (pieces of one row joined); rowPieces the drawn pieces. */
    rows: number; rowPieces: number; rowsDropped: number; plants: number | null; possible: number; missing: number; gaps: number; gapLengthM: number;
    weeds: number; smallGreen: number; unsupportedRowCorn: number; unsupportedRows: number; uncertainGreen: number; fieldEnds: number;
    states: Record<CropState, number>;
    plans: number; uncertainShare: number;
    assessMs: number; readMs: number; ms: number;
  };
  notes: string[];
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };

/** The assessment cell holding a photo point. */
export function cellAt(a: FieldAssessment, x: number, y: number): number {
  const c = Math.max(0, Math.min(a.cols - 1, Math.floor(x / a.cellPx))), r = Math.max(0, Math.min(a.rows - 1, Math.floor(y / a.cellPx)));
  return r * a.cols + c;
}

/**
 * Weed candidates of an establishment read that stand on an empty slot of its lattice with enough others to be a row:
 * corn whose row the reader did not hold. Returns the indices (into read.weeds) of those candidates and the slots'
 * lines. `keep` limits the candidates looked at (a plan's own ground); `typicalPx` is the region's typical plant
 * diameter, photo pixels (0 when unknown: no size test).
 */
export function unsupportedSlots(read: RowCropRead, pitchPx: number, directionDeg: number, typicalPx: number, keep: (w: RowCropWeed) => boolean = () => true): { members: Set<number>; lines: { line: [[number, number], [number, number]]; patches: number }[] } {
  const out = { members: new Set<number>(), lines: [] as { line: [[number, number], [number, number]]; patches: number }[] };
  if (!read.rows.length || !(pitchPx > 0)) return out;
  const dir = (directionDeg * Math.PI) / 180;
  const along = (x: number, y: number) => x * Math.cos(dir) + y * Math.sin(dir), across = (x: number, y: number) => -x * Math.sin(dir) + y * Math.cos(dir);
  const minDiam = ADAPTIVE.minPlantShare * typicalPx;
  const ks = read.rows.map(r => r.k), kLo = Math.min(...ks), kHi = Math.max(...ks), keptK = new Set(ks);
  const slotOf = (w: RowCropWeed): number | null => {
    if (w.tier === "small green" || w.sizeClass === "escape" || !keep(w)) return null;
    if (typicalPx > 0 && w.equivDiameterM / read.gsdM < minDiam) return null;
    const l = along(w.x, w.y), ac = across(w.x, w.y);
    let best: { k: number; d: number; dl: number } | null = null;
    for (const row of read.rows) for (const [x, y] of row.points) { const dl = Math.abs(along(x, y) - l); if (dl <= pitchPx && (!best || dl < best.dl)) best = { k: row.k, d: ac - across(x, y), dl }; }
    if (!best) return null;
    const n = Math.round(best.d / pitchPx);
    if (n === 0 || Math.abs(best.d / pitchPx - n) > ADAPTIVE.slotTol) return null;
    const slot = best.k + n;
    if (keptK.has(slot) || slot < kLo - ADAPTIVE.slotsBeyond || slot > kHi + ADAPTIVE.slotsBeyond) return null;
    return slot;
  };
  const bySlot = new Map<number, number[]>();
  read.weeds.forEach((w, i) => { const s = slotOf(w); if (s != null) (bySlot.get(s) ?? bySlot.set(s, []).get(s)!).push(i); });
  for (const idx of bySlot.values()) {
    if (idx.length < ADAPTIVE.minSlotPatches) continue;
    for (const i of idx) out.members.add(i);
    const ws = idx.map(i => read.weeds[i]), ls = ws.map(w => along(w.x, w.y)), acM = median(ws.map(w => across(w.x, w.y)))!;
    const toXY = (l: number): [number, number] => [r3(l * Math.cos(dir) - acM * Math.sin(dir)), r3(l * Math.sin(dir) + acM * Math.cos(dir))];
    out.lines.push({ line: [toXY(Math.min(...ls)), toXY(Math.max(...ls))], patches: idx.length });
  }
  return out;
}

/** Read one photograph of corn without being told its stage. `params.stage` and `params.geometry` are ignored. */
export function readCornAdaptive(px: PhotoPixels, params: Partial<RowCropParams> = {}, opts: RowCropOptions = {}): AdaptiveRead {
  const t0 = Date.now();
  const P: RowCropParams = { ...DEFAULT_ROW_CROP_PARAMS, ...params };
  const notes: string[] = [];
  const a = assessField(px, P, { debug: opts.debug });
  notes.push(...a.notes);
  const gsdM = a.gsdM;
  const nCells = a.cells.length;

  // 1. Plans: one per stage and planting the readable regions call for, the largest first.
  const plans: AdaptivePlan[] = [];
  const setAside: { stage: RowCropStage; why: string; cells: number[] }[] = [];
  const regionPlan = new Map<number, number>();
  if (a.field) {
    const keyed = new Map<string, AdaptivePlan>();
    for (const r of a.regions) {
      const stage = STAGE_OF[r.state];
      if (!stage || r.pitchPx == null || r.cells.length < ADAPTIVE.minRegionCells) continue;
      const cluster = a.cells[r.cells[0]].cluster ?? 0, key = `${stage}|${cluster}`;
      let plan = keyed.get(key);
      if (!plan) { plan = { id: -1, stage, cluster, pitchPx: r.pitchPx, regions: [], ownedShare: 0, read: null, ms: 0 }; keyed.set(key, plan); }
      plan.regions.push(r.id);
    }
    const cellsOf = (p: AdaptivePlan) => p.regions.reduce((u, id) => u + a.regions[id].cells.length, 0);
    const sorted = [...keyed.values()].sort((u, v) => cellsOf(v) - cellsOf(u));
    const band = (st: RowCropStage) => STAGES.indexOf(st), main = sorted[0];
    for (const p of sorted) {
      if (p !== main) {
        const why = cellsOf(p) < ADAPTIVE.minSecondaryCells ? "too small for a reading of its own"
          : Math.abs(band(p.stage) - band(main.stage)) > 1 && cellsOf(p) < ADAPTIVE.stageJumpShare * cellsOf(main) ? `${p.stage} beside ${main.stage}: two growth bands apart, a verge, a lawn or another field rather than this crop` : null;
        if (why) { setAside.push({ stage: p.stage, why, cells: p.regions.flatMap(id => a.regions[id].cells) }); continue; }
      }
      plans.push(p);
    }
    plans.forEach((p, i) => { p.id = i; for (const id of p.regions) regionPlan.set(id, i); });
  }

  // 2. Each plan reads the whole frame, the field's direction and its planting's pitch as the prior. The pixel size is
  // only ever the one given: without it the main plan assumes its scale from its own rows, as the stage reader does
  // alone (the assessment's scale handed on as "given" changed the reader's work raster: finer, slower, and more small
  // patches), and every further plan is measured in the main plan's metres.
  let readMs = 0, fieldGsd: number | null = null;
  for (const plan of plans) {
    const t1 = Date.now();
    try {
      plan.read = readRowCrop(px, { ...P, stage: plan.stage, geometry: { directionDeg: a.field!.directionDeg, pitchPx: plan.pitchPx, gsdM: P.gsdM ? null : fieldGsd } }, { ...opts, debug: l => opts.debug?.(`plan ${plan.id} (${plan.stage}): ${l}`) });
      if (fieldGsd == null && Number.isFinite(plan.read.gsdM)) fieldGsd = plan.read.gsdM;
    } catch (e) { plan.why = e instanceof Error ? e.message : String(e); if (plan.why === "cancelled") throw e; }
    plan.ms = Date.now() - t1; readMs += plan.ms;
  }

  // 3. Ownership: a readable region's cells belong to its plan; any other cell to the plan whose rows run through it.
  const owner = new Array<number>(nCells).fill(-1);
  for (const r of a.regions) { const p = regionPlan.get(r.id); if (p != null && plans[p].read) for (const i of r.cells) owner[i] = p; }
  const rowPts = plans.map(() => new Int32Array(nCells));
  plans.forEach((plan, pi) => { for (const row of plan.read?.rows ?? []) for (const [x, y] of row.points) rowPts[pi][cellAt(a, x, y)]++; });
  for (let i = 0; i < nCells; i++) {
    if (owner[i] >= 0) continue;
    let best = -1, bn = ADAPTIVE.minRowPointsToOwn - 1;
    plans.forEach((_, pi) => { if (rowPts[pi][i] > bn) { bn = rowPts[pi][i]; best = pi; } });
    owner[i] = best;
  }
  for (const plan of plans) plan.ownedShare = r3(owner.filter(o => o === plan.id).length / nCells);
  const ownedBy = (x: number, y: number) => owner[cellAt(a, x, y)];
  const dirRad = (((plans.find(p => p.read)?.read?.directionDeg ?? a.field?.directionDeg ?? 0) * Math.PI) / 180);

  // Rows near a point, per plan (for "does that plan have a row here?"): a grid of row points, cell a pitch.
  const rowGrid = plans.map(plan => {
    const cell = Math.max(16, plan.pitchPx), g = new Map<number, [number, number][]>(), key = (gx: number, gy: number) => gy * 100003 + gx;
    for (const row of plan.read?.rows ?? []) for (const [x, y] of row.points) { const k = key(Math.floor(x / cell), Math.floor(y / cell)); (g.get(k) ?? g.set(k, []).get(k)!).push([x, y]); }
    return (x: number, y: number, r: number) => { const gx = Math.floor(x / cell), gy = Math.floor(y / cell); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const [qx, qy] of g.get(key(gx + dx, gy + dy)) ?? []) if (Math.hypot(qx - x, qy - y) <= r) return true; return false; };
  });
  /** A row point of plan `pi` stands on ground it may draw: its own, or another plan's where that plan has no row of
   * its own there (none within a third of the narrower pitch: the same row drawn twice). An ownership boundary cuts a
   * row only where the other reading draws that row itself (photograph 21 of 2024corn2: a 76 cm row cut where it crossed
   * a cell of the 160 cm planting's ground, its corn called weeds). */
  const rowGround = (pi: number, x: number, y: number) => { const o = ownedBy(x, y); return o === pi || (o >= 0 && !rowGrid[o](x, y, 0.35 * Math.min(plans[o].pitchPx, plans[pi].pitchPx))); };

  // 4. Each plan's findings over the ground it owns.
  const rows: AdaptiveRow[] = [], weeds: AdaptiveWeed[] = [], excluded: AdaptiveRead["excluded"] = [], fieldEnds: AdaptiveRead["fieldEnds"] = [], fieldLines: [number, number][][] = [], seedlingPoints: [number, number][] = [], unsupportedRows: UnsupportedRow[] = [];
  let rowsDropped = 0;
  for (const plan of plans) {
    const read = plan.read, pi = plan.id; if (!read) continue;
    const mine = (x: number, y: number) => ownedBy(x, y) === pi;
    rowsDropped += read.summary.rowsDropped;
    for (const row of read.rows) {
      // The row's runs of points on owned ground: each run is a row piece; its plants, gaps and points are the row's in
      // owned ground (a row split by another plan's ground keeps them once, in the piece nearest).
      const runs: [number, number][][] = []; let cur: [number, number][] = [];
      for (const p of row.points) { if (rowGround(pi, p[0], p[1])) cur.push(p); else { if (cur.length) runs.push(cur); cur = []; } }
      if (cur.length) runs.push(cur);
      // A piece is the plan's own row only where it holds it on its own ground: at least two points there (a trace of a
      // 160 cm reading lying between two 76 cm rows on the other planting's ground is no row of either).
      const kept = runs.filter(r => r.length >= 2 && r.filter(([x, y]) => mine(x, y)).length >= 2);
      if (!kept.length) continue;
      const n = Math.max(1, row.points.length - 1);
      const pieceOf = (x: number, y: number) => { let bi = 0, bd = Infinity; kept.forEach((run, ri) => { for (const [qx, qy] of run) { const d = (qx - x) ** 2 + (qy - y) ** 2; if (d < bd) { bd = d; bi = ri; } } }); return bi; };
      const onRow = (x: number, y: number) => rowGround(pi, x, y);
      const split = <T,>(xs: T[] | null | undefined, at: (t: T) => [number, number]): (T[] | null)[] => kept.map((_, ri) => (xs ? xs.filter(t => { const [x, y] = at(t); return onRow(x, y) && (kept.length === 1 || pieceOf(x, y) === ri); }) : null));
      const plants = split(row.plantPoints, p => p), poss = split(row.possiblePoints, p => p), miss = split(row.missingPoints, p => p), unc = split(row.uncertainPoints, p => p);
      const gaps = split(row.gaps, g => [(g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2]);
      kept.forEach((run, ri) => {
        rows.push({
          ...row, plan: pi, points: run, lengthM: r3((row.lengthM * (run.length - 1)) / n), gaps: gaps[ri] ?? [],
          plantPoints: plants[ri], plants: plants[ri] ? plants[ri]!.length : row.plants,
          ...(row.possiblePoints ? { possiblePoints: poss[ri] ?? [], missingPoints: miss[ri] ?? [], uncertainPoints: unc[ri] ?? [] } : {}),
        });
      });
    }
    const start = weeds.length;
    for (const w of read.weeds) {
      const o = ownedBy(w.x, w.y);
      if (o === pi) weeds.push({ ...w, plan: pi, verdict: "weed candidate" });
      else if (o < 0 && pi === 0 && a.cells[cellAt(a, w.x, w.y)].state === "unknown") weeds.push({ ...w, plan: pi, verdict: "uncertain: no readable rows" });
    }
    for (const e of read.excluded) {
      const cx = e.hull.reduce((u, q) => u + q[0], 0) / Math.max(1, e.hull.length), cy = e.hull.reduce((u, q) => u + q[1], 0) / Math.max(1, e.hull.length), o = ownedBy(cx, cy);
      if (o === pi || (o < 0 && pi === 0)) excluded.push({ ...e, plan: pi });
    }
    // The field's edge is drawn just past a row's last plant, often on ground nothing owns (the verge, the headland):
    // kept there too, and on the plan's own ground; not on another plan's.
    const mineOrFree = (x: number, y: number) => { const o = ownedBy(x, y); return o === pi || o < 0; };
    for (const e of read.fieldEdge?.ends ?? []) if (mineOrFree(e.x, e.y)) fieldEnds.push({ ...e, plan: pi });
    for (const l of read.fieldEdge?.lines ?? []) { const own = l.filter(([x, y]) => mineOrFree(x, y)); if (own.length >= 2) fieldLines.push(own); }
    for (const p of read.seedlings?.points ?? []) if (mine(p[0], p[1])) seedlingPoints.push(p);
    // Corn on rows the establishment reader did not hold, in the plan's own ground.
    if (plan.stage === "establishment") {
      const regionCells = plan.regions.flatMap(id => a.regions[id].cells);
      const typical = median(regionCells.map(i => a.cells[i].plantDiamPx).filter((d): d is number => d != null)) ?? 0;
      const slots = unsupportedSlots(read, plan.pitchPx, read.directionDeg ?? a.field!.directionDeg, typical, w => mine(w.x, w.y));
      if (slots.members.size) {
        const moved = new Set([...slots.members].map(i => read.weeds[i].id));
        for (let i = start; i < weeds.length; i++) if (weeds[i].verdict === "weed candidate" && moved.has(weeds[i].id)) weeds[i].verdict = "corn on an unsupported row";
        for (const l of slots.lines) unsupportedRows.push({ plan: pi, ...l });
      }
    }
  }
  rows.forEach((r, i) => { r.id = i + 1; });
  // A weed candidate of one reading lying on a row another reading drew through that ground (where the owner has no
  // row of its own: the other planting's row runs on) is that row's crop, judged against the wrong lattice.
  const onOtherRow = (w: AdaptiveWeed) => rows.some(r => {
    if (r.plan === w.plan) return false;
    const reach = (r.bandHalfWidthM + w.equivDiameterM / 2) / (fieldGsd ?? gsdM ?? 1);
    for (let i = 0; i + 1 < r.points.length; i++) {
      const [ax, ay] = r.points[i], [bx, by] = r.points[i + 1], vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1, t = Math.max(0, Math.min(1, ((w.x - ax) * vx + (w.y - ay) * vy) / L2));
      if (Math.hypot(w.x - ax - t * vx, w.y - ay - t * vy) <= reach) return true;
    }
    return false;
  });
  if (plans.length > 1) for (let i = weeds.length - 1; i >= 0; i--) if (weeds[i].verdict === "weed candidate" && onOtherRow(weeds[i])) weeds.splice(i, 1);
  // Row lines: pieces that continue one another end to end (a row cut where it crosses another reading's ground, or
  // drawn on by another reading past a boundary) are one line of the field.
  const parent = rows.map((_, i) => i), find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const minPitch = Math.min(...plans.map(p => p.pitchPx), Infinity);
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a0 = rows[i].points, b0 = rows[j].points, ends = [a0[0], a0[a0.length - 1]], starts = [b0[0], b0[b0.length - 1]];
    // An end within two pitches of the other's start along the rows and a third of a pitch across them.
    if (ends.some(([x, y]) => starts.some(([u, v]) => Math.hypot(x - u, y - v) <= 2 * minPitch && Math.abs((x - u) * Math.sin(dirRad) - (y - v) * Math.cos(dirRad)) <= 0.3 * minPitch))) parent[find(i)] = find(j);
  }
  const lineOf = rows.map((_, i) => find(i)), rowLines = new Set(lineOf).size;
  rows.forEach((r, i) => { r.line = lineOf[i]; });

  // Regions set aside (a reading not justified): their cells no plan's rows run through are left out, not judged.
  for (const sa of setAside) {
    const free = sa.cells.filter(i => owner[i] < 0);
    for (const i of free) { const c = a.cells[i]; excluded.push({ plan: -1, hull: [[c.x0, c.y0], [c.x1, c.y0], [c.x1, c.y1], [c.x0, c.y1]], areaM2: gsdM ? r3((c.x1 - c.x0) * (c.y1 - c.y0) * gsdM * gsdM) : 0, reason: `not read: ${sa.why}` }); }
    if (free.length) notes.push(`${Math.round((100 * free.length) / nCells)}% of the frame looks like ${sa.stage === "late" ? "a closed canopy" : sa.stage === "mid" ? "a nearly closed canopy" : sa.stage === "emergence" ? "seedlings" : "rows of established plants"} but is not read: ${sa.why}.`);
  }
  // 5. Uncertain: cells no plan owns where the assessment saw green but no structure.
  const uncertainCells = a.cells.filter((c, i) => owner[i] < 0 && c.state === "unknown");
  const uncertain: AdaptiveUncertain[] = uncertainCells.length ? [{ reason: "no readable row structure: too little green for rows, or green that lines up with no planting in the field; nothing here is judged", cells: uncertainCells.map(c => [c.x0, c.y0, c.x1, c.y1] as [number, number, number, number]), areaShare: r3(uncertainCells.length / nCells) }] : [];

  const states = { bare: 0, seedlings: 0, rows: 0, canopy: 0, closed: 0, cover: 0, unknown: 0 } as Record<CropState, number>;
  for (const c of a.cells) states[c.state]++;
  for (const k of Object.keys(states) as CropState[]) states[k] = r3(states[k] / nCells);
  const findings = weeds.filter(w => w.verdict === "weed candidate");
  const unsupportedCorn = weeds.filter(w => w.verdict === "corn on an unsupported row").length;
  const uncertainGreen = weeds.filter(w => w.verdict === "uncertain: no readable rows").length;
  const anyPlants = rows.some(r => r.plantPoints != null);
  const ok = plans.filter(p => p.read);
  if (!a.field || !ok.length) notes.push("No row structure anywhere in the photo: nothing is read.");
  else notes.push(`Read by what the photo shows: ${ok.map(p => `${p.stage} at ${gsdM ? Math.round(p.pitchPx * gsdM * 100) : "?"} cm row spacing over ${Math.round(p.ownedShare * 100)}% of the frame`).join(", ")}${uncertain.length ? `; ${Math.round(uncertain[0].areaShare * 100)}% uncertain and not judged` : ""}.`);
  if (unsupportedRows.length) notes.push(`${unsupportedCorn} green patches stand on ${unsupportedRows.length} row line${unsupportedRows.length === 1 ? "" : "s"} the reader did not hold: corn in a thin row, not weeds; those rows are drawn as unsupported.`);
  for (const plan of plans) if (plan.why) notes.push(`The ${plan.stage} reading failed: ${plan.why}.`);
  return {
    version: ADAPTIVE_READ_VERSION, width: px.width, height: px.height, assessment: a, gsdM: fieldGsd ?? gsdM, scaleBasis: a.scaleBasis,
    directionDeg: ok[0]?.read?.directionDeg ?? a.field?.directionDeg ?? null, pitchesM: a.field && gsdM ? a.field.clusters.map(p => r3(p * gsdM)) : [],
    plans, owner, rows, weeds, excluded, fieldEnds, fieldLines, seedlingPoints, uncertain, unsupportedRows,
    summary: {
      rows: rowLines, rowPieces: rows.length, rowsDropped, plants: anyPlants ? rows.reduce((u, r) => u + (r.plantPoints?.length ?? 0), 0) : null,
      possible: rows.reduce((u, r) => u + (r.possiblePoints?.length ?? 0), 0), missing: rows.reduce((u, r) => u + (r.missingPoints?.length ?? 0), 0),
      gaps: rows.reduce((u, r) => u + r.gaps.length, 0), gapLengthM: r3(rows.reduce((u, r) => u + r.gaps.reduce((q, g) => q + g.lengthM, 0), 0)),
      weeds: findings.filter(w => w.tier !== "small green").length, smallGreen: findings.filter(w => w.tier === "small green").length,
      unsupportedRowCorn: unsupportedCorn, unsupportedRows: unsupportedRows.length, uncertainGreen, fieldEnds: fieldEnds.length,
      states, plans: ok.length, uncertainShare: uncertain[0]?.areaShare ?? 0,
      assessMs: a.ms, readMs, ms: Date.now() - t0,
    },
    notes,
  };
}

/**
 * The adaptive read as one RowCropRead, for everything that draws or summarises a stage read (Photo Scout's overlay
 * and summary): the plans' rows and weed candidates over the ground each owns; corn on an unsupported row, green where
 * no rows can be read and the uncertain cells as "not judged" outlines (never findings); the stage is the main plan's.
 */
export function adaptiveAsRead(ad: AdaptiveRead): RowCropRead {
  const reads = ad.plans.filter(p => p.read).sort((u, v) => v.ownedShare - u.ownedShare);
  const main = reads[0]?.read ?? null;
  const t = ad.assessment;
  const weeds: RowCropWeed[] = ad.weeds.filter(w => w.verdict === "weed candidate").map(({ plan: _p, verdict: _v, ...w }, i) => ({ ...w, id: i + 1 }));
  const excluded: RowCropExcluded[] = [
    ...ad.excluded.map(({ plan: _p, ...e }) => e),
    ...ad.weeds.filter(w => w.verdict === "corn on an unsupported row").map(w => ({ hull: w.hull, areaM2: w.areaM2, reason: "corn on a row the reader did not hold (an unsupported row): not a weed" })),
    ...ad.weeds.filter(w => w.verdict === "uncertain: no readable rows").map(w => ({ hull: w.hull, areaM2: w.areaM2, reason: "green where no rows can be read: uncertain, not judged" })),
    ...ad.uncertain.flatMap(u => u.cells.map(([x0, y0, x1, y1]) => ({ hull: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as [number, number][], areaM2: ad.gsdM ? r3((x1 - x0) * (y1 - y0) * ad.gsdM * ad.gsdM) : 0, reason: `uncertain: ${u.reason}` }))),
  ];
  const rows = ad.rows.map(({ plan: _p, ...row }, i) => ({ ...row, id: i + 1 }));
  const s = ad.summary;
  const withLayer = reads.find(p => p.read!.seedlings);
  return {
    version: main?.version ?? 2, stage: main?.stage ?? "establishment", width: ad.width, height: ad.height,
    gsdM: ad.gsdM ?? main?.gsdM ?? NaN, scaleBasis: ad.scaleBasis === "given" ? "given" : "assumed spacing", workFactor: main?.workFactor ?? t.workFactor,
    directionDeg: ad.directionDeg, pitchM: ad.pitchesM[0] ?? null, matchedSpacingM: main?.matchedSpacingM ?? null,
    rows, weeds, excluded,
    seedlings: withLayer ? { ...withLayer.read!.seedlings!, count: ad.seedlingPoints.length, points: ad.seedlingPoints } : null,
    ...(main?.emergence ? { emergence: main.emergence } : {}),
    fieldEdge: { ends: ad.fieldEnds.map(({ plan: _p, ...e }) => e), lines: ad.fieldLines },
    summary: {
      rows: s.rows, rowsDropped: s.rowsDropped, totalRowLengthM: r3(rows.reduce((u, r) => u + r.lengthM, 0)),
      medianBandHalfWidthM: median(rows.map(r => r.bandHalfWidthM)), medianRowGreenShare: median(rows.map(r => r.greenShare)),
      weeds: weeds.filter(w => w.tier !== "small green").length, weedAreaM2: r3(weeds.filter(w => w.tier !== "small green").reduce((u, w) => u + w.areaM2, 0)), betweenRowCover: main?.summary.betweenRowCover ?? null,
      cropComponents: reads.reduce((u, r) => u + r.read!.summary.cropComponents, 0), noRowsPatches: reads.reduce((u, r) => u + r.read!.summary.noRowsPatches, 0), leafTips: reads.reduce((u, r) => u + r.read!.summary.leafTips, 0),
      ...(reads.some(r => r.read!.summary.escapes != null) ? { escapes: weeds.filter(w => w.sizeClass === "escape").length } : {}),
      specks: reads.reduce((u, r) => u + r.read!.summary.specks, 0), gaps: s.gaps, gapLengthM: s.gapLengthM, plants: s.plants,
      coherence: main?.summary.coherence ?? null, vegetationFraction: main?.summary.vegetationFraction ?? 0, ms: s.ms,
    },
    notes: [...ad.notes, ...reads.flatMap(r => r.read!.notes.map(n => (reads.length > 1 ? `[${r.stage} reading] ${n}` : n)))],
    crop: main?.crop ?? null,
  };
}

export { ASSESS };
