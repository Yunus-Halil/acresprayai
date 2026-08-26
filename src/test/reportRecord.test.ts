// The spray report's honesty rules, tested at the source.
//
// The regression that motivates every case here: a scan with no analysis once
// rendered "100.00% of field stays unsprayed" in a green success bar — a null
// presented as an agronomic finding on a legal record. The functions under
// test are the single place those states are decided.
import { describe, expect, it } from "vitest";
import {
  type ApplicationRecord, EMPTY_RECORD,
  bannerFor, computedRateLPerAc, missingRecordFields, missionDateError,
  summariseZones, volumeZoneNote, zoneDetailCsv,
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

    // Post-flight with no applied volume logged: the projection may show,
    // but SAID as a projection — never as measured performance.
    const post = bannerFor({
      ...base, hasAnalysis: true, source: "grid", zoneCount: 3, targetedAcres: 2.4,
      isPostFlight: true, savingsPct: 78,
    });
    expect(post.tone).toBe("success");
    expect(post.big).toBe("78% less chemical planned");
    expect(post.note).toMatch(/projection, not measured performance/i);
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

describe("a verifiable, record-gated savings banner", () => {
  const base = {
    hasAnalysis: true, source: "grid" as const, zoneCount: 3,
    targetedAcres: 6.25, fieldAcres: 11.07,
    isPostFlight: true, savingsPct: 40,
  };
  const chem = { planned: "2.5 gal", fullField: "29.5 gal", baselineRate: "2.7 gal/ac" };

  it("without a logged volume, the projection is labelled as a projection", () => {
    const b = bannerFor({ ...base, chemical: chem });
    expect(b.big).toBe("40% less chemical planned");
    expect(b.sub).toBe("2.5 gal planned vs 29.5 gal whole-field at 2.7 gal/ac");
    expect(b.note).toMatch(/projection, not measured performance/i);
    // Never the acreage subtitle that contradicted the rate-weighted figure.
    expect(b.sub).not.toMatch(/6\.25|11\.07|ac total/);
  });

  it("with a logged volume, the claim rests on the RECORD, not the plan", () => {
    // The reported contradiction: 2.5 gal planned, 10.6 gal applied. The old
    // banner said "91% less chemical" from the plan. Now: actual vs baseline.
    const b = bannerFor({
      ...base,
      chemical: { ...chem, applied: "10.6 gal", appliedSavingsPct: 64, exceededBaseline: false },
    });
    expect(b.tone).toBe("success");
    expect(b.big).toBe("64% less chemical");
    expect(b.sub).toBe("10.6 gal applied vs 29.5 gal whole-field at 2.7 gal/ac");
    expect(b.big).not.toMatch(/91/);
  });

  it("claims NO savings when the applied volume meets or exceeds the baseline", () => {
    const b = bannerFor({
      ...base,
      chemical: { ...chem, applied: "31.0 gal", appliedSavingsPct: 0, exceededBaseline: true },
    });
    expect(b.tone).toBe("none");
    expect(b.big).toMatch(/exceeded the whole-field baseline/i);
    expect(b.big).not.toMatch(/%/);
    expect(b.note).toMatch(/No savings figure is claimed/i);
  });
});

describe("the zone summary a grower actually reads", () => {
  const rows = [
    { id: "g:1:1", issue: "Weed pressure", acres: 0.5, rateLha: 25, flown: true },
    { id: "g:1:2", issue: "Weed pressure", acres: 0.3, rateLha: 25, flown: true },
    { id: "g:2:1", issue: "Weed pressure", acres: 0.2, rateLha: 40, flown: false },
    { id: "g:3:1", issue: "", acres: 0.1, rateLha: 15, flown: true },
    { id: "g:3:2", issue: "Unclassified", acres: 0.1, rateLha: 15, flown: false },
  ];

  it("groups by classification and rate instead of enumerating cells", () => {
    const s = summariseZones(rows, 11.07);
    expect(s.groups).toHaveLength(3);
    const weed25 = s.groups.find(g => g.label === "Weed pressure" && g.rateLha === 25)!;
    expect(weed25.acres).toBeCloseTo(0.8);
    expect(weed25.count).toBe(2);
    expect(weed25.flownState).toBe("all");
    const weed40 = s.groups.find(g => g.rateLha === 40)!;
    expect(weed40.flownState).toBe("none");
    // Blank and explicit "Unclassified" are the same group, said once.
    const uncl = s.groups.find(g => g.label === "Unclassified")!;
    expect(uncl.count).toBe(2);
    expect(uncl.flownState).toBe("partial");
    expect(uncl.flownCount).toBe(1);
  });

  it("totals let the reader tie the banner back to acres", () => {
    const s = summariseZones(rows, 11.07);
    expect(s.totals.treatedAcres).toBeCloseTo(1.2);
    expect(s.totals.untreatedAcres).toBeCloseTo(11.07 - 1.2);
    expect(s.totals.fieldAcres).toBeCloseTo(11.07);
    expect(s.totals.zoneCount).toBe(5);
    expect(s.totals.flownCount).toBe(3);
  });

  it("says all-unclassified once, not once per row", () => {
    const uncl = rows.map(r => ({ ...r, issue: "" }));
    expect(summariseZones(uncl, 11.07).allUnclassified).toBe(true);
    expect(summariseZones(rows, 11.07).allUnclassified).toBe(false);
    expect(summariseZones([], 11.07).allUnclassified).toBe(false);
  });
});

describe("the CSV twin of the appendix", () => {
  it("carries every zone with escaping, never a summarised row", () => {
    const csv = zoneDetailCsv([
      { id: "g:1:1", issue: 'Weed, "resistant"', acres: 0.51234, rateLha: 25, flown: true },
      { id: "g:2:1", issue: "", acres: 0.1, rateLha: null, flown: false },
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("zone_id,classification,acres,rate_l_per_ha,flown");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Weed, ""resistant"""');
    expect(lines[1]).toContain("0.5123");
    expect(lines[2]).toContain("Unclassified");
    expect(lines[2]).toMatch(/,,no$/);
  });
});
