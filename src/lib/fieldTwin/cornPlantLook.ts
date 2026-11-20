// Each corn plant's own look, for the twin's Realistic and Simple views (2026-11-20): which way its leaves lie, how long
// it is, its own green.
//
// A corn seedling's leaves grow in two opposite ranks, so from above a plant is a line. Measured on the first independent
// seedling flight before this was built: 90 % of plants read as a clear line (long axis over 1.8 times the width), and
// a plant's photographs agree on its direction to a median of 12 degrees (45 would be chance).
//
// Two steps, both off the read's path (nothing a read does or returns depends on them, as cornColours.ts):
//   measureMarkLooks  in the helper, after a photograph's read, from the pixels it has just read: at each mark, the
//                     green piece under it (told from the soil around that mark, not from a fixed number), its long
//                     axis, its length along it and the colour of its greenest part. Six bytes a mark.
//   plantLooks        over the field: each plant's look is what the photographs that marked it agree on (the middle
//                     direction when they agree, the median length, the median colour).
// What is not measured is not drawn from this: a plant with no agreed direction is drawn as before. No pixel leaves
// the helper: three numbers a plant go into the twin.
import { type GeorefFrame, groundSampleAt, pixelToGround } from "../directGeoref/projection";
import type { PhotoPixels } from "../photoScout/pattern";
import type { LatLngAlt } from "../sourceFrames/odm";
import { toEnu } from "../sourceFrames/odm";

export const PLANT_LOOK = {
  /** The window around a mark: this far each way, metres (a seedling of the flights measured is 6 to 10 cm long). */
  radiusM: 0.075,
  /** The piece of green a mark stands on: the nearest within this far of it, metres. */
  nearM: 0.02,
  /** A piece smaller than this many pixels is noise. */
  minPx: 4,
  /** Leaf against the window's own soil (its median tint and brightness): greener by `tint`, or, darker than the soil,
   * its tint at the soil's brightness greener by `darkTint` (seedlingGreen.ts lower bar: a dark seedling leaf scores
   * about 14 mid frame and 9 at a corner). */
  tint: 10, darkTint: 8.75, darkMaxGain: 2.5, darkMinL: 40,
  /** Pixels darker or brighter than this are shadow or glare, never a colour to keep. */
  darkest: 20, brightest: 245,
  /** A direction is kept from one photograph only with a long axis at least this many times the width... */
  loneElong: 2,
  /** ... and from several when their directions agree: the mean resultant of the doubled angles at least this
   * (0.7 is a spread of about 24 degrees), and a median long-axis ratio of at least `minElong`. */
  agree: 0.7, minElong: 1.5,
  /** A plant drawn "full" (a second pair of leaves turned from the line) under this long-axis ratio, "line" at or over. */
  lineElong: 2.6,
};

/** Bytes a mark in `measureMarkLooks`: direction (degrees 0..179 in the photograph, from +x towards +y; 255 none),
 * length (quarter pixels, 1..255), long axis over width (tenths, 10..255), r, g, b. */
export const MARK_LOOK_BYTES = 6;
const NONE = 255;

/**
 * The look of the green under each mark of one photograph. `marks` in these pixels; `gsdM` their ground size.
 * A mark on no green keeps direction 255.
 */
