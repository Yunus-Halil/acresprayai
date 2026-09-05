// Per-field farmer configuration, stored as JSON in `fields.settings`.
//
// Drives three things: the cost maths on treatment zones, the AI prompt's
// "available inputs" gate, and the flight planner's aircraft selection. Kept out
// of the viewer component so ReportsTab and the planner can import it without
// pulling in a 5k-line React module.
import { type DroneSpec, DRONE_SPECS } from "./droneSpecs";
import { DEFAULT_HEADLAND_M } from "./headland";
import { DEFAULT_GROUPING_SWATHS } from "./zoneGroups";
import type { ApplicationRecord, ApplicationRecordDefaults } from "./reportRecord";
export type { ApplicationRecord, ApplicationRecordDefaults } from "./reportRecord";

export type CustomInput = { name: string; cost: number };

export type LastFlownMission = {
  id: string;
  // "flight_logs" means `id` exists in public.flight_logs. "field_snapshot" is
  // the denormalized fallback stored on fields.settings when the detailed log
  // insert fails, so Reports can still prefill without violating FKs.
  source?: "flight_logs" | "field_snapshot";
  field_id?: string | null;
  scan_id?: string | null;
  drone_id?: string | null;
  date_flown: string;
  battery_start: number | null;
  battery_end: number | null;
  tank_refills: number;
  zones_completed: string[] | null;
  acres_treated: number | null;
  liters_applied: number | null;
  notes: string | null;
  created_at?: string | null;
  /**
   * The pesticide application record for this mission (grower, product, EPA
   * number, observed conditions, certificates). Rides the settings snapshot
   * and the archived report; public.flight_logs has no column for it yet.
   */
  record?: ApplicationRecord | null;
};

export type FarmerSettings = {
  crop_type: string;          // "wheat" | "corn" | ...
  planting_date: string;      // YYYY-MM-DD or ""
  harvest_date: string;       // YYYY-MM-DD or ""
  area_acres_override: number | null;
  // Display unit system. "metric" = litres, "imperial" = US gallons.
  unit_system: "metric" | "imperial";
  /**
   * ISO 4217 code the farmer's input prices are denominated in.
   *
   * Changing this RELABELS, it does not convert. The farmer types their own
   * local per-acre prices, so a stored 45 means 45 of whatever they picked —
   * converting on switch would silently rewrite their pricing.
   */
  currency: string;
  input_costs: {
    nitrogen_fertilizer: number;
    phosphorus_fertilizer: number;
    potassium_fertilizer: number;
    herbicide: number;
    fungicide: number;
    insecticide: number;
    reseeding: number;
  };
  available_inputs: {
    nitrogen_fertilizer: boolean;
    phosphorus_fertilizer: boolean;
    potassium_fertilizer: boolean;
    herbicide: boolean;
    fungicide: boolean;
    insecticide: boolean;
    reseeding: boolean;
  };
  custom_inputs: CustomInput[];
  flight_plan: {
    drone_id: string | null;     // fleet drone.id; null = none selected yet
    tank_load_pct: number;       // 0-100, how full the tank is for this mission
    custom_specs: DroneSpec;     // active only when the model is unknown/"Custom"
    /**
     * Headland: how far inside the boundary the passes are planned, in metres.
     *
     * Per field, because what borders a field is a property of that field. Read
     * by the planner when it builds the route AND by the Treatment Grid when it
     * prices the prescription, so the sprayed area both of them report is the
     * same one. See lib/headland.ts for the default and its caveats.
     */
    boundary_buffer_m: number;
    /**
     * How close two same-rate zones must be to be flown as one continuous
     * sweep, in swath widths. Zero turns grouping OFF and gives every zone its
     * own pattern — the behaviour the planner had before grouping existed, and
     * the baseline to compare a grouped route against. See lib/zoneGroups.ts.
     */
    zone_grouping_swaths: number;
    /**
     * How much extra ground the operator will accept, as a fraction of the area
     * they marked, to get treatment shapes the aircraft can fly cleanly.
     *
     * Zero is OFF, and zero is the default. This is the one setting that
     * changes WHAT gets sprayed rather than how it is reached, so it stays off
     * until the operator turns it on having seen the added area and the added
     * chemical. See lib/flightBlocks.ts.
     */
    overspray_tolerance: number;
  };
  /**
   * Target application rate in litres per hectare, per zone severity.
   *
   * This is the ONLY numeric dose anywhere in the model. The AI's
   * `recommendation.dose` is free prose written for a human, and the servo PWM
   * values in the .waypoints export are a binary pump open/close — neither can
   * drive a variable-rate prescription. These three numbers are what the DJI
   * Agras Rx raster is built from, so they are agronomy the operator owns, not
   * something inferred. Defaults are conservative starting points to be tuned
   * per crop and product.
   */
  spray_rates_lha: {
    low: number;
    medium: number;
    high: number;
  };
  /**
   * Per-zone rate overrides in L/ha, keyed by zone id. Takes precedence over
   * the severity default. Zones that are never touched stay absent rather than
   * being written out at their default, so changing a severity default still
   * moves every zone the farmer has not explicitly pinned.
   */
  zone_rate_overrides: Record<string, number>;
  // Denormalized copy of the latest completed mission for this field. The
  // canonical record is still public.flight_logs; this snapshot makes the
  // Reports tab resilient across tab switches.
  last_flown_mission?: LastFlownMission | null;
  /**
   * Stable application-record values for this field (grower name, product,
   * certificates). Prefill every mission's record so the operator types them
   * once, not per flight.
   */
  application_record?: ApplicationRecordDefaults | null;
  /**
   * Operator-configured condition-flag thresholds. Hardcoded 10 mph / 85 °F
   * is wrong for somebody — orchards and open row crop tolerate different
   * wind, and product labels vary. These drive the report's condition flags
   * AND the Log Flight entry warnings; the reportReconcile constants are the
   * defaults.
   */
  condition_limits?: { wind_mph: number; temp_f: number };
};

