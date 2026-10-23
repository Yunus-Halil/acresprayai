// Corn rows from the field map for the weed-pressure grade (weedVision/patternRows.ts): the pattern pass with the corn
// profile, its lines in the FieldRows frame with the corn band, and the operator's confirmation before any grade.
import { afterEach, describe, expect, it } from "vitest";
import { renderScene, type Scene } from "../../scripts/cropProfiles/scenes";
import { standInMap } from "../../scripts/cropProfiles/standInMap";
import { analysePhoto } from "@/lib/photoScout/pattern";
import { DEFAULT_PATTERN_BAND_M, distinctRows, readPatternRows, readsPatternRows } from "@/lib/weedVision/patternRows";
import { pressureRefusal } from "@/lib/weedVision/pressure/pressureStore";
import { confirmFieldRows, ensureFieldRows, frameRunFieldRows, getFrameRun, resetFrameRunStore, setFieldRowsReaders, setFrameRunBoundary, setFrameRunMap } from "@/lib/weedVision/frameRunStore";
import { DEFAULT_STAGE1, readStage1 } from "@/lib/weedVision/twoStage/stage1";
import { metresPerPixel } from "@/lib/weedVision/mapRun";

const scene: Scene = { name: "map", widthM: 12, heightM: 9, gsdM: 0.01, angleDeg: 80, pitchM: 0.762, twinM: null, alongM: 0.17, leafM: 0.15, soil: "red", straw: { offsetShare: 0.5, widthShare: 0.4 }, weedsPerM2: 4, weedRadiusM: 0.05, inRowWeedsPerM: 0, seed: 4242 };
const analyse = (r: Parameters<typeof analysePhoto>[0], p: Parameters<typeof analysePhoto>[1]) => analysePhoto(r, p);

afterEach(() => { resetFrameRunStore(); setFieldRowsReaders(null); try { localStorage.clear(); } catch { /* none */ } });

describe("which crops read rows with the pattern pass", () => {
  it("corn by any name; crops without a continuous-row profile keep the tree reader", () => {
    for (const c of ["corn", "Maize", "Mısır"]) expect(readsPatternRows(c), c).toBe(true);
    for (const c of ["apricot", "Soybeans", "", null]) expect(readsPatternRows(c as string), String(c)).toBe(false);
  });
});

describe("rows, not line pieces", () => {
  it("pieces of one row in several windows count once", () => {
    const pieces = [0, 1, 2].flatMap(row => [0, 1, 2].map(w => ({ x1: w * 100, y1: row * 50, x2: w * 100 + 99, y2: row * 50 })));
    expect(distinctRows(pieces, 50)).toBe(3);
    expect(distinctRows([], 50)).toBe(0);
  });
});

describe("corn rows read from a stand-in field map: red soil with straw stripes between the rows", () => {
  it("finds the rows at 76 cm, puts them on the corn, with the corn band and no crowns; Stage 1 reads them at 3 cm", async () => {
    const { px, truth } = renderScene(scene);
    const m = standInMap(px, scene.gsdM);
    const { rows } = await readPatternRows({ rings: [m.ring], tile: () => "", maxNative: m.maxNative, crop: "corn", fetch: m.fetch, analyse });
    expect(rows).not.toBeNull();
    expect(rows!.source).toBe("pattern");
    expect(Math.abs(rows!.spacingM - 0.762) / 0.762).toBeLessThan(0.05);
    expect(rows!.ctx.crops).toEqual([]);
    expect(rows!.ctx.bandPx * rows!.mpp).toBeCloseTo(DEFAULT_PATTERN_BAND_M, 3);
    // The lines on the corn: each line's middle within a quarter pitch of a true row (frame px -> map px -> ground).
    const k = 2 ** (m.raster.z - rows!.z);
    const onCrop = rows!.ctx.lines.filter(l => {
      const x = ((rows!.left + (l.x1 + l.x2) / 2) * k - m.raster.left) * m.mpp, y = -((rows!.top + (l.y1 + l.y2) / 2) * k - m.raster.top) * m.mpp;
      return Math.abs(truth.acrossToRow(x, y)) < scene.pitchM / 4;
    }).length;
    expect(onCrop / rows!.ctx.lines.length).toBeGreaterThanOrEqual(0.9);
    const st = await readStage1({ rings: [m.ring], tile: () => "", maxNative: m.maxNative, lat: m.lat, rows, params: { ...DEFAULT_STAGE1, readMpp: 0.03 }, draw: m.draw as never });
    expect(st).not.toBeNull();
    expect(st!.grid.mpp).toBeLessThanOrEqual(0.03 * 1.01);
    expect(st!.cells.filter(c => !c.uncertain.includes("no rows")).length).toBeGreaterThan(0);
  }, 120_000);

  it("a crop without a continuous-row profile is not read this way", async () => {
    const { px } = renderScene(scene);
    const m = standInMap(px, scene.gsdM);
    expect((await readPatternRows({ rings: [m.ring], tile: () => "", maxNative: m.maxNative, crop: "apricot", fetch: m.fetch, analyse })).rows).toBeNull();
  }, 60_000);
});

