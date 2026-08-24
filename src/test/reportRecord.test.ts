// The spray report's honesty rules, tested at the source.
//
// The regression that motivates every case here: a scan with no analysis once
// rendered "100.00% of field stays unsprayed" in a green success bar — a null
// presented as an agronomic finding on a legal record. The functions under
// test are the single place those states are decided.
import { describe, expect, it } from "vitest";
import {
  type ApplicationRecord, EMPTY_RECORD,
  bannerFor, computedRateLPerAc, missingRecordFields, missionDateError, volumeZoneNote,
} from "@/lib/reportRecord";

const COMPLETE_RECORD: ApplicationRecord = {
  grower_name: "Hutchins Family Farms",
  product_name: "Example herbicide 2,4-D",
  epa_reg_no: "1234-56",
  applicator_cert_no: "AC-9876",
  part137_cert_no: "137-0042",
  start_time: "07:30",
  end_time: "08:10",
  wind_speed_mph: 4.5,
  wind_direction: "NW",
  temperature_f: 68,
};

describe("the result banner", () => {
  const base = { targetedAcres: 0, fieldAcres: 11.07, isPostFlight: false, savingsPct: 0 };

  it("renders NO ASSESSMENT as neutral, explicitly not a finding of zero", () => {
    const b = bannerFor({ ...base, hasAnalysis: false, zoneCount: 0 });
    expect(b.tone).toBe("none");
    expect(b.big).toMatch(/No assessment/i);
    expect(b.big).toMatch(/not determined/i);
    expect(b.note).toMatch(/not a finding of zero/i);
    expect(b.note).toMatch(/No spray recommendation/i);
    // Never the old fabrications, in any field of the banner.
    for (const s of [b.big, b.sub, b.note ?? ""]) {
      expect(s).not.toMatch(/unsprayed|%|less chemical/i);
    }
  });

  it("assessed-and-clean is its own state, not success styling and not absence", () => {
    const b = bannerFor({ ...base, hasAnalysis: true, source: "grid", zoneCount: 0 });
    expect(b.tone).toBe("clean");
    expect(b.big).toMatch(/nothing marked for treatment/i);
  });

  it("reserves success styling for a grid assessment with marked zones", () => {
    const pre = bannerFor({ ...base, hasAnalysis: true, source: "grid", zoneCount: 3, targetedAcres: 2.4 });
    expect(pre.tone).toBe("success");
    expect(pre.big).toMatch(/Targeting 2\.40 ac of 11\.07 ac/);

    const post = bannerFor({
      ...base, hasAnalysis: true, source: "grid", zoneCount: 3, targetedAcres: 2.4,
      isPostFlight: true, savingsPct: 78,
    });
    expect(post.tone).toBe("success");
    expect(post.big).toBe("78% less chemical");
  });

  it("labels a legacy result as the retired path's output, never as success", () => {
    const b = bannerFor({ ...base, hasAnalysis: true, source: "legacy", zoneCount: 3, targetedAcres: 2.4 });
    expect(b.tone).toBe("legacy");
    expect(b.big).toMatch(/Legacy analysis/i);
    expect(b.sub).toMatch(/retired vision-analysis system/i);
    expect(b.note).toMatch(/Re-assess/i);
  });

  it("states areas in acres, never square feet", () => {
    const b = bannerFor({ ...base, hasAnalysis: true, source: "grid", zoneCount: 1, targetedAcres: 0.008 });
    expect(b.big).toContain("0.01 ac");
    expect(b.big).not.toMatch(/ft/);
  });
});

describe("what makes a report FINAL", () => {
  const complete = {
    hasAnalysis: true,
    fieldAcres: 11.07,
    volumeAppliedL: 12.5,
    missionLogged: true,
    record: COMPLETE_RECORD,
  };

  it("a complete record is missing nothing", () => {
    expect(missingRecordFields(complete)).toEqual([]);
  });

  it("names every gap, analysis and record fields alike", () => {
    const m = missingRecordFields({
      hasAnalysis: false, fieldAcres: 0, volumeAppliedL: null,
      missionLogged: false, record: EMPTY_RECORD,
    });
    for (const label of [
      "Treatment grid assessment", "Field boundary", "Logged mission", "Volume applied",
      "Grower / customer name", "Product name", "EPA registration number",
      "Application start time", "Application end time",
      "Wind speed", "Wind direction", "Temperature",
      "Applicator certification number", "Part 137 certificate number",
    ]) {
      expect(m).toContain(label);
    }
  });

  it("one blank certificate is enough to make it a draft", () => {
    const m = missingRecordFields({
      ...complete, record: { ...COMPLETE_RECORD, part137_cert_no: "  " },
    });
    expect(m).toEqual(["Part 137 certificate number"]);
  });
});

describe("mission date validation", () => {
  const today = new Date("2026-08-24T12:00:00");

  it("rejects a mission dated after the report", () => {
    expect(missionDateError("2027-04-24", today)).toMatch(/after the report date/i);
    expect(missionDateError("2026-08-25", today)).toMatch(/after the report date/i);
  });

  it("accepts today and the past", () => {
    expect(missionDateError("2026-08-24", today)).toBeNull();
    expect(missionDateError("2026-04-24", today)).toBeNull();
  });

  it("rejects the empty and the unparseable", () => {
    expect(missionDateError("", today)).toMatch(/required/i);
    expect(missionDateError("not-a-date", today)).toMatch(/not a valid date/i);
  });
});

describe("volume vs zones reconciliation", () => {
  it("logged volume with zero zones flown gets an explanation, not silence", () => {
    const note = volumeZoneNote({ volumeAppliedL: 12.5, zonesFlown: 0, zonesTotal: 3, hasAnalysis: true });
    expect(note).toMatch(/no treatment zone was marked completed/i);
  });

  it("logged volume with no analysis says it cannot be attributed", () => {
    const note = volumeZoneNote({ volumeAppliedL: 12.5, zonesFlown: 0, zonesTotal: 0, hasAnalysis: false });
    expect(note).toMatch(/cannot be attributed/i);
  });

  it("stays quiet when the numbers agree", () => {
    expect(volumeZoneNote({ volumeAppliedL: 12.5, zonesFlown: 2, zonesTotal: 3, hasAnalysis: true })).toBeNull();
    expect(volumeZoneNote({ volumeAppliedL: null, zonesFlown: 0, zonesTotal: 3, hasAnalysis: true })).toBeNull();
  });
});

describe("computed application rate", () => {
  it("is a real division of logged values", () => {
    expect(computedRateLPerAc(25, 5)).toBeCloseTo(5);
  });

  it("is null, never a default, when either input is missing or zero", () => {
    expect(computedRateLPerAc(null, 5)).toBeNull();
    expect(computedRateLPerAc(25, null)).toBeNull();
    expect(computedRateLPerAc(25, 0)).toBeNull();
    expect(computedRateLPerAc(0, 5)).toBeNull();
  });
});