export const DEFAULT_FARMER_SETTINGS: FarmerSettings = {
  crop_type: "",
  planting_date: "",
  harvest_date: "",
  area_acres_override: null,
  unit_system: "imperial",
  currency: "USD",
  input_costs: {
    nitrogen_fertilizer: 45,
    phosphorus_fertilizer: 35,
    potassium_fertilizer: 30,
    herbicide: 25,
    fungicide: 30,
    insecticide: 20,
    reseeding: 35,
  },
  available_inputs: {
    nitrogen_fertilizer: true,
    phosphorus_fertilizer: true,
    potassium_fertilizer: true,
    herbicide: true,
    fungicide: true,
    insecticide: true,
    reseeding: true,
  },
  custom_inputs: [],
  flight_plan: {
    drone_id: null,
    tank_load_pct: 80,
    custom_specs: DRONE_SPECS["Custom"],
    boundary_buffer_m: DEFAULT_HEADLAND_M,
    zone_grouping_swaths: DEFAULT_GROUPING_SWATHS,
    overspray_tolerance: 0,
  },
  spray_rates_lha: { low: 15, medium: 25, high: 40 },
  zone_rate_overrides: {},
  last_flown_mission: null,
  application_record: null,
  condition_limits: { wind_mph: 10, temp_f: 85 },
};

/**
 * True when the medium rate is still the number SwathWise shipped.
 *
 * The savings figure on every report is measured against this rate, so the
 * document has to be able to say where it came from. It cannot say the
 * operator CHOSE it — the whole merged blob is written back on any settings
 * save, so a stored 25 proves nothing about who put it there — but it can say
 * truthfully that the value is unchanged from the default, which is what a
 * reader needs in order to weigh the claim. Anything stronger would be a
 * provenance we do not actually have.
 */
export const baselineRateIsShippedDefault = (s: FarmerSettings): boolean =>
  s.spray_rates_lha.medium === DEFAULT_FARMER_SETTINGS.spray_rates_lha.medium;

