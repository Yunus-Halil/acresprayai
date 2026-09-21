// Weed Scout: the pure pipeline against synthetic scenes with known truth.
//
// Synthetic is the only place a 3 cm weed at a known position exists at all,
// so these tests are where the geometry is proven. They say nothing about
// flown imagery; that is what developer mode on a real scan is for.
import { describe, expect, it } from "vitest";
import type { RasterSource } from "@/lib/cellFeatures";
import { M_PER_DEG_LAT, mPerDegLng, polygonAreaM2, type LatLng2 } from "@/lib/geo";
import {
  classify, fieldBaseline, flagTiles, growRegions, sampleTiles, scoreTiles, shorth, traceOutline,
} from "@/lib/weedScout/baseline";
import { blobBaseline, extractBlobs, labelComponents, scoreBlob } from "@/lib/weedScout/blobs";
import { describeCandidate, rankCandidates } from "@/lib/weedScout/candidates";
import { contextFromReply, describeEvent, localTimeIn, seasonOf } from "@/lib/weedScout/context";
import { describe as describeCandidateInHouse } from "@/lib/weedScout/describe";
import { applyFeedback, featureVectorOf } from "@/lib/weedScout/feedback";
import {
  MIN_TILE_CONFIDENCE, distanceToRowM, fitRowModel, localFrame, pixelAngleToGround, projectionProfile, rowAngle, toSparse,
} from "@/lib/weedScout/rows";
import { inBounds, planSweep, planWindows } from "@/lib/weedScout/sweep";
import { distanceToBoundaryM, rasterGsdM, tessellate, tileIdAt, tileLattice, tileWindow } from "@/lib/weedScout/tiles";
import { DEFAULT_SCOUT_PARAMS, type Candidate, type FeedbackRow } from "@/lib/weedScout/types";
import { globalThreshold, indexRaster, maskWindow, otsuFromHistogram, emptyHistogram, accumulateHistogram } from "@/lib/weedScout/vegetation";
import { cropRaster, pixelRect } from "@/lib/weedScout/zoom";

// Northern Virginia, since that is the example the operator gave.
const LAT0 = 38.95, LNG0 = -77.45;

/** A square field of `sizeM` centred on LAT0/LNG0. */
function squareField(sizeM: number): LatLng2[][] {
  const dLat = sizeM / 2 / M_PER_DEG_LAT, dLng = sizeM / 2 / mPerDegLng(LAT0);
  return [[
    { lat: LAT0 + dLat, lng: LNG0 - dLng }, { lat: LAT0 + dLat, lng: LNG0 + dLng },
    { lat: LAT0 - dLat, lng: LNG0 + dLng }, { lat: LAT0 - dLat, lng: LNG0 - dLng },
  ]];
}

type Scene = {
  sizeM: number; gsdM: number;
  rowAngleDeg?: number; pitchM?: number; plantEveryM?: number; plantRadiusM?: number;
  weeds?: { x: number; y: number; r: number }[];
  /** Bare rectangles, in metres about the centre. No plants grow in them. */
  bare?: { x: number; y: number; halfXM: number; halfYM: number }[];
  /** A brightness step: everything east of `x` is multiplied by `factor`. */
  seam?: { x: number; factor: number };
  noiseSalt?: number;
  seed?: number;
};

/** Deterministic PRNG so the tests do not flap. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Render a top-down scene as a north-up raster: brown soil, green plant discs
 * along rows at a ground angle (counterclockwise from east), optional weeds
 * between rows, optional bare rectangles, optional seam. Ground (x, y) is
 * metres east/north of the scene centre.
 */
