import { describe, it, expect } from "vitest";
import {
  COST_MAP,
  CURRENCIES,
  DEFAULT_FARMER_SETTINGS,
  INPUT_LABELS,
  baselineRateIsShippedDefault,
  currencySymbol,
  formatMoney,
  growthStage,
  issueToCostKey,
  mergeFarmerSettings,
  normalizeBoundary,
} from "@/lib/farmerSettings";
import {
  DRONE_SPECS,
  DRONE_SPEC_KNOWN,
  MODEL_IDS,
  canonicalModel,
  drainPerMin,
  resolveDroneSpec,
  specSheet,
} from "@/lib/droneSpecs";

describe("issueToCostKey", () => {
  it("maps each AI issue phrasing onto a costed input", () => {
    expect(issueToCostKey({ issue: "Bare soil" })).toBe("bare_soil");
    expect(issueToCostKey({ issue: "Waterlogging" })).toBe("waterlogging");
    expect(issueToCostKey({ issue: "Row gap" })).toBe("bare_soil");
    expect(issueToCostKey({ issue: "Weed pressure" })).toBe("weed_pressure");
    expect(issueToCostKey({ issue: "Leaf rust" })).toBe("disease");
    expect(issueToCostKey({ issue: "Aphid damage" })).toBe("pest_damage");
  });

  it("falls back to the recommended action when the issue is vague", () => {
    expect(issueToCostKey({ issue: "Visible discoloration", recommendation: { action: "fertilize" } }))
      .toBe("nitrogen_deficiency");
    expect(issueToCostKey({ issue: "Visible discoloration", recommendation: { action: "reseed" } }))
      .toBe("bare_soil");
    expect(issueToCostKey({ issue: "Visible discoloration", recommendation: { action: "irrigate" } }))
      .toBeNull();
  });

  it("returns null when nothing matches, rather than guessing", () => {
    expect(issueToCostKey({ issue: "Boundary issue" })).toBeNull();
    expect(issueToCostKey({})).toBeNull();
  });

  it("only ever returns keys COST_MAP knows about", () => {
    const samples = [
      "Bare soil", "Waterlogging", "Row gap", "weed", "blight", "beetle",
      "nitrogen deficiency", "phosphorus deficiency", "potassium deficiency",
    ];
    for (const issue of samples) {
      const key = issueToCostKey({ issue });
      if (key !== null) expect(Object.keys(COST_MAP)).toContain(key);
    }
  });

  it("maps waterlogging to no chemical input (nothing to sell the farmer)", () => {
    expect(COST_MAP.waterlogging).toBeNull();
  });

  it("gives every costed issue a labelled, priced input", () => {
    for (const inputKey of Object.values(COST_MAP)) {
      if (inputKey === null) continue;
      expect(INPUT_LABELS[inputKey]).toBeTruthy();
      expect(DEFAULT_FARMER_SETTINGS.input_costs[inputKey]).toBeGreaterThan(0);
      expect(DEFAULT_FARMER_SETTINGS.available_inputs[inputKey]).toBeDefined();
    }
  });
});

describe("currency", () => {
  it("defaults to USD", () => {
    expect(DEFAULT_FARMER_SETTINGS.currency).toBe("USD");
    expect(mergeFarmerSettings({}).currency).toBe("USD");
  });

  it("backfills currency on a settings blob saved before the field existed", () => {
    const legacy = { crop_type: "wheat", input_costs: { herbicide: 30 } };
    expect(mergeFarmerSettings(legacy).currency).toBe("USD");
  });

  it("keeps a stored currency", () => {
    expect(mergeFarmerSettings({ currency: "KES" }).currency).toBe("KES");
  });

  it("formats an amount in the given currency", () => {
    // Exact symbol placement and separators are locale-dependent, so assert on
    // content rather than an exact string.
    const usd = formatMoney(1234.5, "USD");
    expect(usd).toMatch(/1[,.\s]?234/);
    expect(usd).toMatch(/\$|USD/);

    const eur = formatMoney(45, "EUR");
    expect(eur).toMatch(/€|EUR/);
  });

  it("switching currency relabels rather than converting", () => {
    // The farmer types prices in their own currency, so 45 stays 45.
    const inUsd = formatMoney(45, "USD");
    const inKes = formatMoney(45, "KES");
    expect(inUsd).toMatch(/45/);
    expect(inKes).toMatch(/45/);
    expect(inUsd).not.toBe(inKes);
  });

  it("degrades gracefully on an unknown currency instead of throwing in a render", () => {
    expect(() => formatMoney(10, "NOTACURRENCY")).not.toThrow();
    expect(formatMoney(10, "NOTACURRENCY")).toContain("10");
  });

  it("exposes a symbol for prefixing numeric inputs", () => {
    expect(currencySymbol("USD")).toMatch(/\$|USD/);
    expect(currencySymbol("GBP")).toMatch(/£|GBP/);
    expect(() => currencySymbol("NOPE")).not.toThrow();
  });

  it("offers currencies as valid ISO 4217 codes", () => {
    expect(CURRENCIES.length).toBeGreaterThan(5);
    for (const c of CURRENCIES) {
      expect(c.code, c.label).toMatch(/^[A-Z]{3}$/);
      expect(c.label).toBeTruthy();
    }
  });
});

