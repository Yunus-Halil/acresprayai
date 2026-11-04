// What corn structure a photograph shows, read from the photograph itself, region by region, before any stage reader
// is chosen (Yunus, 2026-11-03: "Swardus should not depend on folder names, manually selected growth stages, or one
// uniform growth stage per photograph").
//
// Why. The stage readers (readRowCrop.ts, emergence.ts) each assume the whole frame is one thing: one growth stage,
// one row direction, one row spacing. On a field none of them had seen (2024corn2) that assumption, not the readers,
// was what failed: the emergence reader was handed V4 plants and set every one aside as "too big for a seedling"; the
// establishment reader read two row spacings in one frame (a 38 cm planting beside a 76 cm one) as one and dropped
// half the rows of one half, whose corn then became weeds; and on three frames a mown verge decided the row direction
// for the whole photo. Each of those is a judgement about the photo that must be made before a reader runs, and made
// for each part of the photo, not once.
//
// What is measured, on cells about a twelfth of the frame's long side, each judged over the 3 x 3 cells around it (a
// window of several row spacings, enough for the periodicity to show): the green share; the row direction where the
// green is most periodic; the pitch of that periodicity and its strength (autocorrelation at the pitch); the size of
// the green components (a seedling is a speck, a V5 plant a hand's breadth, a closed canopy one component). Then the
// field's own geometry: the direction most cells agree on, the pitches the agreeing cells cluster at (one planting, or
// a second at another spacing); and each cell's state from its own evidence. Cells of one state and pitch make a
// region; a region is what a reader is given, with the field's direction and the region's own pitch fixed, so that no
// two regions contradict each other about where the rows run.
//
// Nothing here changes the readers' own rules; the readers are untouched unless handed a geometry (RowCropParams.geometry).
import { GREEN_DEFAULTS, type GreenOptions, greenMaskWithExcess } from "../directGeoref/green";
import type { PhotoPixels } from "../photoScout/pattern";
import { acrossProfile, coarseDensity, downsample, LATE, localGreenMask, pitchFromProfile, rowDirection, type RowCropParams } from "./readRowCrop";

export const ASSESS = {
  /** Cells per long side of the frame; each judged over the 3 x 3 cells around it. */
  cellsAlong: 12,
  /** The pitch is searched between these shares of the frame's long side (33 cm to 3.3 m on a 26 m frame). */
  minPitchShare: 1 / 80,
  maxPitchShare: 1 / 8,
  /**
   * A frame spanning fewer rows than this across its long side (a low flight, a tile cut from a video frame: MSDD's
   * 1920 px squares hold about 8 rows) has cells and a pitch search sized from its own row spacing instead of the
   * frame shares above, which assume a frame of 30 rows or more: the window then holds windowPitches rows, and the
   * search reaches past the spacing. Measured 2026-11-04 on MSDD's 2022 test set: with the frame shares, 73 % of its
   * nadir tiles read no rows (the window held two rows; the pitch found was the search's floor).
   */
  fewPitches: 12,
  windowPitches: 4.5,
  /** The frame's own spacing is searched up to this share of its long side. */
  frameMaxPitchShare: 1 / 4,
  /** Coarse density cell for the direction search, work pixels. */
  coarse: 4,
  /** The direction search per window: every this many degrees, then refined at fineStepDeg (a cell's direction only has
   * to agree with the field's within directionTolDeg; the readers refine the field's direction to a tenth themselves). */
  dirStepDeg: 3,
  dirFineStepDeg: 0.5,
  /** A cell with weaker periodicity at its pitch than this has no readable rows of its own. */
  minCoherence: 0.25,
  /** A cell whose direction differs from the field's by more than this is not the field's rows (a verge, a road's edge, another block), degrees. */
  directionTolDeg: 12,
  /** Pitch clusters: cells within this share of a cluster's pitch belong to it. */
  pitchClusterTol: 0.12,
  /** A second pitch cluster must hold at least this many aligned cells to be a planting of its own. */
  minClusterCells: 3,
  /** Two clusters within this share of each other's size are a tie: the narrower pitch is the main planting. */
  tieShare: 0.2,
  /** Green shares: under bare nothing grows; from canopy on the leaves nearly meet (measured 2026-11-03: V8+ cells 45
   * to 70 %, closed-canopy cells 50 to 70 %, V3-V7 rows 5 to 32 %, seedlings under 2 %). */
  bareGreen: 0.0008,
  canopyGreen: 0.45,
  /**
   * A canopy region is closed (the late reader: nothing between the rows can be seen) when the median alley depth of
   * its cells is under this. Measured 2026-11-03 on the mid photographs (V8 to V10, soil alleys): 0.65 to 0.91 on the
   * body of the field, 0.35 to 0.46 at its dense edges; on the closed-canopy photographs: 0.26 to 0.63. Decided per
   * region, not per cell, so one planting is read by one reader.
   */
  closedAlleyDepth: 0.6,
  /** Rows and seedlings stand on soil: a cell aligned with the field but with less fall than this between its rows
   * (green all over at a weak periodicity: a weedy strip, old rows under grass) has no readable rows. */
  rowsMinAlleyDepth: 0.5,
  /** Seedlings: the cell at most this green (a row of VE-V2 seedlings is 0.3 to 2 %) and its median green component no
   * wider than this, metres (3.5 to 6 cm on the emergence photographs at the assumed scale; the emergence reader's own
   * point cap is about 5 cm). */
  seedlingMaxGreen: 0.03,
  seedlingDiamM: 0.07,
  /** Cover (a verge, a lawn): green at least this and no rows of the field's direction. */
  coverGreen: 0.3,
  /** A neighbouring cell at least cover-green and this many times greener than the cell judged is left out of its window. */
  muchGreener: 2,
  /** An unknown cell with at least this many of its four neighbours in one readable state and planting joins them (the rows run on through a thin stretch). */
  joinNeighbours: 3,
  /** A readable region under this share of the largest readable region's cells (and under minMergeCells) beside a larger region of the same planting takes that region's state. */
  mergeShare: 0.25,
  minMergeCells: 6,
};

