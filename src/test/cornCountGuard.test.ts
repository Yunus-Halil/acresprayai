// The emergence guard (src/lib/rowCrop/cornV1.ts CORN_COUNT_GUARD): off by default; with it on, a photograph whose
// rows are green over more of their length than the cut gets no plant count, and keeps its rows, gaps and weed verdicts.
import { describe, expect, it } from "vitest";
import { renderScene, type Scene } from "../../scripts/cropProfiles/scenes";
import { type CornPhotoRead, compactCornRead, cornFlightGuard } from "@/lib/fieldTwin/cornField";
import { CORN_COUNT_GUARD, cornV1AsRead, cornV1RowCover, readCornV1, rowGreenCover } from "@/lib/rowCrop/cornV1";
import { rowCropParamsFor } from "@/lib/rowCrop/params";
import { cropProfileFor } from "@/lib/cropProfiles/registry";

const profile = cropProfileFor("corn")!;
const scene = (over: Partial<Scene>): Scene => ({ name: "t", widthM: 8, heightM: 6, gsdM: 0.005, angleDeg: 90, pitchM: 0.762, twinM: null, alongM: 0.16, leafM: 0.08, soil: "dark", straw: null, weedsPerM2: 0, weedRadiusM: 0.05, inRowWeedsPerM: 0, seed: 11, ...over });

describe("the share of a row's length that has green on it", () => {
  const W = 400, H = 100;
  it("counts a place on the row as green when the mask is green within the band across it", () => {
    const mask = new Uint8Array(W * H);
    // Green beside the row's line (5 px off it) over its first half, nothing over the second.
    for (let x = 0; x < 200; x++) mask[55 * W + x] = 1;
    const row = [{ points: [[0, 50], [399, 50]] as [number, number][] }];
    expect(rowGreenCover(mask, W, H, row, 6).share).toBeCloseTo(0.5, 2);
    expect(rowGreenCover(mask, W, H, row, 2).share).toBe(0);
    expect(rowGreenCover(mask, W, H, [], 6).share).toBeNull();
    // Two rows: each has its own share, the photograph's is by length.
    const two = [...row, { points: [[0, 80], [199, 80]] as [number, number][] }];
    for (let x = 0; x < 200; x++) mask[80 * W + x] = 1;
    const c = rowGreenCover(mask, W, H, two, 6);
    expect(c.perRow[0]).toBeCloseTo(0.5, 2); expect(c.perRow[1]).toBe(1);
    expect(c.share).toBeCloseTo((200 + 199) / (399 + 199), 2);
  });
});

describe("the emergence guard (off by default)", { timeout: 120000 }, () => {
  const params = rowCropParamsFor(profile, 0.005);
  const seedlings = renderScene(scene({})).px;
  // Leaves long enough to meet along the row: a row is green from end to end.
  const grown = renderScene(scene({ leafM: 0.3 })).px;

  it("is off by default, and a read carries nothing of it", () => {
    expect(CORN_COUNT_GUARD.on).toBe(false);
    expect(CORN_COUNT_GUARD.message).toBe("too late for a per-plant count");
    expect(readCornV1(seedlings, params, { enteredCrop: "corn" }).count).toBeUndefined();
  });

  it("measures seedlings under the cut and grown rows over it", () => {
    const a = readCornV1(seedlings, params, { enteredCrop: "corn" }), b = readCornV1(grown, params, { enteredCrop: "corn" });
    expect(a.rows.length).toBeGreaterThan(0); expect(b.rows.length).toBeGreaterThan(0);
    expect(cornV1RowCover(seedlings, a).share!).toBeLessThan(CORN_COUNT_GUARD.cut);
    expect(cornV1RowCover(grown, b).share!).toBeGreaterThan(CORN_COUNT_GUARD.cut);
  });

  it("under the cut: the read is as it was, with the measure beside it", () => {
    const was = readCornV1(seedlings, params, { enteredCrop: "corn" }), v = readCornV1(seedlings, params, { enteredCrop: "corn", countGuard: true });
    expect(v.count!.withheld).toBe(false); expect(v.count!.cut).toBe(CORN_COUNT_GUARD.cut);
    expect(v.plants.points).toEqual(was.plants.points); expect(v.rows).toEqual(was.rows); expect(v.notes).toEqual(was.notes);
  });

  it("past the cut: the plant count is withheld and said so; rows, gaps and weed verdicts stand", () => {
    const was = readCornV1(grown, params, { enteredCrop: "corn" }), v = readCornV1(grown, params, { enteredCrop: "corn", countGuard: true });
    expect(was.plants.points.length).toBeGreaterThan(0);
    expect(v.count!.withheld).toBe(true); expect(v.count!.rowGreenShare!).toBeGreaterThan(CORN_COUNT_GUARD.cut);
    expect(v.plants.points).toEqual([]); expect(v.plants.low).toBeUndefined();
    expect(v.rows.every(r => r.plants === null)).toBe(true);
    expect(v.rows.map(r => ({ ...r, plants: 0 }))).toEqual(was.rows.map(r => ({ ...r, plants: 0 })));
    expect(v.gaps).toEqual(was.gaps); expect(v.weedVerdicts).toEqual(was.weedVerdicts); expect(v.summary.cornRows).toBe(was.summary.cornRows);
    expect(v.notes[0]).toContain("too late for a per-plant count");
    // What Photo Scout shows: no count and no plant position; the rows as before.
    const shown = cornV1AsRead(v), shownWas = cornV1AsRead(was);
    expect(shown.cornV1!.plants).toBeNull(); expect(shown.cornV1!.countWithheld).toBe("too late for a per-plant count");
    expect(shown.summary.plants).toBeNull();
    expect(shown.rows.every(r => r.plants == null && r.plantPoints == null)).toBe(true);
    expect(shown.rows.map(r => r.points)).toEqual(shownWas.rows.map(r => r.points));
    expect(shown.weeds.length).toBe(shownWas.weeds.length);
    // What a build carries from the photograph: its rows, patches and gaps, and no plant.
    const c = compactCornRead("p", v), cWas = compactCornRead("p", was);
    expect(c.plants).toEqual([]); expect(c.countWithheld).toBe(true);
    expect(c.rows).toEqual(cWas.rows); expect(c.gaps).toEqual(cWas.gaps); expect(c.patches).toEqual(cWas.patches);
    expect(cWas.countWithheld).toBeUndefined();
  });

  it("is never run by the corn-v1.0 comparison read", () => {
    expect(readCornV1(grown, params, { enteredCrop: "corn", baselineSeedlings: true, countGuard: true }).count).toBeUndefined();
  });
});