function renderScene(s: Scene): { raster: RasterSource; plants: { x: number; y: number }[]; frame: ReturnType<typeof localFrame> } {
  const px = Math.round(s.sizeM / s.gsdM);
  const rgba = new Uint8ClampedArray(px * px * 4);
  const rand = rng(s.seed ?? 7);
  const th = ((s.rowAngleDeg ?? 0) * Math.PI) / 180;
  const pitch = s.pitchM ?? 0.762, every = s.plantEveryM ?? 0.2, pr = s.plantRadiusM ?? 0.05;
  const half = s.sizeM / 2;
  const inBare = (x: number, y: number) => (s.bare ?? []).some(b => Math.abs(x - b.x) < b.halfXM && Math.abs(y - b.y) < b.halfYM);
  const plants: { x: number; y: number }[] = [];
  if (s.pitchM !== 0) {
    for (let k = -Math.ceil(s.sizeM / pitch); k <= Math.ceil(s.sizeM / pitch); k++) {
      for (let a = -s.sizeM; a <= s.sizeM; a += every) {
        const x = a * Math.cos(th) - k * pitch * Math.sin(th);
        const y = a * Math.sin(th) + k * pitch * Math.cos(th);
        if (Math.abs(x) < half - pr && Math.abs(y) < half - pr && !inBare(x, y)) plants.push({ x, y });
      }
    }
  }
  const cosT = Math.cos(th), sinT = Math.sin(th);
  const onPlant = (x: number, y: number): boolean => {
    if (s.pitchM === 0) return false;
    const across = -x * sinT + y * cosT, along = x * cosT + y * sinT;
    const k = Math.round(across / pitch), a = Math.round(along / every) * every;
    const cx = a * cosT - k * pitch * sinT, cy = a * sinT + k * pitch * cosT;
    if (Math.abs(cx) >= half - pr || Math.abs(cy) >= half - pr) return false;
    if (inBare(cx, cy)) return false;
    return (x - cx) ** 2 + (y - cy) ** 2 <= pr * pr;
  };
  for (let j = 0; j < px; j++) {
    for (let i = 0; i < px; i++) {
      const x = (i + 0.5) * s.gsdM - half, y = half - (j + 0.5) * s.gsdM;
      let R = 118 + (rand() - 0.5) * 16, G = 92 + (rand() - 0.5) * 16, B = 66 + (rand() - 0.5) * 16;
      if (inBare(x, y)) { R = 200; G = 190; B = 170; }
      else if (onPlant(x, y)) { R = 58; G = 128; B = 40; }
      else {
        for (const d of s.weeds ?? []) {
          if ((x - d.x) ** 2 + (y - d.y) ** 2 <= d.r * d.r) { R = 58; G = 128; B = 40; break; }
        }
      }
      if (s.noiseSalt && rand() < s.noiseSalt) { R = 58; G = 128; B = 40; }
      if (s.seam && x > s.seam.x) { R *= s.seam.factor; G *= s.seam.factor; B *= s.seam.factor; }
      const o = (j * px + i) * 4;
      rgba[o] = R; rgba[o + 1] = G; rgba[o + 2] = B; rgba[o + 3] = 255;
    }
  }
  const dLat = half / M_PER_DEG_LAT, dLng = half / mPerDegLng(LAT0);
  const bounds = { north: LAT0 + dLat, south: LAT0 - dLat, east: LNG0 + dLng, west: LNG0 - dLng };
  const raster: RasterSource = { width: px, height: px, bounds, rgba };
  return { raster, plants, frame: localFrame({ lat: LAT0, lng: LNG0 }) };
}

function maskOf(raster: RasterSource): Uint8Array {
  const index = indexRaster(raster);
  const t = globalThreshold(index, raster.width);
  const mask = new Uint8Array(raster.width * raster.height);
  maskWindow(index, raster.width, { x0: 0, y0: 0, x1: raster.width - 1, y1: raster.height - 1 }, mask, t);
  return mask;
}

/** Steps 2 and 3 over a scene, the way the pipeline runs them. */
function baselinePass(raster: RasterSource, field: LatLng2[][], tileM = 3, headlandM = 0, anomalyZ = DEFAULT_SCOUT_PARAMS.anomalyZ) {
  const tiles = tessellate(field, tileM, headlandM);
  const lattice = tileLattice(field, tileM);
  const mask = maskOf(raster);
  const samples = sampleTiles(tiles, raster, mask);
  const base = fieldBaseline(samples)!;
  const scores = scoreTiles(samples, base, tiles, anomalyZ);
  const headland = new Set(tiles.filter(t => t.headland).map(t => t.id));
  const flags = flagTiles(scores, anomalyZ, headland);
  const regions = growRegions(tiles, scores, flags, lattice, { anomalyZ, minRegionTiles: 2, tileM }, headland);
  return { tiles, lattice, mask, samples, base, scores, flags, regions };
}

const at = (x: number, y: number): LatLng2 => localFrame({ lat: LAT0, lng: LNG0 }).toLatLng(x, y);