/**
 * Merge a persisted settings blob over the defaults. Older rows predate several
 * fields, so every nested object is filled in rather than replaced wholesale.
 */
export function mergeFarmerSettings(saved: unknown): FarmerSettings {
  if (!saved || typeof saved !== "object") return DEFAULT_FARMER_SETTINGS;
  const s = saved as Partial<FarmerSettings>;
  return {
    ...DEFAULT_FARMER_SETTINGS,
    ...s,
    input_costs: { ...DEFAULT_FARMER_SETTINGS.input_costs, ...(s.input_costs ?? {}) },
    available_inputs: { ...DEFAULT_FARMER_SETTINGS.available_inputs, ...(s.available_inputs ?? {}) },
    custom_inputs: Array.isArray(s.custom_inputs) ? s.custom_inputs.slice(0, 3) : [],
    spray_rates_lha: { ...DEFAULT_FARMER_SETTINGS.spray_rates_lha, ...(s.spray_rates_lha ?? {}) },
    condition_limits: {
      ...DEFAULT_FARMER_SETTINGS.condition_limits!,
      ...(s.condition_limits ?? {}),
    },
    zone_rate_overrides: (s.zone_rate_overrides && typeof s.zone_rate_overrides === "object")
      ? s.zone_rate_overrides
      : {},
    flight_plan: {
      ...DEFAULT_FARMER_SETTINGS.flight_plan,
      ...(s.flight_plan ?? {}),
      custom_specs: {
        ...DEFAULT_FARMER_SETTINGS.flight_plan.custom_specs,
        ...(s.flight_plan?.custom_specs ?? {}),
      },
    },
  };
}

/**
 * Target rate for one zone, in L/ha: an explicit per-zone override if the
 * farmer has pinned one, otherwise the severity default. Kept here rather than
 * in the exporter so the planner UI and the DJI package always agree.
 */
export function resolveZoneRateLha(
  zone: { id: string; severity: "low" | "medium" | "high" },
  settings: FarmerSettings,
): number {
  const override = settings.zone_rate_overrides?.[zone.id];
  if (typeof override === "number" && isFinite(override) && override > 0) return override;
  return settings.spray_rates_lha[zone.severity];
}

/**
 * Currencies offered in Settings. Not exhaustive by design — a short list of
 * the places SwathWise is aimed at beats a 180-entry dropdown. Any valid ISO
 * 4217 code stored on a field still formats correctly.
 */
export const CURRENCIES: { code: string; label: string }[] = [
  { code: "USD", label: "US Dollar" },
  { code: "EUR", label: "Euro" },
  { code: "GBP", label: "Pound Sterling" },
  { code: "BRL", label: "Brazilian Real" },
  { code: "INR", label: "Indian Rupee" },
  { code: "KES", label: "Kenyan Shilling" },
  { code: "NGN", label: "Nigerian Naira" },
  { code: "ZAR", label: "South African Rand" },
  { code: "AUD", label: "Australian Dollar" },
  { code: "CAD", label: "Canadian Dollar" },
  { code: "UAH", label: "Ukrainian Hryvnia" },
  { code: "TRY", label: "Turkish Lira" },
];

/**
 * Format an amount in the field's currency.
 *
 * `Intl.NumberFormat` handles symbol placement, grouping and decimal digits per
 * locale — several of these currencies put the symbol after the number, and
 * some have no minor unit at all. Falls back to the plain code if the runtime
 * rejects the currency, so a bad value degrades to "45.00 XYZ" rather than
 * throwing inside a render.
 */
export function formatMoney(amount: number, currency = "USD", maximumFractionDigits = 2): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits,
    }).format(amount);
  } catch {
    return `${amount.toFixed(maximumFractionDigits)} ${currency}`;
  }
}

