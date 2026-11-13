// The row editor's snapped add (src/lib/fieldTwin/rowEdits.ts): a tap resolves to a slot from the rows beside it.
import { describe, expect, it } from "vitest";
import { NO_ROW_EDITS, type RowEdits, localFrame, plantIndex, rowModel, snapRow } from "@/lib/fieldTwin/rowEdits";
import type { LatLngPair, TwinBundle } from "@/lib/fieldTwin/types";

const ORIGIN = { lat: 38.5, lng: -77.3 };
const F = localFrame(ORIGIN.lat, ORIGIN.lng);
const S = 0.76;
/** Rows running north, 0.76 m apart, from 0 to 40 m; row index 3 missing (the twin missed it). */
function twin(missing: number[] = [3]): TwinBundle {
  const rows = [];
  for (let k = 0; k < 8; k++) {
    if (missing.includes(k)) continue;
    rows.push({ id: k + 1, status: "corn" as const, line: [F.toLL(k * S, 0), F.toLL(k * S, 20), F.toLL(k * S, 40)], lengthM: 40, seenBy: 3, cornBy: 3, coveredBy: 3, why: "" });
  }
  return { origin: { ...ORIGIN, altM: 0 }, corn: { rowSpacingM: S, rowDirectionDeg: 90, rows } } as unknown as TwinBundle;
}
const eastOf = (line: LatLngPair[]) => line.map(([la, ln]) => F.toEN(la, ln)[0]);

describe("adding a row with one tap", () => {
  it("puts a tap in the empty slot exactly on that slot, the length of its neighbours", () => {
    const m = rowModel(twin(), NO_ROW_EDITS)!;
    const [lat, lng] = F.toLL(3 * S + 0.15, 17);
    const s = snapRow(m, lat, lng);
    expect(s.kind).toBe("new");
    if (s.kind !== "new") return;
    for (const e of eastOf(s.line)) expect(Math.abs(e - 3 * S)).toBeLessThan(0.005);
    const ns = s.line.map(([la, ln]) => F.toEN(la, ln)[1]);
    expect(Math.min(...ns)).toBeLessThan(0.1); expect(Math.max(...ns)).toBeGreaterThan(39.9);
    expect(s.snap).toMatchObject({ method: "between", slot: 1, of: 2 });
  });

  it("takes a tap within a quarter spacing of a drawn row as that row", () => {
    const m = rowModel(twin(), NO_ROW_EDITS)!;
    const s = snapRow(m, ...F.toLL(5 * S + 0.12, 10));
    expect(s).toEqual({ kind: "row", key: 6 });
  });

  it("refuses a slot where two rows are one spacing apart", () => {
    const m = rowModel(twin([]), NO_ROW_EDITS)!;
    // Halfway between rows 2 and 3 (no row is within a quarter spacing, but there is no free slot either).
    expect(snapRow(m, ...F.toLL(2.5 * S, 10)).kind).toBe("none");
  });

  it("steps outward from the outermost row by the local gap, a row at a time", () => {
    let edits: RowEdits = NO_ROW_EDITS;
    const t = twin();
    const s1 = snapRow(rowModel(t, edits)!, ...F.toLL(8 * S - 0.1, 5));
    expect(s1.kind).toBe("new"); if (s1.kind !== "new") return;
    for (const e of eastOf(s1.line)) expect(Math.abs(e - 8 * S)).toBeLessThan(0.005);
    expect(s1.snap).toMatchObject({ method: "beyond", slot: 1 });
    // The added row is now the outer row: the next tap steps from it.
    edits = { ...edits, added: [{ uid: "a", line: s1.line, at: "", snap: s1.snap, onScreen: "rows", pointer: "mouse" }] };
    const s2 = snapRow(rowModel(t, edits)!, ...F.toLL(9 * S + 0.05, 5));
    expect(s2.kind).toBe("new"); if (s2.kind !== "new") return;
    for (const e of eastOf(s2.line)) expect(Math.abs(e - 9 * S)).toBeLessThan(0.005);
  });

  it("moves onto the located plants near the tap, never more than a quarter spacing", () => {
    const m = rowModel(twin(), NO_ROW_EDITS)!;
    // The real row is 9 cm east of the slot the neighbours give.
    const plants: LatLngPair[] = [];
    for (let n = 10; n < 24; n += 0.15) plants.push(F.toLL(3 * S + 0.09 + (n % 0.3 < 0.15 ? 0.01 : -0.01), n));
    const s = snapRow(m, ...F.toLL(3 * S, 17), plantIndex(m, plants));
    expect(s.kind).toBe("new"); if (s.kind !== "new") return;
    expect(s.snap.plants).toBeGreaterThan(10);
    for (const e of eastOf(s.line)) expect(Math.abs(e - (3 * S + 0.09))).toBeLessThan(0.015);
  });

  it("does not snap to a row the operator removed", () => {
    const m = rowModel(twin(), { ...NO_ROW_EDITS, verdicts: { "6": "remove" } })!;
    // Where row 6 was drawn is now an empty slot between rows 5 and 7.
    const s = snapRow(m, ...F.toLL(5 * S, 10));
    expect(s.kind).toBe("new");
  });
});
