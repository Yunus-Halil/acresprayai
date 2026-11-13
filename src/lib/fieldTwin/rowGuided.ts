// Reading along the rows the field already knows (docs/features/corn-row-guided-reading.md, 2026-11-12).
//
// Corn V1 reads each photograph bottom-up, and the field joins what the photographs drew. A row a photograph missed
// stays missed in it. Here the flow is turned round, in three parts, each a pure function:
//
//   latticeRows    every row the planting must contain, from the first pass alone: the planted ground (cornField's
//                  plantedGround) knows, per square, the spacing and where across it the rows sit. One line per row,
//                  bridged along over ground with few plants, never over scattered ground.
//   searchPhoto    one photograph: every row line that crosses it, projected through its camera; a band on the row and
//                  a control strip either side, straightened. Pixels are scored against the soil right there: the
//                  green tint a pixel shows beyond what that soil shows at the pixel's own brightness, in units of
//                  the spread of that same quantity over the soil. Soil of any brightness (sunlit, shaded, wet)
//                  scores about nought, and the unit is the photograph's own noise, so no figure is tied to one soil
//                  or one exposure. (Tried first and dropped, 2026-11-12: tint over the channel sum, in spreads of
//                  that ratio. A ratio is noisy where the pixel is dark, and clod shadows lit the control strips at
//                  2.5 candidates a metre against 5 on the row.) The bar is the lowest at which the control strips
//                  stay quiet, and the false alarms that bar still lets through are measured on them.
//   mergeAlongRows the photographs' candidates joined along each row into one mark per plant: a photograph that covers
//                  the place and finds nothing counts against it (log-odds, as in occupancy mapping). The control
//                  strips are merged by the same rule, and a stretch of row is verified only where the band holds
//                  clearly more marks than its controls.
//
// One rule against self-confirmation: marks found here lie on the rows by construction, so they never go back into
// the planted-ground judgement or the lattice. Nothing here is wired into the build yet; scripts/rowCrop/rowGuidedBench.ts
// runs it over a stored build.
import type { PhotoPixels } from "../photoScout/pattern";
import { fromEnu, toEnu, type LatLngAlt } from "../sourceFrames/odm";
import { groundToPixel, pixelToGround, type GeorefFrame } from "../directGeoref/projection";
import type { PlantedGround } from "./cornField";
import { type LookModel, lookShift } from "./fieldLook";

export const ROW_GUIDED = {
  /** Lattice: squares of neighbouring columns belong to one row within this share of the spacing (cornField's sameRowShare). */
  sameRowShare: 0.25,
  /** ... a row is carried along over ground the plants do not judge (wheel tracks, thin stand) for at most this far, metres ... */
  bridgeM: 6,
  /** ... and is looked for this far past its last planted square, where the verification decides, metres. */
  extendM: 3,
  /** A lattice row shorter than this is no row, metres. */
  minRowM: 3,
  /** Control strips are centred this share of the spacing either side of the row (clear of the leaves, clear of the next row). */
  controlShare: 0.35,
  /** The soil's centre and spread are taken per this length of row, metres (about a row spacing: it always holds alley soil). */
  soilBlockM: 1,
  /** Strict scores tried, in soil spreads: a candidate needs a pixel at the strict score ... */
  ladder: [3, 4, 5, 6.5, 8, 10, 13, 16],
  /** ... and is the connected pixels at this score or more around it. */
  weakZ: 2.5,
  /** The score is smoothed over this many pixels each way before it is judged (the camera stores colour at half the
   * resolution of brightness, so single-pixel colour is noise). */
  smoothPx: 1,
  /** A candidate is at least this large on the ground, square centimetres (a seedling leaf is a centimetre wide). */
  minAreaCm2: 1,
  /** The bar is the lowest strict score at which the first control strip holds at most this many candidates a metre. */
  controlPerM: 0.3,
  /** Pixels the sensor cannot speak for: nearly black, or clipped. Counted as not seen, never as empty. */
  darkSum: 45, clipLevel: 250,
  /** A mark needs this many photographs ... */
  minViews: 2,
  /** ... and a stretch of row this long is verified when its band holds at least minBand marks and beats its controls at alpha. */
  stretchM: 5, minBand: 4, alpha: 0.01,
};
export type RowGuidedOptions = typeof ROW_GUIDED;

/** A row the planting must contain, in the field's row frame (along, across), one point per square along. */
export type LatticeRow = { id: number; ac: [number, number][]; /** False where the row is carried over ground the plants do not judge. */ planted: boolean[] };

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };

