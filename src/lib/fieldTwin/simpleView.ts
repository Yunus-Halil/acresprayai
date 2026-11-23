// The Simple view of a corn twin (his sketch of 2026-11-23): a black ground, the rows as thin white lines, every corn
// plant a small square box, the possible weeds red boxes; zoomed out, each row a bar. Plain shapes, so it is the
// cheapest view to draw.
//
// A plant's box:
//   size    its measured span (cornPlantLook.ts), the box's side `boxShare` of it, so neighbouring plants stay apart;
//   colour  its own measured green, STRETCHED: real corn colours lie very close together (on the first seedling flight
//           every plant is a similar dark olive), so each plant is compared with the field's average and the
//           difference widened. The field's average is drawn as one clear green (`hue`, `light`); a plant paler than
//           the average is drawn lighter, a darker one darker, a yellower one more yellow, a greener one greener. The
//           direction of a difference is always the measured one; only its size is widened.
// A plant with no measured colour or span gets a neutral box at the field's typical span.
//
// A stretch of row with no plant found is one of two things, and they are drawn apart (unreadRows):
//   the photographs saw the ground and found no plant (bare ground, an alley between plots): a faint line;
//   fewer than two photographs looked at it, so a plant there could not have been confirmed (a build keeps a plant two
//   photographs located): amber dashes, "the photos couldn't read it". Known from the photographs' outlines the twin
//   keeps; a twin with no outlines says nothing (no stretch is called not read).
//
// How far each is widened. Paleness: a plant 10 % brighter than the field's average is drawn `lightGain` x 0.1 lighter
// (a real difference of about 3 % of lightness becomes 9 %). Yellowness: the measured hue difference from the field's
// average, times a gain that depends on how finely the twin keeps a plant's colour:
//   `hueGainFine`  a twin with each plant's colour as measured (2026-11-23 on, cornPlantLook.ts `rgb`). On the first
//                  seedling flight the middle 90 % of plants lie within 4.4 degrees yellower and 6.2 greener of the
//                  field's average; at this gain they are all drawn plainly green, and a plant 5 degrees or more
//                  yellower than the field (3 % of them) is drawn yellow-green;
//   `hueGain`      an older twin, which keeps the colour in 16 bits (5 of red, 6 of green, 5 of blue). On a dark
//                  seedling one step of red is then about as large as the difference between two plants (the same
//                  flight read as 11 degrees yellower to 8 greener, most of it the storage's steps), so the gain is
//                  kept low: a larger one painted the steps as yellow plants.
// Brightness has no such limit.
import { lookRgb } from "./cornPlantLook";
import type { PlotContext } from "./plots";
import type { LatLngPair, TwinBundle, TwinRgb } from "./types";

export const SIMPLE = {
  /** A box's side, as a share of the plant's measured span. */
  boxShare: 0.6,
  /** The field's average plant: this hue (degrees), saturation and lightness. */
  hue: 100, sat: 0.78, light: 0.42,
  hueGain: 1.5, hueGainFine: 3, hueMin: 48, hueMax: 140,
  lightGain: 0.9, lightMin: 0.2, lightMax: 0.8,
  neutral: [138, 143, 138] as TwinRgb,
  weed: [255, 59, 48] as TwinRgb,
  row: "#ffffff",
  ground: "#000000",
  /** Boxes from where a typical plant's box is this many pixels; smaller, each row is a bar. */
  boxesMinPx: 2.5,
  /** Up to this many boxes in view are drawn one by one; more are written into one image. */
  directMax: 12_000,
  /** Zoomed out, the red marks are drawn one by one only on a field of up to this many located plants. */
  directFieldMax: 80_000,
  /** A row's bar is cut into pieces about this long, metres (each its plants' average colour and its own fullness). */
  barM: 3,
  /** A bar's width as a share of the row spacing, and its faintest (an empty piece). */
  barShare: 0.42, barMinAlpha: 0.18,
  /** A stretch with no plant found is "not read" where fewer photographs than this looked at it (a plant is kept when
   * two located it); it is asked every `unreadStepM` along the stretch; and the colour it is drawn in. */
  readPhotos: 2, unreadStepM: 0.5, unread: "#f0a63a",
};

