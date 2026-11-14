// EXPERIMENT (experiment/photo-ground, not merged): the flight's original photographs laid on the ground under a Field
// Twin, through the cameras the build aligned. What this is, plainly: orthorectification onto the build's flat ground
// plane (no surface model), each ground point taken from the photograph whose nadir is nearest (Voronoi of the nadir
// points), feathered across a narrow band where two photographs meet, each photograph's colour scaled by one gain per
// channel solved from the overlaps. It is an orthophoto on a flat plane, not a reconstruction: things that stand up
// lean (at most about a quarter of their height with nearest-nadir selection) and no pixel is invented. Where no
// photograph covers the ground the tile keeps the background colour.
//
// Pure: no Node or DOM. The script (scripts/directGeoref/photoGround.ts) supplies the decoded pixels.
import { frameFootprint, groundToPixel, pixelToGround, type GeorefFrame } from "@/lib/directGeoref/projection";

export const TILE = 256;
export const BACKGROUND: [number, number, number] = [26, 28, 26];

export const tileX = (lng: number, z: number) => ((lng + 180) / 360) * 2 ** z;
export const tileY = (lat: number, z: number) => { const s = Math.sin((lat * Math.PI) / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z; };
export const lngOfX = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
export const latOfY = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
/** Ground metres per tile pixel at a latitude. */
export const metresPerPixel = (lat: number, z: number) => (Math.cos((lat * Math.PI) / 180) * 40075016.686) / (2 ** z * TILE);

export type GroundCam = {
  name: string; f: GeorefFrame; alt: number;
  /** Nadir (principal point on the ground), local metres east/north of the origin. */
  ne: number; nn: number; nadir: [number, number];
  ring: [number, number][]; box: [number, number, number, number];
  /** The footprint in local metres (east, north): a ground point belongs to this photograph only inside it. Beyond the
   * frame a lens model's polynomial can fold back and map far ground into the picture; this ring stops that. */
  ringE: Float64Array; ringN: Float64Array;
};

/** Local metres east/north of an origin (equirectangular: the field is a few hundred metres across). */
export function localOf(lat0: number, lng0: number) {
  const kE = Math.cos((lat0 * Math.PI) / 180) * 111_320, kN = 110_574;
  return { e: (lng: number) => (lng - lng0) * kE, n: (lat: number) => (lat - lat0) * kN };
}

export function groundCams(frames: Map<string, GeorefFrame>): { cams: GroundCam[]; origin: [number, number] } {
  const raw: Omit<GroundCam, "ne" | "nn" | "ringE" | "ringN">[] = [];
  for (const f of frames.values()) {
    const ringG = frameFootprint(f), nad = pixelToGround(f, f.intrinsics.cx, f.intrinsics.cy);
    if (!ringG || !nad) continue;
    const ring = ringG.map(p => [p.lat, p.lng] as [number, number]);
    const lats = ring.map(p => p[0]), lngs = ring.map(p => p[1]);
    raw.push({ name: f.name, f, alt: f.ground.kind === "flat" ? f.ground.altM : f.pose.altM, nadir: [nad.lat, nad.lng], ring, box: [Math.min(...lats), Math.min(...lngs), Math.max(...lats), Math.max(...lngs)] });
  }
  const lat0 = raw.reduce((t, c) => t + c.nadir[0], 0) / raw.length, lng0 = raw.reduce((t, c) => t + c.nadir[1], 0) / raw.length;
  const L = localOf(lat0, lng0);
  return { cams: raw.map(c => ({ ...c, ne: L.e(c.nadir[1]), nn: L.n(c.nadir[0]), ringE: Float64Array.from(c.ring.map(p => L.e(p[1]))), ringN: Float64Array.from(c.ring.map(p => L.n(p[0]))) })), origin: [lat0, lng0] };
}

const inRingEN = (c: GroundCam, e: number, n: number) => {
  let hit = false; const E = c.ringE, N = c.ringN;
  for (let i = 0, j = E.length - 1; i < E.length; j = i++) if ((N[i] > n) !== (N[j] > n) && e < ((E[j] - E[i]) * (n - N[i])) / (N[j] - N[i]) + E[i]) hit = !hit;
  return hit;
}

/**
 * The tiles at zoom z the photographs cover, each with every photograph that can be the nearest (or, within the feather
 * band, the next nearest) anywhere in it: nadir distance at the centre within the nearest's plus the tile's diagonal
 * and the band. A shorter list would let neighbouring tiles choose differently and leave a straight seam on the tile edge.
 */
export function planTiles(cams: GroundCam[], z: number, origin: [number, number], bandM = 0.6, maxCands = 16): { x: number; y: number; cands: number[] }[] {
  const L = localOf(origin[0], origin[1]);
  const lat0 = Math.min(...cams.map(c => c.box[0])), lng0 = Math.min(...cams.map(c => c.box[1])), lat1 = Math.max(...cams.map(c => c.box[2])), lng1 = Math.max(...cams.map(c => c.box[3]));
  const x0 = Math.floor(tileX(lng0, z)), x1 = Math.floor(tileX(lng1, z)), y0 = Math.floor(tileY(lat1, z)), y1 = Math.floor(tileY(lat0, z));
  const out: { x: number; y: number; cands: number[] }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const la0 = latOfY(y + 1, z), la1 = latOfY(y, z), lo0 = lngOfX(x, z), lo1 = lngOfX(x + 1, z);
    const ce = L.e((lo0 + lo1) / 2), cn = L.n((la0 + la1) / 2);
    const hit = cams.map((c, k) => ({ k, d: Math.hypot(c.ne - ce, c.nn - cn) })).filter(({ k }) => { const b = cams[k].box; return !(b[2] < la0 || b[0] > la1 || b[3] < lo0 || b[1] > lo1); });
    if (!hit.length) continue;
    hit.sort((a, b) => a.d - b.d);
    const diag = Math.hypot(L.e(lo1) - L.e(lo0), L.n(la1) - L.n(la0)), reach = hit[0].d + diag + bandM;
    out.push({ x, y, cands: hit.filter(h => h.d <= reach).slice(0, maxCands).map(h => h.k) });
  }
  return out;
}

