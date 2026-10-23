// Rendered corn stands with known geometry: the crop-profile benchmark's synthetic suite and the regression tests'
// fixtures. Each scene draws plants as two to four leaves in one plane (corn from above is a line of leaves, not a
// disc), on light, dark or red soil, optionally with straw stripes at the crop's pitch offset from the rows (the
// no-till case that put the pattern pass's rows on the straw, 2026-10-23), weeds between and inside the rows, and twin
// rows. The truth (rows, plants, weeds) is returned beside the pixels.
//
// Frame: the photo's own ground frame, x right and y up in metres from the top-left corner (y negative down the
// photo), exactly as photoScout/pattern.ts reads a photo. Angles are ground degrees counterclockwise from +x.
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";

export type Soil = "light" | "dark" | "red";

export type Scene = {
  name: string;
  widthM: number; heightM: number; gsdM: number;
  angleDeg: number;
  /** Row pitch (centre to centre of a row, or of a twin pair). */
  pitchM: number;
  /** Twin rows: the two lines of a pair this far apart, staggered along the row. Null: single rows. */
  twinM: number | null;
  /** In-row plant spacing. */
  alongM: number;
  /** Leaf length, metres (V2 about 0.06, V3 0.10, V4 0.15, V5 0.20, V6 0.30). */
  leafM: number;
  soil: Soil;
  /** Straw stripes at the crop's pitch: centre offset from the rows as a share of the pitch, and width as a share. */
  straw: { offsetShare: number; widthShare: number } | null;
  /** Weeds between rows, per m² of ground, and their radius. */
  weedsPerM2: number;
  weedRadiusM: number;
  /** Weeds inside the row band (not separable by position), per metre of row. */
  inRowWeedsPerM: number;
  seed: number;
};

export type SceneTruth = {
  angleDeg: number;
  pitchM: number;
  twinM: number | null;
  /** Signed metres across the rows from (x, y) to the nearest row line (the centre of a twin pair). */
  acrossToRow: (x: number, y: number) => number;
  plants: { x: number; y: number }[];
  /** Weeds placed between rows, centres and radii (metres, photo frame). */
  weeds: { x: number; y: number; r: number }[];
  inRowWeeds: { x: number; y: number; r: number }[];
  /** Share of the image that is crop, weed, straw. */
  shares: { crop: number; weed: number; straw: number };
  /** Per pixel: 0 soil, 1 straw, 2 weed, 3 crop (crop drawn last, over everything). */
  layer: Uint8Array;
};

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const SOIL: Record<Soil, [number, number, number]> = { light: [176, 142, 108], dark: [86, 66, 52], red: [150, 72, 52] };
const STRAW: [number, number, number] = [205, 186, 140];
const CROP: [number, number, number] = [62, 128, 42];
const WEED: [number, number, number] = [84, 140, 56];

