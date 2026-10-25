// The resolution chain from the drone's photographs to the map and the analysis, pinned so a quiet downsample
// cannot come back.
//
// 2026-10-24 (docs/research/orthomosaic-resolution-audit-2026-10-24.md): on the first corn field (DJI FC300X at
// 25 m, 1.07 cm, 30.5 N) the tile pyramid's zoom-23 cap was the one stage throwing detail away. 2026-10-25: the
// whole chain follows the flight's own pixel: ODM asked for finer than any flight, tiles to the file's pixel up to
// zoom 26, and the weed hotspots read at the finest pixel within a budget.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HOTSPOT_READ } from "@/components/app/weedVision/HotspotFinder";
import { ODM_UPLOAD_MAX_EDGE_PX, prepareForODM } from "@/lib/imagePrep";
import { ODM_PROCESSING_OPTIONS } from "@/lib/odmOptions";
import { ANALYSIS_MAX_ZOOM, MAP_MAX_ZOOM, ORTHO_MAX_NATIVE_ZOOM } from "@/lib/orthoZoom";
import { fieldReadPlan } from "@/lib/weedVision/fieldRows";
import { latLngOfPx, mercatorPx, metresPerPixel } from "@/lib/weedVision/mapRun";
import { blobFloorPx, DEFAULT_STAGE1 } from "@/lib/weedVision/twoStage/stage1";

const opt = (name: string) => ODM_PROCESSING_OPTIONS.find(o => o.name === name)?.value;
const bake = () => readFileSync(join(process.cwd(), "supabase/functions/bake-tiles/index.ts"), "utf8");

describe("photographs to ODM", () => {
  it("the upload is the camera's own file, never resized or re-encoded", async () => {
    expect(ODM_UPLOAD_MAX_EDGE_PX).toBe(Number.POSITIVE_INFINITY);
    const f = new File([new Uint8Array(3_000_000)], "DJI_0001.JPG", { type: "image/jpeg" });
    expect(await prepareForODM(f)).toBe(f);
  });

  it("ODM is asked for finer than any flight, so the photographs' own pixel decides, and nothing trades detail for speed", () => {
    // ODM caps the request at its GSD estimate: 0.1 cm comes back as the flight's own pixel (0.3 cm from 10 m).
    expect(opt("orthophoto-resolution")).toBeLessThanOrEqual(0.2);
    for (const name of ["fast-orthophoto", "resize-to", "ignore-gsd"]) expect(opt(name)).toBeUndefined();
    expect(["high", "ultra"]).toContain(opt("pc-quality"));
  });
});

describe("orthophoto to tiles to screen", () => {
  it("the bake cap and the map's native cap are the same zoom, and it is finer than a 0.3 cm flight", () => {
    const cap = Number(/const MAX_Z_CAP = (\d+);/.exec(bake())?.[1]);
    expect(cap).toBe(ORTHO_MAX_NATIVE_ZOOM);
    expect(metresPerPixel(30.55, 23) * 100).toBeCloseTo(1.61, 2); // the corn field's old ceiling
    expect(metresPerPixel(30.55, ORTHO_MAX_NATIVE_ZOOM)).toBeLessThan(0.003);
    expect(MAP_MAX_ZOOM).toBe(ORTHO_MAX_NATIVE_ZOOM + 1);
  });

  it("the automatic bake never stops above the old zoom-23 cap for the tile budget", () => {
    expect(Number(/const AUTO_FLOOR_Z = (\d+);/.exec(bake())?.[1])).toBe(23);
  });

  it("tiles are stored lossless", () => {
    expect(bake()).toMatch(/\/cog\/tiles\/WebMercatorQuad\/\$\{z\}\/\$\{x\}\/\$\{y\}\.png/);
    expect(bake()).toMatch(/contentType: "image\/png"/);
  });
});

describe("map to analysis", () => {
  const lat = 30.55, lng = -96.43;
  const square = (z: number, side: number) => {
    const [X, Y] = mercatorPx(lat, lng, z);
    return [[latLngOfPx(X, Y, z), latLngOfPx(X + side, Y, z), latLngOfPx(X + side, Y + side, z), latLngOfPx(X, Y + side, z)]];
  };

  it("the analysis may read as deep as the map is baked", () => {
    expect(ANALYSIS_MAX_ZOOM).toBe(ORTHO_MAX_NATIVE_ZOOM);
  });

  it("the row readers keep their own pixel on a finer map; the hotspots read the finest within their budget", () => {
    const rings = square(26, 4000); // about 8 m square
    expect(fieldReadPlan(rings, 26, lat)!.mpp).toBeGreaterThan(0.025); // READ_MPP, about 4 cm: unchanged
    const fine = fieldReadPlan(rings, 26, lat, HOTSPOT_READ.readMpp, HOTSPOT_READ.maxReadPixels)!;
    expect(fine.z).toBe(26);
    expect(fine.mpp).toBeLessThan(0.003);
  });

  it("a large field's hotspot read gives way to a coarser zoom rather than pass its pixel budget", () => {
    const rings = square(23, 20000); // about 10 ha: 400 million pixels at zoom 23, past the budget
    const plan = fieldReadPlan(rings, 26, lat, HOTSPOT_READ.readMpp, HOTSPOT_READ.maxReadPixels)!;
    expect(plan.width * plan.height).toBeLessThanOrEqual(HOTSPOT_READ.maxReadPixels);
  });

  it("the smallest counted patch follows a fine read, and the 4 cm read keeps its 30 cm2 floor", () => {
    const fine = { ...DEFAULT_STAGE1, blobMinPx: HOTSPOT_READ.blobMinPx };
    expect(blobFloorPx(DEFAULT_STAGE1, 0.04)).toBe(2);
    expect(blobFloorPx(fine, 0.04)).toBe(2);
    expect(blobFloorPx(fine, 0.003)).toBe(9); // 0.3 cm: a 1 cm patch counts
    expect(blobFloorPx(DEFAULT_STAGE1, 0.003)).toBeGreaterThan(300); // what the old floor would have asked
  });
});
