// What the spray report may claim, and what it must admit is missing.
//
// This report is handed to growers and kept as a legal application record, so
// its states are decided here, in plain functions, rather than inline in the
// PDF layout code. The rule that governs all of them: a number that looks
// measured and isn't is worse than a visible blank. Nulls render as labelled
// gaps, never as zeros, and "no analysis was run" is never allowed to wear the
// styling of a finding.

export type ApplicationRecordDefaults = {
  grower_name: string;
  product_name: string;
  epa_reg_no: string;
  applicator_cert_no: string;
  part137_cert_no: string;
};

/** Observed at application time. Entered by the applicator; never backfilled
 *  from a forecast API and presented as observed conditions.
 *  TODO(field-capture): capture these automatically at mission time from an
 *  on-site source, stamped with observation time — until then they are manual. */
export type ApplicationConditions = {
  start_time: string | null;
  end_time: string | null;
  wind_speed_mph: number | null;
  wind_direction: string | null;
  temperature_f: number | null;
};

export type ApplicationRecord = ApplicationRecordDefaults & ApplicationConditions;

export const EMPTY_RECORD: ApplicationRecord = {
  grower_name: "", product_name: "", epa_reg_no: "",
  applicator_cert_no: "", part137_cert_no: "",
  start_time: null, end_time: null,
  wind_speed_mph: null, wind_direction: null, temperature_f: null,
};

export const WIND_DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

// ---------------------------------------------------------------------------
// The result banner
// ---------------------------------------------------------------------------

export type BannerTone = "none" | "clean" | "success";
export type Banner = {
  tone: BannerTone;
  big: string;
  sub: string;
  /** Extra sentence stating what the banner is NOT claiming, when needed. */
  note: string | null;
};

const ac = (n: number) => `${n.toFixed(2)} ac`;

/**
 * Decides the one banner the report shows.
 *
 * The failure this prevents shipped once: a scan nobody analyzed rendered
 * "100.00% of field stays unsprayed" in a full-width green success bar — a
 * null presented as a positive agronomic finding, over a pilot's name.
 *
 *   - no analysis       → neutral, explicitly not a finding of zero
 *   - analyzed, clean   → its own state; a real result, worded as one
 *   - analyzed, zones   → the only state that earns success styling
 */
export function bannerFor(input: {
  hasAnalysis: boolean;
  zoneCount: number;
  targetedAcres: number;
  fieldAcres: number;
  /** True when a mission for THIS scan has been logged. */
  isPostFlight: boolean;
  savingsPct: number;
}): Banner {
  if (!input.hasAnalysis) {
    return {
      tone: "none",
      big: "No analysis run — treatment area not determined",
      sub: "This scan's imagery has not been analyzed.",
      note: "This is not a finding of zero treatment need. No spray recommendation is made or implied.",
    };
  }
  if (input.zoneCount === 0) {
    return {
      tone: "clean",
      big: "Analysis found no areas requiring targeted treatment",
      sub: `Computed over ${ac(input.fieldAcres)} of imaged field.`,
      note: null,
    };
  }
  if (input.isPostFlight) {
    return {
      tone: "success",
      big: `${input.savingsPct}% less chemical`,
      sub: `vs. full-field spraying, across ${ac(input.targetedAcres)} of ${ac(input.fieldAcres)} total`,
      note: null,
    };
  }
  return {
    tone: "success",
    big: `Targeting ${ac(input.targetedAcres)} of ${ac(input.fieldAcres)}`,
    sub: "Computed treatment area from this scan's analysis.",
    note: null,
  };
}

// ---------------------------------------------------------------------------
// Preconditions: what makes a report FINAL rather than DRAFT
// ---------------------------------------------------------------------------

/**
 * Every field a complete application record requires, with human labels.
 * A report generated with any of these missing carries a DRAFT — INCOMPLETE
 * watermark on every page, and each gap renders labelled in the danger colour
 * instead of being silently dropped from the layout.
 */
export function missingRecordFields(input: {
  hasAnalysis: boolean;
  fieldAcres: number;
  volumeAppliedL: number | null;
  missionLogged: boolean;
  record: ApplicationRecord | null;
}): string[] {
  const r = input.record;
  const missing: string[] = [];
  if (!input.hasAnalysis) missing.push("Imagery analysis");
  if (input.fieldAcres <= 0) missing.push("Field boundary");
  if (!input.missionLogged) missing.push("Logged mission");
  if (input.volumeAppliedL == null) missing.push("Volume applied");
  if (!r?.grower_name.trim()) missing.push("Grower / customer name");
  if (!r?.product_name.trim()) missing.push("Product name");
  if (!r?.epa_reg_no.trim()) missing.push("EPA registration number");
  if (!r?.start_time) missing.push("Application start time");
  if (!r?.end_time) missing.push("Application end time");
  if (r?.wind_speed_mph == null) missing.push("Wind speed");
  if (!r?.wind_direction) missing.push("Wind direction");
  if (r?.temperature_f == null) missing.push("Temperature");
  if (!r?.applicator_cert_no.trim()) missing.push("Applicator certification number");
  if (!r?.part137_cert_no.trim()) missing.push("Part 137 certificate number");
  return missing;
}

// ---------------------------------------------------------------------------
// Validation and reconciliation
// ---------------------------------------------------------------------------

/** A mission cannot have been flown after the report generating it. */
export function missionDateError(missionDate: string, today: Date = new Date()): string | null {
  if (!missionDate) return "Mission date is required.";
  const d = new Date(`${missionDate}T00:00`);
  if (Number.isNaN(d.getTime())) return "Mission date is not a valid date.";
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
  if (d.getTime() > end.getTime()) {
    return "Mission date is after the report date. A mission cannot be logged before it was flown.";
  }
  return null;
}

/**
 * Says out loud when logged volume and zone completion disagree.
 *
 * A nonzero applied volume with no zones marked complete is possible — the
 * pilot logged the tank but skipped the checklist — but the report must not
 * print both numbers side by side as if they agree.
 */
export function volumeZoneNote(input: {
  volumeAppliedL: number | null;
  zonesFlown: number;
  zonesTotal: number;
  hasAnalysis: boolean;
}): string | null {
  if (input.volumeAppliedL == null || input.volumeAppliedL <= 0) return null;
  if (!input.hasAnalysis) {
    return "Volume was logged, but no imagery analysis exists for this scan, so it cannot be attributed to treatment zones.";
  }
  if (input.zonesFlown === 0) {
    return "Volume was logged, but no treatment zone was marked completed in the mission log. Verify the mission log before relying on either figure.";
  }
  return null;
}

/**
 * The actual application rate: logged volume over logged treated area. A real
 * division of two logged values — or null, never a default presented as a
 * measurement.
 */
export function computedRateLPerAc(
  volumeAppliedL: number | null,
  acresTreated: number | null,
): number | null {
  if (volumeAppliedL == null || volumeAppliedL <= 0) return null;
  if (acresTreated == null || acresTreated <= 0) return null;
  return volumeAppliedL / acresTreated;
}
