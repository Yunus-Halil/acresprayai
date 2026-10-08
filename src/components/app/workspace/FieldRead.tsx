// The field read: three lines above the findings, in the grower's words.
//
// What the pattern found (rows, plants, blocks, or that there is no row
// pattern), what was found that is not the crop (how many spots, how much
// ground), and the ground that is not crop at all (bare, thin, wet). Numbers
// in the operator's units. Never the method: how the rows were read is the
// product's own business, and this screen says what, not how.
//
// Composes, never computes: the pattern summary comes off the result, the
// spot counts off the candidates, the region areas off the regions.
import type { Candidate, Region, ScoutResult } from "@/lib/weedScout/types";
import { type UnitSystem, fmtArea, fmtLengthCm } from "@/lib/units";

export type FieldReadProps = {
  result: ScoutResult;
  candidates: Candidate[];
  /** Ground the kept spots cover, from plannedAreas. */
  treatAreaM2: number;
  fieldAreaM2: number | null;
  units: UnitSystem;
};

const GROUND_CLASSES: Record<string, string> = {
  "bare or dry ground": "bare or dry",
  "dark ground (wet, shadow or residue)": "wet or dark",
  "thin stand": "thin stand",
};

const compass = (bearingDeg: number): string => {
  const names = ["N-S", "NNE-SSW", "NE-SW", "ENE-WSW", "E-W", "ESE-WNW", "SE-NW", "SSE-NNW"];
  return names[Math.round(bearingDeg / 22.5) % 8];
};

export function FieldRead({ result, candidates, treatAreaM2, fieldAreaM2, units }: FieldReadProps) {
  const len = (m: number) => fmtLengthCm(m * 100, units).text;
  const area = (m2: number) => fmtArea(m2, units).text;
  const p = result.pattern?.summary ?? null;

  let patternLine: string;
  if (p && p.blocks > 0) {
    const parts: string[] = [];
    if (p.rowSpacingM != null) parts.push(`rows ${len(p.rowSpacingM)} apart${p.bearingDeg != null ? `, running ${compass(p.bearingDeg)}` : ""}`);
    if (p.plantSpacingM != null) parts.push(`plants ${len(p.plantSpacingM)} apart`);
    if (p.plantDiameterM != null) parts.push(`about ${len(p.plantDiameterM)} across`);
    patternLine = `${parts.join(", ")}: ${p.plantCount.toLocaleString()} crop plants in ${p.blocks} planting${p.blocks === 1 ? "" : "s"}.`;
  } else if (result.canopyClosed) {
    patternLine = "The canopy is closed, so single plants cannot be told apart; the findings are by area.";
  } else if (result.rowsUsed === "fitted" && result.rows?.usable) {
    patternLine = `Rows ${len(result.rows.medianPitchM)} apart were fitted; single plants were not placed.`;
  } else {
    patternLine = "No row pattern was read, so the findings are by area, not by plant.";
  }

  const weeds = candidates.filter(c => !c.region);
  const between = weeds.filter(c => c.kind === "between plants").length;
  const weedArea = weeds.reduce((s, c) => s + c.areaM2, 0);
  const share = fieldAreaM2 && fieldAreaM2 > 0 ? (treatAreaM2 / fieldAreaM2) * 100 : null;
  const weedLine = weeds.length === 0
    ? "No plants were found off the pattern."
    : `${weeds.length.toLocaleString()} plant${weeds.length === 1 ? "" : "s"} off the pattern${between ? `, ${between.toLocaleString()} of them under the row` : ""}, ${area(weedArea)} of ground${share != null ? `; ${share.toFixed(share < 10 ? 1 : 0)}% of the field to treat` : ""}.`;

  const byClass = new Map<string, { count: number; areaM2: number }>();
  for (const r of result.regions as Region[]) {
    const name = GROUND_CLASSES[r.klass];
    if (!name) continue;
    const cur = byClass.get(name) ?? { count: 0, areaM2: 0 };
    byClass.set(name, { count: cur.count + 1, areaM2: cur.areaM2 + r.areaM2 });
  }
  const groundLine = byClass.size === 0
    ? "No bare, thin or wet ground stands out from the rest of the field."
    : [...byClass.entries()].map(([name, v]) => `${name} ${area(v.areaM2)} in ${v.count} patch${v.count === 1 ? "" : "es"}`).join(", ") + ".";

  return (
    <section className="p-4 border-b border-[#1f1f1f] space-y-1.5" data-testid="field-read">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">The field read</div>
      <p className="text-xs text-neutral-200 leading-relaxed">{patternLine}</p>
      <p className="text-xs text-neutral-200 leading-relaxed">{weedLine}</p>
      <p className="text-xs text-neutral-400 leading-relaxed">{groundLine}</p>
    </section>
  );
}
