// L7 Second look (2026-11-18; an option, OFF by default: LAYERS.secondLook).
//
//   in:   L3's dots (PlacedDots: the dots, the photographs, their registration shifts, the merging gate), L6's reading
//         (plantsFirst.ts Reconstruction: rows, each dot's row and why it is on none), what L5 learned (the plant
//         spacing, its spread, the too-close limit), the photographs' cameras and the field's origin, every read's
//         record of its plants' look and its cores' reference, and a way to look at a photograph's pixels again
//         (`looker`: the green view the plant read used, L1; the cores view over a window, L1)
//   out:  the reading with what the photographs showed added (a refused dot put on its row, or a new plant in a gap),
//         and the record of every spot looked at: where, which photographs looked, how many showed a plant, the decision
//         and why
//
// It works only where L6 and L5 disagree:
//   gap      two neighbouring plants on a row further apart than the spacing's spread allows (over the single
//            spacings' upper fence, L5): the stretch between them, less the too-close limit at either end
//   refused  a dot L6 left off the row whose line it stands on (as close to a plant as a double, not at the spacing, its
//            band losing to the alley, or alone), made by `secondLookMinPhotos` photographs or more
// Each spot is read again in every photograph whose camera puts it in the frame (and whose pixel looks back at it):
// the green view to find green there, then the cores view to part green that runs into a neighbour's. A plant is added
// ONLY where photographs show one: at least `secondLookMinShow` of those that looked, and `secondLookShowShare` of them.
// Nothing is added because the pattern expects a plant: the spacing only says where to look.
//
// Without a looker (a build: the photographs' pixels are not kept) or with the option off, the reading passes through.
import { type GeorefFrame, groundSampleAt, groundToPixel, pixelToGround } from "@/lib/directGeoref/projection";
import type { PhotoPixels } from "@/lib/photoScout/pattern";
import { corePeaks, coresView, vividGreen } from "@/lib/rowCrop/greenCores";
import { type LatLngAlt, fromEnu, toEnu } from "@/lib/sourceFrames/odm";
import type { CornPhotoRead } from "../cornField";
import { type Dot, type PhotoShift, type Reconstruction, SETTLED, type Sight, shiftOf } from "../plantsFirst";
import { LAYERS, type LayerOptions } from "./options";

/** A photograph's pixels as the second look reads them: its pixels, and the green view the plant read used (1 green). */
export type LookedPhoto = { px: PhotoPixels; green: Uint8Array };
/** Gives a photograph's pixels and green view by name (null when it cannot); called once per photograph, in order. */
export type Looker = (name: string) => LookedPhoto | null;

export type SpotLook = { photo: string; u: number; v: number; shows: boolean; why: string };
export type Spot = {
  kind: "gap" | "refused";
  /** The row (index into rec.rows) and, for a gap, the stretch along it (metres along the rows' direction). */
  row: number; a0?: number; a1?: number;
  /** For a refused dot: the dot, and why L6 refused it (Reconstruction.why). */
  dot?: number; why?: number;
  /** The spot on the ground (a gap: its middle). */
  e: number; n: number;
  looks: SpotLook[];
  decision: "added" | "refused"; reason: string;
  /** Plants the spot gave: the dots (new ones after every dot L3 made, or the refused dot itself). */
  added: number[];
};
export type SecondLookRecord = { examined: { gaps: number; refused: number }; added: { inGaps: number; refusedPlaced: number }; refusedBecause: Record<string, number>; spots: Spot[]; photographsRead: number };

const LOOKS_BACK_M = 0.05;