export function renderScene(s: Scene): { px: PhotoPixels; truth: SceneTruth } {
  const W = Math.round(s.widthM / s.gsdM), H = Math.round(s.heightM / s.gsdM), g = s.gsdM;
  const rand = rng(s.seed);
  const th = (s.angleDeg * Math.PI) / 180;
  const tx = Math.cos(th), ty = Math.sin(th), nx = -Math.sin(th), ny = Math.cos(th);
  const cx = s.widthM / 2, cy = -s.heightM / 2;
  const across = (x: number, y: number) => (x - cx) * nx + (y - cy) * ny;
  const along = (x: number, y: number) => (x - cx) * tx + (y - cy) * ty;
  const wrap = (d: number, p: number) => ((((d + p / 2) % p) + p) % p) - p / 2;
  const toGround = (row: number, a: number) => ({ x: cx + a * tx + row * nx, y: cy + a * ty + row * ny });
  const span = Math.hypot(s.widthM, s.heightM);

  // Layers: 0 soil, 1 straw, 2 weed, 3 crop (crop drawn last, over everything).
  const layer = new Uint8Array(W * H);
  const shade = new Float32Array(W * H);
  const setPx = (i: number, j: number, l: number) => { if (i < 0 || j < 0 || i >= W || j >= H) return; const k = j * W + i; if (l >= layer[k]) { layer[k] = l; shade[k] = 0.85 + 0.3 * rand(); } };
  const inside = (x: number, y: number) => x >= 0 && x <= s.widthM && y <= 0 && y >= -s.heightM;

  // Straw: short strands along the row inside stripes at the crop pitch.
  if (s.straw) {
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = (i + 0.5) * g, y = -(j + 0.5) * g;
      const d = wrap(across(x, y) - s.straw.offsetShare * s.pitchM, s.pitchM);
      if (Math.abs(d) <= (s.straw.widthShare * s.pitchM) / 2 && rand() < 0.55) setPx(i, j, 1);
    }
  }
  // A leaf: a tapered thick segment.
  const leaf = (x0: number, y0: number, ang: number, len: number, wid: number, l: number) => {
    const n = Math.max(2, Math.ceil(len / g));
    for (let k = 0; k <= n; k++) {
      const t = k / n, w = wid * (1 - 0.7 * t);
      const x = x0 + Math.cos(ang) * len * t, y = y0 + Math.sin(ang) * len * t;
      const r = Math.max(g * 0.6, w / 2);
      const pi = x / g, pj = -y / g, rp = r / g;
      for (let j = Math.floor(pj - rp); j <= Math.ceil(pj + rp); j++) for (let i = Math.floor(pi - rp); i <= Math.ceil(pi + rp); i++) {
        if ((i + 0.5 - pi) ** 2 + (j + 0.5 - pj) ** 2 <= rp * rp) setPx(i, j, l);
      }
    }
  };
  const plant = (x: number, y: number) => {
    const plane = rand() * Math.PI, leaves = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < leaves; k++) {
      const side = k % 2 ? 0 : Math.PI;
      leaf(x, y, plane + side + (rand() - 0.5) * 0.5, s.leafM * (0.7 + 0.5 * rand()), s.leafM * 0.13, 3);
    }
  };
  const weed = (x: number, y: number, r: number) => {
    if (rand() < 0.5) {
      // broadleaf: a disc of a few lobes
      for (let k = 0; k < 4; k++) leaf(x, y, rand() * 2 * Math.PI, r, r * 0.9, 2);
    } else {
      // grass tuft: many thin leaves
      for (let k = 0; k < 6; k++) leaf(x, y, rand() * 2 * Math.PI, r * 1.3, Math.max(g, r * 0.12), 2);
    }
  };

  const plants: { x: number; y: number }[] = [];
  const kMax = Math.ceil(span / s.pitchM) + 1;
  const lines = s.twinM ? [-s.twinM / 2, s.twinM / 2] : [0];
  for (let k = -kMax; k <= kMax; k++) {
    lines.forEach((off, li) => {
      const stagger = li === 1 ? s.alongM / 2 : 0;
      for (let a = -span; a <= span; a += s.alongM) {
        const jitter = (rand() - 0.5) * 0.25 * s.alongM;
        const p = toGround(k * s.pitchM + off + (rand() - 0.5) * 0.02, a + stagger + jitter);
        if (!inside(p.x, p.y)) continue;
        if (rand() < 0.06) continue; // skips
        plant(p.x, p.y); plants.push(p);
      }
    });
  }
  const weeds: SceneTruth["weeds"] = [];
  const nWeeds = Math.round(s.weedsPerM2 * s.widthM * s.heightM);
  for (let n = 0; n < nWeeds; n++) {
    // Between rows: in the middle 60% of the alley.
    const k = Math.floor(rand() * 2 * kMax) - kMax;
    const p = toGround((k + 0.2 + 0.6 * rand()) * s.pitchM, (rand() - 0.5) * 2 * span);
    if (!inside(p.x, p.y)) continue;
    const r = s.weedRadiusM * (0.6 + 0.8 * rand());
    weed(p.x, p.y, r); weeds.push({ ...p, r });
  }
  const inRowWeeds: SceneTruth["inRowWeeds"] = [];
  const nIn = Math.round(s.inRowWeedsPerM * (s.widthM * s.heightM) / s.pitchM);
  for (let n = 0; n < nIn; n++) {
    const k = Math.floor(rand() * 2 * kMax) - kMax;
    const p = toGround(k * s.pitchM + (rand() - 0.5) * 0.06, (rand() - 0.5) * 2 * span);
    if (!inside(p.x, p.y)) continue;
    const r = s.weedRadiusM * (0.5 + 0.5 * rand());
    weed(p.x, p.y, r); inRowWeeds.push({ ...p, r });
  }

  const rgba = new Uint8ClampedArray(W * H * 4);
  let crop = 0, wd = 0, st = 0;
  const soil = SOIL[s.soil];
  for (let k = 0; k < W * H; k++) {
    const l = layer[k];
    const base = l === 3 ? CROP : l === 2 ? WEED : l === 1 ? STRAW : soil;
    const f = l ? shade[k] : 0.9 + 0.2 * rand();
    const o = k * 4;
    rgba[o] = base[0] * f + (rand() - 0.5) * 10; rgba[o + 1] = base[1] * f + (rand() - 0.5) * 10; rgba[o + 2] = base[2] * f + (rand() - 0.5) * 10; rgba[o + 3] = 255;
    if (l === 3) crop++; else if (l === 2) wd++; else if (l === 1) st++;
  }
  void along;
  return {
    px: { width: W, height: H, rgba },
    truth: {
      angleDeg: s.angleDeg, pitchM: s.pitchM, twinM: s.twinM,
      acrossToRow: (x, y) => wrap(across(x, y), s.pitchM),
      plants, weeds, inRowWeeds,
      shares: { crop: crop / (W * H), weed: wd / (W * H), straw: st / (W * H) },
      layer,
    },
  };
}

