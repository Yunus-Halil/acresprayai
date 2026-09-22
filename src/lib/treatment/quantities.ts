// Treatment quantities: product, carrier, tank loads, from what the operator
// supplied and nothing else.
//
// TREATMENT IS NOT IDENTIFICATION. A weed name says what is standing in the
// field. What to spray on it, at what rate, in which crop, by which method,
// is a decision the operator makes from the product's current label, and no
// table in this app can make it for them: there is no single correct product
// or amount for a species, labels change, and the weed catalog carries no
// herbicide data by design. So a TreatmentChoice is what the operator chose
// and the label they say they checked, and this module only does the
// arithmetic on top of it.
//
// "QUANTITY NOT CALCULATED" IS AN ANSWER. Anything missing (no product, no
// rate, no unit, no tank size, an unverified label) or in conflict (the label
// was read for a different crop than the field's) stops the calculation for
// that group and says why. Nothing is defaulted in to make a number appear.
// A total prints only when every group with area has a calculated quantity.
//
// UNITS. Rates are stored as printed on the label, in the label's units, and
// converted here to litres or kilograms per hectare; areas arrive in square
// metres. Every conversion factor is exact and listed in the assumptions.
import { L_PER_US_GAL, M2_PER_ACRE, M2_PER_HECTARE, KG_PER_LB } from "../units";

export type LiquidRateUnit = "L/ha" | "mL/ha" | "gal/ac" | "qt/ac" | "pt/ac" | "fl oz/ac";
export type DryRateUnit = "kg/ha" | "g/ha" | "lb/ac" | "oz/ac";
export type RateUnit = LiquidRateUnit | DryRateUnit;
export type CarrierUnit = "L/ha" | "gal/ac";

export const LIQUID_RATE_UNITS: readonly LiquidRateUnit[] = ["L/ha", "mL/ha", "gal/ac", "qt/ac", "pt/ac", "fl oz/ac"];
export const DRY_RATE_UNITS: readonly DryRateUnit[] = ["kg/ha", "g/ha", "lb/ac", "oz/ac"];
export const RATE_UNITS: readonly RateUnit[] = [...LIQUID_RATE_UNITS, ...DRY_RATE_UNITS];
export const CARRIER_UNITS: readonly CarrierUnit[] = ["L/ha", "gal/ac"];

export const isLiquidUnit = (u: string | null | undefined): u is LiquidRateUnit => LIQUID_RATE_UNITS.includes(u as LiquidRateUnit);
export const isDryUnit = (u: string | null | undefined): u is DryRateUnit => DRY_RATE_UNITS.includes(u as DryRateUnit);

const HA_PER_AC = M2_PER_ACRE / M2_PER_HECTARE;      // 0.40468564224, exact
const L_PER_QT = L_PER_US_GAL / 4;
const L_PER_PT = L_PER_US_GAL / 8;
const L_PER_FL_OZ = L_PER_US_GAL / 128;
const KG_PER_OZ = KG_PER_LB / 16;

/** Litres per hectare for a liquid rate, kilograms per hectare for a dry one. */
export function ratePerHectare(value: number, unit: RateUnit): number {
  switch (unit) {
    case "L/ha": return value;
    case "mL/ha": return value / 1000;
    case "gal/ac": return value * L_PER_US_GAL / HA_PER_AC;
    case "qt/ac": return value * L_PER_QT / HA_PER_AC;
    case "pt/ac": return value * L_PER_PT / HA_PER_AC;
    case "fl oz/ac": return value * L_PER_FL_OZ / HA_PER_AC;
    case "kg/ha": return value;
    case "g/ha": return value / 1000;
    case "lb/ac": return value * KG_PER_LB / HA_PER_AC;
    case "oz/ac": return value * KG_PER_OZ / HA_PER_AC;
  }
}

export function carrierLitresPerHectare(value: number, unit: CarrierUnit): number {
  return unit === "L/ha" ? value : value * L_PER_US_GAL / HA_PER_AC;
}