/** Where a spot on the ground (registered frame) stands in a photograph, when that pixel looks back at it. */
export function spotInPhoto(f: GeorefFrame, shift: PhotoShift, origin: LatLngAlt, e: number, n: number): { u: number; v: number } | null {
  const W = f.intrinsics.width, H = f.intrinsics.height, altM = (f.ground as { altM?: number }).altM ?? 0;
  let de = 0, dn = 0, u = 0, v = 0;
  for (let it = 0; it < 4; it++) { const p = fromEnu([e - de, n - dn, 0], origin), h = groundToPixel(f, p.lat, p.lng, altM); if (!h) return null; u = h.u; v = h.v; [de, dn] = shiftOf(shift, u, v); }
  if (u < 0 || v < 0 || u >= W || v >= H) return null;
  const g = pixelToGround(f, u, v); if (!g) return null;
  const b = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, origin), [se, sn] = shiftOf(shift, u, v);
  return Math.hypot(b[0] + se - e, b[1] + sn - n) <= LOOKS_BACK_M ? { u, v } : null;
}
const groundOf = (f: GeorefFrame, shift: PhotoShift, origin: LatLngAlt, u: number, v: number): [number, number] | null => {
  const g = pixelToGround(f, u, v); if (!g) return null;
  const b = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, origin), [se, sn] = shiftOf(shift, u, v);
  return [b[0] + se, b[1] + sn];
};

/** 8-connected green pieces inside a window of the green view: label per window pixel (-1 none) and each piece's size. */
function pieces(green: Uint8Array, W: number, x0: number, y0: number, w: number, h: number) {
  const lab = new Int32Array(w * h).fill(-1), size: number[] = [], st: number[] = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i; if (lab[k] >= 0 || !green[(y0 + j) * W + x0 + i]) continue;
    const id = size.length; let n = 0; lab[k] = id; st.push(k);
    while (st.length) { const q = st.pop()!, qi = q % w, qj = (q - qi) / w; n++;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = qi + di, jj = qj + dj; if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue; const r = jj * w + ii; if (lab[r] < 0 && green[(y0 + jj) * W + x0 + ii]) { lab[r] = id; st.push(r); } } }
    size.push(n);
  }
  return { lab, size };
}
/** The piece with the most green within `r` pixels of (u, v) in the window, or -1. */
function pieceAt(P: { lab: Int32Array }, w: number, h: number, x0: number, y0: number, u: number, v: number, r: number): number {
  const cnt = new Map<number, number>(), cu = u - x0, cv = v - y0;
  for (let j = Math.max(0, Math.floor(cv - r)); j <= Math.min(h - 1, Math.ceil(cv + r)); j++) for (let i = Math.max(0, Math.floor(cu - r)); i <= Math.min(w - 1, Math.ceil(cu + r)); i++) {
    if ((i - cu) ** 2 + (j - cv) ** 2 > r * r) continue; const id = P.lab[j * w + i]; if (id >= 0) cnt.set(id, (cnt.get(id) ?? 0) + 1);
  }
  let best = -1, bn = 0; for (const [id, n] of cnt) if (n > bn) { bn = n; best = id; } return best;
}
/** The cores view's peaks over a window (padded so the blurs do not see its edge), at or over `bar` (the photograph's
 * own bar from its read; without one, 0.15 of the window's strongest), in photograph pixels. */
function coresIn(px: PhotoPixels, x0: number, y0: number, w: number, h: number, finePx: number, widePx: number, bar: number | null) {
  const pad = Math.ceil(3 * widePx), X0 = Math.max(0, x0 - pad), Y0 = Math.max(0, y0 - pad), X1 = Math.min(px.width, x0 + w + pad), Y1 = Math.min(px.height, y0 + h + pad), cw = X1 - X0, ch = Y1 - Y0;
  const rgba = new Uint8ClampedArray(cw * ch * 4);
  for (let j = 0; j < ch; j++) rgba.set(px.rgba.subarray(((Y0 + j) * px.width + X0) * 4, ((Y0 + j) * px.width + X1) * 4), j * cw * 4);
  const V = coresView(vividGreen({ width: cw, height: ch, rgba }), cw, ch, finePx, widePx);
  return corePeaks(V.strength, cw, ch, V.top, 0).filter(c => (bar == null ? c.s >= 0.15 : c.v >= bar)).map(c => ({ u: c.x + X0, v: c.y + Y0, s: c.v }));
}

