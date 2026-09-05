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
/**
 * Where a condition value came from. "observed" = the applicator entered what
 * they saw on site. The model shape carries the NOAA station and its distance,
 * because a station observation is NOT an observed condition — an airport
 * anemometer miles from the field, not boom height over the crop — and it must
 * never print without saying so.
 */
export type ConditionSource =
  | "observed"
  | { kind: "model"; provider: string; station: string; distance_mi: number; observed_at: string };

/** A fetched station observation, kept on the record whether or not the
 *  operator accepted it — condition flagging runs on it either way. */
export type ModelConditionCheck = {
  provider: string;
  station: string;
  station_name?: string;
  distance_mi: number;
  observed_at: string;
  wind_mph: number | null;
  wind_dir?: string | null;
  temp_f: number | null;
  fetched_at: string;
};

export type ApplicationConditions = {
  start_time: string | null;
  end_time: string | null;
  wind_speed_mph: number | null;
  wind_direction: string | null;
  temperature_f: number | null;
  /**
   * Legacy single stamp from before per-value provenance; readers fall back
   * to it. Absent entirely on records made before provenance existed; those
   * print unlabelled rather than being stamped with a provenance nobody
   * recorded.
   */
  conditions_source?: "observed" | null;
  /** Per-value provenance: wind (speed + direction travel together) and
   *  temperature can come from different places — accept the station wind,
   *  type your own thermometer reading — and each is labelled as its own. */
  wind_source?: ConditionSource | null;
  temp_source?: ConditionSource | null;
  /** See ModelConditionCheck — stored on fetch, independent of acceptance. */
  model_check?: ModelConditionCheck | null;
};

/** The provenance label printed beside a condition value. Never empty for a
 *  model value; empty only for pre-provenance records. */
export function conditionSourceLabel(
  src: ConditionSource | null | undefined,
  legacy?: "observed" | null,
): string {
  const s = src ?? legacy ?? null;
  if (!s) return "";
  if (s === "observed") return " (observed)";
  return ` (model data: ${s.station}, ${s.distance_mi.toFixed(1)} mi)`;
}

export type ApplicationRecord = ApplicationRecordDefaults & ApplicationConditions;

export const EMPTY_RECORD: ApplicationRecord = {
  grower_name: "", product_name: "", epa_reg_no: "",
  applicator_cert_no: "", part137_cert_no: "",
  start_time: null, end_time: null,
  wind_speed_mph: null, wind_direction: null, temperature_f: null,
};

export const WIND_DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

// ---------------------------------------------------------------------------
// The savings claim
// ---------------------------------------------------------------------------

/**
 * Why no percentage may be printed.
 *
 * Each of these is a state the document has to be able to be IN, not an error.
 * A report that cannot defend a reduction figure prints the reason instead of
 * the figure — a blank with a sentence beats a number with nothing behind it.
 */
export type SavingsRefusal =
  /** No treatment-grid assessment, so there is no plan to compare. */
  | "no-assessment"
  /** No field boundary area, so the whole-field baseline does not exist. */
  | "no-baseline"
  /** Zones exist but carry no rates, so the planned volume is not a number. */
  | "nothing-planned"
  /** The volume actually applied met or exceeded the whole-field baseline. */
  | "exceeded";

/**
 * The ONE savings decision for a report. Every surface prints this or prints
 * nothing.
 *
 * WHY THIS IS A FUNCTION AND NOT AN EXPRESSION AT EACH CALL SITE. It used to
 * be the latter, and the surfaces drifted exactly as you would expect: the
 * banner was gated on the LOGGED volume — the fix for a report that once read
 * "91% less chemical, 2.5 gal planned" beside a record showing 10.6 gal
 * applied — while the header tile above it and the PDF's chemical block below
 * it both went on printing the plan's projection. One page, three surfaces,
 * two different numbers, and the gate only covered one of them.
 *
 *   measured  — 1 − applied/baseline. A logged volume; the only kind of
 *               figure that may be stated in the past tense.
 *   projected — 1 − planned/baseline. The plan's arithmetic, and it must be
 *               labelled as a projection wherever it appears.
 *   none      — nothing may be printed. `reason` says which wall was hit.
 *
 * Note what "projected" really measures: at a single flat rate it collapses to
 * an AREA ratio — 1 − treated/field — against a whole-field application nobody
 * necessarily intended to make. That is a defensible comparison and it is not
 * a measurement, which is why the wording around it never says "saved".
 */
export type SavingsClaim =
  | { kind: "measured"; pct: number }
  | { kind: "projected"; pct: number }
  | { kind: "none"; reason: SavingsRefusal };

const clampPct = (v: number): number => Math.max(0, Math.min(100, Math.round(v)));