/** What the operator chose and the label they read. Stored in `treatment_choices`. */
export type TreatmentChoice = {
  id: string;
  weed_catalog_id: string | null;
  weed_label: string | null;
  product_name: string;
  epa_reg_no: string | null;
  label_source: string | null;
  label_checked_on: string | null;
  label_crop: string | null;
  application_method: string | null;
  restrictions: string | null;
  rate_value: number | null;
  rate_unit: RateUnit | string | null;
  carrier_volume_value: number | null;
  carrier_unit: CarrierUnit | string | null;
  label_verified: boolean;
  notes: string | null;
};

/** A set of zones that share one treatment choice. */
export type TreatmentGroup = {
  key: string;
  label: string;
  areaM2: number;
  zoneCount: number;
  choice: TreatmentChoice | null;
};

export type Calibration = {
  /** Tank capacity of the aircraft, litres; null when no drone is chosen. */
  tankCapacityL: number | null;
  /** How full the tank is loaded, 0 to 100. */
  tankLoadPct: number;
  /** The planner's application volume when the label states no carrier volume, litres per hectare. */
  applicationVolumeLha: number | null;
  /** The field's crop, to check against the crop the label was read for. */
  fieldCrop: string | null;
};

export type GroupQuantity =
  | {
    kind: "calculated";
    key: string;
    label: string;
    areaHa: number;
    productAmount: number;
    productUnit: "L" | "kg";
    productPerHa: number;
    carrierLitresPerHa: number;
    carrierSource: "label" | "planner";
    sprayVolumeL: number;
  }
  | { kind: "not-calculated"; key: string; label: string; areaHa: number; reasons: string[] };

export type QuantityResult = {
  groups: GroupQuantity[];
  /** Present only when every group with area calculated. */
  total: {
    products: { name: string; amount: number; unit: "L" | "kg" }[];
    sprayVolumeL: number;
    loads: number;
    perLoadL: number;
    lastLoadL: number;
  } | null;
  /** Why there is no total, when there is none. Group reasons, deduplicated, in group order. */
  reasons: string[];
  assumptions: string[];
};

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** The crop the label was read for must be the field's crop, when both are known. */
export function cropConflict(labelCrop: string | null, fieldCrop: string | null): string | null {
  const a = norm(labelCrop), b = norm(fieldCrop);
  if (!a || !b) return null;
  if (a === b) return null;
  // "soybean" vs "soybeans": a plural is the same crop.
  if (a.replace(/s$/, "") === b.replace(/s$/, "")) return null;
  return `The label was checked for ${labelCrop}, but this field's crop is ${fieldCrop}.`;
}

/** Why a single choice cannot be priced, or an empty list. Pure, so a form can show it live. */
export function choiceProblems(choice: TreatmentChoice | null, calib: Pick<Calibration, "fieldCrop">): string[] {
  if (!choice) return ["No product chosen."];
  const out: string[] = [];
  if (!choice.product_name.trim()) out.push("No product name.");
  if (!choice.label_verified) out.push("Label not marked as verified.");
  if (!choice.label_checked_on) out.push("No date the label was checked.");
  if (!choice.label_source?.trim()) out.push("No label source recorded.");
  if (!(choice.rate_value != null && choice.rate_value > 0)) out.push("No application rate.");
  if (!choice.rate_unit || !RATE_UNITS.includes(choice.rate_unit as RateUnit)) out.push("No rate unit, or one this app cannot convert.");
  if (choice.carrier_volume_value != null && !(choice.carrier_volume_value > 0)) out.push("Carrier volume must be above zero.");
  if (choice.carrier_volume_value != null && (!choice.carrier_unit || !CARRIER_UNITS.includes(choice.carrier_unit as CarrierUnit))) out.push("No carrier volume unit.");
  const conflict = cropConflict(choice.label_crop, calib.fieldCrop);
  if (conflict) out.push(conflict);
  return out;
}