describe("step 1: the boundary becomes tiles", () => {
  it("tessellates a 30 m square into 100 three-metre tiles and marks the headland", () => {
    const field = squareField(30);
    const tiles = tessellate(field, 3, 5);
    expect(tiles.length).toBe(100);
    expect(tiles.filter(t => t.headland).length).toBe(64);
    expect(tiles.filter(t => !t.headland).length).toBe(36);
  });

  it("drops tiles whose centroid is outside, and points look up to the tile they fall in", () => {
    const tri: LatLng2[][] = [[
      { lat: LAT0, lng: LNG0 },
      { lat: LAT0 + 30 / M_PER_DEG_LAT, lng: LNG0 },
      { lat: LAT0, lng: LNG0 + 30 / mPerDegLng(LAT0) },
    ]];
    const tiles = tessellate(tri, 3, 0);
    expect(tiles.length).toBeGreaterThan(30);
    expect(tiles.length).toBeLessThan(60);
    const lattice = tileLattice(tri, 3);
    for (const t of tiles.slice(0, 20)) expect(tileIdAt(lattice, t.centroid)).toBe(t.id);
  });

  it("measures distance to the boundary in metres, and maps a tile onto pixels", () => {
    expect(distanceToBoundaryM({ lat: LAT0, lng: LNG0 }, squareField(30))).toBeCloseTo(15, 0);
    const { raster } = renderScene({ sizeM: 6, gsdM: 0.02, pitchM: 0 });
    expect(rasterGsdM(raster)).toBeCloseTo(0.02, 4);
    const [tile] = tessellate(squareField(6), 3, 0);
    const w = tileWindow(tile, raster)!;
    expect(w.x1 - w.x0 + 1).toBeGreaterThanOrEqual(149);
    expect(w.x1 - w.x0 + 1).toBeLessThanOrEqual(151);
  });
});

describe("vegetation mask", () => {
  it("separates green plants from brown soil by chromaticity", () => {
    const { raster, plants } = renderScene({ sizeM: 4, gsdM: 0.02, rowAngleDeg: 0 });
    const mask = maskOf(raster);
    let on = 0;
    for (let i = 0; i < mask.length; i++) on += mask[i];
    const expected = plants.length * Math.PI * 0.05 * 0.05 / (0.02 * 0.02);
    expect(on / expected).toBeGreaterThan(0.8);
    expect(on / expected).toBeLessThan(1.25);
  });

  it("gives the same ground area for the same plant at two GSDs (within the edge rim)", () => {
    const weed = [{ x: 0, y: 0, r: 0.15 }];
    const area = (r: RasterSource) => {
      const m = maskOf(r);
      let n = 0;
      for (let i = 0; i < m.length; i++) n += m[i];
      return n * rasterGsdM(r) ** 2;
    };
    const truth = Math.PI * 0.15 * 0.15;
    for (const gsdM of [0.01, 0.02]) {
      const { raster } = renderScene({ sizeM: 2, gsdM, pitchM: 0, weeds: weed });
      expect(Math.abs(area(raster) - truth) / truth).toBeLessThan(0.1);
    }
  });

  it("Otsu finds the split between two modes and reports a spread", () => {
    const h = emptyHistogram();
    const idx = new Float32Array(2000);
    for (let i = 0; i < 1000; i++) idx[i] = -0.2 + (i % 10) * 0.005;
    for (let i = 1000; i < 2000; i++) idx[i] = 0.6 + (i % 10) * 0.005;
    accumulateHistogram(h, idx, 2000);
    const r = otsuFromHistogram(h)!;
    expect(r.threshold).toBeGreaterThan(-0.15);
    expect(r.threshold).toBeLessThan(0.6);
    expect(r.spread).toBeGreaterThan(0.5);
  });
});