export function measureMarkLooks(px: PhotoPixels, marks: readonly (readonly [number, number])[], gsdM: number, o = PLANT_LOOK): Uint8Array {
  const { width: W, height: H, rgba: d } = px, out = new Uint8Array(marks.length * MARK_LOOK_BYTES);
  const R = Math.max(4, Math.min(40, Math.round(o.radiusM / Math.max(1e-4, gsdM)))), side = 2 * R + 1, N = side * side, near2 = (o.nearM / gsdM) ** 2, R2 = R * R;
  const tint = new Float32Array(N), lum = new Float32Array(N), score = new Float32Array(N), leaf = new Uint8Array(N), lab = new Int32Array(N), stack = new Int32Array(N), piece = new Int32Array(N), sc = new Float32Array(N);
  // Medians by counting (tint in half steps from -255, brightness in whole steps): a sort a mark would cost more than all the rest.
  const hT = new Uint16Array(1024), hL = new Uint16Array(256);
  const medianOf = (h: Uint16Array) => { let acc = 0; const half = N >> 1; for (let i = 0; i < h.length; i++) { acc += h[i]; if (acc > half) return i; } return h.length - 1; };
  for (let m = 0; m < marks.length; m++) {
    const b = m * MARK_LOOK_BYTES; out[b] = NONE;
    const cx = Math.round(marks[m][0]), cy = Math.round(marks[m][1]);
    if (cx - R < 0 || cy - R < 0 || cx + R >= W || cy + R >= H) continue;
    // The window's tint and brightness; its soil is their medians (a seedling covers a small part of it).
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const q = ((cy - R + y) * W + cx - R + x) * 4, j = y * side + x, r = d[q], g = d[q + 1], bl = d[q + 2];
      const t = g - (r + bl) / 2, L = 0.3 * r + 0.59 * g + 0.11 * bl;
      tint[j] = t; lum[j] = L; hT[Math.round(2 * t) + 510]++; hL[Math.round(L)]++;
    }
    const sT = (medianOf(hT) - 510) / 2, sL = medianOf(hL);
    hT.fill(0); hL.fill(0);
    for (let j = 0; j < N; j++) {
      const dt = tint[j] - sT, L = lum[j];
      let s = dt - o.tint;
      if (L < sL && L > o.darkMinL) s = Math.max(s, tint[j] * Math.min(o.darkMaxGain, sL / L) - sT - o.darkTint);
      score[j] = s; leaf[j] = s > 0 && L > o.darkest && L < o.brightest ? 1 : 0; lab[j] = -1;
    }
    // The piece nearest the mark (8-connected), within `nearM` of it.
    let seed = -1, sd = Infinity;
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) { const j = y * side + x; if (!leaf[j]) continue; const dd = (x - R) ** 2 + (y - R) ** 2; if (dd < sd) { sd = dd; seed = j; } }
    if (seed < 0 || sd > near2) continue;
    let n = 0, top = 0; stack[top++] = seed; lab[seed] = 1;
    let mx = 0, my = 0;
    while (top) {
      const p = stack[--top], x = p % side, y = (p - x) / side;
      // Only what lies inside the window's circle is this plant's (beyond it: the next plant's leaves).
      if ((x - R) ** 2 + (y - R) ** 2 <= R2) { piece[n++] = p; mx += x; my += y; }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= side || yy >= side) continue; const qn = yy * side + xx; if (leaf[qn] && lab[qn] < 0) { lab[qn] = 1; stack[top++] = qn; } }
    }
    if (n < o.minPx) continue;
    mx /= n; my /= n;
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) { const p = piece[i], px0 = p % side, x = px0 - mx, y = (p - px0) / side - my; sxx += x * x; syy += y * y; sxy += x * y; }
    sxx = sxx / n + 1 / 12; syy = syy / n + 1 / 12; sxy /= n;
    const tr = sxx + syy, disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - (sxx * syy - sxy * sxy))), l1 = tr / 2 + disc, l2 = Math.max(1 / 12, tr / 2 - disc);
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ax = Math.cos(ang), ay = Math.sin(ang);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { const p = piece[i], px0 = p % side, t = (px0 - mx) * ax + ((p - px0) / side - my) * ay; if (t < lo) lo = t; if (t > hi) hi = t; }
    // Its colour: the greener half of the piece (a leaf two pixels wide is half soil at its edges).
    for (let i = 0; i < n; i++) sc[i] = score[piece[i]];
    const cut = sc.subarray(0, n).sort()[n >> 1];
    let r = 0, g = 0, bl = 0, k = 0;
    for (let i = 0; i < n; i++) { const p = piece[i]; if (score[p] < cut) continue; const px0 = p % side, q = ((cy - R + (p - px0) / side) * W + cx - R + px0) * 4; r += d[q]; g += d[q + 1]; bl += d[q + 2]; k++; }
    out[b] = ((Math.round((ang * 180) / Math.PI) % 180) + 180) % 180;
    out[b + 1] = Math.max(1, Math.min(255, Math.round((hi - lo + 1) * 4)));
    out[b + 2] = Math.max(10, Math.min(255, Math.round(Math.sqrt(l1 / l2) * 10)));
    out[b + 3] = Math.round(r / k); out[b + 4] = Math.round(g / k); out[b + 5] = Math.round(bl / k);
  }
  return out;
}