describe("the guard over a flight: a photograph that misread its row spacing", () => {
  const read = (name: string, spacingPx: number | null, opts: Partial<CornPhotoRead> = {}): CornPhotoRead => ({ name, scale: 1, rows: [], patches: [], gaps: [], plants: [[1, 1], [2, 2]], low: [[3, 3]], guard: { rowGreenShare: 0.3, rowSpacingPx: spacingPx, gsdM: 0.005 }, ...opts });
  const flight = [read("a", 150), read("b", 152), read("c", 155), read("d", 949), read("e", 60), read("f", 148, { plants: [], countWithheld: true, countReason: "too late for a per-plant count", guard: { rowGreenShare: 0.9, rowSpacingPx: 148, gsdM: 0.005 } })];

  it("drops the marks of a photograph over 1.5 times or under 1/1.5 of the flight's median, and says it misread", () => {
    expect(CORN_COUNT_GUARD.misreadRatio).toBe(1.5); expect(CORN_COUNT_GUARD.misreadMessage).toBe("row spacing misread");
    const G = cornFlightGuard(flight);
    expect(G.medianSpacingM).toBeCloseTo(152 * 0.005, 9);
    const by = new Map(G.reads.map(r => [r.name, r]));
    for (const n of ["d", "e"]) { expect(by.get(n)!.plants).toEqual([]); expect(by.get(n)!.low).toBeUndefined(); expect(by.get(n)!.countReason).toBe("row spacing misread"); }
    for (const n of ["a", "b", "c"]) expect(by.get(n)).toBe(flight.find(r => r.name === n));
    // A late photograph at the flight's spacing stays withheld as too late.
    expect(by.get("f")!.countReason).toBe("too late for a per-plant count");
    expect(G.withheld.map(w => [w.name, w.reason])).toEqual([["d", "row spacing misread"], ["e", "row spacing misread"], ["f", "too late for a per-plant count"]]);
  });

  it("a photograph the cut withheld as too late is called a misread when its spacing is off", () => {
    const G = cornFlightGuard([read("a", 150), read("b", 152), read("c", 155), read("d", 949, { plants: [], countWithheld: true, countReason: "too late for a per-plant count" })]);
    expect(G.withheld).toEqual([expect.objectContaining({ name: "d", reason: "row spacing misread" })]);
  });

  it("leaves the reads alone where the guard did not run, or with the misread check off (the guard as it stood)", () => {
    const off = flight.map(({ guard: _g, ...r }) => r as CornPhotoRead);
    expect(cornFlightGuard(off).reads).toEqual(off);
    const asItStood = cornFlightGuard(flight, { ...CORN_COUNT_GUARD, misreadRatio: null });
    expect(asItStood.reads).toEqual(flight);
    expect(asItStood.withheld.map(w => w.name)).toEqual(["f"]);
  });
});