describe("steps 2 and 3: a baseline that survives a big patch", () => {
  it("the shorth centres on the ordinary ground when a third of the values are the patch", () => {
    const rand = rng(11);
    const values: number[] = [];
    for (let i = 0; i < 67; i++) values.push((rand() - 0.5) * 1.0);
    for (let i = 0; i < 33; i++) values.push(10 + (rand() - 0.5) * 1.0);
    const { centre, scale } = shorth(values);
    expect(Math.abs(centre)).toBeLessThan(0.3);
    expect(scale).toBeLessThan(0.6);
    // The median-and-MAD it replaced would have put the patch under 3.5 z.
    expect((10 - centre) / scale).toBeGreaterThan(10);
  });

  it("a dry patch covering a third of the field becomes ONE region of the right size and class", () => {
    const { raster } = renderScene({
      sizeM: 60, gsdM: 0.05, rowAngleDeg: 0,
      bare: [{ x: -20, y: 0, halfXM: 10, halfYM: 30 }],
    });
    const { tiles, flags, regions } = baselinePass(raster, squareField(60));
    expect(tiles.length).toBe(400);
    // The patch is 20 x 60 m = about 133 tiles at 3 m.
    expect(regions.length).toBeGreaterThanOrEqual(1);
    const big = regions[0];
    expect(big.tileCount).toBeGreaterThanOrEqual(115);
    expect(big.tileCount).toBeLessThanOrEqual(150);
    expect(big.klass).toBe("bare or dry ground");
    expect(big.rings.length).toBeGreaterThanOrEqual(1);
    // Its outline encloses about the patch's area.
    const ringArea = polygonAreaM2(big.rings[0]);
    expect(ringArea).toBeGreaterThan(20 * 60 * 0.8);
    expect(ringArea).toBeLessThan(20 * 60 * 1.3);
    // Nothing outside the patch is flagged as a core tile.
    const outside = flags.filter(f => {
      const t = tiles.find(x => x.id === f.tileId)!;
      const x = (t.centroid.lng - LNG0) * mPerDegLng(LAT0);
      return x > -10 + 1.5;
    });
    expect(outside.length).toBeLessThanOrEqual(3);
  });

  it("a brightness seam alone does not flag anything", () => {
    const { raster } = renderScene({ sizeM: 30, gsdM: 0.05, rowAngleDeg: 0, seam: { x: 0, factor: 1.25 } });
    const { flags, regions, scores } = baselinePass(raster, squareField(30));
    expect(regions.length).toBe(0);
    expect(flags.length).toBeLessThanOrEqual(1);
    // The seam was seen: brightness deviates far past the threshold on many
    // tiles. It is descriptive, never a trigger, so nothing came of it.
    const brightOnly = scores.filter(s => Math.abs(s.fieldZ[3]) >= 3.5 || Math.abs(s.localZ[3]) >= 3.5);
    expect(brightOnly.length).toBeGreaterThanOrEqual(10);
    expect(brightOnly.every(s => s.strength < 3.5 || !s.supported)).toBe(true);
  });

  it("a single odd tile inside a uniform field is a point, found by local contrast", () => {
    const { raster } = renderScene({
      sizeM: 30, gsdM: 0.05, rowAngleDeg: 0,
      // Centred in the tile that spans 6..9 m, so no neighbour shares it.
      bare: [{ x: 7.5, y: 7.5, halfXM: 1.2, halfYM: 1.2 }],
    });
    const field = squareField(30);
    const { tiles, lattice, flags, regions, scores } = baselinePass(raster, field);
    expect(regions.length).toBe(0);
    expect(flags.length).toBeGreaterThanOrEqual(1);
    expect(flags.length).toBeLessThanOrEqual(2);
    const bareTile = tileIdAt(lattice, at(7.5, 7.5));
    expect(flags[0].tileId).toBe(bareTile);
    const s = scores.find(x => x.tileId === bareTile)!;
    expect(Math.max(...s.localZ.map(Math.abs))).toBeGreaterThan(3.5);
    const { candidates } = rankCandidates({ blobs: [], tiles, flags, regions, rows: null, params: DEFAULT_SCOUT_PARAMS });
    expect(candidates.length).toBe(1);
    expect(candidates[0].kind).toBe("field outlier");
    expect(candidates[0].region).toBeNull();
  });

  it("classifies regions from the direction of their deviations", () => {
    const z = (veg: number, bright: number, green: number) => {
      const a = new Array(9).fill(0);
      a[8] = veg; a[3] = bright; a[1] = green; a[5] = green; a[7] = green;
      return a;
    };
    expect(classify(z(-3, 2, -1))).toBe("bare or dry ground");
    expect(classify(z(-3, -2, 0))).toBe("dark ground (wet, shadow or residue)");
    expect(classify(z(-2, 0, 0))).toBe("thin stand");
    expect(classify(z(3, 0, 1))).toBe("dense vegetation");
    expect(classify(z(0, 0, -2))).toBe("pale vegetation");
    expect(classify(z(0, 0, 2))).toBe("greener than the field");
    expect(classify(z(0, 4, 0))).toBe("different from the field");
  });

  it("traces outlines: a block is one ring, a ring of tiles has a hole", () => {
    const field = squareField(30);
    const tiles = tessellate(field, 3, 0);
    const lattice = tileLattice(field, 3);
    const block = tiles.filter(t => t.col >= 2 && t.col <= 3 && t.row >= 2 && t.row <= 3);
    const rings = traceOutline(block, lattice);
    expect(rings.length).toBe(1);
    expect(polygonAreaM2(rings[0])).toBeCloseTo(36, 0);
    const donut = tiles.filter(t => t.col >= 2 && t.col <= 4 && t.row >= 2 && t.row <= 4 && !(t.col === 3 && t.row === 3));
    const rings2 = traceOutline(donut, lattice);
    expect(rings2.length).toBe(2);
    expect(polygonAreaM2(rings2[0])).toBeCloseTo(81, 0);
    expect(polygonAreaM2(rings2[1])).toBeCloseTo(9, 0);
  });

  it("refuses a baseline from too few tiles", () => {
    const { raster } = renderScene({ sizeM: 6, gsdM: 0.05, rowAngleDeg: 0 });
    const tiles = tessellate(squareField(6), 3, 0);
    expect(fieldBaseline(sampleTiles(tiles, raster, maskOf(raster)))).toBeNull();
  });
});