/** Every row the planted ground implies (see the header). */
export function latticeRows(pg: PlantedGround, o: RowGuidedOptions = ROW_GUIDED): LatticeRow[] {
  const d = pg.spacingM, tol = o.sameRowShare * d, bridge = Math.max(1, Math.round(o.bridgeM / pg.cellA));
  // Per column along: the rows' across positions, each square giving the lattice line inside it; near-duplicates merged.
  const cols: { c: number; used: boolean }[][] = [];
  for (let i = 0; i < pg.w; i++) {
    const cs: number[] = [];
    for (let j = 0; j < pg.h; j++) {
      const k = j * pg.w + i; if (pg.state[k] !== 1 || !Number.isFinite(pg.rowOffset[k])) continue;
      const base = pg.c0 + j * pg.cellC; cs.push(base + ((((pg.rowOffset[k] - base) % d) + d) % d));
    }
    cs.sort((a, b) => a - b);
    const merged: number[][] = [];
    for (const c of cs) { const last = merged[merged.length - 1]; if (last && c - last[last.length - 1] <= tol) last.push(c); else merged.push([c]); }
    cols.push(merged.map(g => ({ c: g.reduce((s, v) => s + v, 0) / g.length, used: false })));
  }
  const aOf = (i: number) => pg.a0 + (i + 0.5) * pg.cellA;
  const rows: LatticeRow[] = [];
  for (let i0 = 0; i0 < pg.w; i0++) for (const start of cols[i0]) {
    if (start.used) continue;
    start.used = true;
    const idx = [i0], cv = [start.c];
    for (let i = i0;;) {
      let next: { c: number; used: boolean } | null = null, ni = -1;
      for (let s = 1; s <= bridge + 1 && i + s < pg.w && !next; s++) {
        let best: { c: number; used: boolean } | null = null, bd = tol;
        for (const p of cols[i + s]) { const dd = Math.abs(p.c - cv[cv.length - 1]); if (!p.used && dd <= bd) { bd = dd; best = p; } }
        if (best) { next = best; ni = i + s; }
        // Never carried over scattered ground.
        else if (pg.at(aOf(i + s), cv[cv.length - 1]) === 2) break;
      }
      if (!next) break;
      next.used = true; idx.push(ni); cv.push(next.c); i = ni;
    }
    if ((idx[idx.length - 1] - idx[0] + 1) * pg.cellA < o.minRowM) continue;
    // Smooth across over five squares, fill the bridged columns, and look a little past both ends.
    const sm = cv.map((_, k) => median(cv.slice(Math.max(0, k - 2), k + 3)));
    const ac: [number, number][] = [], planted: boolean[] = [];
    const ext = Math.round(o.extendM / pg.cellA);
    for (let e = ext; e >= 1; e--) { const i = idx[0] - e; if (i >= 0 && pg.at(aOf(i), sm[0]) !== 2) { ac.push([aOf(i), sm[0]]); planted.push(false); } }
    for (let k = 0; k < idx.length; k++) {
      ac.push([aOf(idx[k]), sm[k]]); planted.push(true);
      if (k + 1 < idx.length) for (let i = idx[k] + 1; i < idx[k + 1]; i++) { const t = (i - idx[k]) / (idx[k + 1] - idx[k]); ac.push([aOf(i), sm[k] + t * (sm[k + 1] - sm[k])]); planted.push(false); }
    }
    for (let e = 1; e <= ext; e++) { const i = idx[idx.length - 1] + e; if (i < pg.w && pg.at(aOf(i), sm[sm.length - 1]) !== 2) { ac.push([aOf(i), sm[sm.length - 1]]); planted.push(false); } else break; }
    rows.push({ id: rows.length + 1, ac, planted });
  }
  return rows;
}

/** A row line on the ground for the search: local metres east/north, one vertex per `stepM` of row, `a0` the along position of the first. */
export type RowLine = { id: number; a0: number; stepM: number; en: [number, number][] };
/** 0 the band on the row, 1 and 2 the control strips either side. */
export type Strip = 0 | 1 | 2;
export type Candidate = { row: number; strip: Strip; /** Along the row, metres (the row frame's along). */ a: number; /** Across from the row line, metres. */ off: number; areaCm2: number; /** Its strongest pixel, in soil spreads. */ z: number; /** Its centre in the photograph, pixels of the decoded image. */ u: number; v: number;
  /** What it looks like, with no position in it (for the per-field visual model): mean score in soil spreads; length of
   * its long axis, cm; long over short axis; brightness against its soil (0 the same, -0.3 a third darker). */
  zMean: number; lengthCm: number; elong: number; dLum: number };