describe("growthStage", () => {
  const planting = "2026-04-01";
  const eightWeeksLater = new Date("2026-05-27").getTime();

  it("returns null without a planting date", () => {
    expect(growthStage("wheat", "")).toBeNull();
  });

  it("returns null for a planting date in the future", () => {
    expect(growthStage("wheat", "2026-12-01", new Date("2026-04-01").getTime())).toBeNull();
  });

  it("names cereal stages", () => {
    expect(growthStage("wheat", planting, eightWeeksLater)).toMatch(/tillering|stem extension/);
  });

  it("names corn stages with V-numbers", () => {
    expect(growthStage("corn", planting, eightWeeksLater)).toMatch(/V6/);
  });

  it("falls back to a neutral week count for unknown crops", () => {
    const s = growthStage("sorghum", planting, eightWeeksLater);
    expect(s).toMatch(/weeks since planting/);
  });
});

describe("mergeFarmerSettings", () => {
  it("returns the defaults for null/garbage input", () => {
    expect(mergeFarmerSettings(null)).toEqual(DEFAULT_FARMER_SETTINGS);
    expect(mergeFarmerSettings("nope")).toEqual(DEFAULT_FARMER_SETTINGS);
  });

  it("fills in nested keys a legacy row never had", () => {
    const legacy = { crop_type: "wheat", input_costs: { herbicide: 99 } };
    const merged = mergeFarmerSettings(legacy);
    expect(merged.crop_type).toBe("wheat");
    expect(merged.input_costs.herbicide).toBe(99);
    // Untouched costs keep their defaults rather than becoming undefined.
    expect(merged.input_costs.fungicide).toBe(DEFAULT_FARMER_SETTINGS.input_costs.fungicide);
    expect(merged.available_inputs.nitrogen_fertilizer).toBe(true);
  });

  it("backfills custom_specs fields added after the row was saved", () => {
    const legacy = { flight_plan: { drone_id: "d1", tank_load_pct: 50, custom_specs: { tank_l: 12 } } };
    const merged = mergeFarmerSettings(legacy);
    expect(merged.flight_plan.drone_id).toBe("d1");
    expect(merged.flight_plan.custom_specs.tank_l).toBe(12);
    expect(merged.flight_plan.custom_specs.min_turn_radius_m).toBeGreaterThan(0);
    expect(merged.flight_plan.custom_specs.climb_rate_ms).toBeGreaterThan(0);
  });

  it("caps custom inputs at three", () => {
    const many = { custom_inputs: [1, 2, 3, 4, 5].map(n => ({ name: `x${n}`, cost: n })) };
    expect(mergeFarmerSettings(many).custom_inputs).toHaveLength(3);
  });
});

describe("normalizeBoundary", () => {
  const ring = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }];

  it("wraps a legacy single ring", () => {
    expect(normalizeBoundary(ring)).toEqual([ring]);
  });

  it("passes multi-part boundaries through", () => {
    expect(normalizeBoundary([ring, ring])).toEqual([ring, ring]);
  });

  it("drops rings too small to be a polygon", () => {
    expect(normalizeBoundary([ring, [{ lat: 0, lng: 0 }]])).toEqual([ring]);
  });

  it("returns null for empty/absent boundaries", () => {
    expect(normalizeBoundary(null)).toBeNull();
    expect(normalizeBoundary([])).toBeNull();
  });
});

