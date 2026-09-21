// Weed Scout: the pure pipeline against synthetic scenes with known truth.
//
// Synthetic is the only place a 3 cm weed at a known position exists at all,
// so these tests are where the geometry is proven. They say nothing about
// flown imagery; that is what developer mode on a real scan is for.
import { describe, expect, it } from "vitest";
import type { RasterSource } from "@/lib/cellFeatures";
import { M_PER_DEG_LAT, mPerDegLng, type LatLng2 } from "@/lib/geo";
import { fieldBaseline, flagOutliers, sampleTiles } from "@/lib/weedScout/baseline";
import { extractBlobs, labelComponents } from "@/lib/weedScout/blobs";
import { describeCandidate, rankCandidates } from "@/lib/weedScout/candidates";
import { contextFromReply, describeEvent, localTimeIn, seasonOf } from "@/lib/weedScout/context";
import {
  MIN_TILE_CONFIDENCE, distanceToRowM, fitRowModel, localFrame, pixelAngleToGround,
} from "@/lib/weedScout/rows";
import { distanceToBoundaryM, rasterGsdM, tessellate, tileIdAt, tileLattice, tileWindow } from "@/lib/weedScout/tiles";
import { DEFAULT_SCOUT_PARAMS } from "@/lib/weedScout/types";
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
  bare?: { x: number; y: number; halfM: number }[];
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
 * between rows, optional bare patches. Ground (x, y) is metres east/north of
 * the scene centre.
 */