export type CropState = "bare" | "seedlings" | "rows" | "canopy" | "closed" | "cover" | "unknown";

export type AssessCell = {
  col: number; row: number;
  /** Photo pixels. */
  x0: number; y0: number; x1: number; y1: number;
  green: number;
  /** Row direction of the cell's window, degrees [0, 180), or null with no periodic rows. */
  directionDeg: number | null;
  /** Pitch, photo pixels, or null. */
  pitchPx: number | null;
  coherence: number;
  /** How far the green falls between the rows: 1 minus the folded across profile's floor over its peak (bare alleys
   * about 1, a canopy nearly meeting about half, a closed canopy near 0), or null without a pitch. */
  alleyDepth: number | null;
  /** Median equivalent diameter of the green components with their centre in the cell, photo pixels, or null. */
  plantDiamPx: number | null;
  components: number;
  /** Whether the cell's direction agrees with the field's. */
  aligned: boolean;
  /** Which pitch cluster (0 the main planting), or null. */
  cluster: number | null;
  state: CropState;
  region: number;
};

export type AssessRegion = {
  id: number;
  state: CropState;
  cells: number[];
  /** The field's direction, degrees, and the region's pitch, photo pixels (null for bare, cover, unknown). */
  directionDeg: number | null;
  pitchPx: number | null;
  /** Bounding box, photo pixels. */
  x0: number; y0: number; x1: number; y1: number;
  /** Mean coherence of its cells. */
  confidence: number;
  areaShare: number;
};