type Placed = { all: Dot[]; strict: number; tier: Uint8Array | null; covered: Int32Array; photos: string[]; shifts: PhotoShift[]; sights?: Sight[]; gateM?: number };

/**
 * L7 over a reading. Returns the reading and the dots (copies where anything was added: new dots after every existing
 * one) and the record of every spot.
 */
export function secondLookOnField<T extends Placed>(P: T, rec: Reconstruction, frames: Map<string, GeorefFrame>, origin: LatLngAlt, reads: CornPhotoRead[], looker: Looker | null, o: LayerOptions = LAYERS): { P: T; rec: Reconstruction; record: SecondLookRecord } {
  const record: SecondLookRecord = { examined: { gaps: 0, refused: 0 }, added: { inGaps: 0, refusedPlaced: 0 }, refusedBecause: {}, spots: [], photographsRead: 0 };
  const seedM = rec.geometry.seedM, upper = rec.profile?.spread.upperFenceM ?? null;
  if (!o.secondLook || !looker || seedM == null || upper == null) return { P, rec, record };
  const th = (rec.geometry.directionDeg * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th);
  const toEN = (a: number, c: number): [number, number] => [a * ct - c * st, a * st + c * ct];
  const tooClose = rec.tooCloseM, rSpot = 0.25 * seedM, halfBand = 0.25 * seedM, gate = Math.max(P.gateM ?? 0.05, 0.5 * tooClose);
  // Each row's course from its drawn line: the across position at a place along it.
  const courseOf = rec.rows.map(r => { const ac = r.line.map(([e, n]) => [e * ct + n * st, -e * st + n * ct] as [number, number]).sort((x, y) => x[0] - y[0]); return (a: number) => { if (a <= ac[0][0]) return ac[0][1]; if (a >= ac[ac.length - 1][0]) return ac[ac.length - 1][1]; let k = 0; while (k + 1 < ac.length && ac[k + 1][0] < a) k++; const t = (a - ac[k][0]) / (ac[k + 1][0] - ac[k][0] || 1); return ac[k][1] + t * (ac[k + 1][1] - ac[k][1]); }; });
  // The spots: gaps over the spread's upper fence, and refused dots on a row's line seen by enough photographs.
  const spots: Spot[] = [];
  rec.rows.forEach((r, ri) => {
    const as = r.dots.map(i => rec.a[i]).sort((x, y) => x - y);
    for (let k = 1; k < as.length; k++) { const g = as[k] - as[k - 1]; if (g <= upper) continue; const a0 = as[k - 1] + tooClose, a1 = as[k] - tooClose; if (a1 <= a0) continue; const am = (a0 + a1) / 2, [e, n] = toEN(am, courseOf[ri](am)); spots.push({ kind: "gap", row: ri, a0, a1, e, n, looks: [], decision: "refused", reason: "", added: [] }); }
  });
  for (let i = 0; i < P.all.length; i++) {
    if (rec.rowOf[i] >= 0 || P.all[i].photos < o.secondLookMinPhotos || ![2, 3, 6, 8].includes(rec.why[i])) continue;
    // On a row's line: the nearest row whose course passes within the band, and whose ends reach it within a spacing.
    let best = -1, bd = halfBand;
    rec.rows.forEach((r, ri) => { if (rec.a[i] < r.a0 - seedM || rec.a[i] > r.a1 + seedM) return; const d = Math.abs(rec.c[i] - courseOf[ri](rec.a[i])); if (d <= bd) { bd = d; best = ri; } });
    if (best >= 0) spots.push({ kind: "refused", row: best, dot: i, why: rec.why[i], e: P.all[i].e, n: P.all[i].n, looks: [], decision: "refused", reason: "", added: [] });
  }
  record.examined.gaps = spots.filter(s => s.kind === "gap").length; record.examined.refused = spots.filter(s => s.kind === "refused").length;
  // The photographs a spot might be in: by the ground their sightings cover (a metre round); the camera then decides.
  const box = P.photos.map(() => [Infinity, Infinity, -Infinity, -Infinity]);
  for (const s of P.sights ?? []) { const b = box[s.p]; b[0] = Math.min(b[0], s.e); b[1] = Math.min(b[1], s.n); b[2] = Math.max(b[2], s.e); b[3] = Math.max(b[3], s.n); }
  const readOf = new Map(reads.map(r => [r.name, r]));
  // A row's plants near a place, to tell a plant from its neighbour's leaves.
  const rowPlants = rec.rows.map(r => r.dots.slice().sort((x, y) => rec.a[x] - rec.a[y]));
  const near = (ri: number, a: number, within: number) => rowPlants[ri].filter(j => Math.abs(rec.a[j] - a) <= within);
  const found = new Map<Spot, [number, number, number][]>();
  // Photograph by photograph: everything asked of it, then on to the next (each decoded once).
  const asked = P.photos.map(() => [] as Spot[]);
  for (const sp of spots) {
    const reach = sp.kind === "gap" ? (sp.a1! - sp.a0!) / 2 + 1 : 1;
    P.photos.forEach((_, p) => { const b = box[p]; if (sp.e >= b[0] - reach && sp.e <= b[2] + reach && sp.n >= b[1] - reach && sp.n <= b[3] + reach) asked[p].push(sp); });
  }
  P.photos.forEach((name, p) => {
    if (!asked[p].length) return;
    const f = frames.get(name); if (!f) return;
    const shift = P.shifts[p], R = readOf.get(name), cores = R?.look?.cores ?? null, typ = R?.look?.typicalPx ?? null;
    const inFrame = asked[p].map(sp => ({ sp, at: spotInPhoto(f, shift, origin, sp.e, sp.n) })).filter((x): x is { sp: Spot; at: { u: number; v: number } } => !!x.at);
    if (!inFrame.length) return;
    const L = looker(name); if (!L) return;
    record.photographsRead++;
    const W = L.px.width, H = L.px.height;
    for (const { sp, at } of inFrame) {
      const gsd = groundSampleAt(f, at.u, at.v) ?? 0.01, r = Math.max(2, rSpot / gsd), tc = tooClose / gsd;
      if (sp.kind === "refused") {
        // The refused dot and its nearest plant on the row, in this photograph.
        const nb = near(sp.row, rec.a[sp.dot!], 1.5 * seedM).filter(j => j !== sp.dot).map(j => spotInPhoto(f, shift, origin, P.all[j].e, P.all[j].n)).filter((x): x is { u: number; v: number } => !!x).sort((x, y) => Math.hypot(x.u - at.u, x.v - at.v) - Math.hypot(y.u - at.u, y.v - at.v))[0] ?? null;
        const pad = Math.ceil(2 * r), x0 = Math.max(0, Math.floor(Math.min(at.u, nb?.u ?? at.u) - pad)), y0 = Math.max(0, Math.floor(Math.min(at.v, nb?.v ?? at.v) - pad));
        const x1 = Math.min(W, Math.ceil(Math.max(at.u, nb?.u ?? at.u) + pad)), y1 = Math.min(H, Math.ceil(Math.max(at.v, nb?.v ?? at.v) + pad)), w = x1 - x0, h = y1 - y0;
        const Pc = pieces(L.green, W, x0, y0, w, h), mine = pieceAt(Pc, w, h, x0, y0, at.u, at.v, r);
        if (mine < 0) { sp.looks.push({ photo: name, u: at.u, v: at.v, shows: false, why: "no green" }); continue; }
        const theirs = nb ? pieceAt(Pc, w, h, x0, y0, nb.u, nb.v, r) : -1;
        if (theirs !== mine) { sp.looks.push({ photo: name, u: at.u, v: at.v, shows: true, why: "green of its own" }); continue; }
        // One piece with its neighbour: do the cores part them?
        if (!cores || !nb) { sp.looks.push({ photo: name, u: at.u, v: at.v, shows: false, why: "one piece with its neighbour; no cores view" }); continue; }
        const pk = coresIn(L.px, x0, y0, w, h, cores.finePx, cores.widePx, cores.threshold).filter(c => { const i = Math.round(c.u) - x0, j = Math.round(c.v) - y0; return i >= 0 && j >= 0 && i < w && j < h && Pc.lab[j * w + i] === mine; });
        const a = pk.filter(c => Math.hypot(c.u - at.u, c.v - at.v) <= r), b = pk.filter(c => Math.hypot(c.u - nb.u, c.v - nb.v) <= r);
        const parted = a.some(x => b.some(y => Math.hypot(x.u - y.u, x.v - y.v) >= tc));
        sp.looks.push({ photo: name, u: at.u, v: at.v, shows: parted, why: parted ? "the cores part it from its neighbour" : "one piece with its neighbour, the cores do not part them" });
      } else {
        // A gap: the green in the band along the stretch that is not the end plants'.
        const ends = near(sp.row, (sp.a0! + sp.a1!) / 2, (sp.a1! - sp.a0!) / 2 + tooClose + 1e-6).map(j => spotInPhoto(f, shift, origin, P.all[j].e, P.all[j].n)).filter((x): x is { u: number; v: number } => !!x);
        const corners = [[sp.a0!, -halfBand], [sp.a0!, halfBand], [sp.a1!, -halfBand], [sp.a1!, halfBand]].map(([a, c]) => { const [e, n] = toEN(a, courseOf[sp.row](a) + c); return spotInPhoto(f, shift, origin, e, n); });
        if (corners.some(c => !c)) { sp.looks.push({ photo: name, u: at.u, v: at.v, shows: false, why: "the stretch is not all in this photograph" }); continue; }
        const us = [...corners.map(c => c!.u), ...ends.map(c => c.u)], vs = [...corners.map(c => c!.v), ...ends.map(c => c.v)], pad = Math.ceil(r);
        const x0 = Math.max(0, Math.floor(Math.min(...us) - pad)), y0 = Math.max(0, Math.floor(Math.min(...vs) - pad)), x1 = Math.min(W, Math.ceil(Math.max(...us) + pad)), y1 = Math.min(H, Math.ceil(Math.max(...vs) + pad)), w = x1 - x0, h = y1 - y0;
        if (w <= 0 || h <= 0 || w * h > 4e6) { sp.looks.push({ photo: name, u: at.u, v: at.v, shows: false, why: "the stretch is too large to read here" }); continue; }
        const Pc = pieces(L.green, W, x0, y0, w, h), endPieces = new Set(ends.map(c => pieceAt(Pc, w, h, x0, y0, c.u, c.v, r)).filter(id => id >= 0));
        const minArea = typ ? 0.15 * typ * typ : 0;
        // Each other piece's pixels inside the band and within the stretch.
        const sum = new Map<number, [number, number, number]>();
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const id = Pc.lab[j * w + i]; if (id < 0 || endPieces.has(id) || Pc.size[id] < minArea) continue;
          const g = groundOf(f, shift, origin, x0 + i + 0.5, y0 + j + 0.5); if (!g) continue;
          const a = g[0] * ct + g[1] * st, c = -g[0] * st + g[1] * ct; if (a < sp.a0! || a > sp.a1! || Math.abs(c - courseOf[sp.row](a)) > halfBand) continue;
          const s = sum.get(id) ?? [0, 0, 0]; s[0]++; s[1] += x0 + i + 0.5; s[2] += y0 + j + 0.5; sum.set(id, s);
        }
        const pk = sum.size && cores ? coresIn(L.px, x0, y0, w, h, cores.finePx, cores.widePx, cores.threshold) : [];
        const cand: [number, number][] = [];
        for (const [id, [n0, su, sv]] of sum) {
          // Mostly outside the band and small inside it: a neighbouring row's plant or a weed reaching in.
          if (n0 * 4 < Pc.size[id] && n0 < minArea) continue;
          const inPiece = pk.filter(c => { const i = Math.round(c.u) - x0, j = Math.round(c.v) - y0; return i >= 0 && j >= 0 && i < w && j < h && Pc.lab[j * w + i] === id; });
          // The cores part one piece into plants (peaks closer than the too-close limit are one plant); else its centre.
          const kept: { u: number; v: number }[] = []; for (const c of inPiece.sort((x, y) => y.s - x.s)) if (kept.every(k => Math.hypot(k.u - c.u, k.v - c.v) >= tc)) kept.push(c);
          for (const k of kept.length ? kept : [{ u: su / n0, v: sv / n0 }]) cand.push([k.u, k.v]);
        }
        let any = false;
        for (const [u, v] of cand) { const g = groundOf(f, shift, origin, u, v); if (!g) continue; const a = g[0] * ct + g[1] * st, c = -g[0] * st + g[1] * ct; if (a < sp.a0! || a > sp.a1! || Math.abs(c - courseOf[sp.row](a)) > halfBand) continue; (found.get(sp) ?? found.set(sp, []).get(sp)!).push([g[0], g[1], p]); any = true; }
        sp.looks.push({ photo: name, u: at.u, v: at.v, shows: any, why: any ? "green in the gap" : "no green in the gap but its end plants'" });
      }
    }
  });
  // The decisions.
  const enough = (shows: number, looked: number) => shows >= o.secondLookMinShow && shows >= o.secondLookShowShare * looked;
  const placeDot: { i: number; row: number; from: "gap" | "refused" }[] = [], newDots: { d: Dot; row: number; looked: number }[] = [], taken = new Set<number>();
  // Refused dots first: a dot is one plant, whatever a gap later sees at it.
  for (const sp of spots.filter(s => s.kind === "refused")) {
    const looked = new Set(sp.looks.map(l => l.photo)).size, shows = sp.looks.filter(l => l.shows).length;
    if (!looked) { sp.reason = "no photograph looked at it"; continue; }
    if (!enough(shows, looked)) { sp.reason = shows ? "too few photographs show a plant of its own there" : sp.looks.some(l => l.why.startsWith("one piece")) ? "one piece with its neighbour; the cores do not part them" : "no green there in the photographs"; continue; }
    sp.decision = "added"; sp.reason = `${shows} of ${looked} photographs show a plant of its own there`; sp.added = [sp.dot!]; taken.add(sp.dot!); placeDot.push({ i: sp.dot!, row: sp.row, from: "refused" });
  }
  for (const sp of spots.filter(s => s.kind === "gap")) {
    const looked = new Set(sp.looks.map(l => l.photo)).size;
    if (!looked) { sp.reason = "no photograph looked at it"; continue; }
    // Candidates gathered across the photographs within the gate, one per photograph at most.
    const C = found.get(sp) ?? [], used = new Uint8Array(C.length), groups: [number, number, number[]][] = [];
    for (let k = 0; k < C.length; k++) { if (used[k]) continue; const g = [k], ps = new Set([C[k][2]]); used[k] = 1; for (let m = k + 1; m < C.length; m++) if (!used[m] && !ps.has(C[m][2]) && Math.hypot(C[m][0] - C[k][0], C[m][1] - C[k][1]) <= gate) { g.push(m); used[m] = 1; ps.add(C[m][2]); } groups.push([g.reduce((t, m) => t + C[m][0], 0) / g.length, g.reduce((t, m) => t + C[m][1], 0) / g.length, [...ps]]); }
    const good = groups.filter(([, , ps]) => enough(ps.length, looked)).sort((x, y) => y[2].length - x[2].length);
    const keptAs = rowPlants[sp.row].map(j => rec.a[j]).concat(placeDot.filter(x => x.row === sp.row).map(x => rec.a[x.i]));
    for (const [e, n, ps] of good) {
      const a = e * ct + n * st; if (keptAs.some(x => Math.abs(x - a) < tooClose)) continue;
      keptAs.push(a);
      // A dot already standing there (refused, not yet placed) is the plant: put on the row, not made twice.
      let at = -1; for (let i = 0; i < P.all.length && at < 0; i++) if (rec.rowOf[i] < 0 && !taken.has(i) && Math.hypot(P.all[i].e - e, P.all[i].n - n) <= gate) at = i;
      if (at >= 0) { taken.add(at); placeDot.push({ i: at, row: sp.row, from: "gap" }); sp.added.push(at); }
      else { newDots.push({ d: { e, n, members: [], photos: ps.length, spreadM: 0 }, row: sp.row, looked }); sp.added.push(-newDots.length); }
    }
    if (sp.added.length) { sp.decision = "added"; sp.reason = `${sp.added.length} plant${sp.added.length > 1 ? "s" : ""} the photographs show in the gap (of ${looked} that looked)`; }
    else sp.reason = !groups.length ? "no green in the gap but its end plants'" : good.length ? "the green the photographs show is as close to a plant as a double" : "green in the gap, but too few photographs show it at one place";
  }
  for (const sp of spots) if (sp.decision === "refused") record.refusedBecause[`${sp.kind}: ${sp.reason}`] = (record.refusedBecause[`${sp.kind}: ${sp.reason}`] ?? 0) + 1;
  const n0 = P.all.length, n = n0 + newDots.length;
  for (const sp of spots) sp.added = sp.added.map(x => (x < 0 ? n0 + (-x - 1) : x));
  record.spots = spots;
  record.added.inGaps = newDots.length + placeDot.filter(x => x.from === "gap").length; record.added.refusedPlaced = placeDot.filter(x => x.from === "refused").length;
  if (!placeDot.length && !newDots.length) return { P, rec, record };
  // The copies: new dots after every existing one; the changed dots on their rows, probable, settled by the second look.
  const grow = <A extends Uint8Array | Int32Array | Float64Array>(x: A, fill: number): A => { const y = new (x.constructor as new (k: number) => A)(n); y.set(x as never); (y as unknown as { fill: (v: number, s: number) => void }).fill(fill, n0); return y; };
  const all = [...P.all, ...newDots.map(x => x.d)];
  const tier = P.tier ? grow(P.tier, 0) : null, covered = grow(P.covered, 0); newDots.forEach((x, k) => { covered[n0 + k] = x.looked; });
  const R: Reconstruction = { ...rec, certainty: grow(rec.certainty, 1), rowOf: grow(rec.rowOf, -1), between: grow(rec.between, 0), why: grow(rec.why, 0), settled: grow(rec.settled, SETTLED.secondLook), offSpacing: grow(rec.offSpacing, 0), loose: grow(rec.loose, 0), a: grow(Float64Array.from(rec.a), 0), c: grow(Float64Array.from(rec.c), 0), rows: rec.rows.map(r => ({ ...r, dots: [...r.dots] })), secondLook: new Uint8Array(n) };
  for (let k = 0; k < newDots.length; k++) { const i = n0 + k, d = newDots[k].d; R.a[i] = d.e * ct + d.n * st; R.c[i] = -d.e * st + d.n * ct; R.rowOf[i] = newDots[k].row; R.rows[newDots[k].row].dots.push(i); R.secondLook![i] = 1; }
  for (const { i, row } of placeDot) { R.rowOf[i] = row; R.certainty[i] = 1; R.why[i] = 0; R.between[i] = 0; R.settled[i] = SETTLED.secondLook; R.rows[row].dots.push(i); R.secondLook![i] = 1; }
  for (const r of R.rows) r.dots.sort((x, y) => R.a[x] - R.a[y]);
  return { P: { ...P, all, tier, covered }, rec: R, record };
}

/** The chain's L7 (layers/chain.ts): without the photographs' pixels it can do nothing, so the reading passes through;
 * the field step that holds them does the second look (secondLookOnField). */
export function secondLook(rec: Reconstruction): Reconstruction {
  return rec;
}