export function computeQuantities(groups: readonly TreatmentGroup[], calib: Calibration): QuantityResult {
  const assumptions: string[] = [
    "Product amount = label rate x treated area. Treated area is the planner's zone area after the headland inset.",
    "Spray volume = carrier volume x treated area; the product is mixed into that volume, not added on top.",
    `Conversions: 1 US gal = ${L_PER_US_GAL} L, 1 ac = ${M2_PER_ACRE} m2, 1 lb = ${KG_PER_LB} kg.`,
  ];
  const out: GroupQuantity[] = [];
  const reasons: string[] = [];
  let usedPlannerCarrier = false;

  for (const g of groups) {
    const areaHa = Math.max(0, g.areaM2) / M2_PER_HECTARE;
    if (!(areaHa > 0)) {
      out.push({ kind: "not-calculated", key: g.key, label: g.label, areaHa, reasons: ["No treated area."] });
      continue;
    }
    const problems = choiceProblems(g.choice, calib);
    const c = g.choice!;
    let carrierLha: number | null = null;
    let carrierSource: "label" | "planner" = "label";
    if (!problems.length) {
      if (c.carrier_volume_value != null) {
        carrierLha = carrierLitresPerHectare(c.carrier_volume_value, c.carrier_unit as CarrierUnit);
      } else if (calib.applicationVolumeLha != null && calib.applicationVolumeLha > 0) {
        carrierLha = calib.applicationVolumeLha;
        carrierSource = "planner";
        usedPlannerCarrier = true;
      } else {
        problems.push("No carrier volume: the label states none and the planner has no application volume.");
      }
    }
    if (problems.length) {
      out.push({ kind: "not-calculated", key: g.key, label: g.label, areaHa, reasons: problems });
      for (const p of problems) { const r = `${g.label}: ${p}`; if (!reasons.includes(r)) reasons.push(r); }
      continue;
    }
    const unit = c.rate_unit as RateUnit;
    const perHa = ratePerHectare(c.rate_value!, unit);
    out.push({
      kind: "calculated", key: g.key, label: g.label, areaHa,
      productAmount: perHa * areaHa, productUnit: isDryUnit(unit) ? "kg" : "L", productPerHa: perHa,
      carrierLitresPerHa: carrierLha!, carrierSource, sprayVolumeL: carrierLha! * areaHa,
    });
  }

  if (usedPlannerCarrier) {
    assumptions.push("Where the label states no carrier volume, the planner's application volume setting is used and said so.");
  }

  const withArea = out.filter(g => g.areaHa > 0);
  const calculated = withArea.filter((g): g is Extract<GroupQuantity, { kind: "calculated" }> => g.kind === "calculated");
  let total: QuantityResult["total"] = null;
  if (withArea.length > 0 && calculated.length === withArea.length) {
    const sprayVolumeL = calculated.reduce((s, g) => s + g.sprayVolumeL, 0);
    const products = new Map<string, { name: string; amount: number; unit: "L" | "kg" }>();
    for (const g of calculated) {
      const choice = groups.find(x => x.key === g.key)!.choice!;
      const k = `${choice.product_name} ${g.productUnit}`;
      const cur = products.get(k) ?? { name: choice.product_name, amount: 0, unit: g.productUnit };
      cur.amount += g.productAmount;
      products.set(k, cur);
    }
    if (!(calib.tankCapacityL != null && calib.tankCapacityL > 0)) {
      reasons.push("Tank loads: no tank capacity (choose a drone in the planner).");
    } else {
      const perLoadL = calib.tankCapacityL * Math.max(0, Math.min(100, calib.tankLoadPct)) / 100;
      if (!(perLoadL > 0)) {
        reasons.push("Tank loads: the tank load is zero percent.");
      } else {
        const loads = Math.max(1, Math.ceil(sprayVolumeL / perLoadL - 1e-9));
        const lastLoadL = sprayVolumeL - perLoadL * (loads - 1);
        total = { products: [...products.values()], sprayVolumeL, loads, perLoadL, lastLoadL };
        assumptions.push(`Tank loads assume ${perLoadL.toFixed(0)} L per load (${calib.tankCapacityL} L tank at ${Math.round(calib.tankLoadPct)}%), with no allowance for rinse or dead volume.`);
      }
    }
  } else if (withArea.length === 0) {
    reasons.push("No treated area in any group.");
  }

  return { groups: out, total, reasons, assumptions };
}

/** "Quantity not calculated" is the phrase the screen and the report use. Kept here so they agree. */
export const NOT_CALCULATED = "Quantity not calculated";