/** Leaf length by stage, metres (our reading of the profile's heights and projected areas; a drawing parameter). */
export const LEAF_BY_STAGE: Record<string, number> = { V2: 0.06, V3: 0.10, V4: 0.15, V5: 0.20, V6: 0.28 };

/**
 * The benchmark's scene lists. Each draws from the same grid of conditions with its own random seeds (and so its own
 * layouts). The first evaluation set (seeds 2000+) was looked at while the ExGR gate replaced the ExG floor on
 * 2026-10-23, so it became development data; the evaluation set is now seeds 3000+, run after that change.
 */
export function sceneSet(kind: "development" | "evaluation"): Scene[] {
  if (kind === "development") return [...sceneBatch(1, 1000, 20, "development"), ...sceneBatch(101, 2000, 60, "development-v1eval")];
  return sceneBatch(201, 3000, 60, "evaluation");
}

function sceneBatch(rngSeed: number, seedBase: number, n: number, label: string): Scene[] {
  const r = rng(rngSeed);
  const pitches = [0.762, 0.762, 0.762, 0.508, 0.559, 0.70, 0.914];
  const gsds = [0.003, 0.005, 0.01, 0.02, 0.03];
  const soils: Soil[] = ["light", "dark", "red"];
  const stages = Object.keys(LEAF_BY_STAGE);
  const out: Scene[] = [];
  for (let i = 0; i < n; i++) {
    const gsdM = gsds[Math.floor(r() * gsds.length)];
    const twin = r() < 0.12;
    const pitchM = twin ? 0.762 : pitches[Math.floor(r() * pitches.length)];
    const soil = soils[Math.floor(r() * soils.length)];
    const stage = stages[Math.floor(r() * stages.length)];
    const small = r() < 0.35;
    // Keep the long edge at most 2000 px.
    const maxM = 2000 * gsdM;
    const widthM = Math.min(small ? 4 + 3 * r() : 10 + 10 * r(), maxM);
    const heightM = Math.min(widthM * 0.75, maxM);
    const straw = soil !== "light" && r() < 0.6 ? { offsetShare: 0.5, widthShare: 0.3 + 0.2 * r() } : null;
    const weedy = r();
    out.push({
      name: `${label}-${i + 1}`,
      widthM, heightM, gsdM, angleDeg: Math.floor(r() * 180), pitchM, twinM: twin ? 0.19 : null,
      alongM: 0.14 + 0.08 * r(), leafM: LEAF_BY_STAGE[stage], soil, straw,
      weedsPerM2: weedy < 0.3 ? 0 : weedy < 0.75 ? 4 : 15, weedRadiusM: 0.03 + 0.05 * r(), inRowWeedsPerM: weedy < 0.5 ? 0 : 1,
      seed: seedBase + i,
    });
  }
  return out;
}
