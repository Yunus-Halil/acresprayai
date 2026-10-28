// Boundary evidence: what the photographs show on each small square of ground, as one of six classes, in the
// field's own frame (metres along and across the rows). The boundary engine (boundary.ts) reads this raster to
// find where the cultivated block ends; nothing else does. It is built from per-cell measurements that a script
// samples from the original photographs (scripts/directGeoref/boundaryEvidence.ts) and from the twin's reconciled
// trees; the rules that turn measurements into classes live here so the app and the tests share them.
//
// Classes:
//   unseen    no photograph covered the cell: the engine never extends a boundary into it
//   soil      bare or sparsely vegetated ground, tilled or not: the field's own ground (small weed patches too)
//   canopy    under a tree that stands on one of the field's rows: the field's own ground
//   cover     dense vegetation of any colour over a large connected area: another crop, a sward, a hedge, a verge
//   road      bright, low-saturation, untextured ground: a track, a road, concrete, a building
//   foreign   under a tree that is NOT on the field's rows: a hedge tree or another planting, widened so a row of
//             them reads as a band the engine stops at

export const EVIDENCE_CLASSES = ["unseen", "soil", "canopy", "cover", "road", "foreign"] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];
export const EV: Record<EvidenceClass, number> = { unseen: 0, soil: 1, canopy: 2, cover: 3, road: 4, foreign: 5 };

export type EvidenceRaster = {
  /** Metres per cell. */
  cellM: number;
  /** Field-frame coordinates (along, across) of the raster's minimum corner. */
  along0: number;
  across0: number;
  width: number;
  height: number;
  /** One class code per cell (EV), row-major from the minimum corner. */
  cls: Uint8Array;
};

/** The per-cell measurements the sampling script writes, in the same layout as the raster. */
export type EvidenceMeasures = {
  cellM: number;
  along0: number;
  across0: number;
  width: number;
  height: number;
  /** 1 where some photograph covered the cell. */
  seen: Uint8Array;
  /** Share of the cell's pixels that are cover of any colour (ExGR over COVER_EXGR), 0 to 1. */
  cover: Float32Array;
  /** Mean brightness, 0 to 255. */
  luma: Float32Array;
  /** Mean saturation, 0 to 1. */
  sat: Float32Array;
};

/** A tree for the classifier: field-frame position, crown radius, and whether it stands on one of the field's rows. */
export type EvidenceTree = { along: number; across: number; r: number; onRow: boolean };

export type ClassifyOptions = {
  /** A cell is cover when at least this share of its pixels is cover. Wheat and a hedge measure 1.0, bare soil 0. */
  coverShare: number;
  /** A cover component smaller than this is a weed patch or a shrub, kept as the field's own ground. */
  minCoverM2: number;
  /** Road: cover share at most this, saturation at most `roadSat`, brightness at least `roadLuma`. */
  roadCover: number;
  roadSat: number;
  roadLuma: number;
  minRoadM2: number;
  /** A foreign tree's disc is at least this radius and is widened by this much, so a row of them closes into a band. */
  foreignMinR: number;
  foreignPadM: number;
};

/**
 * Measured on the apricot flight (data/direct-georef/apricot/boundary): wheat and the hedge have a cover share of
 * 1.0, bare soil 0 with weeds pushing its 90th percentile to 0.76 at a quarter-metre; the track reads saturation
 * 0.27 and brightness 160 against soil's 0.43 and 128.
 */
export const CLASSIFY_DEFAULTS: ClassifyOptions = { coverShare: 0.6, minCoverM2: 40, roadCover: 0.3, roadSat: 0.34, roadLuma: 135, minRoadM2: 20, foreignMinR: 1, foreignPadM: 0.75 };

export type ClassifyStats = { cells: Record<EvidenceClass, number>; coverComponentsKept: number; coverComponentsDropped: number; roadComponentsKept: number; roadComponentsDropped: number };

