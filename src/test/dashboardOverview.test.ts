// The four numbers at the top of the first screen an operator sees.
//
// A headline figure is exactly the kind of number nobody checks. It looks
// authoritative, it sits above everything else, and if it is wrong it is wrong
// quietly. The two that are derived rather than counted, weed-affected area and
// missions ready, are the ones with a way to be wrong, so they are the ones
// pinned here.
import { describe, expect, it } from "vitest";
import {
  type AnnotationRow, type MissionRow, type ScanRow, missionsReady, tallyFields, weedArea,
} from "@/lib/dashboard/overview";
import { groupFor, isWeedPoly } from "@/lib/treatment/groups";

const ann = (over: Partial<AnnotationRow> = {}): AnnotationRow => ({
  id: Math.random().toString(36).slice(2),
  field_id: "f1",
  task_id: "scan-1",
  name: "Weed Scout: patch",
  issue_type: "Weed pressure",
  weed_label: null,
  weed_catalog_id: null,
  area_hectares: 1,
  created_at: "2026-06-01T00:00:00Z",
  ...over,
});

const scan = (id: string, field_id: string, created_at: string): ScanRow =>
  ({ id, field_id, created_at });

describe("fields", () => {
  it("splits mapped from awaiting a boundary", () => {
    const t = tallyFields([
      { id: "a", boundary: [[{ lat: 1, lng: 1 }]] },
      { id: "b", boundary: null },
      { id: "c", boundary: null },
    ]);
    expect(t).toEqual({ total: 3, mapped: 1, awaiting: 2 });
  });

  it("counts nothing as nothing rather than as a problem", () => {
    expect(tallyFields([])).toEqual({ total: 0, mapped: 0, awaiting: 0 });
  });
});

describe("what counts as a weed", () => {
  it("is the same rule the treatment grouping uses, not a second one", () => {
    // If these two ever disagree, the dashboard totals ground the screen it
    // links to does not, and neither number can be trusted.
    const cases: AnnotationRow[] = [
      ann({ name: "Weed Scout: patch", issue_type: "Weed pressure" }),
      ann({ name: "Patch", issue_type: "Weed pressure" }),
      ann({ name: "Patch", issue_type: "Drainage", weed_label: "common ragweed" }),
      ann({ name: "Wet corner", issue_type: "Drainage" }),
      ann({ name: "Rock", issue_type: "Obstruction" }),
    ];
    for (const c of cases) {
      const grouped = groupFor(c);
      const weedByGroup = grouped.label !== "Hand-drawn zones (not weeds)";
      expect(isWeedPoly(c)).toBe(weedByGroup);
    }
  });

  it("leaves hand-drawn zones that are not weeds out of the total", () => {
    const r = weedArea([
      ann({ area_hectares: 2 }),
      ann({ name: "Wet corner", issue_type: "Drainage", area_hectares: 50 }),
      ann({ name: "Rock pile", issue_type: "Obstruction", area_hectares: 50 }),
    ]);
    // A wet patch and a rock are real zones an operator drew. They are not
    // weeds, and totalling them here would put 102 ha on the front page.
    expect(r.hectares).toBe(2);
    expect(r.zones).toBe(1);
  });
});