/** A photograph's marks' looks: of its stricter marks (`CornPhotoRead.plants`) and of its lower-bar candidates (`low`), in read pixels. */
export type PhotoLooks = { plants: Uint8Array; low: Uint8Array };

/** One sighting of a plant: the photograph (name), its pixel in the full frame, and where its look is: the index into
 * that photograph's stricter marks, or -1 for a lower-bar candidate (found by its place). */
export type LookSighting = { photo: string; u: number; v: number; k: number };

/** A plant's look. `dirDeg`: compass bearing of its leaf line, 0..180 (null: not agreed). `shape`: 0 a line, 1 fuller. */
export type PlantLook = { dirDeg: number | null; shape: 0 | 1; sizeM: number | null; rgb: [number, number, number] | null };

/**
 * The look of each plant from its sightings. `reads`: per photograph its scale and lower-bar candidates (read pixels).
 * A direction in a photograph becomes a compass bearing through that photograph's camera.
 */
export function plantLooks(plants: LookSighting[][], looks: Map<string, PhotoLooks>, reads: Map<string, { scale: number; low?: [number, number][] }>, frames: Map<string, GeorefFrame>, origin: LatLngAlt, o = PLANT_LOOK): PlantLook[] {
  const median = (v: number[]) => { v.sort((a, b) => a - b); return v[v.length >> 1]; };
  // Lower-bar candidates by place, per photograph (a candidate split along a row has no look of its own: none).
  const lowAt = new Map<string, Map<number, number[]>>(), CELL = 8;
  const lowIndex = (name: string) => {
    let g = lowAt.get(name); if (g) return g;
    g = new Map(); const r = reads.get(name);
    (r?.low ?? []).forEach(([x, y], i) => { const key = Math.floor(x / CELL) * 100_000 + Math.floor(y / CELL); (g!.get(key) ?? g!.set(key, []).get(key)!).push(i); });
    lowAt.set(name, g); return g;
  };
  return plants.map(sightings => {
    const bearings: number[] = [], elong: number[] = [], sizes: number[] = [], rs: number[] = [], gs: number[] = [], bs: number[] = [];
    for (const s of sightings) {
      const L = looks.get(s.photo), f = frames.get(s.photo), r = reads.get(s.photo); if (!L || !f || !r) continue;
      let bytes: Uint8Array, at = -1;
      if (s.k >= 0) { bytes = L.plants; at = s.k; }
      else {
        bytes = L.low; const x = s.u / r.scale, y = s.v / r.scale, g = lowIndex(s.photo); let bd = 3 * 3;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of g.get((Math.floor(x / CELL) + dx) * 100_000 + Math.floor(y / CELL) + dy) ?? []) { const dd = (r.low![i][0] - x) ** 2 + (r.low![i][1] - y) ** 2; if (dd <= bd) { bd = dd; at = i; } }
      }
      const b = at * MARK_LOOK_BYTES; if (at < 0 || b + MARK_LOOK_BYTES > bytes.length || bytes[b] === NONE) continue;
      const gsd = groundSampleAt(f, s.u, s.v); if (!gsd) continue;
      const a = (bytes[b] * Math.PI) / 180, du = Math.cos(a) * 20 * r.scale, dv = Math.sin(a) * 20 * r.scale;
      const g0 = pixelToGround(f, s.u - du, s.v - dv), g1 = pixelToGround(f, s.u + du, s.v + dv); if (!g0 || !g1) continue;
      const e0 = toEnu({ lat: g0.lat, lng: g0.lng, altM: 0 }, origin), e1 = toEnu({ lat: g1.lat, lng: g1.lng, altM: 0 }, origin);
      bearings.push((((Math.atan2(e1[0] - e0[0], e1[1] - e0[1]) * 180) / Math.PI) + 360) % 180);
      elong.push(bytes[b + 2] / 10); sizes.push((bytes[b + 1] / 4) * r.scale * gsd);
      rs.push(bytes[b + 3]); gs.push(bytes[b + 4]); bs.push(bytes[b + 5]);
    }
    if (!bearings.length) return { dirDeg: null, shape: 1, sizeM: null, rgb: null };
    const el = median([...elong]);
    let dirDeg: number | null = null;
    if (bearings.length === 1) { if (el >= o.loneElong) dirDeg = bearings[0]; }
    else {
      const c = bearings.reduce((t, x) => t + Math.cos((2 * x * Math.PI) / 180), 0) / bearings.length, sn = bearings.reduce((t, x) => t + Math.sin((2 * x * Math.PI) / 180), 0) / bearings.length;
      if (Math.hypot(c, sn) >= o.agree && el >= o.minElong) dirDeg = (((Math.atan2(sn, c) * 90) / Math.PI) + 180) % 180;
    }
    return { dirDeg, shape: el >= o.lineElong ? 0 : 1, sizeM: median(sizes), rgb: [median(rs), median(gs), median(bs)] };
  });
}