/** Which photograph shows each pixel of a tile: the nearest-nadir one holding it (a), the next (b) with its feather weight. */
export type TileGeometry = {
  z: number; x: number; y: number;
  a: Int16Array; b: Int16Array; wb: Float32Array;
  ua: Float32Array; va: Float32Array; ub: Float32Array; vb: Float32Array;
  /** Camera indexes any pixel uses. */
  used: number[];
  /** Pixels blended across a seam. */
  seamPx: number;
};

/**
 * The geometry of one tile at size T: per pixel the two nearest-nadir photographs holding it, their pixel coordinates
 * (the camera evaluated exactly on a 5 x 5 grid over the tile, bilinear between: over a tile the projection is as good
 * as linear), and the second's weight inside the feather band (metres of nadir-distance difference).
 */
export function tileGeometry(cams: GroundCam[], origin: [number, number], z: number, x: number, y: number, cands: number[], T: number, featherM: number): TileGeometry {
  const L = localOf(origin[0], origin[1]), G = 4, n = T * T;
  const a = new Int16Array(n).fill(-1), b = new Int16Array(n).fill(-1), wb = new Float32Array(n);
  const ua = new Float32Array(n), va = new Float32Array(n), ub = new Float32Array(n), vb = new Float32Array(n);
  const grids: { k: number; gu: Float64Array; gv: Float64Array; W: number; H: number; full: boolean }[] = [];
  for (const k of cands) {
    const c = cams[k], gu = new Float64Array((G + 1) * (G + 1)), gv = new Float64Array((G + 1) * (G + 1));
    let ok = true;
    for (let j = 0; j <= G && ok; j++) for (let i = 0; i <= G; i++) { const h = groundToPixel(c.f, latOfY(y + j / G, z), lngOfX(x + i / G, z), c.alt); if (!h) { ok = false; break; } gu[j * (G + 1) + i] = h.u; gv[j * (G + 1) + i] = h.v; }
    if (!ok) continue;
    // The tile wholly inside the footprint needs no test per pixel; a tile across its edge does.
    const corners = [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]].map(([i, j]) => inRingEN(c, L.e(lngOfX(x + i, z)), L.n(latOfY(y + j, z))));
    grids.push({ k, gu, gv, W: c.f.intrinsics.width, H: c.f.intrinsics.height, full: corners.every(Boolean) });
  }
  const e0 = L.e(lngOfX(x, z)), e1 = L.e(lngOfX(x + 1, z)), n0 = L.n(latOfY(y, z)), n1 = L.n(latOfY(y + 1, z));
  const used = new Set<number>();
  let seamPx = 0;
  for (let py = 0; py < T; py++) {
    const fy = ((py + 0.5) / T) * G, j = Math.min(G - 1, Math.floor(fy)), wy = fy - j, nn = n0 + ((py + 0.5) / T) * (n1 - n0);
    for (let px = 0; px < T; px++) {
      const fx = ((px + 0.5) / T) * G, i = Math.min(G - 1, Math.floor(fx)), wx = fx - i, ee = e0 + ((px + 0.5) / T) * (e1 - e0);
      let d1 = Infinity, d2 = Infinity, k1 = -1, k2 = -1, u1 = 0, v1 = 0, u2 = 0, v2 = 0;
      for (const g of grids) {
        const p = j * (G + 1) + i, q = p + G + 1;
        const u = (g.gu[p] * (1 - wx) + g.gu[p + 1] * wx) * (1 - wy) + (g.gu[q] * (1 - wx) + g.gu[q + 1] * wx) * wy;
        const v = (g.gv[p] * (1 - wx) + g.gv[p + 1] * wx) * (1 - wy) + (g.gv[q] * (1 - wx) + g.gv[q + 1] * wx) * wy;
        if (u < 0 || v < 0 || u > g.W - 1 || v > g.H - 1) continue;
        const c = cams[g.k];
        if (!g.full && !inRingEN(c, ee, nn)) continue;
        const d = Math.hypot(c.ne - ee, c.nn - nn);
        if (d < d1) { d2 = d1; k2 = k1; u2 = u1; v2 = v1; d1 = d; k1 = g.k; u1 = u; v1 = v; } else if (d < d2) { d2 = d; k2 = g.k; u2 = u; v2 = v; }
      }
      const o = py * T + px;
      if (k1 < 0) continue;
      a[o] = k1; ua[o] = u1; va[o] = v1; used.add(k1);
      if (k2 >= 0 && featherM > 0 && d2 - d1 < featherM) { b[o] = k2; ub[o] = u2; vb[o] = v2; wb[o] = 0.5 * (1 - (d2 - d1) / featherM); used.add(k2); seamPx++; }
    }
  }
  return { z, x, y, a, b, wb, ua, va, ub, vb, used: [...used], seamPx };
}