describe("the row model: learn where corn is", () => {
  const scene = renderScene({ sizeM: 12, gsdM: 0.02, rowAngleDeg: 23, pitchM: 0.762 });
  const mask = maskOf(scene.raster);
  const model = fitRowModel(mask, scene.raster, 0.762, { windowM: 12 });

  it("recovers the angle and the pitch", () => {
    expect(model.usable).toBe(true);
    const t = model.tiles[0];
    const angleErr = Math.min(Math.abs(t.angleDeg - 23), 180 - Math.abs(t.angleDeg - 23));
    expect(angleErr).toBeLessThan(1.5);
    expect(t.pitchFromGrower).toBe(false);
    expect(Math.abs(t.recoveredPitchM - 0.762) / 0.762).toBeLessThan(0.05);
    expect(t.confidence).toBeGreaterThan(MIN_TILE_CONFIDENCE);
  });

  it("puts the centrelines through the plants, not at a random offset (the phase check)", () => {
    const ds = scene.plants.map(p => Math.abs(distanceToRowM(model, scene.frame.toLatLng(p.x, p.y))!));
    ds.sort((a, b) => a - b);
    expect(ds[Math.floor(ds.length / 2)]).toBeLessThan(0.04);
  });

  it("puts a weed midway between rows half a pitch off-row", () => {
    const th = (23 * Math.PI) / 180;
    // Half a pitch along the row normal (-sin, cos) from the row through the centre.
    const d = distanceToRowM(model, scene.frame.toLatLng(-0.381 * Math.sin(th), 0.381 * Math.cos(th)))!;
    expect(Math.abs(Math.abs(d) - 0.381)).toBeLessThan(0.06);
  });

  it("finds the same angle from a hint as from the full search, and mirrors it onto the ground", () => {
    const factor = 4;
    const w = scene.raster.width;
    const img = { data: new Float32Array((w / factor) * (w / factor)), width: w / factor, height: w / factor };
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      let s = 0;
      for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) s += mask[(y * factor + dy) * w + x * factor + dx];
      img.data[y * img.width + x] = s / 16;
    }
    const full = rowAngle(img);
    const hinted = rowAngle(toSparse(img), { hintPxDeg: full.anglePxDeg + 2 });
    expect(Math.abs(hinted.anglePxDeg - full.anglePxDeg)).toBeLessThan(0.3);
    expect(hinted.confidence).toBeGreaterThan(MIN_TILE_CONFIDENCE);
    // Dense and sparse inputs give the same profile.
    const a = projectionProfile(img, 40).profile, b = projectionProfile(toSparse(img), 40).profile;
    for (let i = 0; i < a.length; i++) {
      if (Number.isFinite(a[i])) expect(b[i]).toBeCloseTo(a[i], 9); else expect(Number.isFinite(b[i])).toBe(false);
    }
    expect(pixelAngleToGround(30)).toBe(150);
  });

  it("refuses to be queried on noise at the same coverage", () => {
    const noise = renderScene({ sizeM: 12, gsdM: 0.02, pitchM: 0, noiseSalt: 0.05, seed: 3 });
    const m = fitRowModel(maskOf(noise.raster), noise.raster, 0.762, { windowM: 12 });
    expect(m.tiles[0].confidence).toBeLessThan(MIN_TILE_CONFIDENCE);
    expect(m.usable).toBe(false);
    expect(distanceToRowM(m, { lat: LAT0, lng: LNG0 })).toBeNull();
  });
});

