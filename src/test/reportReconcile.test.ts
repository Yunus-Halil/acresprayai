// The reconciliation pass, tested against the report that motivated it.
//
// A real generated document claimed "91% less chemical, 2.5 gal planned"
// beside a record of 10.6 gal applied, a computed rate 5.5× baseline, two
// different treated acreages, and 97 °F / 11 mph with no comment. Every case
// here is one of those, generalised: figures that disagree must surface, in
// plain words, and no rule may block generation or pick a winner.
import { describe, expect, it } from "vitest";
import {
  AREA_TOLERANCE, RATE_BASELINE_RATIO, TEMP_LIMIT_F, VOLUME_PLAN_TOLERANCE, WIND_LIMIT_MPH,
  areaMismatchNote, conditionFlags, endBeforeStartNote, modelConditionFlags,
  overTankCapacityNote, rateVsBaselineNote, reconcileReport, volumeVsPlanNote,
} from "@/lib/reportReconcile";
import { AC_PER_HA, L_PER_US_GAL } from "@/lib/units";

const gal = (l: number) => `${(l / L_PER_US_GAL).toFixed(1)} gal`;
const ac = (a: number) => `${a.toFixed(2)} ac`;
const ratePerAc = (l: number) => `${(l / L_PER_US_GAL).toFixed(2)} gal/ac`;

describe("volume vs plan", () => {
  it("flags the reported case: 10.6 gal applied against 2.5 gal planned", () => {
    const note = volumeVsPlanNote(10.6 * L_PER_US_GAL, 2.5 * L_PER_US_GAL, gal)!;
    expect(note).toMatch(/ABOVE the planned/);
    expect(note).toMatch(/4\.2× plan/);
  });

  it("stays quiet inside the ±20% tolerance, and speaks just past it", () => {
    expect(volumeVsPlanNote(11.9, 10, gal)).toBeNull();
    expect(volumeVsPlanNote(12.5, 10, gal)).toMatch(/ABOVE/);
    expect(volumeVsPlanNote(7.5, 10, gal)).toMatch(/below the planned/);
    expect(VOLUME_PLAN_TOLERANCE).toBe(0.2);
  });

  it("claims nothing when either figure is absent", () => {
    expect(volumeVsPlanNote(null, 10, gal)).toBeNull();
    expect(volumeVsPlanNote(10, null, gal)).toBeNull();
    expect(volumeVsPlanNote(10, 0, gal)).toBeNull();
  });
});

describe("rate vs baseline", () => {
  it("flags the reported case: 15.14 gal/ac against a 2.67 gal/ac baseline", () => {
    const computed = 15.14 * L_PER_US_GAL;              // L per acre
    const baselineLha = 2.67 * L_PER_US_GAL * AC_PER_HA; // back to L/ha
    const note = rateVsBaselineNote(computed, baselineLha, ratePerAc)!;
    expect(note).toMatch(/5\.7× the configured baseline|5\.6× the configured baseline/);
    expect(note).toMatch(/verify/i);
  });

  it("is quiet below the ratio threshold", () => {
    const baselineLha = 25;
    const justUnder = (baselineLha / AC_PER_HA) * (RATE_BASELINE_RATIO - 0.1);
    expect(rateVsBaselineNote(justUnder, baselineLha, ratePerAc)).toBeNull();
  });
});

describe("marked vs logged treated area", () => {
  it("flags the reported case: 0.95 ac marked, 0.70 ac treated, all zones flown", () => {
    const note = areaMismatchNote(0.95, 0.7, 6, 6, ac)!;
    expect(note).toMatch(/0\.70 ac/);
    expect(note).toMatch(/0\.95 ac/);
    expect(note).toMatch(/different measurements/i);
    expect(note).toMatch(/never interchanged/i);
  });

  it("does not fire while zones remain unflown — a partial mission SHOULD differ", () => {
    expect(areaMismatchNote(0.95, 0.4, 3, 6, ac)).toBeNull();
  });

  it("tolerates measurement noise at full completion", () => {
    expect(areaMismatchNote(1.0, 1 - AREA_TOLERANCE + 0.01, 6, 6, ac)).toBeNull();
  });
});

describe("time and capacity", () => {
  it("catches an end before its start, and a zero-minute application", () => {
    expect(endBeforeStartNote("16:00", "15:30")).toMatch(/before its start/);
    expect(endBeforeStartNote("16:00", "16:00")).toMatch(/zero-minute/);
    expect(endBeforeStartNote("15:00", "16:30")).toBeNull();
    expect(endBeforeStartNote(null, "16:30")).toBeNull();
  });

  it("catches a volume no number of fills could hold", () => {
    expect(overTankCapacityNote(100, 30, 2, gal)).toMatch(/exceeds what 3 tank loads/);
    expect(overTankCapacityNote(89, 30, 2, gal)).toBeNull();
  });
});