/** Pixels of one photograph and how they relate to its camera's own pixel grid (image px per intrinsics px). */
export type GroundImage = { width: number; height: number; rgba: Uint8ClampedArray | Uint8Array; scale: number };

/** Bilinear colour of a photograph at camera pixel (u, v). */
export const sampleInto = (im: GroundImage, u: number, v: number, out: Float64Array) => {
  const x = Math.min(im.width - 1.001, Math.max(0, u * im.scale - 0.5)), y = Math.min(im.height - 1.001, Math.max(0, v * im.scale - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, W = im.width, d = im.rgba;
  const o00 = (y0 * W + x0) * 4, o10 = o00 + 4, o01 = o00 + W * 4, o11 = o01 + 4;
  for (let c = 0; c < 3; c++) out[c] = (d[o00 + c] * (1 - fx) + d[o10 + c] * fx) * (1 - fy) + (d[o01 + c] * (1 - fx) + d[o11 + c] * fx) * fy;
};

/** One tile's colours from its geometry: gains per photograph and channel (1 when absent). */
export function shadeTile(g: TileGeometry, T: number, image: (k: number) => GroundImage, gains: Float64Array | null): Uint8Array {
  const out = new Uint8Array(T * T * 4), A = new Float64Array(3), B = new Float64Array(3);
  for (let o = 0; o < T * T; o++) {
    const q = o * 4; out[q + 3] = 255;
    const ka = g.a[o];
    if (ka < 0) { out[q] = BACKGROUND[0]; out[q + 1] = BACKGROUND[1]; out[q + 2] = BACKGROUND[2]; continue; }
    sampleInto(image(ka), g.ua[o], g.va[o], A);
    const kb = g.b[o], w = kb >= 0 ? g.wb[o] : 0;
    if (w > 0) sampleInto(image(kb), g.ub[o], g.vb[o], B);
    for (let c = 0; c < 3; c++) {
      const va = A[c] * (gains ? gains[ka * 3 + c] : 1), vb = w > 0 ? B[c] * (gains ? gains[kb * 3 + c] : 1) : 0;
      out[q + c] = Math.max(0, Math.min(255, Math.round(va * (1 - w) + vb * w)));
    }
  }
  return out;
}

/** Overlap statistics for the gains: per pair of photographs, both photographs' mean colour over the same ground. */
export type PairStats = Map<string, { a: number; b: number; n: number; sa: Float64Array; sb: Float64Array }>;

/** Adds a tile's overlap (pixels both photographs hold, within `bandM` of the seam's nadir-distance difference). */
export function accumulateOverlap(cams: GroundCam[], origin: [number, number], z: number, x: number, y: number, cands: number[], T: number, bandM: number, image: (k: number) => GroundImage, stats: PairStats) {
  const g = tileGeometry(cams, origin, z, x, y, cands, T, bandM);
  const A = new Float64Array(3), B = new Float64Array(3);
  for (let o = 0; o < T * T; o++) {
    const ka = g.a[o], kb = g.b[o];
    if (ka < 0 || kb < 0) continue;
    sampleInto(image(ka), g.ua[o], g.va[o], A); sampleInto(image(kb), g.ub[o], g.vb[o], B);
    const lo = Math.min(ka, kb), hi = Math.max(ka, kb), key = `${lo}:${hi}`;
    let s = stats.get(key);
    if (!s) { s = { a: lo, b: hi, n: 0, sa: new Float64Array(3), sb: new Float64Array(3) }; stats.set(key, s); }
    const [P, Q] = ka === lo ? [A, B] : [B, A];
    s.n++; for (let c = 0; c < 3; c++) { s.sa[c] += P[c]; s.sb[c] += Q[c]; }
  }
}

/**
 * Gains per photograph and channel (Brown & Lowe's gain compensation in log space): g_a * mean_a = g_b * mean_b over
 * each overlap, weighted by its pixels, with a prior pulling every gain to 1 so the flight's overall colour is kept.
 */
export function solveGains(nCams: number, stats: PairStats, prior = 0.02): Float64Array {
  const x = new Float64Array(nCams * 3);
  const pairs = [...stats.values()].filter(s => s.n > 50);
  const totalW = pairs.reduce((t, s) => t + s.n, 0) || 1, lambda = (prior * totalW) / Math.max(1, nCams);
  for (let it = 0; it < 300; it++) {
    for (let c = 0; c < 3; c++) {
      const num = new Float64Array(nCams), den = new Float64Array(nCams);
      for (const s of pairs) {
        const ma = s.sa[c] / s.n, mb = s.sb[c] / s.n;
        if (ma < 1 || mb < 1) continue;
        const r = Math.log(mb / ma);
        // x_a - x_b = r: a moves toward x_b + r, b toward x_a - r.
        num[s.a] += s.n * (x[s.b * 3 + c] + r); den[s.a] += s.n;
        num[s.b] += s.n * (x[s.a * 3 + c] - r); den[s.b] += s.n;
      }
      for (let k = 0; k < nCams; k++) x[k * 3 + c] = num[k] / (den[k] + lambda);
    }
  }
  return x.map(Math.exp);
}

/** A tile at zoom z-1 from its four children at z (missing children keep the background). */
export function parentTile(children: (Uint8Array | null)[], T: number): Uint8Array {
  const out = new Uint8Array(T * T * 4), h = T / 2;
  for (let q = 0; q < T * T; q++) { out[q * 4] = BACKGROUND[0]; out[q * 4 + 1] = BACKGROUND[1]; out[q * 4 + 2] = BACKGROUND[2]; out[q * 4 + 3] = 255; }
  children.forEach((ch, idx) => {
    if (!ch) return;
    const dx = (idx & 1) * h, dy = (idx >> 1) * h;
    for (let py = 0; py < h; py++) for (let px = 0; px < h; px++) {
      const q = ((py + dy) * T + px + dx) * 4;
      for (let c = 0; c < 3; c++) { const o = (2 * py * T + 2 * px) * 4 + c; out[q + c] = (ch[o] + ch[o + 4] + ch[o + T * 4] + ch[o + T * 4 + 4]) >> 2; }
    }
  });
  return out;
}

/**
 * Seam agreement: the same ground drawn from photograph a alone and from b alone (grey, T x T), the offset that best
 * aligns them by normalised cross-correlation, coarse to fine (a search of +-R pixels at a quarter of the resolution,
 * then +-3 at full around it, a parabola for the sub-pixel), in tile pixels; `atEdge` when the best coarse offset sits
 * on the search's edge (the photographs disagree by at least the range). Null when the ground has too little texture
 * or nothing correlates.
 */
export function seamOffset(g: TileGeometry, T: number, ka: number, kb: number, image: (k: number) => GroundImage, R: number): { dx: number; dy: number; peak: number; atEdge: boolean } | null {
  const A = new Float32Array(T * T), B = new Float32Array(T * T), tmp = new Float64Array(3);
  const ia = image(ka), ib = image(kb);
  for (let o = 0; o < T * T; o++) {
    let ua: number, va: number, ub: number, vb: number;
    if (g.a[o] === ka && g.b[o] === kb) { ua = g.ua[o]; va = g.va[o]; ub = g.ub[o]; vb = g.vb[o]; }
    else if (g.a[o] === kb && g.b[o] === ka) { ua = g.ub[o]; va = g.vb[o]; ub = g.ua[o]; vb = g.va[o]; }
    else return null;
    sampleInto(ia, ua, va, tmp); A[o] = 0.299 * tmp[0] + 0.587 * tmp[1] + 0.114 * tmp[2];
    sampleInto(ib, ub, vb, tmp); B[o] = 0.299 * tmp[0] + 0.587 * tmp[1] + 0.114 * tmp[2];
  }
  const down = (X: Float32Array, n: number, f: number) => { const m = n / f, Y = new Float32Array(m * m); for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) { let s = 0; for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += X[(y * f + j) * n + x * f + i]; Y[y * m + x] = s / (f * f); } return Y; };
  // NCC of A's centre window against B shifted by (dx, dy); the window leaves `pad` pixels on every side.
  const ncc = (P: Float32Array, Qm: Float32Array, n: number, pad: number, dx: number, dy: number) => {
    const m = n - 2 * pad; let ma = 0, mb = 0;
    for (let y = pad; y < pad + m; y++) for (let x = pad; x < pad + m; x++) { ma += P[y * n + x]; mb += Qm[(y + dy) * n + x + dx]; }
    ma /= m * m; mb /= m * m;
    let sab = 0, sa = 0, sb = 0;
    for (let y = pad; y < pad + m; y++) for (let x = pad; x < pad + m; x++) { const p = P[y * n + x] - ma, q = Qm[(y + dy) * n + x + dx] - mb; sab += p * q; sa += p * p; sb += q * q; }
    return { s: sab / Math.sqrt(sa * sb + 1e-9), varA: sa / (m * m) };
  };
  const F = 4, n4 = T / F, R4 = Math.max(2, Math.round(R / F)), A4 = down(A, T, F), B4 = down(B, T, F);
  if (ncc(A4, B4, n4, R4, 0, 0).varA < 4) return null;
  let best = -2, bx = 0, by = 0;
  for (let dy = -R4; dy <= R4; dy++) for (let dx = -R4; dx <= R4; dx++) { const { s } = ncc(A4, B4, n4, R4, dx, dy); if (s > best) { best = s; bx = dx; by = dy; } }
  const atEdge = Math.abs(bx) === R4 || Math.abs(by) === R4;
  // Refine at full resolution around the coarse answer.
  const cx = bx * F, cy = by * F, r = 3, pad = Math.abs(cx) + Math.abs(cy) + r + 2;
  if (pad * 2 >= T - 16) return { dx: cx, dy: cy, peak: best, atEdge };
  const S = 2 * r + 1, score = new Float64Array(S * S);
  let fb = -2, fx = 0, fy = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const { s } = ncc(A, B, T, pad, cx + dx, cy + dy); score[(dy + r) * S + dx + r] = s; if (s > fb) { fb = s; fx = dx; fy = dy; } }
  if (fb < 0.4) return null;
  const at = (dx: number, dy: number) => score[(dy + r) * S + dx + r];
  const par = (l: number, c: number, rr: number) => { const den = l - 2 * c + rr; return Math.abs(den) < 1e-9 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (l - rr)) / den)); };
  const sx = Math.abs(fx) < r ? par(at(fx - 1, fy), fb, at(fx + 1, fy)) : 0, sy = Math.abs(fy) < r ? par(at(fx, fy - 1), fb, at(fx, fy + 1)) : 0;
  return { dx: cx + fx + sx, dy: cy + fy + sy, peak: fb, atEdge };
}