export type PhotoSearch = {
  name: string;
  /** Every candidate whose strongest pixel reaches the lowest strict score of the ladder. */
  candidates: Candidate[];
  /** Stretches of each row this photograph covers readably. */
  covered: { row: number; a0: number; a1: number }[];
  rowM: number;
  /** Share of sampled pixels the sensor could not speak for. */
  unreadableShare: number;
  /** The soil's spread of the score's quantity (grey levels of tint), median over the blocks: how noisy this photograph's soil is. */
  soilSpread: number;
  ms: number;
};

/** One photograph searched along every row line that crosses it (see the header). `bandHalfM`: half the band's width. */
export function searchPhoto(name: string, px: PhotoPixels, frame: GeorefFrame, rows: RowLine[], origin: LatLngAlt, spacingM: number, bandHalfM: number, o: RowGuidedOptions = ROW_GUIDED): PhotoSearch {
  const t0 = Date.now(), W = px.width, H = px.height, d = px.rgba;
  const sx = W / frame.intrinsics.width, sy = H / frame.intrinsics.height;
  const alt = frame.ground.kind === "flat" ? frame.ground.altM : frame.pose.altM, margin = 0.02 * Math.min(W, H);
  const candidates: Candidate[] = [], covered: PhotoSearch["covered"] = [];
  const centres = [0, o.controlShare * spacingM, -o.controlShare * spacingM];
  let rowM = 0, seenPx = 0, badPx = 0; const spreads: number[] = [];
  for (const row of rows) {
    // The row's vertices in this photograph; runs of consecutive vertices inside the frame.
    // A point is in the photograph only if the pixel it lands on looks back at it: far outside the field of view the
    // lens model's polynomial folds ground points back into the frame (rows 30 m away landed mid-frame, 2026-11-12).
    const uv: ([number, number] | null)[] = row.en.map(([e, n]) => {
      const ll = fromEnu([e, n, 0], origin), h = groundToPixel(frame, ll.lat, ll.lng, alt); if (!h) return null;
      const u = h.u * sx, v = h.v * sy; if (u < margin || v < margin || u >= W - margin || v >= H - margin) return null;
      const back = pixelToGround(frame, h.u, h.v); if (!back) return null;
      const b = toEnu({ lat: back.lat, lng: back.lng, altM: 0 }, origin);
      return Math.hypot(b[0] - e, b[1] - n) <= 0.05 ? [u, v] : null;
    });
    for (let k0 = 0; k0 < uv.length;) {
      if (!uv[k0]) { k0++; continue; }
      let k1 = k0; while (k1 + 1 < uv.length && uv[k1 + 1]) k1++;
      if (k1 > k0) run(row, k0, k1, uv as [number, number][]);
      k0 = k1 + 1;
    }
  }
  function run(row: RowLine, k0: number, k1: number, uv: [number, number][]) {
    // Straightened strips: along at one photograph pixel a sample, across at one pixel a sample.
    const segLen: number[] = []; let L = 0;
    for (let k = k0; k < k1; k++) { const l = Math.hypot(uv[k + 1][0] - uv[k][0], uv[k + 1][1] - uv[k][1]); segLen.push(l); L += l; }
    const n = Math.max(2, Math.round(L)), pxPerM = L / ((k1 - k0) * row.stepM), half = Math.max(1, Math.round(bandHalfM * pxPerM)), wp = 2 * half + 1;
    const cm2 = (100 / pxPerM) ** 2, minPx = Math.max(1, Math.round(o.minAreaCm2 / cm2));
    const g = [new Float32Array(n * wp), new Float32Array(n * wp), new Float32Array(n * wp)], lum = [new Float32Array(n * wp), new Float32Array(n * wp), new Float32Array(n * wp)], ok = [new Uint8Array(n * wp), new Uint8Array(n * wp), new Uint8Array(n * wp)];
    const alongM = new Float32Array(n), cxA = new Float32Array(n), cyA = new Float32Array(n), dxA = new Float32Array(n), dyA = new Float32Array(n);
    let seg = 0, acc = 0;
    for (let i = 0; i < n; i++) {
      const s = (i / (n - 1)) * L;
      while (seg < segLen.length - 1 && s > acc + segLen[seg]) { acc += segLen[seg]; seg++; }
      const k = k0 + seg, t = segLen[seg] > 0 ? Math.min(1, (s - acc) / segLen[seg]) : 0;
      const dx = (uv[k + 1][0] - uv[k][0]) / (segLen[seg] || 1), dy = (uv[k + 1][1] - uv[k][1]) / (segLen[seg] || 1);
      const cx = uv[k][0] + t * (uv[k + 1][0] - uv[k][0]), cy = uv[k][1] + t * (uv[k + 1][1] - uv[k][1]);
      alongM[i] = row.a0 + (seg + k0 + t) * row.stepM; cxA[i] = cx; cyA[i] = cy; dxA[i] = dx; dyA[i] = dy;
      for (let st = 0; st < 3; st++) {
        const oc = centres[st] * pxPerM;
        for (let j = 0; j < wp; j++) {
          const off = oc + (j - half), x = Math.round(cx - dy * off), y = Math.round(cy + dx * off), q = i * wp + j;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const p = (y * W + x) * 4, r = d[p], gg = d[p + 1], b = d[p + 2], sum = r + gg + b;
          seenPx++;
          if (sum < o.darkSum || r >= o.clipLevel || gg >= o.clipLevel || b >= o.clipLevel) { badPx++; continue; }
          g[st][q] = gg - (r + b) / 2; lum[st][q] = sum / 3; ok[st][q] = 1;
        }
      }
    }
    // The soil per block of row. Its tint is in proportion to its brightness (one colour, more or less light), so the
    // block's soil is one number: the median of tint over brightness, over everything sampled there (plants are a few
    // per cent of it). A pixel's excess is its tint beyond what that soil shows at the pixel's own brightness; the
    // excess is smoothed, and judged in units of its own spread over the block.
    const block = Math.max(8, Math.round(o.soilBlockM * pxPerM)), buf = new Float32Array(block * wp * 3), tmp = new Float32Array(n * wp), sm = o.smoothPx, soilLumA = new Float32Array(n);
    for (let i0 = 0; i0 < n; i0 += block) {
      const i1 = Math.min(n, i0 + block); let m = 0;
      for (let st = 0; st < 3; st++) for (let q = i0 * wp; q < i1 * wp; q++) if (ok[st][q]) buf[m++] = g[st][q] / lum[st][q];
      if (m < 30) { for (let st = 0; st < 3; st++) ok[st].fill(0, i0 * wp, i1 * wp); continue; }
      const kSoil = buf.subarray(0, m).slice().sort()[m >> 1];
      m = 0;
      for (let st = 0; st < 3; st++) for (let q = i0 * wp; q < i1 * wp; q++) if (ok[st][q]) buf[m++] = lum[st][q];
      soilLumA.fill(buf.subarray(0, m).slice().sort()[m >> 1], i0, i1);
      m = 0;
      for (let st = 0; st < 3; st++) {
        const e = g[st], good = ok[st];
        for (let q = i0 * wp; q < i1 * wp; q++) if (good[q]) e[q] -= kSoil * lum[st][q];
        if (sm > 0) {
          for (let i = i0; i < i1; i++) for (let j = 0; j < wp; j++) { let s = 0, c = 0; for (let di = -sm; di <= sm; di++) for (let dj = -sm; dj <= sm; dj++) { const ii = i + di, jj = j + dj; if (ii < i0 || jj < 0 || ii >= i1 || jj >= wp) continue; const qq = ii * wp + jj; if (good[qq]) { s += e[qq]; c++; } } tmp[i * wp + j] = c ? s / c : 0; }
          for (let q = i0 * wp; q < i1 * wp; q++) if (good[q]) e[q] = tmp[q];
        }
        for (let q = i0 * wp; q < i1 * wp; q++) if (good[q]) buf[m++] = e[q];
      }
      const s = buf.subarray(0, m).slice().sort(), med = s[m >> 1];
      for (let q = 0; q < m; q++) s[q] = Math.abs(s[q] - med);
      s.sort(); const spread = Math.max(0.05, 1.4826 * s[m >> 1]);
      spreads.push(spread);
      for (let st = 0; st < 3; st++) for (let q = i0 * wp; q < i1 * wp; q++) if (ok[st][q]) g[st][q] = (g[st][q] - med) / spread;
    }
    rowM += (k1 - k0) * row.stepM;
    covered.push({ row: row.id, a0: row.a0 + k0 * row.stepM, a1: row.a0 + k1 * row.stepM });
    // Candidates: connected pixels at the weak score, kept when their strongest pixel reaches the ladder's first step.
    const seen = new Uint8Array(n * wp), stack: number[] = [], zMin = o.ladder[0];
    for (let st = 0; st < 3; st++) {
      const z = g[st], good = ok[st]; seen.fill(0);
      for (let q0 = 0; q0 < n * wp; q0++) {
        if (!good[q0] || z[q0] < zMin || seen[q0]) continue;
        let area = 0, si = 0, sj = 0, zmax = 0, sii = 0, sjj = 0, sij = 0, sz = 0, sl = 0, sSoil = 0;
        seen[q0] = 1; stack.push(q0);
        while (stack.length) {
          const q = stack.pop()!, j = q % wp, i = (q - j) / wp; area++; si += i; sj += j; sii += i * i; sjj += j * j; sij += i * j; sz += z[q]; sl += lum[st][q]; sSoil += soilLumA[i]; if (z[q] > zmax) zmax = z[q];
          for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= n || jj >= wp) continue; const qq = ii * wp + jj; if (good[qq] && !seen[qq] && z[qq] >= o.weakZ) { seen[qq] = 1; stack.push(qq); } }
        }
        if (area < minPx) continue;
        const ci = si / area, cj = sj / area, i0 = Math.floor(ci), f = ci - i0, offPx = centres[st] * pxPerM + (cj - half);
        // Second moments (pixels; the strips are straightened at one pixel a sample): the axes of the candidate.
        const vi = sii / area - ci * ci + 1 / 12, vj = sjj / area - cj * cj + 1 / 12, cij = sij / area - ci * cj, tr = vi + vj, det = Math.sqrt(Math.max(0, ((vi - vj) / 2) ** 2 + cij * cij));
        const l1 = tr / 2 + det, l2 = Math.max(1 / 12, tr / 2 - det), cmPerPx = 100 / pxPerM;
        candidates.push({ u: Math.round(cxA[i0] - dyA[i0] * offPx), v: Math.round(cyA[i0] + dxA[i0] * offPx), row: row.id, strip: st as Strip, a: alongM[i0] + f * ((alongM[Math.min(n - 1, i0 + 1)] ?? alongM[i0]) - alongM[i0]), off: centres[st] + (cj - half) / pxPerM, areaCm2: Math.round(area * cm2 * 10) / 10, z: Math.round(zmax * 10) / 10,
          zMean: Math.round((sz / area) * 10) / 10, lengthCm: Math.round(4 * Math.sqrt(l1) * cmPerPx * 10) / 10, elong: Math.round(Math.sqrt(l1 / l2) * 100) / 100, dLum: Math.round((sl / Math.max(1, sSoil) - 1) * 1000) / 1000 });
      }
    }
  }
  return { name, candidates, covered, rowM, unreadableShare: seenPx ? badPx / seenPx : 0, soilSpread: spreads.length ? median(spreads) : NaN, ms: Date.now() - t0 };
}