describe("condition flags", () => {
  it("flags the reported 11 mph / 97 °F, without judging compliance", () => {
    const flags = conditionFlags(11, 97);
    expect(flags).toHaveLength(2);
    for (const f of flags) {
      expect(f).toMatch(/outside typical application conditions/i);
      expect(f).toMatch(/verify against the product label/i);
      expect(f).not.toMatch(/non-compliant|violation|illegal/i);
    }
  });

  it("is quiet at the limits themselves", () => {
    expect(conditionFlags(WIND_LIMIT_MPH, TEMP_LIMIT_F)).toHaveLength(0);
    expect(conditionFlags(null, null)).toHaveLength(0);
  });
});

describe("the full pass over the reported document", () => {
  it("surfaces all four contradictions at once, blocking nothing", () => {
    const notes = reconcileReport({
      plannedL: 2.5 * L_PER_US_GAL,
      appliedL: 10.6 * L_PER_US_GAL,
      baselineLha: 2.67 * L_PER_US_GAL * AC_PER_HA,
      computedRateLPerAc: (10.6 * L_PER_US_GAL) / 0.7,
      markedAcres: 0.95,
      loggedTreatedAcres: 0.7,
      zonesFlown: 6,
      zonesTotal: 6,
      windMph: 11,
      tempF: 97,
      startTime: null,
      endTime: null,
      fmtVolume: gal,
      fmtAcres: ac,
      fmtRatePerAc: ratePerAc,
    });
    const kinds = notes.map(n => n.kind);
    expect(kinds).toContain("volume-vs-plan");
    expect(kinds).toContain("rate-vs-baseline");
    expect(kinds).toContain("area-mismatch");
    expect(kinds.filter(k => k === "conditions")).toHaveLength(2);
  });

  it("a consistent mission produces zero notes", () => {
    const notes = reconcileReport({
      plannedL: 40, appliedL: 42, baselineLha: 25,
      computedRateLPerAc: 42 / 3.8, markedAcres: 3.9, loggedTreatedAcres: 3.8,
      zonesFlown: 6, zonesTotal: 6, windMph: 6, tempF: 74,
      startTime: "07:30", endTime: "08:10",
      fmtVolume: gal, fmtAcres: ac, fmtRatePerAc: ratePerAc,
    });
    expect(notes).toEqual([]);
  });
});

describe("operator-configured limits", () => {
  it("flags against the operator's thresholds, not the hardcoded defaults", () => {
    const limits = { wind_mph: 6, temp_f: 75 };
    // 8 mph / 80 F: quiet on defaults, flagged for an orchard operator.
    expect(conditionFlags(8, 80)).toHaveLength(0);
    const flagged = conditionFlags(8, 80, limits);
    expect(flagged).toHaveLength(2);
    expect(flagged[0]).toMatch(/above 6 mph/);
    expect(flagged[1]).toMatch(/above 75/);
  });
});

describe("station data speaks even when the operator recorded different values", () => {
  const check = {
    wind_mph: 14, temp_f: 97, station: "KMIC", distance_mi: 4.2,
  };

  it("flags fetched conditions with the station named, no compliance claim", () => {
    const flags = modelConditionFlags(check);
    expect(flags).toHaveLength(2);
    for (const f of flags) {
      expect(f).toMatch(/KMIC, 4\.2 mi/);
      expect(f).toMatch(/verify against the product label/i);
      expect(f).not.toMatch(/non-compliant|violation/i);
    }
  });

  it("runs in the full pass alongside the operator's own values", () => {
    const notes = reconcileReport({
      plannedL: 40, appliedL: 42, baselineLha: 25,
      computedRateLPerAc: 42 / 3.8, markedAcres: 3.9, loggedTreatedAcres: 3.8,
      zonesFlown: 6, zonesTotal: 6,
      // Operator recorded calm conditions; the station disagreed.
      windMph: 5, tempF: 74,
      startTime: "07:30", endTime: "08:10",
      modelCheck: check,
      fmtVolume: gal, fmtAcres: ac, fmtRatePerAc: ratePerAc,
    });
    expect(notes.filter(n => n.kind === "conditions")).toHaveLength(2);
    expect(notes[0].message).toMatch(/Station data/);
  });
});

describe("the area note names the time skew when the grid moved on", () => {
  it("says the grid was edited after logging when the timestamps show it", () => {
    const notes = reconcileReport({
      plannedL: null, appliedL: null, baselineLha: 25, computedRateLPerAc: null,
      markedAcres: 0.95, loggedTreatedAcres: 0.7, zonesFlown: 6, zonesTotal: 6,
      windMph: null, tempF: null, startTime: null, endTime: null,
      assessedAt: "2026-08-25T18:00:00Z", loggedAt: "2026-08-20T12:00:00Z",
      fmtVolume: gal, fmtAcres: ac, fmtRatePerAc: ratePerAc,
    });
    const area = notes.find(n => n.kind === "area-mismatch")!;
    expect(area.message).toMatch(/edited since this mission was logged/i);
    expect(area.message).toMatch(/marked area reflects today's grid/i);
  });
});
