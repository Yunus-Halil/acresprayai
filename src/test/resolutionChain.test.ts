// The resolution chain from the drone's photographs to the map, pinned so a quiet downsample cannot come back.
//
// Measured on the first corn field (DJI FC300X at 25 m, 1.07 cm a pixel, 30.5 deg N; 2026-10-24,
// docs/research/orthomosaic-resolution-audit-2026-10-24.md): the photographs reach ODM untouched, ODM is asked for
// 1 cm, and the only stage that threw detail away was the tile pyramid, capped at zoom 23 (1.61 cm there).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ODM_UPLOAD_MAX_EDGE_PX, prepareForODM } from "@/lib/imagePrep";
import { ODM_PROCESSING_OPTIONS } from "@/lib/odmOptions";
import { ANALYSIS_MAX_ZOOM, MAP_MAX_ZOOM, ORTHO_MAX_NATIVE_ZOOM } from "@/lib/orthoZoom";
import { metresPerPixel } from "@/lib/weedVision/mapRun";

const opt = (name: string) => ODM_PROCESSING_OPTIONS.find(o => o.name === name)?.value;

describe("photographs to ODM", () => {
  it("the upload is the camera's own file, never resized or re-encoded", async () => {
    expect(ODM_UPLOAD_MAX_EDGE_PX).toBe(Number.POSITIVE_INFINITY);
    const f = new File([new Uint8Array(3_000_000)], "DJI_0001.JPG", { type: "image/jpeg" });
    expect(await prepareForODM(f)).toBe(f);
  });

  it("ODM is asked for a 1 cm orthophoto and nothing that trades detail for speed", () => {
    expect(opt("orthophoto-resolution")).toBeLessThanOrEqual(1);
    for (const name of ["fast-orthophoto", "resize-to", "ignore-gsd"]) expect(opt(name)).toBeUndefined();
    expect(["high", "ultra"]).toContain(opt("pc-quality"));
  });
});

describe("orthophoto to tiles to screen", () => {
  it("the bake cap and the map's native cap are the same zoom, and that zoom is finer than a 1.07 cm flight", () => {
    const bake = readFileSync(join(process.cwd(), "supabase/functions/bake-tiles/index.ts"), "utf8");
    const cap = Number(/const MAX_Z_CAP = (\d+);/.exec(bake)?.[1]);
    expect(cap).toBe(ORTHO_MAX_NATIVE_ZOOM);
    // At the corn field's latitude zoom 23 was 1.61 cm, coarser than the 1.07 cm the camera captured.
    expect(metresPerPixel(30.55, 23) * 100).toBeCloseTo(1.61, 2);
    expect(metresPerPixel(30.55, ORTHO_MAX_NATIVE_ZOOM)).toBeLessThan(0.0107);
    expect(MAP_MAX_ZOOM).toBe(ORTHO_MAX_NATIVE_ZOOM + 1);
  });

  it("tiles are stored lossless", () => {
    const bake = readFileSync(join(process.cwd(), "supabase/functions/bake-tiles/index.ts"), "utf8");
    expect(bake).toMatch(/\/cog\/tiles\/WebMercatorQuad\/\$\{z\}\/\$\{x\}\/\$\{y\}\.png/);
    expect(bake).toMatch(/contentType: "image\/png"/);
  });

  it("the analysis reads no deeper than the zoom its thresholds were set at, whatever the display holds", () => {
    expect(ANALYSIS_MAX_ZOOM).toBe(23);
    expect(ANALYSIS_MAX_ZOOM).toBeLessThan(ORTHO_MAX_NATIVE_ZOOM);
  });
});