/** The looks packed for the twin, a plant each in the plants' order: `dir` a byte (2-degree steps 0..89, plus 90 when
 * the shape is fuller; 255: no direction), `size` a byte (half centimetres, 0: none), `colour` two bytes (5-6-5 bits
 * of r, g, b, low byte first; 0: none). */
export type PackedLooks = { version: 1; dir: string; size: string; colour: string };

const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };

export function packLooks(L: PlantLook[]): PackedLooks {
  const n = L.length, dir = new Uint8Array(n), size = new Uint8Array(n), colour = new Uint8Array(2 * n);
  L.forEach((p, i) => {
    dir[i] = p.dirDeg == null ? NONE : (Math.round(p.dirDeg / 2) % 90) + (p.shape ? 90 : 0);
    size[i] = p.sizeM == null ? 0 : Math.max(1, Math.min(255, Math.round(p.sizeM * 200)));
    if (p.rgb) { const v = Math.max(1, ((p.rgb[0] >> 3) << 11) | ((p.rgb[1] >> 2) << 5) | (p.rgb[2] >> 3)); colour[2 * i] = v & 255; colour[2 * i + 1] = v >> 8; }
  });
  return { version: 1, dir: b64(dir), size: b64(size), colour: b64(colour) };
}

/** The packed looks opened for drawing; null when they are not a version 1 record of `n` plants. */
export function unpackLooks(P: PackedLooks | null | undefined, n: number): { dir: Uint8Array; size: Uint8Array; colour: Uint16Array } | null {
  if (!P || P.version !== 1) return null;
  try {
    const dir = unb64(P.dir), size = unb64(P.size), c = unb64(P.colour);
    if (dir.length !== n || size.length !== n || c.length !== 2 * n) return null;
    const colour = new Uint16Array(n); for (let i = 0; i < n; i++) colour[i] = c[2 * i] | (c[2 * i + 1] << 8);
    return { dir, size, colour };
  } catch { return null; }
}

/** A packed colour as r, g, b. */
export const lookRgb = (v: number): [number, number, number] => [((v >> 11) & 31) * 8 + 4, ((v >> 5) & 63) * 4 + 2, (v & 31) * 8 + 4];
