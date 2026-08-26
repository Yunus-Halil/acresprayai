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
  return ` (model data — ${s.station}, ${s.distance_mi.toFixed(1)} mi)`;
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
  savingsPct: number;
  /**
   * The volumes the savings claim is computed from, pre-formatted so the
   * headline is reproducible from the page. Post-flight, `applied` (the
   * LOGGED volume) is what the claim must rest on — a projection printed
   * beside a record that contradicts it is the most damaging thing this
   * document can do.
   */
  chemical?: {
    planned: string;
    fullField: string;
    baselineRate: string;
    /** The logged applied volume, when one exists. */
    applied?: string | null;
    /** 1 − applied/fullField, rounded. Null when applied is missing. */
    appliedSavingsPct?: number | null;
    /** True when the applied volume meets or exceeds the whole-field baseline. */
    exceededBaseline?: boolean;
  };
}): Banner {
  if (!input.hasAnalysis) {
    return {
      tone: "none",
      big: "No assessment — treatment area not determined",
      sub: "No treatment-grid assessment exists for this scan.",
      note: "This is not a finding of zero treatment need. No spray recommendation is made or implied.",
    };
  }
  if (input.source === "legacy") {
    return {
      tone: "legacy",
      big: input.zoneCount === 0
        ? "Legacy analysis on file — no zones"
        : `Legacy analysis on file — ${input.zoneCount} zone${input.zoneCount === 1 ? "" : "s"}, ${ac(input.targetedAcres)}`,
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
    // GATED ON THE RECORD. Once a mission is logged, the savings claim rests
    // on the volume actually applied, never on the plan's projection — a
    // report once said "91% less chemical, 2.5 gal planned" while its own
    // application record showed 10.6 gal applied. Everything printed here is
    // reproducible from the two volumes in the subtitle.
    if (chem?.applied != null) {
      if (chem.exceededBaseline) {
        return {
          tone: "none",
          big: "Application exceeded the whole-field baseline",
          sub: `${chem.applied} applied vs ${chem.fullField} whole-field at ${chem.baselineRate}`,
          note: "No savings figure is claimed for this mission.",
        };
      }
      return {
        tone: "success",
        big: `${chem.appliedSavingsPct}% less chemical`,
        sub: `${chem.applied} applied vs ${chem.fullField} whole-field at ${chem.baselineRate}`,
        note: null,
      };
    }
    // No applied volume logged: the projection may show, SAID as a projection.
    return {
      tone: "success",
      big: `${input.savingsPct}% less chemical planned`,
      sub: chem
        ? `${chem.planned} planned vs ${chem.fullField} whole-field at ${chem.baselineRate}`
        : `across ${ac(input.targetedAcres)} of ${ac(input.fieldAcres)} total`,
      note: "No applied volume is logged yet — this is the plan's projection, not measured performance.",
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