export function savingsClaim(input: {
  /** False for no assessment, or for a legacy result — neither can be priced. */
  hasGridAssessment: boolean;
  /** Sum of (zone area x painted rate), litres. Null when not computable. */
  plannedL: number | null;
  /** The volume the pilot logged, litres. Null until a mission is logged. */
  appliedL: number | null;
  /** Whole field at the baseline rate, litres. */
  fullFieldL: number;
}): SavingsClaim {
  if (!input.hasGridAssessment) return { kind: "none", reason: "no-assessment" };
  if (!(input.fullFieldL > 0)) return { kind: "none", reason: "no-baseline" };

  // A logged volume outranks the plan, always. This is the gate.
  if (input.appliedL != null) {
    if (input.appliedL >= input.fullFieldL) return { kind: "none", reason: "exceeded" };
    return { kind: "measured", pct: clampPct((1 - input.appliedL / input.fullFieldL) * 100) };
  }

  // No planned volume is not "100% saved". Zones with no rates on them price
  // at zero litres, and 1 − 0/baseline is 100 — a fabricated headline off an
  // empty prescription. It is a missing number, and it prints as one.
  if (input.plannedL == null || !(input.plannedL > 0)) {
    return { kind: "none", reason: "nothing-planned" };
  }
  return { kind: "projected", pct: clampPct((1 - input.plannedL / input.fullFieldL) * 100) };
}

/** Headline for a refused claim. Never contains a digit. */
export function savingsRefusalHeadline(reason: SavingsRefusal): string {
  switch (reason) {
    case "no-assessment": return "No reduction figure: treatment area not determined";
    case "no-baseline": return "No reduction figure: no field area to compare against";
    case "nothing-planned": return "No reduction figure: zones carry no rates";
    case "exceeded": return "Application met or exceeded the whole-field baseline";
  }
}

/** The sentence stating what is NOT being claimed, and why. */
export function savingsRefusalNote(reason: SavingsRefusal): string {
  switch (reason) {
    case "no-assessment":
      return "No treatment-grid assessment exists for this scan, so no comparison is made.";
    case "no-baseline":
      return "This field has no boundary area on file, so the whole-field baseline cannot be computed.";
    case "nothing-planned":
      return "The marked zones carry no application rates, so there is no planned volume to compare.";
    case "exceeded":
      return "No reduction figure is claimed for this mission.";
  }
}

/** Four words for a stat tile, naming what the percentage rests on. */
export function savingsBasisLabel(claim: SavingsClaim): string {
  return claim.kind === "measured" ? "Less chemical"
    : claim.kind === "projected" ? "Planned reduction"
    : "Reduction";
}

// ---------------------------------------------------------------------------
// The result banner
// ---------------------------------------------------------------------------

export type BannerTone = "none" | "clean" | "legacy" | "success";
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
 * The failure this prevents shipped once: a scan nobody assessed rendered
 * "100.00% of field stays unsprayed" in a full-width green success bar — a
 * null presented as a positive agronomic finding, over a pilot's name.
 *
 *   - no assessment      → neutral, explicitly not a finding of zero
 *   - assessed, clean    → its own state; a real result, worded as one
 *   - legacy result      → labelled as the retired vision path's output,
 *                          never given success styling — its numbers are not
 *                          the treatment grid's and must not dress like them
 *   - assessed, zones    → the only state that earns success styling
 */