describe("drone specs", () => {
  it("resolves every model offered in the fleet picker", () => {
    for (const id of MODEL_IDS) {
      const { spec, isCustom } = resolveDroneSpec(id);
      expect(isCustom).toBe(false);
      expect(spec.max_flight_min).toBeGreaterThan(0);
    }
  });

  // Regression guard: Fleet used to register "XAG P100 Pro" while the planner
  // only knew "XAG P100", so the planner silently fell back to generic specs.
  // Both strings must resolve to a real airframe rather than to nothing; since
  // the directory seeded the P100 as its own entry they resolve to DIFFERENT
  // airframes, which is the point - "XAG P100" names the 40 L P100, not the
  // 50 L Pro it used to be aliased onto.
  it("resolves legacy model names to a real airframe", () => {
    expect(canonicalModel("XAG P100")).toBe("XAG P100");
    expect(canonicalModel("XAG P100 Pro")).toBe("XAG P100 Pro");
    expect(resolveDroneSpec("XAG P100").isCustom).toBe(false);
    expect(resolveDroneSpec("XAG P100").spec.tank_l).toBe(40);
    expect(resolveDroneSpec("XAG P100 Pro").spec.tank_l).toBe(50);
  });

  it("resolves hyphenated Agras names saved by older builds", () => {
    expect(canonicalModel("DJI Agras T-40")).toBe("DJI Agras T40");
    expect(canonicalModel("DJI Mavic 3 Multispectral")).toBe("DJI Mavic 3M");
    expect(canonicalModel("Nothing Like This")).toBeNull();
  });

  it("falls back to custom specs for an unknown model", () => {
    const { spec, isCustom } = resolveDroneSpec("Homebrew Hexacopter", { tank_l: 7 });
    expect(isCustom).toBe(true);
    expect(spec.tank_l).toBe(7);
    // Missing fields still come from the defaults so physics checks stay valid.
    expect(spec.min_turn_radius_m).toBeGreaterThan(0);
  });

  it("treats null/undefined models as custom rather than throwing", () => {
    expect(resolveDroneSpec(null).isCustom).toBe(true);
    expect(resolveDroneSpec(undefined).isCustom).toBe(true);
  });

  it("derives battery drain from flight time so fleet and planner agree", () => {
    const t40 = DRONE_SPECS["DJI Agras T40"];
    // Draining at this rate must empty the pack exactly at max_flight_min.
    expect(drainPerMin(t40) * t40.max_flight_min).toBeCloseTo(100, 6);
  });

  // A sprayer figure is either a real published number or exactly zero. Zero
  // is how "the manufacturer does not publish this" is spelled, and the guards
  // in effectiveSwathM handle it. What must never appear is a plausible-looking
  // middle number nobody sourced, because that reads as a measurement.
  it("keeps sprayer fields coherent", () => {
    for (const name of MODEL_IDS) {
      const spec = DRONE_SPECS[name];
      const known = DRONE_SPEC_KNOWN[name];
      if (spec.role === "sprayer") {
        if (known.has("tank_l")) expect(spec.tank_l, name).toBeGreaterThan(0);
        else expect(spec.tank_l, name).toBe(0);
        if (known.has("spray_swath_m")) expect(spec.spray_swath_m, name).toBeGreaterThan(0);
        else expect(spec.spray_swath_m, name).toBe(0);
        if (known.has("spray_rate_lpm")) expect(spec.spray_rate_lpm, name).toBeGreaterThan(0);
      } else {
        expect(spec.tank_l, name).toBe(0);
        expect(spec.spray_swath_m, name).toBe(0);
      }
      expect(spec.min_turn_radius_m, name).toBeGreaterThan(0);
      expect(spec.climb_rate_ms, name).toBeGreaterThan(0);
      expect(spec.max_speed_ms, name).toBeGreaterThan(0);
    }
  });

  // "Custom" is not an aircraft. It is the fallback SHAPE the arithmetic needs
  // when nothing has been published, so its numbers are finite and its known
  // set is empty - nothing in it is claimed as a fact about any airframe.
  it("claims nothing as known for the Custom fallback shape", () => {
    expect(MODEL_IDS).not.toContain("Custom");
    expect(DRONE_SPEC_KNOWN["Custom"].size).toBe(0);
    expect(DRONE_SPECS["Custom"].spray_swath_m).toBeGreaterThan(0);
  });

  it("renders a spec sheet with no blank values", () => {
    for (const id of MODEL_IDS) {
      for (const row of specSheet(DRONE_SPECS[id])) {
        expect(row.v, `${id}/${row.k}`).toBeTruthy();
      }
    }
  });

  it("shows a placeholder rather than zeroes for survey drones", () => {
    // A survey airframe has no tank, and "0 L" would read as a real spec.
    // The placeholder is a plain hyphen: em dashes were removed from all
    // user-facing text, and this value is user-facing.
    const sheet = specSheet(DRONE_SPECS["DJI Mavic 3M"], DRONE_SPEC_KNOWN["DJI Mavic 3M"]);
    expect(sheet.find(r => r.k === "Tank")?.v).toBe("-");
    expect(sheet.find(r => r.k === "Swath")?.v).toBe("-");
  });
});

describe("the report's savings baseline names where it came from", () => {
  it("flags a medium rate still sitting at the shipped default", () => {
    expect(baselineRateIsShippedDefault(DEFAULT_FARMER_SETTINGS)).toBe(true);
    expect(baselineRateIsShippedDefault(
      mergeFarmerSettings({ spray_rates_lha: { medium: 40 } }),
    )).toBe(false);
  });

  it("does not pretend a saved blob proves the operator chose the rate", () => {
    // Any settings save writes the whole merged object back, so a stored 25
    // is indistinguishable from an untouched default - and the predicate
    // reports exactly that rather than inventing provenance.
    const saved = mergeFarmerSettings({ crop_type: "corn" });
    expect(saved.spray_rates_lha.medium).toBe(25);
    expect(baselineRateIsShippedDefault(saved)).toBe(true);
  });
});