export type FieldAssessment = {
  width: number; height: number; workFactor: number;
  cols: number; rows: number; cellPx: number;
  cells: AssessCell[];
  regions: AssessRegion[];
  /** The field's direction (the cells' consensus) and the main planting's pitch, photo pixels; null when no rows at all. */
  field: { directionDeg: number; pitchPx: number; clusters: number[] } | null;
  /** Metres per photo pixel used for the size thresholds: given, or assumed from the main pitch and the default spacing. */
  gsdM: number | null;
  scaleBasis: "given" | "assumed spacing" | "none";
  notes: string[];
  ms: number;
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const angDiff = (a: number, b: number) => { const d = Math.abs(((a - b) % 180) + 180) % 180; return Math.min(d, 180 - d); };

/** Autocorrelation of a profile at a lag, normalised by its variance. */
function autocorrAt(p: Float64Array, lag: number): number {
  let m = 0; for (const v of p) m += v; m /= p.length;
  let a0 = 0, aP = 0;
  for (let i = 0; i < p.length; i++) { a0 += (p[i] - m) ** 2; if (i + lag < p.length) aP += (p[i] - m) * (p[i + lag] - m); }
  return a0 > 0 ? aP / a0 : 0;
}

/** Judge one photograph: cells, their states, and the regions they form. */
export function assessField(px: PhotoPixels, params: Pick<RowCropParams, "gsdM" | "spacingsM" | "defaultSpacingM" | "pitchToleranceShare">, opts: { debug?: (line: string) => void } = {}): FieldAssessment {
  const t0 = Date.now(), A = ASSESS;
  const notes: string[] = [];
  const given = params.gsdM != null && params.gsdM > 0 ? params.gsdM : null;
  const f = Math.max(1, Math.ceil(Math.max(px.width, px.height) / 2048));
  const work = downsample(px, f);
  const { W, H } = work, L = Math.max(W, H);

  // 1. Green, as the establishment reader sees it (soil-relative), the lens's black corners out.
  const gopts: GreenOptions = { ...GREEN_DEFAULTS, index: "exgr-soil", soilTilePx: 64, cellPx: 1, soilCapAboveGlobal: 0.05 };
  const { mask, excess } = greenMaskWithExcess({ width: W, height: H, rgba: work.rgba }, gopts);
  const lateMask = localGreenMask(excess, work.rgba, W, H, Math.max(4, Math.round(L * LATE.windowShare)));
  {
    const cx = (W - 1) / 2, cy = (H - 1) / 2, R2 = (LATE.cornerRadius ** 2) * (cx * cx + cy * cy);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 < R2) continue;
      const q = (y * W + x) * 4;
      if (0.3 * work.rgba[q] + 0.59 * work.rgba[q + 1] + 0.11 * work.rgba[q + 2] < LATE.minLuma) mask[y * W + x] = 0;
    }
  }

  const tGreen = Date.now() - t0;
  // 2. Green components (8-neighbour): size and centre of each.
  const lab = new Int32Array(W * H), stack = new Int32Array(W * H);
  const compN: number[] = [], compX: number[] = [], compY: number[] = [];
  for (let i0 = 0; i0 < W * H; i0++) {
    if (!mask[i0] || lab[i0]) continue;
    const id = compN.length + 1; let top = 0, n = 0, sx = 0, sy = 0;
    lab[i0] = id; stack[top++] = i0;
    while (top) {
      const i = stack[--top], x = i % W, y = (i - x) / W; n++; sx += x; sy += y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const j = yy * W + xx; if (mask[j] && !lab[j]) { lab[j] = id; stack[top++] = j; } }
    }
    compN.push(n); compX.push(sx / n); compY.push(sy / n);
  }

  const tComp = Date.now() - t0 - tGreen;
  // 3. Cells and their windows.
  // 3a. The frame's own row spacing: a frame spanning few rows gets cells and a pitch search sized from it.
  let cellPx = Math.max(16, Math.round(L / A.cellsAlong));
  let minLag = L * A.minPitchShare, maxLag = L * A.maxPitchShare;
  {
    const wide = L * A.frameMaxPitchShare;
    const cd = coarseDensity(mask, W, H, A.coarse, Math.max(2, Math.round(wide / A.coarse / 2)), false);
    const ang = rowDirection(cd.d, cd.w, cd.h, minLag / A.coarse, wide / A.coarse, undefined, { stepDeg: A.dirStepDeg, fineStepDeg: A.dirFineStepDeg });
    const { profile } = acrossProfile(mask, new Uint8Array(W * H), W, H, ang, Math.round(wide));
    const p = pitchFromProfile(profile, minLag, Math.min(profile.length / 3, wide));
    if (p != null && L / p < A.fewPitches && autocorrAt(profile, Math.round(p)) >= A.minCoherence) {
      cellPx = Math.max(cellPx, Math.round((A.windowPitches * p) / 3));
      maxLag = Math.max(maxLag, 1.6 * p);
      notes.push(`The frame spans about ${Math.round(L / p)} rows: cells sized from its own row spacing.`);
      opts.debug?.(`assess: few rows (${(L / p).toFixed(1)} pitches of ${Math.round(p * f)} px): cell ${cellPx * f} px`);
    }
  }
  const cols = Math.ceil(W / cellPx), rows = Math.ceil(H / cellPx);
  const cellGreen = new Float64Array(cols * rows), cellN = new Float64Array(cols * rows);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = Math.floor(y / cellPx) * cols + Math.floor(x / cellPx); cellN[c]++; cellGreen[c] += mask[y * W + x]; }
  const cellComps: number[][] = Array.from({ length: cols * rows }, () => []);
  for (let k = 0; k < compN.length; k++) { if (compN[k] < 3) continue; const c = Math.min(rows - 1, Math.floor(compY[k] / cellPx)) * cols + Math.min(cols - 1, Math.floor(compX[k] / cellPx)); cellComps[c].push(compN[k]); }
  const cells: AssessCell[] = [];
  let noSkip = new Uint8Array(0);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = r * cols + c;
    const green = cellN[k] ? cellGreen[k] / cellN[k] : 0;
    // The window: the cell and its neighbours, clamped to the frame.
    const wx0 = Math.max(0, (c - 1) * cellPx), wy0 = Math.max(0, (r - 1) * cellPx), wx1 = Math.min(W, (c + 2) * cellPx), wy1 = Math.min(H, (r + 2) * cellPx);
    const ww = wx1 - wx0, wh = wy1 - wy0;
    // A neighbouring cell far greener than this one (a verge beside the field's last rows, a lawn) is left out of the
    // window: its green would swamp the profile and decide the direction for rows it has nothing to do with.
    const sub = new Uint8Array(ww * wh), late = new Uint8Array(ww * wh); let wg = 0;
    // ... and the other way round: a dense cell (a lawn, a canopy) is judged with neighbours at least half as green
    // as itself, so a lawn beside the field's rows does not borrow their periodicity and pass for a closed canopy.
    // (Decided once per neighbouring cell; each window column's cell and row's cell looked up, not divided per pixel.)
    const keepCell = (cc: number, rr: number) => { const n = cellN[rr * cols + cc] ? cellGreen[rr * cols + cc] / cellN[rr * cols + cc] : 0; return green >= A.canopyGreen ? n * A.muchGreener >= green : !(n >= A.coverGreen && n > A.muchGreener * green); };
    const keep9 = new Uint8Array(9);
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) { const cc = c - 1 + dc, rr = r - 1 + dr; keep9[dr * 3 + dc] = cc >= 0 && rr >= 0 && cc < cols && rr < rows && keepCell(cc, rr) ? 1 : 0; }
    const colOf = new Uint8Array(ww); for (let x = 0; x < ww; x++) colOf[x] = Math.floor((wx0 + x) / cellPx) - (c - 1);
    for (let y = 0; y < wh; y++) {
      const kr = (Math.floor((wy0 + y) / cellPx) - (r - 1)) * 3, o = (wy0 + y) * W + wx0;
      for (let x = 0; x < ww; x++) { if (!keep9[kr + colOf[x]]) continue; const v = mask[o + x]; sub[y * ww + x] = v; wg += v; late[y * ww + x] = lateMask[o + x]; }
    }
    let directionDeg: number | null = null, pitchPx: number | null = null, coherence = 0, alleyDepth: number | null = null;
    const wGreen = wg / (ww * wh);
    if (wGreen >= A.bareGreen) {
      // A dense canopy (the window at least canopyGreen) keeps little periodicity in the soil-relative mask (the leaves
      // nearly meet); its rows still show as ridges greener than the canopy around them (the late reader's mask).
      const dense = wGreen >= A.canopyGreen;
      const src = dense ? late : sub;
      const cd = coarseDensity(src, ww, wh, A.coarse, Math.max(2, Math.round(maxLag / A.coarse / 2)), false);
      const ang = rowDirection(cd.d, cd.w, cd.h, minLag / A.coarse, maxLag / A.coarse, undefined, { stepDeg: A.dirStepDeg, fineStepDeg: A.dirFineStepDeg });
      if (noSkip.length < ww * wh) noSkip = new Uint8Array(ww * wh); // never written: acrossProfile only reads it
      const skip = noSkip;
      const { profile } = acrossProfile(src, skip, ww, wh, ang, Math.round(maxLag));
      const p = pitchFromProfile(profile, minLag, Math.min(profile.length / 3, maxLag));
      if (p != null) {
        pitchPx = p * f; coherence = autocorrAt(profile, Math.round(p)); directionDeg = r3(((ang * 180) / Math.PI + 180) % 180);
        // The alleys' depth: the soil-relative mask's green share by phase across the rows (16 bins per pitch), floor over peak.
        const sn = -Math.sin(ang), cs = Math.cos(ang), fold = new Float64Array(16), cnt = new Float64Array(16);
        for (let y = 0; y < wh; y++) { const base = (y * cs) / p; for (let x = 0; x < ww; x++) { const t = base + (x * sn) / p, b = Math.min(15, Math.floor((t - Math.floor(t)) * 16)); cnt[b]++; fold[b] += sub[y * ww + x]; } }
        let lo = Infinity, hi = 0; for (let b = 0; b < 16; b++) if (cnt[b] > 0) { const v = fold[b] / cnt[b]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
        alleyDepth = hi > 0 && Number.isFinite(lo) ? r3(1 - lo / hi) : null;
      }
    }
    const diam = median(cellComps[k].map(n => 2 * Math.sqrt(n / Math.PI)));
    cells.push({ col: c, row: r, x0: c * cellPx * f, y0: r * cellPx * f, x1: Math.min(W, (c + 1) * cellPx) * f, y1: Math.min(H, (r + 1) * cellPx) * f, green: r3(green), directionDeg, pitchPx: pitchPx == null ? null : r3(pitchPx), coherence: r3(coherence), alleyDepth, plantDiamPx: diam == null ? null : r3(diam * f), components: cellComps[k].length, aligned: false, cluster: null, state: "unknown", region: -1 });
  }

  const tCells = Date.now() - t0 - tGreen - tComp;
  opts.debug?.(`assess timing: green ${tGreen} ms, components ${tComp} ms, cells ${tCells} ms`);
  // 4. The field's direction: the coherent cells' consensus (5-degree bins, weighted by coherence), refined as the
  // weighted circular mean of the cells within the tolerance of the winning bin.
  const periodic = cells.filter(c => c.pitchPx != null && c.coherence >= A.minCoherence);
  let field: FieldAssessment["field"] = null;
  if (periodic.length) {
    const bins = new Float64Array(36);
    for (const c of periodic) bins[Math.floor(c.directionDeg! / 5) % 36] += c.coherence;
    let best = 0; for (let b = 1; b < 36; b++) if (bins[b] + bins[(b + 1) % 36] + bins[(b + 35) % 36] > bins[best] + bins[(best + 1) % 36] + bins[(best + 35) % 36]) best = b;
    const around = periodic.filter(c => angDiff(c.directionDeg!, best * 5 + 2.5) <= A.directionTolDeg);
    let sx = 0, sy = 0; for (const c of around) { const a = (2 * c.directionDeg! * Math.PI) / 180; sx += c.coherence * Math.cos(a); sy += c.coherence * Math.sin(a); }
    const dir = (((Math.atan2(sy, sx) * 180) / Math.PI / 2) % 180 + 180) % 180;
    for (const c of cells) c.aligned = c.pitchPx != null && c.coherence >= A.minCoherence && angDiff(c.directionDeg!, dir) <= A.directionTolDeg;
    // Pitch clusters among the aligned cells: greedy, the most populous first.
    // Pitch clusters among the aligned cells: the pitches sorted and split where consecutive ones differ by more than
    // the tolerance. The most populous cluster is the main planting; near a tie (within A.tieShare) the narrower pitch
    // is (a spacing and its double in one frame are read with the narrower as the planted one, so the scale does not
    // flip from frame to frame). Clusters too small to be a planting of their own are not read.
    const aligned = cells.filter(c => c.aligned).sort((u, v) => u.pitchPx! - v.pitchPx!);
    const groups: AssessCell[][] = [];
    for (const c of aligned) { const g = groups[groups.length - 1]; if (g && c.pitchPx! / g[g.length - 1].pitchPx! - 1 <= A.pitchClusterTol) g.push(c); else groups.push([c]); }
    groups.sort((u, v) => (Math.abs(u.length - v.length) <= A.tieShare * Math.max(u.length, v.length) ? u[0].pitchPx! - v[0].pitchPx! : v.length - u.length));
    const clusters: number[] = [];
    for (const g of groups) {
      if (clusters.length && g.length < A.minClusterCells) { for (const c of g) c.aligned = false; continue; }
      const id = clusters.length; clusters.push(median(g.map(c => c.pitchPx!))!);
      for (const c of g) c.cluster = id;
    }
    field = { directionDeg: r3(dir), pitchPx: clusters[0], clusters };
  }

  // 5. Scale: given, or the main pitch is the default spacing (as the readers assume without a pixel size).
  const gsdM = given ?? (field ? params.defaultSpacingM / field.pitchPx : null);
  const scaleBasis: FieldAssessment["scaleBasis"] = given ? "given" : field ? "assumed spacing" : "none";
  if (field && !given) notes.push(`No pixel size: the main planting's pitch is taken as ${(params.defaultSpacingM * 100).toFixed(1)} cm, so every size here rests on that.`);
  if (field && field.clusters.length > 1) {
    const others = field.clusters.slice(1).map(p => `${(p * (gsdM ?? 0) * 100).toFixed(0)} cm`);
    notes.push(`More than one row spacing in the photo: the main planting at ${(field.pitchPx * (gsdM ?? 0) * 100).toFixed(0)} cm and another at ${others.join(", ")}; each is read with its own spacing.`);
  }

  // 6. Each cell's state from its own evidence.
  for (const c of cells) {
    if (c.green < A.bareGreen) { c.state = "bare"; continue; }
    if (!c.aligned) { c.state = c.green >= A.coverGreen ? "cover" : "unknown"; continue; }
    if (c.green >= A.canopyGreen) { c.state = "canopy"; continue; } // closed or not is decided per region below
    if ((c.alleyDepth ?? 0) < A.rowsMinAlleyDepth) { c.state = "unknown"; c.aligned = false; c.cluster = null; continue; }
    const diamM = c.plantDiamPx != null && gsdM != null ? c.plantDiamPx * gsdM : null;
    c.state = diamM != null && diamM <= A.seedlingDiamM && c.green <= A.seedlingMaxGreen ? "seedlings" : "rows";
  }
  // A lone cell unlike all its 4-neighbours of a readable state takes their state when they agree (one cell's noise
  // is not a region); bare and cover cells stay what they are.
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? null : cells[r * cols + c]);
  const readable = new Set<CropState>(["seedlings", "rows", "canopy", "closed"]);
  // An unknown cell (too few plants for a periodicity of its own: a thin stretch, a dim corner) joins the readable
  // state and planting that most of its neighbours share: the rows run on through it, and the reader will trace them.
  const next = cells.map(c => c.state), nextCluster = cells.map(c => c.cluster);
  for (const c of cells) {
    const nbs = [at(c.col - 1, c.row), at(c.col + 1, c.row), at(c.col, c.row - 1), at(c.col, c.row + 1)].filter((n): n is AssessCell => !!n && readable.has(n.state));
    const i = c.row * cols + c.col;
    if (c.state === "unknown") {
      const counts = new Map<string, number>(); for (const n of nbs) { const k = `${n.state}|${n.cluster}`; counts.set(k, (counts.get(k) ?? 0) + 1); }
      const top = [...counts.entries()].sort((u, v) => v[1] - u[1])[0];
      if (top && top[1] >= A.joinNeighbours) { const [s, cl] = top[0].split("|"); next[i] = s as CropState; nextCluster[i] = Number(cl); }
      continue;
    }
    if (!readable.has(c.state)) continue;
    const same = nbs.filter(n => n.cluster === c.cluster);
    if (same.length < 2) continue;
    const counts = new Map<CropState, number>(); for (const n of same) counts.set(n.state, (counts.get(n.state) ?? 0) + 1);
    const [top, n] = [...counts.entries()].sort((u, v) => v[1] - u[1])[0];
    if (top !== c.state && n === same.length) next[i] = top;
  }
  cells.forEach((c, i) => { c.state = next[i]; c.cluster = nextCluster[i]; });

  // 7. Regions: 4-connected cells of one state and pitch cluster.
  const regions: AssessRegion[] = [];
  for (const seed of cells) {
    if (seed.region >= 0) continue;
    const id = regions.length, members: AssessCell[] = [], q = [seed]; seed.region = id;
    while (q.length) {
      const c = q.pop()!; members.push(c);
      for (const n of [at(c.col - 1, c.row), at(c.col + 1, c.row), at(c.col, c.row - 1), at(c.col, c.row + 1)]) if (n && n.region < 0 && n.state === seed.state && n.cluster === seed.cluster) { n.region = id; q.push(n); }
    }
    const rowsState = readable.has(seed.state);
    regions.push({
      id, state: seed.state, cells: members.map(c => c.row * cols + c.col),
      directionDeg: rowsState && field ? field.directionDeg : null, pitchPx: rowsState && field && seed.cluster != null ? r3(field.clusters[seed.cluster]) : null,
      x0: Math.min(...members.map(c => c.x0)), y0: Math.min(...members.map(c => c.y0)), x1: Math.max(...members.map(c => c.x1)), y1: Math.max(...members.map(c => c.y1)),
      confidence: r3(members.reduce((u, c) => u + c.coherence, 0) / members.length), areaShare: r3(members.length / cells.length),
    });
  }
  // A small readable region beside a much larger one of the same planting is a patch of that planting (a dense corner
  // of a V7 field is not a closed canopy of its own; a few larger plants among seedlings are not a planting): it takes
  // the larger region's state, so one planting is read by one reader.
  for (let pass = 0; pass < 4; pass++) {
    const largest = Math.max(0, ...regions.filter(r => readable.has(r.state)).map(r => r.cells.length));
    let merged = false;
    for (const r of regions) {
      if (!readable.has(r.state) || r.cells.length >= Math.max(A.minMergeCells, A.mergeShare * largest)) continue;
      const touching = new Set<number>();
      for (const i of r.cells) { const c = cells[i]; for (const n of [at(c.col - 1, c.row), at(c.col + 1, c.row), at(c.col, c.row - 1), at(c.col, c.row + 1)]) if (n && n.region !== r.id && readable.has(n.state) && n.cluster === c.cluster) touching.add(n.region); }
      const into = [...touching].map(id => regions[id]).filter(o => o.cells.length > r.cells.length).sort((u, v) => v.cells.length - u.cells.length)[0];
      if (!into) continue;
      for (const i of r.cells) { cells[i].state = into.state; cells[i].region = into.id; }
      into.cells.push(...r.cells); r.cells = [];
      into.x0 = Math.min(into.x0, r.x0); into.y0 = Math.min(into.y0, r.y0); into.x1 = Math.max(into.x1, r.x1); into.y1 = Math.max(into.y1, r.y1);
      merged = true;
    }
    if (!merged) break;
  }
  for (let i = regions.length - 1; i >= 0; i--) if (!regions[i].cells.length) regions.splice(i, 1);
  for (const r of regions) { const m = r.cells.map(i => cells[i]); r.confidence = r3(m.reduce((u, c) => u + c.coherence, 0) / m.length); r.areaShare = r3(m.length / cells.length); }
  // A canopy region is closed when its cells' median alley depth says so (one planting, one reader).
  for (const r of regions) {
    if (r.state !== "canopy") continue;
    const depth = median(r.cells.map(i => cells[i].alleyDepth).filter((d): d is number => d != null));
    if (depth != null && depth < A.closedAlleyDepth) { r.state = "closed"; for (const i of r.cells) cells[i].state = "closed"; }
  }
  regions.sort((u, v) => v.cells.length - u.cells.length);
  const remap = new Map(regions.map((r, i) => [r.id, i])); regions.forEach((r, i) => { r.id = i; }); for (const c of cells) c.region = remap.get(c.region)!;
  const share = (s: CropState) => cells.filter(c => c.state === s).length / cells.length;
  opts.debug?.(`assess: field ${field ? `${field.directionDeg} deg, pitch ${field.clusters.map(p => p.toFixed(0)).join("/")} px` : "none"}; states bare ${(share("bare") * 100).toFixed(0)}% seedlings ${(share("seedlings") * 100).toFixed(0)}% rows ${(share("rows") * 100).toFixed(0)}% canopy ${(share("canopy") * 100).toFixed(0)}% closed ${(share("closed") * 100).toFixed(0)}% cover ${(share("cover") * 100).toFixed(0)}% unknown ${(share("unknown") * 100).toFixed(0)}%; ${regions.length} regions`);
  return { width: px.width, height: px.height, workFactor: f, cols, rows, cellPx: cellPx * f, cells, regions, field, gsdM: gsdM == null ? null : r3(gsdM * 1e5) / 1e5, scaleBasis, notes, ms: Date.now() - t0 };
}