/** The field's average plant colour, as measured: the median hue (degrees) and brightness of its counted plants. */
export type FieldColour = { hue: number; lum: number };

const lumOf = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;
/** Hue in degrees, 0 to 360 (0 for a grey). */
export function hueOf(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d <= 0) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
export function hslRgb(h: number, s: number, l: number): TwinRgb {
  const c = (1 - Math.abs(2 * l - 1)) * s, hp = (((h % 360) + 360) % 360) / 60, x = c * (1 - Math.abs((hp % 2) - 1)), m = l - c / 2;
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** The field's average from its plants' packed colours (0: none), over the plants `use` keeps. Null: none measured. */
export function fieldColourOf(colour: ArrayLike<number>, use: (k: number) => boolean = () => true): FieldColour | null {
  const hues: number[] = [], lums: number[] = [];
  for (let k = 0; k < colour.length; k++) { if (!colour[k] || !use(k)) continue; const [r, g, b] = lookRgb(colour[k]); hues.push(hueOf(r, g, b)); lums.push(lumOf(r, g, b)); }
  if (!hues.length) return null;
  hues.sort((a, b) => a - b); lums.sort((a, b) => a - b);
  return { hue: hues[hues.length >> 1], lum: lums[lums.length >> 1] };
}

/** A measured colour as the Simple view draws it: its difference from the field's average, widened (see the header).
 * `fine`: the twin keeps each plant's colour as measured (the larger gain on hue). */
export function stretched(rgb: ArrayLike<number>, F: FieldColour, o = SIMPLE, fine = false): TwinRgb {
  const dHue = hueOf(rgb[0], rgb[1], rgb[2]) - F.hue, rel = F.lum > 0 ? lumOf(rgb[0], rgb[1], rgb[2]) / F.lum - 1 : 0;
  const h = Math.max(o.hueMin, Math.min(o.hueMax, o.hue + (fine ? o.hueGainFine : o.hueGain) * dHue));
  const l = Math.max(o.lightMin, Math.min(o.lightMax, o.light + o.lightGain * rel));
  return hslRgb(h, o.sat, l);
}
/** The colour the field's average plant is drawn in (the legend's swatch). */
export const averageColour = (o = SIMPLE): TwinRgb => hslRgb(o.hue, o.sat, o.light);

/**
 * How many photographs looked at a place (metres east / north of the twin's origin): the outlines the twin keeps,
 * without the photographs the build could not read. Null: no outline to go by, nothing can be said.
 */
export function photosOver(footprints: { photo: string; ring: LatLngPair[] }[], failed: string[], frame: PlotContext["frame"]): ((e: number, n: number) => number) | null {
  const stem = (s: string) => s.replace(/\.[^.\\/]+$/, "").toLowerCase(), bad = new Set(failed.map(stem));
  const rings = footprints.filter(f => f.ring.length >= 3 && !bad.has(stem(f.photo))).map(f => {
    const xy = new Float64Array(f.ring.length * 2); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    f.ring.forEach(([la, ln], i) => { const [e, n] = frame.toEN(la, ln); xy[2 * i] = e; xy[2 * i + 1] = n; if (e < x0) x0 = e; if (e > x1) x1 = e; if (n < y0) y0 = n; if (n > y1) y1 = n; });
    return { xy, x0, y0, x1, y1 };
  });
  if (!rings.length) return null;
  return (e, n) => {
    let c = 0;
    for (const r of rings) {
      if (e < r.x0 || e > r.x1 || n < r.y0 || n > r.y1) continue;
      let hit = false; const k = r.xy.length / 2;
      for (let i = 0, j = k - 1; i < k; j = i++) { const xi = r.xy[2 * i], yi = r.xy[2 * i + 1], xj = r.xy[2 * j], yj = r.xy[2 * j + 1]; if ((yi > n) !== (yj > n) && e < ((xj - xi) * (n - yi)) / (yj - yi) + xi) hit = !hit; }
      if (hit) c++;
    }
    return c;
  };
}

/** The parts of the rows with no plant found that the photographs could not read (see the header). */
export type UnreadRows = {
  n: number;
  /** Each part's two ends, latitude / longitude. */
  a: LatLngPair[]; b: LatLngPair[];
  /** Metres of row with no plant found: the part not read, and all of it. */
  unreadM: number; noPlantsM: number;
  /** False: the twin keeps no photograph outlines, so no stretch could be judged. */
  judged: boolean;
};

export function unreadRows(ctx: PlotContext, twin: Pick<TwinBundle, "footprints" | "corn">, o = SIMPLE): UnreadRows {
  const over = photosOver(twin.footprints ?? [], (twin.corn?.photographs?.failed ?? []).map(f => f.name), ctx.frame);
  const a: LatLngPair[] = [], b: LatLngPair[] = [];
  let unreadM = 0, noPlantsM = 0;
  for (const s of ctx.stretches) {
    if (s.seen) continue;
    for (let i = 1; i < s.pts.length / 2; i++) {
      const e0 = s.pts[2 * i - 2], n0 = s.pts[2 * i - 1], e1 = s.pts[2 * i], n1 = s.pts[2 * i + 1], L = Math.hypot(e1 - e0, n1 - n0);
      if (L <= 0) continue;
      const parts = Math.max(1, Math.ceil(L / o.unreadStepM));
      let from = -1;
      const close = (to: number) => { if (from < 0) return; a.push(ctx.frame.toLL(e0 + (from / parts) * (e1 - e0), n0 + (from / parts) * (n1 - n0))); b.push(ctx.frame.toLL(e0 + (to / parts) * (e1 - e0), n0 + (to / parts) * (n1 - n0))); from = -1; };
      for (let j = 0; j < parts; j++) {
        const tm = (j + 0.5) / parts, len = (L / parts) * s.scale;
        noPlantsM += len;
        if (over && over(e0 + tm * (e1 - e0), n0 + tm * (n1 - n0)) < o.readPhotos) { unreadM += len; if (from < 0) from = j; } else close(j);
      }
      close(parts);
    }
  }
  return { n: a.length, a, b, unreadM, noPlantsM, judged: !!over };
}

/** A row's bars for the zoomed-out view: pieces of each stretch with plants seen, their ends, colour and fullness. */
export type RowBars = {
  n: number;
  /** Each piece's two ends, latitude / longitude. */
  a: LatLngPair[]; b: LatLngPair[];
  /** Its plants' average colour, stretched (the neutral colour where none was measured). */
  rgb: TwinRgb[];
  /** 0 to 1: its counted plants per length against the field's (1: as full as the field's average, or fuller). */
  full: Float32Array;
  field: FieldColour | null;
  /** The parts of the rows the photographs could not read (null: no twin was handed in to ask). */
  unread: UnreadRows | null;
};

/**
 * The bars: every stretch of row with plants seen along it, cut into pieces of about `barM`. A piece's colour is the
 * average of its plants' measured colours, stretched as a plant's is; its fullness its counted plants per metre over
 * the field's (counted plants on the rows per metre of row with plants seen).
 */
export function rowBars(ctx: PlotContext, o = SIMPLE, twin: Pick<TwinBundle, "footprints" | "corn"> | null = null): RowBars {
  const field = fieldColourOf(ctx.pColour);
  const a: LatLngPair[] = [], b: LatLngPair[] = [], rgb: TwinRgb[] = [], full: number[] = [];
  let plants = 0, seenM = 0;
  for (const s of ctx.stretches) { if (!s.seen) continue; plants += s.plants.length; let L = 0; for (let i = 1; i < s.pts.length / 2; i++) L += Math.hypot(s.pts[2 * i] - s.pts[2 * i - 2], s.pts[2 * i + 1] - s.pts[2 * i - 1]); seenM += L * s.scale; }
  const perM = seenM > 0 ? plants / seenM : 0;
  for (const s of ctx.stretches) {
    if (!s.seen || s.pts.length < 4) continue;
    // The stretch's course by its along value (a stretch runs one way along the rows).
    const k = s.pts.length / 2, A = new Float64Array(k);
    for (let i = 0; i < k; i++) A[i] = ctx.toAC(s.pts[2 * i], s.pts[2 * i + 1])[0];
    const rev = A[k - 1] < A[0], a0 = Math.min(A[0], A[k - 1]), a1 = Math.max(A[0], A[k - 1]), len = a1 - a0;
    if (len <= 0) continue;
    const at = (av: number): [number, number] => {
      for (let i = 1; i < k; i++) {
        const lo = rev ? A[i] : A[i - 1], hi = rev ? A[i - 1] : A[i];
        if (av >= lo - 1e-9 && av <= hi + 1e-9) { const t = (av - A[i - 1]) / (A[i] - A[i - 1] || 1); return [s.pts[2 * i - 2] + t * (s.pts[2 * i] - s.pts[2 * i - 2]), s.pts[2 * i - 1] + t * (s.pts[2 * i + 1] - s.pts[2 * i - 1])]; }
      }
      return av <= a0 ? [s.pts[rev ? 2 * k - 2 : 0], s.pts[rev ? 2 * k - 1 : 1]] : [s.pts[rev ? 0 : 2 * k - 2], s.pts[rev ? 1 : 2 * k - 1]];
    };
    const pieces = Math.max(1, Math.round(len / o.barM)), step = len / pieces;
    const cnt = new Int32Array(pieces), sr = new Float64Array(pieces), sg = new Float64Array(pieces), sb = new Float64Array(pieces), nc = new Int32Array(pieces);
    for (const p of s.plants) {
      const j = Math.max(0, Math.min(pieces - 1, Math.floor((ctx.pA[p] - a0) / step)));
      cnt[j]++;
      if (ctx.pColour[p]) { const [r, g, bl] = lookRgb(ctx.pColour[p]); sr[j] += r; sg[j] += g; sb[j] += bl; nc[j]++; }
    }
    for (let j = 0; j < pieces; j++) {
      const p0 = at(a0 + j * step), p1 = at(a0 + (j + 1) * step);
      a.push(ctx.frame.toLL(p0[0], p0[1])); b.push(ctx.frame.toLL(p1[0], p1[1]));
      rgb.push(nc[j] && field ? stretched([sr[j] / nc[j], sg[j] / nc[j], sb[j] / nc[j]], field, o, ctx.pColourFine) : o.neutral);
      full.push(perM > 0 ? Math.min(1, cnt[j] / (step * s.scale) / perM) : 0);
    }
  }
  return { n: a.length, a, b, rgb, full: Float32Array.from(full), field, unread: twin ? unreadRows(ctx, twin, o) : null };
}

/** A plots-per-acre figure for a plot's label: "29.5k/ac". */
export const fmtPerAcreShort = (v: number) => `${(Math.round(v / 100) / 10).toFixed(1)}k/ac`;
/**
 * A plot's number in its label: amber when it calls for care (the stand is more than `under` below the field's, or the
 * plot is too small for a stable number), green otherwise.
 */
export function plotNumberTone(perAcre: number | null, fieldPerAcre: number | null, small: boolean, under = 0.1): "green" | "amber" {
  if (small || perAcre == null) return "amber";
  return fieldPerAcre != null && perAcre < (1 - under) * fieldPerAcre ? "amber" : "green";
}