/** The bar one photograph is read at: the lowest strict score whose first control strip stays quiet, and the false alarms a metre the second control strip still shows there. */
export function chooseLevel(s: PhotoSearch, o: RowGuidedOptions = ROW_GUIDED): { level: number; falsePerM: number; quiet: boolean } {
  const perM = (lv: number, strip: Strip) => (s.rowM > 0 ? s.candidates.filter(c => c.strip === strip && c.z >= o.ladder[lv]).length / s.rowM : 0);
  for (let lv = 0; lv < o.ladder.length; lv++) if (perM(lv, 1) <= o.controlPerM) return { level: lv, falsePerM: perM(lv, 2), quiet: true };
  const lv = o.ladder.length - 1;
  return { level: lv, falsePerM: perM(lv, 2), quiet: false };
}

export type Mark = { row: number; strip: Strip; a: number; off: number; views: number; covered: number; /** Position and photographs' evidence, then with the look added (equal without a look model). */ posLogOdds: number; logOdds: number; look: number; z: number; areaCm2: number; /** The candidates behind it, one a photograph (index into the searches used). */ members: (Candidate & { photo: number })[] };
export type RowStretch = { row: number; a0: number; a1: number; band: number; control: number; state: "verified" | "not verified" | "not covered" };
export type MergeResult = {
  marks: Mark[];
  /** Marks on the control strips, by the same rule: what the method finds where no row runs. */
  controlMarks: Mark[];
  stretches: RowStretch[];
  /** A photograph's chance of finding a plant that is there, and of a false candidate inside one merge gate, as used. */
  p: number; q: number;
};