describe("the grade waits for the operator's word on pattern rows", () => {
  const rows = { source: "pattern" as const } as never;
  it("refused until confirmed; then graded; tree-reader rows are never used for corn", () => {
    expect(pressureRefusal("corn", rows, { rowsConfirmed: false })).toMatch(/^Confirm the corn rows first/);
    expect(pressureRefusal("corn", rows, { rowsConfirmed: true })).toBeNull();
    expect(pressureRefusal("corn", { source: "reader" } as never, { rowsConfirmed: true })).toMatch(/rows have not been read from the map yet/);
    expect(pressureRefusal("corn", null)).toMatch(/rows have not been read from the map yet/);
    expect(pressureRefusal("corn", { source: "layout" } as never)).toBeNull();
  });
});

describe("the frame run reads corn with the pattern pass, and keeps the confirmation for the rows that were seen", () => {
  const fakeRows = (spacingM: number) => ({ z: 21, left: 0, top: 0, mpp: metresPerPixel(40, 21), ctx: { lines: [{ x1: 0, y1: 0, x2: 100, y2: 0, band: 3 }], crops: [], bandPx: 3, gsdM: 0.05 }, rows: 1, spacingM, seedSpacingM: 0, directionDeg: 90, blocks: 1, source: "pattern" as const });
  const ring = [{ lat: 40, lng: -75 }, { lat: 40, lng: -74.999 }, { lat: 39.999, lng: -74.999 }, { lat: 39.999, lng: -75 }];

  it("corn: pattern reader, not the tree reader; confirmation needed, held per rows signature", async () => {
    let tree = 0, pattern = 0, spacing = 0.762;
    setFieldRowsReaders({ reader: async () => { tree++; return null; }, patternReader: async () => { pattern++; return { rows: fakeRows(spacing), pattern: null }; } });
    setFrameRunMap("t1", { tile: () => "", maxNative: 22, lat: 40, lng: -75, crop: "Corn" });
    setFrameRunBoundary("t1", [ring]);
    await ensureFieldRows("t1");
    expect([tree, pattern]).toEqual([0, 1]);
    expect(getFrameRun("t1").fieldRowsSource).toBe("pattern");
    expect(getFrameRun("t1").fieldRowsConfirmed).toBe(false);
    confirmFieldRows("t1");
    expect(getFrameRun("t1").fieldRowsConfirmed).toBe(true);
    expect(frameRunFieldRows("t1")?.source).toBe("pattern");
    // Read again with the same rows: still confirmed. A different read: asked again.
    resetFrameRunStore();
    setFrameRunMap("t1", { tile: () => "", maxNative: 22, lat: 40, lng: -75, crop: "Corn" });
    setFrameRunBoundary("t1", [ring]);
    await ensureFieldRows("t1");
    expect(getFrameRun("t1").fieldRowsConfirmed).toBe(true);
    resetFrameRunStore();
    spacing = 0.508;
    setFrameRunMap("t1", { tile: () => "", maxNative: 22, lat: 40, lng: -75, crop: "Corn" });
    setFrameRunBoundary("t1", [ring]);
    await ensureFieldRows("t1");
    expect(getFrameRun("t1").fieldRowsConfirmed).toBe(false);
  });

  it("an orchard keeps the tree reader", async () => {
    let tree = 0, pattern = 0;
    setFieldRowsReaders({ reader: async () => { tree++; return null; }, patternReader: async () => { pattern++; return { rows: null, pattern: null }; } });
    setFrameRunMap("t2", { tile: () => "", maxNative: 22, lat: 40, lng: -75, crop: "apricot" });
    setFrameRunBoundary("t2", [ring]);
    await ensureFieldRows("t2");
    expect([tree, pattern]).toEqual([1, 0]);
  });
});