/** The evidence raster from the measurements and the trees. Deterministic: the same inputs give the same raster. */
export function classifyEvidence(m: EvidenceMeasures, trees: EvidenceTree[], opts: Partial<ClassifyOptions> = {}): { raster: EvidenceRaster; stats: ClassifyStats } {
  const o = { ...CLASSIFY_DEFAULTS, ...opts };
  const { width: W, height: H, cellM } = m, N = W * H;
  const cls = new Uint8Array(N);
  for (let c = 0; c < N; c++) {
    if (!m.seen[c]) { cls[c] = EV.unseen; continue; }
    if (m.cover[c] >= o.coverShare) cls[c] = EV.cover;
    else if (m.cover[c] <= o.roadCover && m.sat[c] <= o.roadSat && m.luma[c] >= o.roadLuma) cls[c] = EV.road;
    else cls[c] = EV.soil;
  }
  // A 3 x 3 majority over soil / cover / road removes single-cell speckle; unseen cells stay unseen.
  const maj = new Uint8Array(cls);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = j * W + i;
    if (cls[c] === EV.unseen) continue;
    const n = [0, 0, 0, 0, 0, 0];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
      n[cls[jj * W + ii]]++;
    }
    let best = cls[c], bn = -1;
    for (const k of [EV.soil, EV.cover, EV.road]) if (n[k] > bn) { bn = n[k]; best = k; }
    maj[c] = best;
  }
  // Trees: the field's own crowns are canopy, the rest foreign, each a disc; foreign discs widened into a band.
  const paint = (t: EvidenceTree, code: number, r: number) => {
    const i0 = Math.max(0, Math.floor((t.along - r - m.along0) / cellM)), i1 = Math.min(W - 1, Math.ceil((t.along + r - m.along0) / cellM));
    const j0 = Math.max(0, Math.floor((t.across - r - m.across0) / cellM)), j1 = Math.min(H - 1, Math.ceil((t.across + r - m.across0) / cellM));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const al = m.along0 + (i + 0.5) * cellM, ac = m.across0 + (j + 0.5) * cellM;
      if ((al - t.along) ** 2 + (ac - t.across) ** 2 > r * r) continue;
      const c = j * W + i;
      if (maj[c] !== EV.unseen) maj[c] = code;
    }
  };
  for (const t of trees) if (t.onRow) paint(t, EV.canopy, t.r);
  for (const t of trees) if (!t.onRow) paint(t, EV.foreign, Math.max(t.r, o.foreignMinR) + o.foreignPadM);
  // Small cover and road components are the field's own ground (weed patches, a bright patch of dry soil).
  const stats: ClassifyStats = { cells: { unseen: 0, soil: 0, canopy: 0, cover: 0, road: 0, foreign: 0 }, coverComponentsKept: 0, coverComponentsDropped: 0, roadComponentsKept: 0, roadComponentsDropped: 0 };
  const minCells = { [EV.cover]: Math.ceil(o.minCoverM2 / (cellM * cellM)), [EV.road]: Math.ceil(o.minRoadM2 / (cellM * cellM)) };
  const seen = new Uint8Array(N);
  const stack: number[] = [];
  for (let s = 0; s < N; s++) {
    const code = maj[s];
    if ((code !== EV.cover && code !== EV.road) || seen[s]) continue;
    const members: number[] = [];
    stack.length = 0; stack.push(s); seen[s] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      members.push(c);
      const i = c % W, j = (c - i) / W;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
        const q = jj * W + ii;
        if (!seen[q] && maj[q] === code) { seen[q] = 1; stack.push(q); }
      }
    }
    const keep = members.length >= minCells[code];
    if (code === EV.cover) { if (keep) stats.coverComponentsKept++; else stats.coverComponentsDropped++; } else { if (keep) stats.roadComponentsKept++; else stats.roadComponentsDropped++; }
    if (!keep) for (const c of members) maj[c] = EV.soil;
  }
  for (let c = 0; c < N; c++) stats.cells[EVIDENCE_CLASSES[maj[c]]]++;
  return { raster: { cellM, along0: m.along0, across0: m.across0, width: W, height: H, cls: maj }, stats };
}

/** The class at a field-frame point, or unseen outside the raster. */
export function evidenceAt(r: EvidenceRaster, along: number, across: number): number {
  const i = Math.floor((along - r.along0) / r.cellM), j = Math.floor((across - r.across0) / r.cellM);
  if (i < 0 || j < 0 || i >= r.width || j >= r.height) return EV.unseen;
  return r.cls[j * r.width + i];
}

/** The raster at a coarser cell (an integer factor), each coarse cell taking the most common class of its fine cells. */
export function downsampleEvidence(r: EvidenceRaster, factor: number): EvidenceRaster {
  if (factor <= 1) return r;
  const W = Math.ceil(r.width / factor), H = Math.ceil(r.height / factor);
  const cls = new Uint8Array(W * H);
  const n = [0, 0, 0, 0, 0, 0];
  for (let J = 0; J < H; J++) for (let I = 0; I < W; I++) {
    n.fill(0);
    for (let j = J * factor; j < Math.min(r.height, (J + 1) * factor); j++) for (let i = I * factor; i < Math.min(r.width, (I + 1) * factor); i++) n[r.cls[j * r.width + i]]++;
    let best = 0;
    for (let k = 1; k < 6; k++) if (n[k] > n[best]) best = k;
    cls[J * W + I] = best;
  }
  return { cellM: r.cellM * factor, along0: r.along0, across0: r.across0, width: W, height: H, cls };
}

// ------------------------------------------------------------------------------------------------------------------
// The raster in a bundle: run-length encoded (class byte, varint length) and base64, so a 0.5 m raster of a field
// is tens of kilobytes rather than hundreds.
// ------------------------------------------------------------------------------------------------------------------

export type EncodedEvidence = { cellM: number; along0: number; across0: number; width: number; height: number; classes: readonly string[]; rle: string };

const toBase64 = (bytes: Uint8Array): string => {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (s: string): Uint8Array => {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export function encodeEvidence(r: EvidenceRaster): EncodedEvidence {
  const out: number[] = [];
  const N = r.cls.length;
  for (let i = 0; i < N;) {
    const code = r.cls[i];
    let n = 1;
    while (i + n < N && r.cls[i + n] === code) n++;
    out.push(code);
    let v = n;
    while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
    out.push(v);
    i += n;
  }
  return { cellM: r.cellM, along0: r.along0, across0: r.across0, width: r.width, height: r.height, classes: EVIDENCE_CLASSES, rle: toBase64(Uint8Array.from(out)) };
}

/** The raster back from a bundle, or null when the encoding does not fill its stated size. */
export function decodeEvidence(e: EncodedEvidence): EvidenceRaster | null {
  const bytes = fromBase64(e.rle), N = e.width * e.height, cls = new Uint8Array(N);
  let p = 0, at = 0;
  while (p < bytes.length && at < N) {
    const code = bytes[p++];
    let n = 0, shift = 0, b: number;
    do { if (p >= bytes.length) return null; b = bytes[p++]; n |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    if (code >= EVIDENCE_CLASSES.length || at + n > N) return null;
    cls.fill(code, at, at + n);
    at += n;
  }
  if (at !== N) return null;
  return { cellM: e.cellM, along0: e.along0, across0: e.across0, width: e.width, height: e.height, cls };
}