function renderScene(s: Scene): { raster: RasterSource; plants: { x: number; y: number }[]; frame: ReturnType<typeof localFrame> } {
  const px = Math.round(s.sizeM / s.gsdM);
  const rgba = new Uint8ClampedArray(px * px * 4);
  const rand = rng(s.seed ?? 7);
  const th = ((s.rowAngleDeg ?? 0) * Math.PI) / 180;
  const pitch = s.pitchM ?? 0.762, every = s.plantEveryM ?? 0.2, pr = s.plantRadiusM ?? 0.05;
  const half = s.sizeM / 2;
  const plants: { x: number; y: number }[] = [];
  if (s.pitchM !== 0) {
    // Enumerate plant centres so the test knows the truth.
    const along0 = -s.sizeM, along1 = s.sizeM;
    for (let k = -Math.ceil(s.sizeM / pitch); k <= Math.ceil(s.sizeM / pitch); k++) {
      for (let a = along0; a <= along1; a += every) {
        const x = a * Math.cos(th) - k * pitch * Math.sin(th);
        const y = a * Math.sin(th) + k * pitch * Math.cos(th);
        if (Math.abs(x) < half - pr && Math.abs(y) < half - pr) plants.push({ x, y });
      }
    }
  }
  const cosT = Math.cos(th), sinT = Math.sin(th);
  // Plant membership is analytic (nearest lattice point), so a 600 px scene
  // with thousands of plants renders in O(pixels), not O(pixels x plants).
  const onPlant = (x: number, y: number): boolean => {
    if (s.pitchM === 0) return false;
    const across = -x * sinT + y * cosT, along = x * cosT + y * sinT;
    const k = Math.round(across / pitch), a = Math.round(along / every) * every;
    const cx = a * cosT - k * pitch * sinT, cy = a * sinT + k * pitch * cosT;
    if (Math.abs(cx) >= half - pr || Math.abs(cy) >= half - pr) return false;
    return (x - cx) ** 2 + (y - cy) ** 2 <= pr * pr;
  };
  for (let j = 0; j < px; j++) {
    for (let i = 0; i < px; i++) {
      const x = (i + 0.5) * s.gsdM - half, y = half - (j + 0.5) * s.gsdM;
      let R = 118 + (rand() - 0.5) * 16, G = 92 + (rand() - 0.5) * 16, B = 66 + (rand() - 0.5) * 16;
      for (const b of s.bare ?? []) {
        if (Math.abs(x - b.x) < b.halfM && Math.abs(y - b.y) < b.halfM) { R = 200; G = 190; B = 170; }
      }
      if (onPlant(x, y)) { R = 58; G = 128; B = 40; }
      else {
        for (const d of s.weeds ?? []) {
          if ((x - d.x) ** 2 + (y - d.y) ** 2 <= d.r * d.r) { R = 58; G = 128; B = 40; break; }
        }
      }
      if (s.noiseSalt && rand() < s.noiseSalt) { R = 58; G = 128; B = 40; }
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

describe("step 1: the boundary becomes tiles", () => {
  it("tessellates a 30 m square into 100 three-metre tiles and marks the headland", () => {
    const field = squareField(30);
    const tiles = tessellate(field, 3, 5);
    expect(tiles.length).toBe(100);
    const headland = tiles.filter(t => t.headland);
    // Outer ring of a 10x10 lattice, plus the next ring in where centroids sit 4.5 m from the edge.
    expect(headland.length).toBe(64);
    expect(tiles.filter(t => !t.headland).length).toBe(36);
    expect(tiles.every(t => t.ring.length === 4)).toBe(true);
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

  it("measures distance to the boundary in metres", () => {
    const field = squareField(30);
    expect(distanceToBoundaryM({ lat: LAT0, lng: LNG0 }, field)).toBeCloseTo(15, 0);
  });

  it("maps a tile onto raster pixels and reads the GSD off the bounds", () => {
    const { raster } = renderScene({ sizeM: 6, gsdM: 0.02, pitchM: 0 });
    expect(rasterGsdM(raster)).toBeCloseTo(0.02, 4);
    const field = squareField(6);
    const [tile] = tessellate(field, 3, 0);
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
    const a = renderScene({ sizeM: 2, gsdM: 0.01, pitchM: 0, weeds: weed });
    const b = renderScene({ sizeM: 2, gsdM: 0.02, pitchM: 0, weeds: weed });
    const area = (r: RasterSource) => {
      const m = maskOf(r);
      let n = 0;
      for (let i = 0; i < m.length; i++) n += m[i];
      return n * rasterGsdM(r) ** 2;
    };
    const truth = Math.PI * 0.15 * 0.15;
    expect(Math.abs(area(a.raster) - truth) / truth).toBeLessThan(0.1);
    expect(Math.abs(area(b.raster) - truth) / truth).toBeLessThan(0.1);
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

describe("steps 2 and 3: the field baseline flags what is not average", () => {
  it("flags a bare patch and nothing else in a uniform field", () => {
    const { raster } = renderScene({
      sizeM: 30, gsdM: 0.05, rowAngleDeg: 0,
      bare: [{ x: 6, y: 6, halfM: 1.4 }],
    });
    const field = squareField(30);
    const tiles = tessellate(field, 3, 0);
    const mask = maskOf(raster);
    const samples = sampleTiles(tiles, raster, mask);
    expect(samples.filter(s => s.usable).length).toBe(100);
    const base = fieldBaseline(samples)!;
    const flags = flagOutliers(samples, base, DEFAULT_SCOUT_PARAMS.anomalyZ);
    expect(flags.length).toBeGreaterThanOrEqual(1);
    expect(flags.length).toBeLessThanOrEqual(4);
    const lattice = tileLattice(field, 3);
    const bareTile = tileIdAt(lattice, { lat: LAT0 + 6 / M_PER_DEG_LAT, lng: LNG0 + 6 / mPerDegLng(LAT0) });
    expect(flags[0].tileId).toBe(bareTile);
    expect(["brightness", "vegetation fraction", "greenness (ExG)", "green share", "green-red index"]).toContain(flags[0].feature);
  });

  it("refuses a baseline from too few tiles", () => {
    const { raster } = renderScene({ sizeM: 6, gsdM: 0.05, rowAngleDeg: 0 });
    const tiles = tessellate(squareField(6), 3, 0);
    const samples = sampleTiles(tiles, raster, maskOf(raster));
    expect(fieldBaseline(samples)).toBeNull();
  });
});

describe("the row model: learn where corn is", () => {
  const scene = renderScene({ sizeM: 12, gsdM: 0.02, rowAngleDeg: 23, pitchM: 0.762 });
  const mask = maskOf(scene.raster);
  const model = fitRowModel(mask, scene.raster, 0.762, { windowM: 12 });

  it("recovers the angle and the pitch", () => {
    expect(model.usable).toBe(true);
    expect(model.tiles.length).toBe(1);
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
    const median = ds[Math.floor(ds.length / 2)];
    // Uniform noise on a 76 cm pitch averages 19 cm; a fit that found the rows
    // leaves the sampling jitter.
    expect(median).toBeLessThan(0.04);
  });

  it("puts a weed midway between rows half a pitch off-row", () => {
    const th = (23 * Math.PI) / 180;
    // Half a pitch along the row normal from the centre row.
    const x = -0.381 * -Math.sin(th) * -1, y = 0.381 * Math.cos(th);
    const d = distanceToRowM(model, scene.frame.toLatLng(x, y))!;
    expect(Math.abs(Math.abs(d) - 0.381)).toBeLessThan(0.06);
  });

  it("mirrors the array angle onto the ground", () => {
    expect(pixelAngleToGround(0)).toBe(0);
    expect(pixelAngleToGround(30)).toBe(150);
    expect(pixelAngleToGround(90)).toBe(90);
  });

  it("refuses to be queried on noise at the same coverage", () => {
    const noise = renderScene({ sizeM: 12, gsdM: 0.02, pitchM: 0, noiseSalt: 0.05, seed: 3 });
    const m = fitRowModel(maskOf(noise.raster), noise.raster, 0.762, { windowM: 12 });
    expect(m.tiles[0].confidence).toBeLessThan(MIN_TILE_CONFIDENCE);
    expect(m.usable).toBe(false);
    expect(distanceToRowM(m, { lat: LAT0, lng: LNG0 })).toBeNull();
  });
});

describe("blobs and the ranked queue", () => {
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

  it("labels components and drops nothing above the floor", () => {
    const { count } = labelComponents(mask, scene.raster.width, scene.raster.height);
    expect(count).toBeGreaterThan(scene.plants.length * 0.9);
    const blobs = extractBlobs(mask, scene.raster, { tileOf: p => tileIdAt(lattice, p) });
    expect(blobs.length).toBeGreaterThan(scene.plants.length * 0.9);
    const big = blobs.filter(b => b.equivDiameterM > 0.11);
    expect(big.length).toBe(1);   // the 12 cm weed; plants are 10 cm
    expect(big[0].chromaG).toBeGreaterThan(big[0].chromaR);
  });

  it("ranks the between-row plants as off-row and leaves the crop alone", () => {
    const rows = fitRowModel(mask, scene.raster, 0.762, { windowM: 12 });
    const blobs = extractBlobs(mask, scene.raster, { tileOf: p => tileIdAt(lattice, p) });
    const { candidates } = rankCandidates({ blobs, tiles, flags: [], rows, params: DEFAULT_SCOUT_PARAMS });
    expect(candidates.length).toBe(2);
    for (const c of candidates) {
      expect(c.kind).toBe("off-row vegetation");
      expect(Math.abs(c.distanceToRowM!)).toBeGreaterThan(0.3);
      expect(c.score).toBeGreaterThan(0.5);
    }
    const near = (c: typeof candidates[number], w: typeof weeds[number]) => {
      const p = scene.frame.toXY(c.centroid);
      return Math.hypot(p.x - w.x, p.y - w.y) < 0.05;
    };
    expect(weeds.every(w => candidates.some(c => near(c, w)))).toBe(true);
  });

  it("a flagged tile with no vegetation still enters the queue as a tile", () => {
    const { candidates } = rankCandidates({
      blobs: [], tiles, rows: null,
      flags: [{ tileId: tiles[5].id, z: 5.2, feature: "brightness", direction: "above" }],
      params: DEFAULT_SCOUT_PARAMS,
    });
    expect(candidates.length).toBe(1);
    expect(candidates[0].blob).toBeNull();
    expect(candidates[0].kind).toBe("field outlier");
    expect(describeCandidate(candidates[0])).toContain("no vegetation");
  });

  it("excludes headland ground before scoring", () => {
    const hTiles = tessellate(field, 3, 5);      // every tile of a 12 m field is headland at 5 m
    const blobs = extractBlobs(mask, scene.raster, { tileOf: p => tileIdAt(lattice, p) });
    const r = rankCandidates({ blobs, tiles: hTiles, flags: [], rows: null, params: DEFAULT_SCOUT_PARAMS });
    expect(r.candidates.length).toBe(0);
    expect(r.headlandExcluded).toBe(blobs.length);
  });

  it("never calls a candidate a weed", () => {
    const rows = fitRowModel(mask, scene.raster, 0.762, { windowM: 12 });
    const blobs = extractBlobs(mask, scene.raster, { tileOf: p => tileIdAt(lattice, p) });
    const { candidates } = rankCandidates({
      blobs, tiles, rows,
      flags: [{ tileId: tiles[0].id, z: 4, feature: "brightness", direction: "above" }],
      params: DEFAULT_SCOUT_PARAMS,
    });
    for (const c of candidates) {
      expect(c.kind.toLowerCase()).not.toContain("weed");
      expect(describeCandidate(c).toLowerCase()).not.toContain("weed");
    }
  });
});

describe("step 4: the zoom window geometry", () => {
  it("crops a sub-raster whose bounds match the pixels it kept", () => {
    const { raster } = renderScene({ sizeM: 4, gsdM: 0.02, pitchM: 0, weeds: [{ x: 0, y: 0, r: 0.2 }] });
    const b = { north: LAT0 + 0.5 / M_PER_DEG_LAT, south: LAT0 - 0.5 / M_PER_DEG_LAT, east: LNG0 + 0.5 / mPerDegLng(LAT0), west: LNG0 - 0.5 / mPerDegLng(LAT0) };
    const r = pixelRect(raster, b);
    expect(r.x1 - r.x0 + 1).toBeGreaterThanOrEqual(49);
    const crop = cropRaster(raster, b);
    expect(crop.width).toBe(r.x1 - r.x0 + 1);
    expect(rasterGsdM(crop)).toBeCloseTo(0.02, 3);
    // Centre pixel of the crop is the weed.
    const o = ((Math.floor(crop.height / 2)) * crop.width + Math.floor(crop.width / 2)) * 4;
    expect(crop.rgba[o + 1]).toBe(128);
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
    expect(ctx.localTime).toBeNull();
    expect(describeEvent(ctx)).toContain("No station observation");
    const failed = contextFromReply(null, 38.95, -77.45, "2026-08-12T15:00:00Z");
    expect(failed.place).toBeNull();
    expect(failed.observationReason).toBe("lookup unavailable");
  });
});
