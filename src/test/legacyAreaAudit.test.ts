// The pre-fix acreage flag: records are marked, never rewritten.
//
// From 2026-08-20 (grid zones entered the flight plan, 166222b) to 2026-08-26
// (fix, 309d3e0), Log Flight re-derived grid-zone areas from the traced ring
// instead of the carried clipped areaM2 — inflating `acres_treated` for those
// missions (measured: ~0% interior-only, 10–20% full-coverage, up to ~2.5×
// for boundary slivers). The stored number stays exactly as recorded; the
// predicate here decides which records get the disclosure, on the Flight Log
// and in the report's reconciliation notes.
import { describe, expect, it } from "vitest";
import {
  LEGACY_AREA_NOTE, RING_AREA_BUG_FROM, RING_AREA_FIX_AT, acreageFromBuggyPath,
} from "@/lib/legacyAreaAudit";
import { reconcileReport } from "@/lib/reportReconcile";

const IN_WINDOW = "2026-08-23T12:00:00Z";
const gridLog = (over: Record<string, unknown> = {}) => ({
  created_at: IN_WINDOW,
  acres_treated: 0.95,
  zones_completed: ["grid:abc:3:4", "grid:abc:5:4"],
  ...over,
});

describe("which records the flag catches", () => {
  it("a grid-zone mission logged inside the window", () => {
    expect(acreageFromBuggyPath(gridLog())).toBe(true);
    expect(acreageFromBuggyPath(gridLog({ zones_completed: ["block:g:0:0:4x2"] }))).toBe(true);
  });

  it("nothing outside the window — the bug did not exist yet, or was fixed", () => {
    expect(acreageFromBuggyPath(gridLog({ created_at: "2026-08-19T00:00:00Z" }))).toBe(false);
    expect(acreageFromBuggyPath(gridLog({ created_at: RING_AREA_FIX_AT }))).toBe(false);
    expect(acreageFromBuggyPath(gridLog({ created_at: "2026-09-01T00:00:00Z" }))).toBe(false);
    // The boundaries themselves: the very first buggy moment is included.
    expect(acreageFromBuggyPath(gridLog({ created_at: RING_AREA_BUG_FROM }))).toBe(true);
  });

  it("not AI or user zones — their ring was always their only measure", () => {
    expect(acreageFromBuggyPath(gridLog({ zones_completed: ["ai-1", "user:xyz"] }))).toBe(false);
  });

  it("not a mission with no acreage, no zones, or no timestamp", () => {
    expect(acreageFromBuggyPath(gridLog({ acres_treated: null }))).toBe(false);
    expect(acreageFromBuggyPath(gridLog({ zones_completed: [] }))).toBe(false);
    expect(acreageFromBuggyPath(gridLog({ zones_completed: null }))).toBe(false);
    expect(acreageFromBuggyPath(gridLog({ created_at: null }))).toBe(false);
    expect(acreageFromBuggyPath(null)).toBe(false);
  });
});

describe("the report's reconciliation pass carries the disclosure", () => {
  const base = {
    plannedL: null, appliedL: null, baselineLha: 25, computedRateLPerAc: null,
    markedAcres: null, loggedTreatedAcres: 0.95, zonesFlown: 6, zonesTotal: 6,
    windMph: null, tempF: null, startTime: null, endTime: null,
    fmtVolume: (l: number) => `${l} L`,
    fmtAcres: (a: number) => `${a} ac`,
    fmtRatePerAc: (r: number) => `${r} L/ac`,
  };

  it("a pre-fix mission prints the note, first, in plain words", () => {
    const notes = reconcileReport({ ...base, log: gridLog() });
    expect(notes[0].kind).toBe("legacy-area");
    expect(notes[0].message).toBe(LEGACY_AREA_NOTE);
    expect(LEGACY_AREA_NOTE).toMatch(/kept exactly as recorded/);
    expect(LEGACY_AREA_NOTE).toMatch(/over-counts zones at the field edge/);
    // It names the direction of the rate error too — understated, because
    // the divisor was inflated.
    expect(LEGACY_AREA_NOTE).toMatch(/understated/);
  });

  it("a post-fix mission prints nothing extra", () => {
    const notes = reconcileReport({ ...base, log: gridLog({ created_at: "2026-08-27T00:00:00Z" }) });
    expect(notes.find(n => n.kind === "legacy-area")).toBeUndefined();
  });

  it("no mission handed in at all — the pass stays silent about it", () => {
    expect(reconcileReport(base).find(n => n.kind === "legacy-area")).toBeUndefined();
  });
});
