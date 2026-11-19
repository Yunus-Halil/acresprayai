// The hand-label scorer (scripts/rowCrop/cornLabelJudge.ts), shared by cornLabelScore.ts and the corn inspector.
import { describe, expect, it } from "vitest";
import { type Label, type Mark, judgeTile, labelSpacingPx, labelTiles, within } from "../../scripts/rowCrop/cornLabelJudge";

const ident = (u: number, v: number): [number, number] => [u, v];
const mark = (u: number, v: number, tier = 0): Mark => ({ u, v, e: u, n: v, tier });
const plant = (x: number, y: number): Label => ({ x, y, type: "plant" });

describe("the chessboard of tiles", () => {
  it("splits a photograph into dev and held-back tiles that never share a pixel and cover it whole", () => {
    const area = { x: 0, y: 0, w: 5280, h: 3956 }, dev = labelTiles(area, 4, false), held = labelTiles(area, 4, true);
    expect(dev.map(t => t.id)).toEqual(["r1c1", "r1c3", "r2c2", "r2c4", "r3c1", "r3c3", "r4c2", "r4c4"]);
    expect(held.map(t => t.id)).toEqual(["r1c2", "r1c4", "r2c1", "r2c3", "r3c2", "r3c4", "r4c1", "r4c3"]);
    expect([...dev, ...held].reduce((s, t) => s + t.w * t.h, 0)).toBe(5280 * 3956);
    for (const [u, v] of [[10, 10], [5279, 3955], [1320, 989], [2639, 1977]]) expect(dev.filter(t => within(t, u, v)).length + held.filter(t => within(t, u, v)).length).toBe(1);
  });
});

describe("one tile judged", () => {
  const tile = { id: "t", x: 0, y: 0, w: 1000, h: 1000 };
  it("matches labels to marks one to one within R, and tells a second mark on a plant from a mark on nothing", () => {
    const labels = [plant(100, 100), plant(300, 100), plant(500, 500)];
    // One mark on each of the first two plants, a second mark 4 px from the first plant, a mark on nothing, none on the third plant.
    const marks = [mark(102, 100), mark(300, 103), mark(96, 100), mark(700, 700)];
    const J = judgeTile(tile, marks, ident, 10, labels);
    expect(J.score.labelled).toBe(3); expect(J.score.found[0]).toBe(2); expect(J.score.missed).toBe(1);
    expect(J.score.wrong[0]).toBe(2); expect(J.score.wrongSecond[0]).toBe(1); expect(J.score.wrongNothing[0]).toBe(1);
    expect(J.plantFound).toEqual([true, true, false]);
    const wrong = J.ms.map((m, j) => ({ m, j })).filter(x => J.state[x.j] === 0);
    expect(wrong.map(x => [x.m.u, J.second[x.j]])).toEqual(expect.arrayContaining([[96, 1], [700, 0]]));
  });

  it("does not judge a left-over mark at the tile's edge, and counts marks by tier", () => {
    const J = judgeTile(tile, [mark(3, 500, 2), mark(500, 500, 1)], ident, 10, [plant(500, 500)]);
    expect(J.score.found).toEqual([0, 1, 0, 0, 0, 0]); expect(J.score.atEdge).toEqual([0, 0, 1, 0, 0, 0]); expect(J.score.wrong).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("gives an unsure label a mark only after the plants are matched, and never counts it as wrong", () => {
    const J = judgeTile(tile, [mark(200, 200), mark(400, 400)], ident, 10, [plant(200, 202), { x: 401, y: 400, type: "unsure" }]);
    expect(J.score.found[0]).toBe(1); expect(J.score.onUnsure[0]).toBe(1); expect(J.score.wrong[0]).toBe(0);
  });
});

describe("the labels' own spacing (a photograph scored in pixels)", () => {
  it("is the median distance between neighbouring plant labels along their rows", () => {
    const tile = { id: "t", x: 0, y: 0, w: 2000, h: 2000 }, labels: Label[] = [];
    for (let r = 0; r < 4; r++) for (let k = 0; k < 10; k++) labels.push(plant(200 + r * 300, 100 + k * 120));
    const L = labelSpacingPx([tile], () => labels);
    expect(L.medianPx).toBeCloseTo(120, 6); expect(L.rowsPerTile.t).toBe(4); expect(L.gapsPx.length).toBe(36);
  });
});
