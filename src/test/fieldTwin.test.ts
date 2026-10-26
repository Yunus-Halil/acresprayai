import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIELD_TWIN_FORMAT, parseTwin, type TwinBundle, type TwinWeed } from "@/lib/fieldTwin/types";
import { bundleFileNames, missingFiles, twinPath } from "@/lib/fieldTwin/store";
import { isFieldTwinReviewer } from "@/lib/fieldTwin/reviewers";
import { OUTLINES_FROM_ZOOM, POINTS_FROM_ZOOM, detailAt, treeLines, weedDensity, weedLines } from "@/lib/fieldTwin/view";
import { WEED_COLOUR, weedColour } from "@/lib/fieldTwin/style";
import { fieldRowsFromPixels, type RowReadTraceLog } from "@/lib/weedVision/fieldRows";

const weed = (over: Partial<TwinWeed> = {}): TwinWeed => ({
  id: 1, lat: 33.88, lng: -5.42, status: "verified", rowStatus: "between rows", diameterM: 0.2, areaM2: 0.03, spanM: 0.31, heightM: 0.04,
  seenBy: 4, coveredBy: 5, viewSpreadM: 0.043, sizeCv: 0.08, score: 0.81, treeId: null, ring: [[33.88, -5.42], [33.88001, -5.42], [33.88001, -5.41999]],
  evidence: [{ photo: "DJI_0301", atlas: 0, x: 0, y: 0, size: 112, metresAcross: 0.6, poly: [[10, 10], [50, 10], [30, 40]] }], ...over,
});

const bundle = (over: Partial<TwinBundle> = {}): TwinBundle => ({
  format: FIELD_TWIN_FORMAT, id: "apricot-2021-04-27", name: "Apricot", builtAt: "2026-10-26T00:00:00Z",
  source: { photographs: 71, camera: "DJI FC6310R", capturedAt: null, groundPixelCm: 0.98, method: "m", weedModel: "w", treeModel: "t" },
  origin: { lat: 33.88, lng: -5.42 }, bounds: [[33.879, -5.421], [33.881, -5.419]],
  field: { rowDirectionDeg: 131, rowSpacingM: 5, plantSpacingM: 3.1 },
  footprints: [{ photo: "DJI_0301", ring: [[33.879, -5.421], [33.881, -5.421], [33.881, -5.419]] }],
  rows: [{ id: 1, kept: true, reason: null, line: [[33.879, -5.42], [33.881, -5.42]], trees: 10, inferred: 0, photos: 4, lengthM: 30, straightnessSdM: 0.2 }],
  trees: [{ id: 7, lat: 33.88, lng: -5.4201, crownRadiusM: 0.9, heightM: 1.1, seenBy: 4, coveredBy: 4, viewSpreadM: 0.07, sizeCv: 0.06, rowId: 1, evidence: [] }],
  inferredTrees: [], weeds: [weed()], vegetation: [], atlases: [{ file: "atlas-0.jpg", width: 2016, height: 112 }], stats: {}, ...over,
});

describe("Field Twin bundle", () => {
  it("accepts a well-formed bundle", () => {
    const r = parseTwin(JSON.parse(JSON.stringify(bundle())));
    expect(r.ok).toBe(true);
  });

  it("refuses what is not a bundle, with the reason", () => {
    expect(parseTwin(null)).toMatchObject({ ok: false });
    expect(parseTwin({ ...bundle(), format: "something-else" })).toMatchObject({ ok: false, reason: expect.stringContaining("format") });
    expect(parseTwin({ ...bundle(), id: "../other-user" })).toMatchObject({ ok: false, reason: expect.stringContaining("id") });
    expect(parseTwin({ ...bundle(), atlases: [{ file: "../../secret.jpg", width: 1, height: 1 }] })).toMatchObject({ ok: false, reason: expect.stringContaining("atlas") });
    expect(parseTwin({ ...bundle(), weeds: [weed({ evidence: [{ photo: "x", atlas: 3, x: 0, y: 0, size: 112, metresAcross: null, poly: [] }] })] })).toMatchObject({ ok: false, reason: expect.stringContaining("atlas 3") });
    expect(parseTwin({ ...bundle(), weeds: [weed({ status: "maybe" as TwinWeed["status"] })] })).toMatchObject({ ok: false, reason: expect.stringContaining("status") });
    expect(parseTwin({ ...bundle(), rows: [{ ...bundle().rows[0], line: [[33.88, -5.42]] }] })).toMatchObject({ ok: false });
  });

  it("knows its files and where they live in the account", () => {
    const b = bundle({ atlases: [{ file: "atlas-0.jpg", width: 1, height: 1 }, { file: "atlas-1.jpg", width: 1, height: 1 }] });
    expect(bundleFileNames(b)).toEqual(["twin.json", "atlas-0.jpg", "atlas-1.jpg"]);
    expect(missingFiles(b, ["twin.json", "atlas-1.jpg"])).toEqual(["atlas-0.jpg"]);
    expect(twinPath("user-1", b.id, "twin.json")).toBe("user-1/field-twins/apricot-2021-04-27/twin.json");
  });

  const real = join(process.cwd(), "data/direct-georef/twin/apricot-2021-04-27/twin.json");
  it.skipIf(!existsSync(real))("the bundle built from the apricot photographs parses (when built on this computer)", () => {
    const r = parseTwin(JSON.parse(readFileSync(real, "utf8")));
    if ("reason" in r) throw new Error(r.reason);
    expect(r.twin.trees.length).toBeGreaterThan(500);
    expect(r.twin.weeds.some(w => w.status === "verified")).toBe(true);
  });
});