/**
 * The photographs' candidates joined along each row (see the header). `gateM`: candidates of different photographs
 * within this distance along the row are one plant; two of the same photograph never are. `use` picks photographs
 * (the odd and the even halves, for the repeat check).
 */
export function mergeAlongRows(searches: PhotoSearch[], rows: RowLine[], gateM: number, o: RowGuidedOptions = ROW_GUIDED, use: (i: number) => boolean = () => true, look: LookModel | null = null): MergeResult {
  const list = searches.filter((_, i) => use(i)), levels = list.map(s => chooseLevel(s, o));
  type C = Candidate & { photo: number };
  const groups = new Map<string, C[]>();
  list.forEach((s, pi) => { const bar = o.ladder[levels[pi].level]; for (const c of s.candidates) { if (c.z < bar) continue; const k = `${c.row}:${c.strip}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push({ ...c, photo: pi }); } });
  const cov = new Map<number, { a0: number; a1: number }[]>();
  list.forEach(s => { for (const c of s.covered) (cov.get(c.row) ?? cov.set(c.row, []).get(c.row)!).push(c); });
  const coveredAt = (row: number, a: number) => (cov.get(row) ?? []).filter(c => a >= c.a0 && a <= c.a1).length;
  type Cl = { row: number; strip: Strip; members: C[] };
  const clusters: Cl[] = [];
  for (const [k, cs] of groups) {
    const [row, strip] = k.split(":").map(Number);
    cs.sort((x, y) => x.a - y.a);
    let cur: Cl | null = null, centre = 0;
    for (const c of cs) {
      if (cur && Math.abs(c.a - centre) <= gateM && !cur.members.some(m => m.photo === c.photo)) { cur.members.push(c); centre = cur.members.reduce((s, m) => s + m.a, 0) / cur.members.length; }
      else { cur = { row, strip: strip as Strip, members: [c] }; clusters.push(cur); centre = c.a; }
    }
  }
  const sized = clusters.map(cl => { const a = cl.members.reduce((s, m) => s + m.a, 0) / cl.members.length; return { cl, a, covered: Math.max(cl.members.length, coveredAt(cl.row, a)) }; });
  // A photograph's chance of finding a plant that is there, from the band's own repeats; of a false one, from the controls.
  const rep = sized.filter(x => x.cl.strip === 0 && x.cl.members.length >= 2);
  const p = Math.min(0.95, Math.max(0.05, rep.reduce((s, x) => s + x.cl.members.length, 0) / Math.max(1, rep.reduce((s, x) => s + x.covered, 0))));
  const q = Math.min(0.5 * p, Math.max(1e-3, (levels.reduce((s, l) => s + l.falsePerM, 0) / Math.max(1, levels.length)) * 2 * gateM));
  const hit = Math.log(p / q), miss = Math.log((1 - p) / (1 - q));
  const toMark = (x: (typeof sized)[number]): Mark => {
    const m = x.cl.members, pos = m.length * hit + (x.covered - m.length) * miss, lk = lookShift(look, m);
    return { row: x.cl.row, strip: x.cl.strip, a: Math.round(x.a * 1000) / 1000, off: Math.round((m.reduce((s, c) => s + c.off, 0) / m.length) * 1000) / 1000, views: m.length, covered: x.covered, posLogOdds: Math.round(pos * 100) / 100, logOdds: Math.round((pos + lk) * 100) / 100, look: Math.round(lk * 100) / 100, z: Math.max(...m.map(c => c.z)), areaCm2: median(m.map(c => c.areaCm2)), members: m };
  };
  const accepted = sized.map(toMark).filter(m => m.views >= Math.min(o.minViews, m.covered) && m.logOdds > 0);
  const marks = accepted.filter(m => m.strip === 0), controlMarks = accepted.filter(m => m.strip !== 0);
  // Stretches of row: verified where the band holds clearly more than its two control strips together would by chance.
  const tail = (k: number, n: number) => { let s = 0, term = Math.pow(2 / 3, n); for (let i = 0; i <= n; i++) { if (i >= k) s += term; term = (term * (n - i)) / (i + 1) / 2; } return s; };
  const stretches: RowStretch[] = [];
  for (const row of rows) {
    const a0 = row.a0, a1 = row.a0 + (row.en.length - 1) * row.stepM, mine = marks.filter(m => m.row === row.id), ctl = controlMarks.filter(m => m.row === row.id);
    for (let s = a0; s < a1 - 1e-6; s += o.stretchM) {
      const e = Math.min(a1, s + o.stretchM), band = mine.filter(m => m.a >= s && m.a < e).length, control = ctl.filter(m => m.a >= s && m.a < e).length;
      const seen = coveredAt(row.id, (s + e) / 2);
      stretches.push({ row: row.id, a0: s, a1: e, band, control, state: seen < Math.min(o.minViews, list.length) ? "not covered" : band >= o.minBand * ((e - s) / o.stretchM) && tail(band, band + control) < o.alpha ? "verified" : "not verified" });
    }
  }
  return { marks, controlMarks, stretches, p: Math.round(p * 1000) / 1000, q: Math.round(q * 10000) / 10000 };
}

/**
 * Seed populations a corn planting is sown at, plants per hectare: a deliberately wide band around common practice
 * (US grain corn about 28,000-36,000 seeds per acre, 69,000-89,000 per hectare; dryland and silage plantings reach
 * below and above it). With the row spacing it bounds the distance between seeds along a row; it is a sanity bound,
 * not a measurement: the spacing itself is measured from the marks.
 */
export const CORN_POPULATION_PER_HA: [number, number] = [45_000, 115_000];

export type SeedSpacing = {
  /** The distance at which the marks repeat along the rows, metres (null: too few marks to say). */
  spacingM: number | null;
  /** The range the planting allows at this row spacing, metres. */
  allowedM: [number, number];
  /** How strongly the marks repeat at it, 0 (not at all) to 1 (every pair a whole number of spacings apart). */
  regularity: number;
  /** Plants a hectare that spacing and the row spacing imply. */
  impliedPerHa: number | null;
  pairs: number;
};

/**
 * The seed spacing the marks themselves show, as the field's row spacing is found across the rows: every pair of
 * marks on one row up to `reachM` apart votes for the spacings it is a whole multiple of (the cosine of its distance
 * in turns of the spacing). Misses do not matter (a pair two seeds apart still votes for the spacing); half the
 * spacing scores as well, so the search is bounded below by what corn is sown at, and the longest spacing within a
 * hair of the best is taken.
 */
export function seedSpacing(marks: { row: number; a: number }[], rowSpacingM: number, reachM = 0.8): SeedSpacing {
  const allowedM: [number, number] = [1 / (CORN_POPULATION_PER_HA[1] / 10_000) / rowSpacingM, 1 / (CORN_POPULATION_PER_HA[0] / 10_000) / rowSpacingM];
  const byRow = new Map<number, number[]>();
  for (const m of marks) (byRow.get(m.row) ?? byRow.set(m.row, []).get(m.row)!).push(m.a);
  const d: number[] = [];
  for (const as of byRow.values()) { as.sort((x, y) => x - y); for (let i = 0; i < as.length; i++) for (let j = i + 1; j < as.length && as[j] - as[i] <= reachM; j++) d.push(as[j] - as[i]); }
  if (d.length < 50) return { spacingM: null, allowedM, regularity: 0, impliedPerHa: null, pairs: d.length };
  const score = (s: number) => { let c = 0; for (const x of d) c += Math.cos((2 * Math.PI * x) / s); return c / d.length; };
  const scan: [number, number][] = [];
  for (let s = allowedM[0]; s <= allowedM[1] + 1e-9; s += 0.002) scan.push([s, score(s)]);
  const best = Math.max(...scan.map(x => x[1]));
  const pick = [...scan].reverse().find(x => x[1] >= best - 0.02)!;
  return { spacingM: Math.round(pick[0] * 1000) / 1000, allowedM: [Math.round(allowedM[0] * 1000) / 1000, Math.round(allowedM[1] * 1000) / 1000], regularity: Math.round(Math.max(0, pick[1]) * 1000) / 1000, impliedPerHa: Math.round(10_000 / (pick[0] * rowSpacingM)), pairs: d.length };
}

/**
 * Lattice rows moved onto the plants: per bin of `binM` along each row, the median across offset of the marks a first
 * search found on its band (at least `minMarks` of them), smoothed over the neighbouring bins, shifts the line. A row
 * from the planted ground is placed per square of 1 m by one spacing and smoothed; the photographs disagree by about
 * 6 cm; together the line can sit a band's half-width off the plants (seen 2026-11-12). This moves geometry only: a
 * row is not made more or less real by it, and the marks found on the moved line must still beat its control strips.
 */
export function recentreRows(rows: LatticeRow[], marks: { row: number; a: number; off: number; strip: Strip }[], cellA: number, binM = 2, minMarks = 5, maxShiftM = 0.2): { rows: LatticeRow[]; shiftedM: number; medianShiftM: number } {
  const byRow = new Map<number, { a: number; off: number }[]>();
  for (const m of marks) if (m.strip === 0) (byRow.get(m.row) ?? byRow.set(m.row, []).get(m.row)!).push(m);
  const shifts: number[] = [];
  let shiftedM = 0;
  const out = rows.map(r => {
    const ms = byRow.get(r.id) ?? [], a0 = r.ac[0][0], nb = Math.ceil((r.ac[r.ac.length - 1][0] - a0) / binM) + 1;
    const bins: number[][] = Array.from({ length: nb }, () => []);
    for (const m of ms) { const b = Math.floor((m.a - a0) / binM); if (b >= 0 && b < nb) bins[b].push(m.off); }
    const raw = bins.map(b => (b.length >= minMarks ? median(b) : NaN));
    // Smooth over three bins; carry the nearest known shift into bins without enough marks.
    const sm = raw.map((_, i) => { const v = raw.slice(Math.max(0, i - 1), i + 2).filter(Number.isFinite); return v.length ? median(v) : NaN; });
    for (let i = 0; i < nb; i++) if (!Number.isFinite(sm[i])) { let d = 1; while (d < nb && !Number.isFinite(sm[i - d] ?? NaN) && !Number.isFinite(sm[i + d] ?? NaN)) d++; sm[i] = Number.isFinite(sm[i - d] ?? NaN) ? sm[i - d] : Number.isFinite(sm[i + d] ?? NaN) ? sm[i + d] : 0; }
    const ac = r.ac.map(([a, c]) => { const b = Math.max(0, Math.min(nb - 1, Math.floor((a - a0) / binM))), s = Math.max(-maxShiftM, Math.min(maxShiftM, sm[b] || 0)); if (Math.abs(s) > 0.02) shiftedM += cellA; shifts.push(Math.abs(s)); return [a, c + s] as [number, number]; });
    return { ...r, ac };
  });
  return { rows: out, shiftedM: Math.round(shiftedM), medianShiftM: Math.round(median(shifts) * 1000) / 1000 };
}

/**
 * Where each row starts and ends, from its own marks. Inside a row, gaps are allowed (wheel tracks cross the rows every
 * planter pass, and a row may thin out): what ends a row is that steady runs of plants stop. A run is marks no further
 * apart than k expected seed positions, k the smallest with (1 - filled)^k under `risk` (0.9 filled: 2 positions; 0.7:
 * 4; 0.5: 7); a run holding at least `minRun` marks is the crop. The row reaches from the first such run to the last;
 * a mark or two past it, in the headland, is not the crop. Null for a row with too few marks to say.
 */
export function rowExtents(marks: { row: number; a: number; strip: Strip }[], rowIds: number[], seedM: number, risk = 0.01, minMarks = 10, minRun = 5): Map<number, [number, number] | null> {
  const out = new Map<number, [number, number] | null>();
  for (const id of rowIds) {
    const as = marks.filter(m => m.row === id && m.strip === 0).map(m => m.a).sort((x, y) => x - y);
    if (as.length < minMarks) { out.set(id, null); continue; }
    // Filled share over the row's middle half: marks over expected positions.
    const q1 = as[Math.floor(as.length * 0.25)], q3 = as[Math.floor(as.length * 0.75)];
    const filled = Math.min(0.98, Math.max(0.2, as.filter(a => a >= q1 && a <= q3).length / Math.max(1, (q3 - q1) / seedM)));
    const k = Math.max(2, Math.ceil(Math.log(risk) / Math.log(1 - filled))), maxGap = (k + 0.5) * seedM;
    let first: number | null = null, last: number | null = null;
    for (let s = 0; s < as.length;) { let e = s; while (e + 1 < as.length && as[e + 1] - as[e] <= maxGap) e++; if (e - s + 1 >= minRun) { if (first == null) first = as[s]; last = as[e]; } s = e + 1; }
    out.set(id, first != null && last != null ? [first - seedM / 2, last + seedM / 2] : null);
  }
  return out;
}

/**
 * Whether reading along the rows applies to this flight, from the photographs themselves. It is made for seedlings
 * small beside the row spacing: there the strips between rows hold soil and the odd weed, and the band beats them by
 * an order of magnitude. Once leaves reach across (about V3 and later on the three test flights, 2026-11-12) the
 * control strips fill with the crop's own leaves and are never quiet; the first pass's readers are the right
 * instrument there and stand alone. A photograph applies when, at its bar, the controls are quiet and the band holds
 * at least `contrast` times their candidates a metre; the flight applies when `share` of its photographs do.
 */
export function applicability(searches: PhotoSearch[], o: RowGuidedOptions = ROW_GUIDED, contrast = 3, share = 0.6): { applies: boolean; photographs: number; applying: number; why: string } {
  const read = searches.filter(s => s.rowM >= 5);
  const ok = read.filter(s => {
    const lv = chooseLevel(s, o); if (!lv.quiet) return false;
    const bar = o.ladder[lv.level], band = s.candidates.filter(c => c.strip === 0 && c.z >= bar).length / s.rowM, ctl = s.candidates.filter(c => c.strip !== 0 && c.z >= bar).length / (2 * s.rowM);
    return band >= contrast * Math.max(ctl, 0.02);
  }).length;
  const applies = read.length > 0 && ok >= share * read.length;
  return { applies, photographs: read.length, applying: ok, why: applies ? `${ok} of ${read.length} photographs show the rows' band clearly above the strips between them` : `only ${ok} of ${read.length} photographs show the rows' band clearly above the strips between them (leaves across the rows, or nothing to find): not read along rows, the first pass stands` };
}