/** Just the symbol, for prefixing a bare numeric input. */
export function currencySymbol(currency = "USD"): string {
  try {
    const parts = new Intl.NumberFormat(undefined, { style: "currency", currency })
      .formatToParts(0);
    return parts.find(p => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

export const INPUT_LABELS: Record<keyof FarmerSettings["input_costs"], string> = {
  nitrogen_fertilizer: "Nitrogen fertilizer",
  phosphorus_fertilizer: "Phosphorus fertilizer",
  potassium_fertilizer: "Potassium fertilizer",
  herbicide: "Herbicide",
  fungicide: "Fungicide",
  insecticide: "Insecticide",
  reseeding: "Reseeding / seed",
};

// Maps a canonical issue key → the farmer input whose per-acre cost applies.
// `null` = no chemical fix exists for that issue.
export const COST_MAP: Record<string, keyof FarmerSettings["input_costs"] | null> = {
  bare_soil: "reseeding",
  nitrogen_deficiency: "nitrogen_fertilizer",
  phosphorus_deficiency: "phosphorus_fertilizer",
  potassium_deficiency: "potassium_fertilizer",
  weed_pressure: "herbicide",
  disease: "fungicide",
  pest_damage: "insecticide",
  waterlogging: null,
};

/** Loose mapping from the AI's free-text issue/action to a COST_MAP key. */
export function issueToCostKey(
  z: { issue?: string; recommendation?: { action?: string } | null },
): string | null {
  const txt = `${z.issue ?? ""} ${z.recommendation?.action ?? ""}`.toLowerCase();
  if (/water|drain|saturat|pond/.test(txt)) return "waterlogging";
  if (/bare|reseed|gap|establish/.test(txt)) return "bare_soil";
  if (/nitrogen|\bn\s+def/.test(txt)) return "nitrogen_deficiency";
  if (/phosphor|\bp\s+def/.test(txt)) return "phosphorus_deficiency";
  if (/potass|\bk\s+def/.test(txt)) return "potassium_deficiency";
  if (/weed|herbicid/.test(txt)) return "weed_pressure";
  if (/disease|fung|blight|rust|mildew/.test(txt)) return "disease";
  if (/pest|insect|aphid|worm|beetle/.test(txt)) return "pest_damage";
  // Generic recommendation actions.
  if (/fertili/.test(txt)) return "nitrogen_deficiency";
  return null;
}

/**
 * Days since planting → a coarse growth-stage hint for the AI prompt.
 * `now` is injectable so this is testable without freezing the clock.
 */
export function growthStage(crop: string, planting: string, now: number = Date.now()): string | null {
  if (!planting) return null;
  const days = Math.floor((now - new Date(planting).getTime()) / 86400000);
  if (!Number.isFinite(days) || days < 0) return null;
  const wk = Math.round(days / 7);
  const c = crop.toLowerCase();
  if (c === "wheat" || c === "barley" || c === "oats" || c === "rye") {
    if (wk < 4) return `~${wk} weeks (emergence / tillering)`;
    if (wk < 10) return `~${wk} weeks (tillering / stem extension)`;
    if (wk < 16) return `~${wk} weeks (heading / flowering)`;
    return `~${wk} weeks (grain fill / ripening)`;
  }
  if (c === "corn") {
    if (wk < 4) return `~${wk} weeks (V1–V4)`;
    if (wk < 10) return `~${wk} weeks (V6–V12)`;
    if (wk < 14) return `~${wk} weeks (tasseling / silking)`;
    return `~${wk} weeks (grain fill / dent)`;
  }
  return `~${wk} weeks since planting`;
}

/**
 * Boundaries are stored either as a single ring (legacy) or as an array of rings
 * (fragmented multi-part fields). Always normalise to rings before use.
 */
export function normalizeBoundary(b: unknown): { lat: number; lng: number }[][] | null {
  if (!Array.isArray(b) || b.length === 0) return null;
  const [head] = b as unknown[];
  // Legacy: a bare array of {lat,lng}
  if (head && typeof (head as { lat?: unknown }).lat === "number") {
    return [b as { lat: number; lng: number }[]];
  }
  if (Array.isArray(head)) {
    return (b as unknown[])
      .filter((r): r is { lat: number; lng: number }[] => Array.isArray(r) && r.length >= 3);
  }
  return null;
}