export function bannerFor(input: {
  hasAnalysis: boolean;
  /** "grid" for treatment-grid assessments; "legacy" for retired-path results. */
  source?: "grid" | "legacy";
  zoneCount: number;
  targetedAcres: number;
  fieldAcres: number;
  /** True when a mission for THIS scan has been logged. */
  isPostFlight: boolean;
  /**
   * The one savings decision, from `savingsClaim()`. The banner does not
   * compute a percentage and must not be handed one: every surface on the
   * report reads this same value, which is the only way they cannot disagree.
   */
  savings: SavingsClaim;
  /**
   * The volumes the claim is computed from, pre-formatted so the headline is
   * reproducible from the page. `applied` is the LOGGED volume — a projection
   * printed beside a record that contradicts it is the most damaging thing
   * this document can do.
   */
  chemical?: {
    planned: string;
    fullField: string;
    baselineRate: string;
    /** The logged applied volume, when one exists. */
    applied?: string | null;
  };
}): Banner {
  if (!input.hasAnalysis) {
    return {
      tone: "none",
      big: "No assessment: treatment area not determined",
      sub: "No treatment-grid assessment exists for this scan.",
      note: "This is not a finding of zero treatment need. No spray recommendation is made or implied.",
    };
  }
  if (input.source === "legacy") {
    return {
      tone: "legacy",
      big: input.zoneCount === 0
        ? "Legacy analysis on file: no zones"
        : `Legacy analysis on file: ${input.zoneCount} zone${input.zoneCount === 1 ? "" : "s"}, ${ac(input.targetedAcres)}`,
      sub: "Produced by the retired vision-analysis system, not the treatment grid.",
      note: "Re-assess this scan with the treatment grid before acting on these figures.",
    };
  }
  if (input.zoneCount === 0) {
    return {
      tone: "clean",
      big: "Assessment found nothing marked for treatment",
      sub: `From your reference points, across ${ac(input.fieldAcres)} of field.`,
      note: null,
    };
  }
  if (input.isPostFlight) {
    const chem = input.chemical;
    const claim = input.savings;

    // GATED ON THE RECORD, in one place. Once a mission is logged the claim
    // rests on the volume actually applied, never on the plan's projection.
    if (claim.kind === "none") {
      return {
        tone: "none",
        big: savingsRefusalHeadline(claim.reason),
        sub: chem?.applied != null
          ? `${chem.applied} applied vs ${chem.fullField} whole-field at ${chem.baselineRate}`
          : `across ${ac(input.targetedAcres)} of ${ac(input.fieldAcres)} total`,
        note: savingsRefusalNote(claim.reason),
      };
    }
    if (claim.kind === "measured") {
      return {
        tone: "success",
        big: `${claim.pct}% less chemical`,
        sub: `${chem?.applied} applied vs ${chem?.fullField} whole-field at ${chem?.baselineRate}`,
        note: null,
      };
    }
    // No applied volume logged: the projection may show, SAID as a projection.
    return {
      tone: "success",
      big: `${claim.pct}% less chemical planned`,
      sub: chem
        ? `${chem.planned} planned vs ${chem.fullField} whole-field at ${chem.baselineRate}`
        : `across ${ac(input.targetedAcres)} of ${ac(input.fieldAcres)} total`,
      note: "No applied volume is logged yet; this is the plan's projection, not measured performance.",
    };
  }
  return {
    tone: "success",
    big: `Targeting ${ac(input.targetedAcres)} of ${ac(input.fieldAcres)}`,
    sub: "Treatment area extrapolated from your reference points by the treatment grid.",
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
  if (!input.hasAnalysis) missing.push("Treatment grid assessment");
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

// ---------------------------------------------------------------------------
// Zone summary: what the report's main body shows instead of a row per cell
// ---------------------------------------------------------------------------

export type ReportZoneRow = {
  id: string;
  issue: string;
  acres: number;
  rateLha: number | null;
  flown: boolean;
};

export type ZoneGroup = {
  /** Classification, or "Unclassified" said once — never printed per row. */
  label: string;
  rateLha: number | null;
  acres: number;
  count: number;
  flownCount: number;
  /** all / partial / none, so "Flown" is never claimed for a half-flown group. */
  flownState: "all" | "partial" | "none";
};

export type ZoneSummary = {
  groups: ZoneGroup[];
  totals: {
    treatedAcres: number;
    untreatedAcres: number;
    fieldAcres: number;
    zoneCount: number;
    flownCount: number;
  };
  /** True when zones exist and not one carries a classification. */
  allUnclassified: boolean;
};

/**
 * Groups zones by (classification, rate) for the grower-facing table.
 *
 * The grid legitimately produces one zone per contiguous cell group — dozens
 * of 0.02 ac fragments on a scattered field — and a real report once
 * enumerated all 54 of them, pushing the application record clean off the
 * page. A grower needs "Stressed at 25 L/ha: 3.10 ac across 14 zones", not
 * the lattice. The per-zone detail stays available (appendix, CSV); this is
 * what the main body prints.
 */
export function summariseZones(rows: ReportZoneRow[], fieldAcres: number): ZoneSummary {
  const byKey = new Map<string, ZoneGroup>();
  for (const z of rows) {
    const label = z.issue.trim() || "Unclassified";
    const key = `${label}\u0000${z.rateLha ?? ""}`;
    let g = byKey.get(key);
    if (!g) {
      byKey.set(key, (g = {
        label, rateLha: z.rateLha, acres: 0, count: 0, flownCount: 0, flownState: "none",
      }));
    }
    g.acres += z.acres;
    g.count += 1;
    if (z.flown) g.flownCount += 1;
  }
  const groups = [...byKey.values()]
    .map(g => ({
      ...g,
      flownState: (g.flownCount === 0 ? "none"
        : g.flownCount === g.count ? "all" : "partial") as ZoneGroup["flownState"],
    }))
    .sort((a, b) => b.acres - a.acres);

  const treatedAcres = groups.reduce((s, g) => s + g.acres, 0);
  return {
    groups,
    totals: {
      treatedAcres,
      untreatedAcres: Math.max(0, fieldAcres - treatedAcres),
      fieldAcres,
      zoneCount: rows.length,
      flownCount: rows.filter(z => z.flown).length,
    },
    allUnclassified: rows.length > 0 &&
      rows.every(z => !z.issue.trim() || z.issue.trim() === "Unclassified"),
  };
}

/** The per-zone detail as CSV — the appendix's machine-readable twin. */
export function zoneDetailCsv(rows: ReportZoneRow[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = ["zone_id,classification,acres,rate_l_per_ha,flown"];
  for (const z of rows) {
    lines.push([
      esc(z.id),
      esc(z.issue.trim() || "Unclassified"),
      z.acres.toFixed(4),
      z.rateLha != null ? String(z.rateLha) : "",
      z.flown ? "yes" : "no",
    ].join(","));
  }
  return lines.join("\n");
}