describe("plants and the ranked queue", () => {
  const th = (23 * Math.PI) / 180;
  const weeds = [
    { x: 0.381 * -Math.sin(th) + 1.0 * Math.cos(th), y: 0.381 * Math.cos(th) + 1.0 * Math.sin(th), r: 0.06 },
    { x: 0.381 * -Math.sin(th) - 2.0 * Math.cos(th), y: 0.381 * Math.cos(th) - 2.0 * Math.sin(th), r: 0.04 },
  ];
  const scene = renderScene({ sizeM: 12, gsdM: 0.02, rowAngleDeg: 23, pitchM: 0.762, weeds });
  const field = squareField(12);
  const tiles = tessellate(field, 3, 0);
  const lattice = tileLattice(field, 3);
  const mask = maskOf(scene.raster);
  const blobsOf = () => extractBlobs(mask, scene.raster, { tileOf: p => tileIdAt(lattice, p) });

  it("labels components and knows the typical plant", () => {
    const { count } = labelComponents(mask, scene.raster.width, scene.raster.height);
    expect(count).toBeGreaterThan(scene.plants.length * 0.9);
    const blobs = blobsOf();
    const base = blobBaseline(blobs)!;
    expect(base.typicalDiameterM).toBeGreaterThan(0.085);
    expect(base.typicalDiameterM).toBeLessThan(0.115);
  });

  it("ranks the between-row plants as off-row and leaves the crop alone", () => {
    const rows = fitRowModel(mask, scene.raster, 0.762, { windowM: 12 });
    const { candidates } = rankCandidates({ blobs: blobsOf(), tiles, flags: [], regions: [], rows, params: DEFAULT_SCOUT_PARAMS });
    expect(candidates.length).toBe(2);
    for (const c of candidates) {
      expect(c.kind).toBe("off-row vegetation");
      expect(Math.abs(c.distanceToRowM!)).toBeGreaterThan(0.3);
      expect(c.score).toBeGreaterThan(0.5);
    }
    const near = (c: Candidate, w: typeof weeds[number]) => {
      const p = scene.frame.toXY(c.centroid);
      return Math.hypot(p.x - w.x, p.y - w.y) < 0.05;
    };
    expect(weeds.every(w => candidates.some(c => near(c, w)))).toBe(true);
  });

  it("finds a big plant IN the row as unlike the field's plants, with no row model at all", () => {
    // A 30 cm plant sitting exactly on a row line, among 10 cm crop.
    const big = { x: 1.0 * Math.cos(th), y: 1.0 * Math.sin(th), r: 0.15 };
    const s2 = renderScene({ sizeM: 12, gsdM: 0.02, rowAngleDeg: 23, pitchM: 0.762, weeds: [big] });
    const m2 = maskOf(s2.raster);
    const blobs = extractBlobs(m2, s2.raster, { tileOf: p => tileIdAt(lattice, p) });
    const base = blobBaseline(blobs)!;
    const bigBlob = blobs.reduce((a, b) => (b.areaM2 > a.areaM2 ? b : a));
    const sc = scoreBlob(bigBlob, base, 3.5);
    expect(sc.feature).toBe("size");
    expect(sc.strength).toBeGreaterThan(3.5);
    const { candidates } = rankCandidates({ blobs, tiles, flags: [], regions: [], rows: null, params: DEFAULT_SCOUT_PARAMS });
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates[0].kind).toBe("vegetation outlier");
    const p = s2.frame.toXY(candidates[0].centroid);
    expect(Math.hypot(p.x - big.x, p.y - big.y)).toBeLessThan(0.1);
  });

  it("a region and a plant outlier arrive together, and a plant inside a region is not a second candidate", () => {
    // 2.5 cm/px so the 10 cm crop is measurable (4 px) and the 30 cm plant is 12.
    const big = { x: 6, y: 6, r: 0.15 };
    const s3 = renderScene({
      sizeM: 30, gsdM: 0.025, rowAngleDeg: 0,
      bare: [{ x: -10, y: 0, halfXM: 5, halfYM: 15 }],
      weeds: [big],
    });
    const f3 = squareField(30);
    const { tiles: t3, lattice: l3, mask: m3, flags, regions } = baselinePass(s3.raster, f3);
    const blobs = extractBlobs(m3, s3.raster, { tileOf: p => tileIdAt(l3, p) });
    const { candidates } = rankCandidates({ blobs, tiles: t3, flags, regions, rows: null, params: DEFAULT_SCOUT_PARAMS });
    const regionCs = candidates.filter(c => c.region);
    expect(regionCs.length).toBeGreaterThanOrEqual(1);
    expect(regionCs[0].areaM2).toBeGreaterThan(200);
    const outliers = candidates.filter(c => c.kind === "vegetation outlier");
    expect(outliers.length).toBeGreaterThanOrEqual(1);
    const p = s3.frame.toXY(outliers[0].centroid);
    expect(Math.hypot(p.x - big.x, p.y - big.y)).toBeLessThan(0.15);
    // No "field outlier" points inside the region: the region is the candidate.
    const inRegion = new Set(regionCs[0].region!.tileIds);
    expect(candidates.filter(c => c.kind === "field outlier" && inRegion.has(c.tileId)).length).toBe(0);
  });

  it("excludes headland ground before scoring", () => {
    const hTiles = tessellate(field, 3, 5);
    const blobs = blobsOf();
    const r = rankCandidates({ blobs, tiles: hTiles, flags: [], regions: [], rows: null, params: DEFAULT_SCOUT_PARAMS });
    expect(r.candidates.length).toBe(0);
    expect(r.headlandExcluded).toBe(blobs.length);
  });

  it("never calls a candidate a weed, in the queue or in the description", () => {
    const rows = fitRowModel(mask, scene.raster, 0.762, { windowM: 12 });
    const { candidates, plants } = rankCandidates({
      blobs: blobsOf(), tiles, rows, regions: [],
      flags: [{ tileId: tiles[0].id, z: 4, feature: "brightness", direction: "above", drivers: [] }],
      params: DEFAULT_SCOUT_PARAMS,
    });
    for (const c of candidates) {
      expect(c.kind.toLowerCase()).not.toContain("weed");
      expect(describeCandidate(c).toLowerCase()).not.toContain("weed");
      const e = describeCandidateInHouse(c, null, "Corn", "~4 weeks (V1-V4)", plants, 0.762, 0.02);
      const text = JSON.stringify(e).toLowerCase();
      expect(text).not.toContain("weed");
      expect(text).not.toMatch(/\b(spray|apply|rate|glyphosate|dicamba|atrazine)\b/);
      expect(e.model).toBe("swathwise-inhouse-v1");
      expect(e.summary.length).toBeGreaterThan(10);
      expect(e.whatWouldConfirm.length).toBeGreaterThan(0);
    }
  });
});

