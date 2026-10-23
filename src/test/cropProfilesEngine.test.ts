// Regression tests for the failure cases in crop-profiles/corn/10_validation/validation.json, on rendered corn stands
// (scripts/cropProfiles/scenes.ts, development scenes only: the evaluation scenes stay out of every test).
import { describe, expect, it } from "vitest";
import { renderScene, sceneSet, type Scene } from "../../scripts/cropProfiles/scenes";
import { analysePhoto, photoMask, spacingCandidates, AUTO_SPACING_CANDIDATES_M, type PhotoPattern } from "@/lib/photoScout/pattern";
import { overlayFromPattern } from "@/lib/sourceFrames/patternLook";
import { patternPriorFor } from "@/lib/cropProfiles/engine";
import { cropProfileFor } from "@/lib/cropProfiles/registry";
import { indexRaster, maskWindow } from "@/lib/weedScout/vegetation";

const prior = patternPriorFor(cropProfileFor("corn"))!;
const dev = (name: string) => sceneSet("development").find(s => s.name === name)!;

/** Share of the pattern's row lines whose mean distance to the nearest true row is under a quarter pitch. */
function linesOnCrop(p: PhotoPattern, s: Scene, acrossToRow: (x: number, y: number) => number): number | null {
  const o = overlayFromPattern(p, null);
  if (!o.lines.length) return null;
  const on = o.lines.map(l => { let sum = 0; for (let k = 0; k <= 10; k++) sum += Math.abs(acrossToRow((l.x1 + ((l.x2 - l.x1) * k) / 10) * s.gsdM, -(l.y1 + ((l.y2 - l.y1) * k) / 10) * s.gsdM)); return sum / 11 < s.pitchM / 4; });
  return on.filter(Boolean).length / on.length;
}

async function both(s: Scene) {
  const { px, truth } = renderScene(s);
  const neutral = await analysePhoto(px, { gsdM: s.gsdM, rowSpacingM: "auto" });
  const corn = await analysePhoto(px, { gsdM: s.gsdM, rowSpacingM: "auto", prior });
  return { neutral, corn, onCrop: (p: PhotoPattern) => linesOnCrop(p, s, truth.acrossToRow) };
}

describe("fc-0359-residue-rows: straw stripes between corn rows on red soil", () => {
  for (const name of ["development-4", "development-v1eval-59"]) {
    it(`${name}: crop-neutral rows sit on the straw; with the corn profile they sit on the crop`, async () => {
      const s = dev(name);
      expect(s.soil).toBe("red");
      expect(s.straw).not.toBeNull();
      const r = await both(s);
      expect(r.onCrop(r.neutral)).toBe(0);
      expect(r.onCrop(r.corn)).toBe(1);
      expect(Math.abs(r.corn.summary.medianPitchM! - s.pitchM) / s.pitchM).toBeLessThan(0.05);
      expect(r.corn.summary.exgrGatedShare).toBeGreaterThan(0.05);
      expect(r.corn.notes.join(" ")).toMatch(/ExGR gate/);
    }, 60_000);
  }
});

describe("fc-pic1-pitch-confidence and fc-small-photo-blocks: close-up photos a few rows wide", () => {
  const closeUp: Scene = { name: "close-up", widthM: 4, heightM: 3, gsdM: 0.005, angleDeg: 90, pitchM: 0.762, twinM: null, alongM: 0.18, leafM: 0.15, soil: "light", straw: null, weedsPerM2: 2, weedRadiusM: 0.04, inRowWeedsPerM: 0, seed: 77 };
  it("a 4 x 3 m photo of five corn rows reads the rows on the crop at the right spacing", async () => {
    const r = await both(closeUp);
    expect(r.corn.summary.blocks).toBeGreaterThan(0);
    expect(Math.abs(r.corn.summary.medianPitchM! - 0.762) / 0.762).toBeLessThan(0.05);
    expect(r.onCrop(r.corn)).toBeGreaterThanOrEqual(0.75);
  }, 60_000);

  it("a photo with fewer windows than a block normally needs still forms a block (crop-neutral too)", async () => {
    const s: Scene = { ...closeUp, name: "two-windows", widthM: 6.9, heightM: 5.1, gsdM: 0.0047, seed: 78 };
    const { px } = renderScene(s);
    const p = await analysePhoto(px, { gsdM: s.gsdM, rowSpacingM: 0.762 });
    expect(p.windows.length).toBeLessThan(3);
    expect(p.summary.blocks).toBe(1);
  }, 60_000);
});

describe("a pitch nobody measured is not rows", () => {
  it("development-v1eval-27: the profile no longer reads straw at a candidate's spacing", async () => {
    const s = dev("development-v1eval-27");
    const r = await both(s);
    const ok = r.corn.summary.blocks === 0 || Math.abs(r.corn.summary.medianPitchM! - s.pitchM) / s.pitchM < 0.05;
    expect(ok).toBe(true);
  }, 60_000);
});

describe("the vegetation mask: floor and ExGR gate", () => {
  it("maskWindow never splits below its floor, and says so", () => {
    // Two populations of index: soil about -0.4 and straw about -0.1; Otsu splits between them.
    const w = 20, h = 10, rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { const straw = i % 2 === 0; rgba.set(straw ? [200, 182, 140, 255] : [150, 72, 52, 255], i * 4); }
    const index = indexRaster({ width: w, height: h, rgba, bounds: { north: 1, south: 0, east: 1, west: 0 } });
    const mask = new Uint8Array(w * h);
    const free = maskWindow(index, w, { x0: 0, y0: 0, x1: w - 1, y1: h - 1 }, mask, 0);
    expect(free.vegetation).toBe(100); // the straw half reads as "vegetation"
    const floored = maskWindow(index, w, { x0: 0, y0: 0, x1: w - 1, y1: h - 1 }, mask, 0, undefined, 0.3);
    expect(floored.floored).toBe(true);
    expect(floored.vegetation).toBe(0);
  });

  it("the ExGR gate keeps green leaves and drops straw that ExG calls green", () => {
    const w = 30, h = 10, rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { const k = i % 3; rgba.set(k === 0 ? [62, 128, 42, 255] : k === 1 ? [205, 186, 140, 255] : [176, 142, 108, 255], i * 4); }
    const px = { width: w, height: h, rgba };
    const plain = photoMask(px, 64);
    const gated = photoMask(px, 64, null, 0);
    const leaf = (m: Uint8Array) => m.filter((v, i) => v && i % 3 === 0).length, straw = (m: Uint8Array) => m.filter((v, i) => v && i % 3 === 1).length;
    expect(leaf(gated.mask)).toBe(100);
    expect(straw(gated.mask)).toBe(0);
    expect(gated.gatedPixels).toBe(straw(plain.mask));
  });

  it("the crop's spacings are searched beside the crop-neutral ones, never instead of them", () => {
    const c = spacingCandidates(prior);
    for (const m of prior.spacingCandidatesM) expect(c).toContain(m);
    for (const m of [1.5, 2.5, 4, 6]) expect(c).toContain(m);
    expect(spacingCandidates(null)).toBe(AUTO_SPACING_CANDIDATES_M);
  });
});
