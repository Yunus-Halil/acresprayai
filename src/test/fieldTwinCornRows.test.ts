// A corn row is one object: plants-first twins store each row as stretches (plants seen along it / the row's course
// where no plant was confirmed), and the viewer groups them back into the field's rows, from the stored `row` or,
// for twins saved before 2026-11-14, from the stretch's reason. Lattice twins' rows stay rows.
import { describe, expect, it } from "vitest";
import { cornFieldRows, fieldRowIndex, fieldRowOf } from "@/lib/fieldTwin/cornView";
import { DETAIL_PRESETS } from "@/lib/fieldTwin/style";
import { buildScene } from "@/lib/fieldTwin/scene";
import { parseTwin, type TwinBundle, type TwinCorn, type TwinCornRow } from "@/lib/fieldTwin/types";
import { CORN_TWIN } from "./fixtures/cornTwin";

const line = (a: number): [number, number][] => [[40 + a * 1e-5, -77], [40 + (a + 1) * 1e-5, -77]];
const stretch = (id: number, status: TwinCornRow["status"], lengthM: number, why: string, extra: Partial<TwinCornRow> = {}): TwinCornRow =>
  ({ id, status, line: line(id), lengthM, seenBy: 0, cornBy: 0, coveredBy: 0, why, ...extra });
const plants = { points: [], certainty: [], photos: [], note: "", summary: { plants: 0, certain: 0, probable: 0, onNoRow: 0, betweenRows: 0, confirmedM: 0, notConfirmedM: 0 } };
const cornOf = (rows: TwinCornRow[], extra: Partial<TwinCorn> = {}): TwinCorn => ({ ...(CORN_TWIN.corn as TwinCorn), rows, weeds: [], gaps: [], ...extra });

// The reasons exactly as cornPlants.ts wrote them from 2026-11-13 (the only plants-first version saved before this).
const seen = (row: number, n: number, certain: number, perM: number, slot = false) => `Plants seen along it (row ${row}: ${n} plants, ${certain} seen by most photographs over them, ${perM.toFixed(1)} a metre${slot ? "; found in a slot the certain rows leave" : ""}).`;
const continues = (row: number) => `The row probably continues here (row ${row}), but no plant was confirmed on this stretch.`;

describe("a corn row is one object", () => {
  it("groups a plants-first twin's stretches by their stored field row, with the row's plants", () => {
    const corn = cornOf([
      stretch(1, "corn", 6, seen(4, 40, 30, 3.2), { row: 4, plants: 22 }),
      stretch(2, "unconfirmed", 3, continues(4), { row: 4, plants: 0 }),
      stretch(3, "corn", 4, seen(4, 40, 30, 3.2), { row: 4, plants: 18 }),
      stretch(4, "corn", 5, seen(7, 15, 9, 3.0, true), { row: 7, plants: 15 }),
    ], { plants, fieldRows: [{ id: 4, plants: 40, certain: 30, perM: 3.2, kind: "certain" }, { id: 7, plants: 15, certain: 9, perM: 3, kind: "geometry" }] });
    const rows = cornFieldRows(corn);
    expect(rows.map(r => [r.id, r.stretches, r.confirmedM, r.notConfirmedM, r.confirmed, r.notConfirmed, r.plants, r.kind])).toEqual([
      [4, [0, 1, 2], 10, 3, 2, 1, 40, "certain"],
      [7, [3], 5, 0, 1, 0, 15, "geometry"],
    ]);
    expect(Array.from(fieldRowIndex(rows, 4))).toEqual([0, 0, 0, 1]);
  });

  it("reads the field row and its plants from the reasons of a plants-first twin saved before the row was stored", () => {
    const corn = cornOf([
      stretch(1, "unconfirmed", 2, continues(12)),
      stretch(2, "corn", 7.5, seen(12, 52, 41, 4.1)),
      stretch(3, "corn", 3, seen(13, 9, 9, 2.5, true)),
    ], { plants });
    expect(corn.rows.map(r => fieldRowOf(corn, r))).toEqual([12, 12, 13]);
    const rows = cornFieldRows(corn);
    expect(rows.map(r => [r.id, r.stretches.length, r.lengthM, r.plants, r.certain, r.perM, r.kind])).toEqual([
      [12, 2, 9.5, 52, 41, 4.1, "certain"],
      [13, 1, 3, 9, 9, 2.5, "geometry"],
    ]);
  });

  it("reads a development twin's reasons too (\"N certain\"), without a plants section", () => {
    const corn = cornOf([stretch(1, "corn", 4, "Plants seen along it (row 1: 543 plants, 422 certain, 4.4 a metre)."), stretch(2, "unconfirmed", 2, continues(1))]);
    expect(cornFieldRows(corn).map(r => [r.id, r.stretches.length, r.plants, r.certain, r.perM])).toEqual([[1, 2, 543, 422, 4.4]]);
  });

  it("keeps a lattice twin's rows as they are, one row each, and never reads a row number out of their reasons", () => {
    const corn = cornOf([stretch(1, "corn", 10, "held by 9 of 10 photographs (row 3: ...)", { seenBy: 9, coveredBy: 10, cornBy: 9 }), stretch(2, "unconfirmed", 8, "a planted row (row 3)")]);
    expect(corn.rows.map(r => fieldRowOf(corn, r))).toEqual([null, null]);
    expect(cornFieldRows(corn).map(r => [r.id, r.plantsFirst, r.stretches])).toEqual([[1, false, [0]], [2, false, [1]]]);
  });

  it("checks the stored field rows, and still reads a twin without them", () => {
    const base = { ...CORN_TWIN, corn: cornOf([stretch(1, "corn", 4, seen(1, 9, 9, 2), { row: 1, plants: 9 })], { plants, fieldRows: [{ id: 1, plants: 9, certain: 9, perM: 2, kind: "certain" }] }) };
    expect(parseTwin(JSON.parse(JSON.stringify(base))).ok).toBe(true);
    const broken = JSON.parse(JSON.stringify(base)); broken.corn.fieldRows[0].kind = "guess";
    expect(parseTwin(broken)).toEqual({ ok: false, reason: "corn: field row 1 is incomplete" });
    const legacy = JSON.parse(JSON.stringify(base)); delete legacy.corn.fieldRows; delete legacy.corn.rows[0].row; delete legacy.corn.rows[0].plants;
    expect(parseTwin(legacy).ok).toBe(true);
  });

  it("gives the scene each stored row's field row and extent", () => {
    const twin = { ...CORN_TWIN, corn: cornOf([stretch(1, "corn", 4, seen(2, 9, 9, 2), { row: 2 }), stretch(2, "unconfirmed", 1, continues(2), { row: 2 })], { plants }) } as TwinBundle;
    const K = buildScene(twin).corn!;
    expect(Array.from(K.rows.group)).toEqual([0, 0]);
    expect(K.rows.box.length).toBe(8);
    expect(K.rows.box[2]).toBeGreaterThanOrEqual(K.rows.box[0]);
  });
});

describe("what a corn twin shows by default", () => {
  it("hides the observations the photographs do not confirm at Simple and Standard, shows them at Full", () => {
    expect(DETAIL_PRESETS.simple.cornUncertain).toBe(false);
    expect(DETAIL_PRESETS.standard.cornUncertain).toBe(false);
    expect(DETAIL_PRESETS.full.cornUncertain).toBe(true);
    expect(DETAIL_PRESETS.simple.corn).toBe(true);
  });
});