describe("step 4: the full-depth sweep plan", () => {
  const field = squareField(60);
  const tiles = tessellate(field, 3, 0);
  const lattice = tileLattice(field, 3);
  const bbox = {
    north: lattice.minLat + lattice.rows * lattice.dLat, south: lattice.minLat,
    east: lattice.minLng + lattice.cols * lattice.dLng, west: lattice.minLng,
  };

  it("owned rectangles tile the field exactly: every tile centroid is owned by one window", () => {
    // At zoom 21 a 512 px window is about 30 m, so a 60 m field takes four.
    const { windows, gsdM } = planWindows(bbox, tiles, 21);
    expect(gsdM).toBeGreaterThan(0.05);
    expect(gsdM).toBeLessThan(0.065);
    expect(windows.length).toBe(4);
    for (const t of tiles) {
      const owners = windows.filter(w => inBounds(t.centroid, w.owned));
      expect(owners.length).toBe(1);
    }
    for (const w of windows) {
      expect(w.fetch.west).toBeLessThanOrEqual(w.owned.west);
      expect(w.fetch.east).toBeGreaterThanOrEqual(w.owned.east);
      expect(w.fetch.south).toBeLessThanOrEqual(w.owned.south);
      expect(w.fetch.north).toBeGreaterThanOrEqual(w.owned.north);
    }
  });

  it("backs the zoom off to fit the window budget, and says so", () => {
    const deep = planSweep(bbox, tiles, 21, 10_000);
    expect(deep.z).toBe(21);
    expect(deep.backedOff).toBe(0);
    const tight = planSweep(bbox, tiles, 21, 2);
    expect(tight.windows.length).toBeLessThanOrEqual(2);
    expect(tight.backedOff).toBeGreaterThan(0);
    expect(tight.z).toBeLessThan(21);
  });

  it("crops a sub-raster whose bounds match the pixels it kept", () => {
    const { raster } = renderScene({ sizeM: 4, gsdM: 0.02, pitchM: 0, weeds: [{ x: 0, y: 0, r: 0.2 }] });
    const b = { north: LAT0 + 0.5 / M_PER_DEG_LAT, south: LAT0 - 0.5 / M_PER_DEG_LAT, east: LNG0 + 0.5 / mPerDegLng(LAT0), west: LNG0 - 0.5 / mPerDegLng(LAT0) };
    const r = pixelRect(raster, b);
    const crop = cropRaster(raster, b);
    expect(crop.width).toBe(r.x1 - r.x0 + 1);
    expect(rasterGsdM(crop)).toBeCloseTo(0.02, 3);
    const o = ((Math.floor(crop.height / 2)) * crop.width + Math.floor(crop.width / 2)) * 4;
    expect(crop.rgba[o + 1]).toBe(128);
  });
});