describe("weed-affected area", () => {
  it("sums the weed zones of a single scan", () => {
    const r = weedArea([
      ann({ area_hectares: 1.5 }),
      ann({ area_hectares: 0.5 }),
    ], [scan("scan-1", "f1", "2026-06-01T00:00:00Z")]);
    expect(r).toEqual({ hectares: 2, fields: 1, zones: 2 });
  });

  it("counts one scan per field, not every scan of it", () => {
    // THE HEADLINE BUG THIS PREVENTS. A field flown in June and again in August
    // has two sets of annotations over one piece of ground. Summing both would
    // roughly double the number, and it would grow every time somebody re-flew
    // a field they had already dealt with.
    const r = weedArea([
      ann({ task_id: "june", area_hectares: 3 }),
      ann({ task_id: "august", area_hectares: 1 }),
    ], [
      scan("june", "f1", "2026-06-01T00:00:00Z"),
      scan("august", "f1", "2026-08-01T00:00:00Z"),
    ]);
    expect(r.hectares).toBe(1);
    expect(r.fields).toBe(1);
    expect(r.zones).toBe(1);
  });

  it("adds up across fields, because each is different ground", () => {
    const r = weedArea([
      ann({ field_id: "f1", task_id: "s1", area_hectares: 2 }),
      ann({ field_id: "f2", task_id: "s2", area_hectares: 3 }),
    ], [
      scan("s1", "f1", "2026-06-01T00:00:00Z"),
      scan("s2", "f2", "2026-06-01T00:00:00Z"),
    ]);
    expect(r).toEqual({ hectares: 5, fields: 2, zones: 2 });
  });

  it("keeps a finding from an older scan when the newest one has none", () => {
    // A scan uploaded this morning and not yet reviewed must not erase a
    // finding from last week that is still in the ground.
    const r = weedArea([
      ann({ task_id: "reviewed", area_hectares: 4 }),
    ], [
      scan("reviewed", "f1", "2026-06-01T00:00:00Z"),
      scan("brand-new", "f1", "2026-09-01T00:00:00Z"),
    ]);
    expect(r.hectares).toBe(4);
  });

  it("falls back to the annotations' own dates when the scan rows are missing", () => {
    // Degrade to a reasonable answer rather than to nothing.
    const r = weedArea([
      ann({ task_id: "older", area_hectares: 9, created_at: "2026-01-01T00:00:00Z" }),
      ann({ task_id: "newer", area_hectares: 2, created_at: "2026-07-01T00:00:00Z" }),
    ], []);
    expect(r.hectares).toBe(2);
  });

  it("says nothing rather than zero when no scan has been reviewed", () => {
    // Zero is a finding: it says the operator looked and found nothing. Null
    // says nobody has looked. The card shows a dash for the second.
    expect(weedArea([])).toEqual({ hectares: null, fields: 0, zones: 0 });
    expect(weedArea([ann({ name: "Wet corner", issue_type: "Drainage" })]).hectares).toBeNull();
  });

  it("does not let a missing or broken area quietly become a number", () => {
    const r = weedArea([
      ann({ area_hectares: null }),
      ann({ area_hectares: "2.5" }),
      ann({ area_hectares: -4 }),
    ]);
    // Postgres numerics arrive as strings, a null area is unknown rather than
    // zero, and a negative one is corrupt. None of them may inflate the total.
    expect(r.hectares).toBe(2.5);
    expect(r.zones).toBe(3);
  });

  it("ignores annotations with no field, which cannot be attributed", () => {
    expect(weedArea([ann({ field_id: null, area_hectares: 7 })]).hectares).toBeNull();
  });
});

describe("missions ready", () => {
  const now = new Date("2026-09-24T12:00:00Z");
  const m = (scheduledAt: string, status = "scheduled"): MissionRow => ({ status, scheduledAt });

  it("counts a mission scheduled for later today", () => {
    // Boundary case worth pinning: "today" is the whole day, not this instant.
    // A mission booked for 09:00 has not been flown just because it is noon.
    expect(missionsReady([m("2026-09-24T09:00:00Z")], now)).toBe(1);
    expect(missionsReady([m("2026-09-24T18:00:00Z")], now)).toBe(1);
  });

  it("counts missions still ahead", () => {
    expect(missionsReady([
      m("2026-09-25T09:00:00Z"),
      m("2026-11-01T09:00:00Z"),
    ], now)).toBe(2);
  });

  it("does not count a mission whose slot has passed", () => {
    // The app never writes a completed status, so a past slot is the only
    // completion signal there is. Documented, and it is a judgement.
    expect(missionsReady([m("2026-09-23T09:00:00Z")], now)).toBe(0);
  });

  it("does not count a mission in any other state", () => {
    expect(missionsReady([m("2026-11-01T09:00:00Z", "cancelled")], now)).toBe(0);
    expect(missionsReady([m("2026-11-01T09:00:00Z", "completed")], now)).toBe(0);
  });

  it("does not count a row with an unreadable date", () => {
    expect(missionsReady([m("not a date")], now)).toBe(0);
    expect(missionsReady([m("")], now)).toBe(0);
  });

  it("is zero, not an error, on an empty schedule", () => {
    expect(missionsReady([], now)).toBe(0);
  });
});