describe("Field Twin reviewers", () => {
  it("lists the reviewer by email, any case, and nobody else", () => {
    expect(isFieldTwinReviewer("yunushalilerdogan5@gmail.com")).toBe(true);
    expect(isFieldTwinReviewer(" YunusHalilErdogan5@Gmail.com ")).toBe(true);
    expect(isFieldTwinReviewer("someone@example.com")).toBe(false);
    expect(isFieldTwinReviewer(null)).toBe(false);
  });
});

describe("Field Twin view", () => {
  it("shows more as the map zooms in", () => {
    expect(detailAt(POINTS_FROM_ZOOM - 0.5)).toBe("overview");
    expect(detailAt(POINTS_FROM_ZOOM)).toBe("points");
    expect(detailAt(OUTLINES_FROM_ZOOM)).toBe("outlines");
  });

  it("counts weeds per square for the overview, aligned to the twin's origin", () => {
    const t = bundle({ weeds: [weed({ id: 1, lat: 33.88001, lng: -5.41999 }), weed({ id: 2, lat: 33.880015, lng: -5.419985 }), weed({ id: 3, lat: 33.8802, lng: -5.4198 }), weed({ id: 4, status: "single view" })] });
    const cells = weedDensity(t, 5, w => w.status === "verified");
    expect(cells.reduce((s, c) => s + c.count, 0)).toBe(3);
    const big = cells.find(c => c.count === 2)!;
    expect(big.north - big.south).toBeCloseTo(5 / 111_320, 9);
    expect(big.areaM2).toBeCloseTo(0.06, 9);
  });

  it("describes a weed in the account's units, saying how it was verified", () => {
    const m = weedLines(weed(), "metric");
    expect(m.find(l => l.label === "Status")!.value).toBe("Verified: seen in 4 of 5 photographs");
    expect(m.find(l => l.label === "Size across")!.value).toMatch(/^20(\.0)? cm$/);
    expect(m.find(l => l.label === "Ground cover")!.value).toMatch(/cm²$/);
    const i = weedLines(weed(), "imperial");
    expect(i.find(l => l.label === "Size across")!.value).toMatch(/ in$/);
    expect(i.find(l => l.label === "Ground cover")!.value).toMatch(/in²$/);
    expect(weedLines(weed({ status: "single view", seenBy: 1, coveredBy: 3 }), "metric")[0].value).toBe("Unverified: seen in 1 of 3 photographs");
    expect(weedLines(weed({ status: "on a tree" }), "metric")[0].value).toMatch(/tree crown/);
    // One sighting has no cross-view agreement to report.
    expect(weedLines(weed({ status: "single view", seenBy: 1 }), "metric").some(l => l.label.startsWith("Views agree"))).toBe(false);
  });

  it("describes a tree, its crown in the account's units", () => {
    const t = bundle().trees[0];
    expect(treeLines(t, "metric").find(l => l.label === "Crown across")!.value).toBe("1.8 m");
    expect(treeLines(t, "imperial").find(l => l.label === "Crown across")!.value).toMatch(/ ft$/);
    expect(treeLines(t, "metric").find(l => l.label === "Row")!.value).toBe("Row 1");
  });

  it("colours weeds by what they are", () => {
    expect(weedColour({ status: "verified", rowStatus: "between rows" })).toBe(WEED_COLOUR.betweenRows);
    expect(weedColour({ status: "verified", rowStatus: "on a row" })).toBe(WEED_COLOUR.onRow);
    expect(weedColour({ status: "single view", rowStatus: "between rows" })).toBe(WEED_COLOUR.single);
    expect(weedColour({ status: "on a tree", rowStatus: "on a row" })).toBe(WEED_COLOUR.onTree);
  });
});

describe("row reader trace (diagnosis only)", () => {
  // A synthetic orchard: green crowns 0.8 m across, 3 m apart along rows 5 m apart, on soil, 5 cm pixels.
  const mpp = 0.05, W = 600, H = 600;
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) rgba.set([150, 115, 85, 255], i * 4);
  for (let row = 0; row < 5; row++) for (let k = 0; k < 9; k++) {
    const cx = (2 + k * 3) / mpp, cy = (3 + row * 5) / mpp, r = 0.4 / mpp;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= 0 && y >= 0 && x < W && y < H) rgba.set([60, 140, 40, 255], (y * W + x) * 4);
  }
  it("reads the same rows with and without a trace, and the trace says what each check left", () => {
    const px = { width: W, height: H, rgba };
    const plain = fieldRowsFromPixels(px, mpp);
    const trace: RowReadTraceLog = { blocks: [] };
    const traced = fieldRowsFromPixels(px, mpp, trace);
    expect(plain).not.toBeNull();
    expect(traced).toEqual(plain);
    expect(plain!.spacingM).toBeCloseTo(5, 0);
    expect(plain!.seedSpacingM).toBeCloseTo(3, 0);
    const kept = trace.blocks[0].find(t => !t.stoppedAt)!;
    expect(kept.rowsAcross).toBe(5);
    expect(kept.spacingM).toBeCloseTo(5, 0);
  });
  it("says where a refusal stopped", () => {
    const blank = { width: 200, height: 200, rgba: new Uint8ClampedArray(200 * 200 * 4).fill(120) };
    const trace: RowReadTraceLog = { blocks: [] };
    expect(fieldRowsFromPixels(blank, mpp, trace)).toBeNull();
    expect(trace.blocks[0][0].stoppedAt).toMatch(/fewer than 12/);
  });
});