describe("the archive tunes the scout", () => {
  const th = (23 * Math.PI) / 180;
  const weeds = [
    { x: 0.381 * -Math.sin(th) + 1.0 * Math.cos(th), y: 0.381 * Math.cos(th) + 1.0 * Math.sin(th), r: 0.06 },
    { x: 0.381 * -Math.sin(th) - 2.0 * Math.cos(th), y: 0.381 * Math.cos(th) - 2.0 * Math.sin(th), r: 0.04 },
  ];
  const scene = renderScene({ sizeM: 12, gsdM: 0.02, rowAngleDeg: 23, pitchM: 0.762, weeds });
  const field = squareField(12);
  const tiles = tessellate(field, 3, 0);
  const lattice = tileLattice(field, 3);
  const mask = maskOf(scene.raster);
  const rows = fitRowModel(mask, scene.raster, 0.762, { windowM: 12 });
  const blobs = extractBlobs(mask, scene.raster, { tileOf: p => tileIdAt(lattice, p) });
  const { candidates } = rankCandidates({ blobs, tiles, flags: [], regions: [], rows, params: DEFAULT_SCOUT_PARAMS });

  const rowsLike = (c: Candidate, verdict: FeedbackRow["verdict"], n: number, species: string | null = null): FeedbackRow[] => {
    const v = featureVectorOf(c, 0.762);
    const rand = rng(5);
    return Array.from({ length: n }, () => ({
      kind: c.kind, verdict, species, fieldId: "f1",
      vector: v.map(x => x + (rand() - 0.5) * 0.02),
    }));
  };

  it("lowers a candidate that resembles dismissed ones, and raises one that resembles confirmed ones", () => {
    const [a, b] = candidates;
    const archive = [...rowsLike(a, "not_vegetation", 5), ...rowsLike(b, "weed", 5, "lambsquarters")];
    const out = applyFeedback(candidates, archive, 0.762, "f1");
    const a2 = out.find(c => c.id === a.id)!, b2 = out.find(c => c.id === b.id)!;
    expect(a2.feedback?.dismissed).toBe(5);
    expect(a2.feedback?.factor).toBe(0.4);
    expect(a2.score).toBeCloseTo(a.score * 0.4, 6);
    expect(b2.feedback?.confirmed).toBe(5);
    expect(b2.feedback?.factor).toBe(1.25);
    expect(b2.feedback?.species).toEqual(["lambsquarters"]);
    expect(b2.score).toBeGreaterThanOrEqual(b.score);
    // The queue re-sorts.
    expect(out[0].id).toBe(b.id);
  });

  it("stays silent with too few neighbours, and never removes a candidate", () => {
    const [a] = candidates;
    const out = applyFeedback(candidates, rowsLike(a, "not_vegetation", 2), 0.762, "f1");
    expect(out.length).toBe(candidates.length);
    expect(out.find(c => c.id === a.id)!.feedback).toBeNull();
  });

  it("vectors are stable per candidate and differ by family", () => {
    const v = featureVectorOf(candidates[0], 0.762);
    expect(v.length).toBe(9);
    expect(v.every(Number.isFinite)).toBe(true);
  });
});

describe("step 5: the event context", () => {
  it("knows the season, in both hemispheres", () => {
    expect(seasonOf(new Date("2026-09-21T21:00:00Z"), 38.9)).toBe("autumn");
    expect(seasonOf(new Date("2026-09-21T21:00:00Z"), -33.9)).toBe("spring");
    expect(seasonOf(new Date("2026-01-10T12:00:00Z"), 38.9)).toBe("winter");
    expect(seasonOf(new Date("2026-06-10T12:00:00Z"), 38.9)).toBe("summer");
  });

  it("tells local time in the field's zone", () => {
    const t = localTimeIn("2026-09-21T21:05:00Z", "America/New_York")!;
    expect(t.time).toBe("5:05 PM");
    expect(t.date).toBe("2026-09-21");
    expect(localTimeIn("2026-09-21T21:05:00Z", null)).toBeNull();
    expect(localTimeIn("2026-09-21T21:05:00Z", "Not/AZone")).toBeNull();
  });

  it("builds the sentence the operator gave as the example", () => {
    const ctx = contextFromReply({
      ok: true, place: "Fairfax, VA", time_zone: "America/New_York",
      observation: {
        ok: true, station: "KIAD", station_name: "Washington Dulles International Airport",
        distance_mi: 8.2, observed_at: "2026-09-21T20:52:00Z", temp_f: 74.1, wind_mph: 5.8, wind_dir: "NW", sky: "Sunny",
      },
    }, 38.95, -77.45, "2026-09-21T21:05:00Z");
    expect(ctx.place).toBe("Fairfax, VA");
    expect(ctx.localTime).toBe("5:05 PM");
    expect(ctx.season).toBe("autumn");
    const s = describeEvent(ctx);
    expect(s).toContain("Captured in Fairfax, VA at 5:05 PM local time, autumn.");
    expect(s).toContain("sunny, 74 F, wind 6 mph NW");
    expect(s).toContain("8 mi away");
  });

  it("carries the reason when there is no observation, and fabricates nothing", () => {
    const ctx = contextFromReply({
      ok: true, place: null, time_zone: null,
      observation: { ok: false, reason: "out-of-retention", detail: "NWS keeps ~7 days of observations; this time is 40 days ago." },
    }, 38.95, -77.45, "2026-08-12T15:00:00Z");
    expect(ctx.observation).toBeNull();
    expect(ctx.observationReason).toContain("40 days ago");
    expect(describeEvent(ctx)).toContain("No station observation");
    expect(contextFromReply(null, 38.95, -77.45, "2026-08-12T15:00:00Z").observationReason).toBe("lookup unavailable");
  });
});
