// Step 5, in-house: describe a candidate from what was measured.
//
// This replaces the external model. Everything in an Estimate is derived from
// numbers the pipeline computed (size, shape, colour against the field's own
// plants, position against the fitted rows), from the event context (season,
// place, local time), and from the operator's archive (feedback.ts). No
// species is ever named by this file; species text only ever comes from
// verdicts the operator wrote, surfaced by retrieval.
//
// The estimate is decision support: what is there, how big, how it sits, and
// what a person on the ground should look at. Never a product, never a rate.
import type { EventContext } from "./context";
import type { BlobBaseline } from "./blobs";
import type { Candidate, Estimate } from "./types";
import { type UnitSystem, fmtArea, fmtLengthCm } from "../units";

/** cm, formatted in whichever system the operator has set. `sys` defaults to metric for any caller that has not been threaded through yet. */
const cm = (m: number, sys: UnitSystem = "metric") => fmtLengthCm(m * 100, sys).text;

/** Size class from equivalent diameter, with the resolution floor stated. */
export function sizeClassOf(diameterM: number, gsdM: number, sys: UnitSystem = "metric"): string {
  const px = diameterM / gsdM;
  if (px < 3) return "at the resolution floor (under 3 pixels across, size and shape are not reliable)";
  if (diameterM < 0.04) return `seedling-sized (under ${cm(0.04, sys)})`;
  if (diameterM < 0.08) return `small (${cm(0.04, sys)} to ${cm(0.08, sys)})`;
  if (diameterM < 0.16) return `established (${cm(0.08, sys)} to ${cm(0.16, sys)})`;
  if (diameterM < 0.32) return `large (${cm(0.16, sys)} to ${cm(0.32, sys)})`;
  return `a clump or patch (over ${cm(0.32, sys)})`;
}

/** Growth habit from the coarse outline, only when there are pixels enough to say. */
export function habitOf(c: Candidate): string | null {
  const b = c.blob;
  if (!b) return null;
  const px = b.equivDiameterM / b.gsdM;
  if (px < 6) return null;
  const aspect = Math.max(b.widthM, b.heightM) / Math.max(1e-6, Math.min(b.widthM, b.heightM));
  if (aspect >= 2.2) return "elongated, the outline of a grass or a leaning leaf";
  if (b.extent < 0.45) return "sprawling or irregular, more like a spreading broadleaf or several plants touching";
  return "compact and roughly round, rosette-like from above";
}

/** Colour against the field's own plant population. */
export function colourNoteOf(c: Candidate, plants: BlobBaseline | null): string | null {
  const b = c.blob;
  if (!b || !plants) return null;
  const dz = plants.scales[1] > 1e-9 ? (b.exgMean - plants.centres[1]) / plants.scales[1] : 0;
  if (dz >= 2) return "distinctly greener than the field's typical plant";
  if (dz <= -2) return "paler or yellower than the field's typical plant";
  return "about the same green as the field's typical plant";
}

export function positionNoteOf(c: Candidate, rowSpacingM: number, sys: UnitSystem = "metric"): string {
  if (c.kind === "not-average region") {
    return `A ${c.region?.klass ?? "not-average"} area of about ${fmtArea(c.areaM2, sys).text}, ${c.region?.tileCount ?? 0} tiles.`;
  }
  if (c.distanceToRowM == null) return "No trustworthy row model here, so its position relative to the crop rows is unknown.";
  const d = Math.abs(c.distanceToRowM);
  const frac = rowSpacingM > 0 ? d / rowSpacingM : 0;
  if (frac >= 0.4) return `Sits ${cm(d, sys)} from the nearest fitted row, near the middle of the inter-row: not where the planter put anything.`;
  if (frac >= 0.3) return `Sits ${cm(d, sys)} from the nearest fitted row, outside the in-row band.`;
  return `Sits ${cm(d, sys)} from the nearest fitted row, within the band a planted plant can wander in.`;
}

/** Season and time context, in words a farmer would use. Groups only, never a species. */
export function seasonNoteOf(ctx: EventContext | null, crop: string, stage: string | null): string {
  if (!ctx) return "Season and place unknown for this capture.";
  const where = ctx.place ? ` in ${ctx.place}` : "";
  const when = ctx.localTime ? ` at ${ctx.localTime}` : "";
  const base = `Captured${where}${when}, ${ctx.season}${crop ? `, ${crop}${stage ? ` ${stage}` : ""}` : ""}.`;
  const hint: Record<EventContext["season"], string> = {
    spring: "Early-season: small seedlings between rows are the ones that matter most and the ones hardest to see from above.",
    summer: "Mid-season: anything still visible between rows has outgrown the crop's shading, so size relative to the crop is the strongest clue.",
    autumn: "Late-season: the crop shades most of the inter-row; what stands out is usually large, late-emerging, or a gap in the stand.",
    winter: "Dormant season: green between rows is most often a winter annual or a cover crop rather than a summer weed.",
  };
  const sun = ctx.localTime && /\b(6|7|8|17|18|19):|[6-8]:\d\d AM|[5-7]:\d\d PM/.test(ctx.localTime)
    ? " Low sun at this hour lengthens shadows; a dark region may be shadow, not ground."
    : "";
  return `${base} ${hint[ctx.season]}${sun}`;
}

export function whatWouldConfirm(c: Candidate): string[] {
  const out: string[] = [];
  out.push(`Walk to ${c.centroid.lat.toFixed(6)}, ${c.centroid.lng.toFixed(6)}.`);
  if (c.kind === "not-average region") {
    const k = c.region?.klass ?? "";
    if (k.startsWith("bare") || k === "thin stand") out.push("Check whether the stand is missing (planter skip, crusting, washout) or present but small (compaction, wet feet, nutrient).");
    else if (k.startsWith("dark")) out.push("Check for standing water, residue, or a shadow at capture time.");
    else if (k === "dense vegetation") out.push("Check whether the extra vegetation is crop (a double plant) or something between the rows.");
    else if (k === "pale vegetation") out.push("Check leaf colour against a healthy plant nearby: yellowing from the bottom up reads differently from tip burn.");
    else out.push("Compare with the ground just outside the shape.");
  } else {
    out.push("Is it in the row or between rows? Between rows, it was not planted.");
    out.push("Leaf shape: grass-like blades or broad leaves; a rosette or an upright stem.");
    if (c.blob && c.blob.equivDiameterM / c.blob.gsdM < 6) out.push("It is only a few pixels across in the imagery; do not judge shape from the chip.");
  }
  return out;
}

export function caveatsOf(c: Candidate, gsdM: number, sys: UnitSystem = "metric"): string[] {
  const out: string[] = [];
  if (c.blob) {
    const px = c.blob.equivDiameterM / c.blob.gsdM;
    out.push(`${cm(c.blob.equivDiameterM, sys)} across is ${px.toFixed(0)} pixels at ${cm(c.blob.gsdM, sys)}/px.`);
  } else {
    out.push(`Measured at ${cm(gsdM, sys)}/px; nothing smaller than ${cm(3 * gsdM, sys)} is measurable in this pass.`);
  }
  if (c.rowConfidence != null && c.rowConfidence < 0.5) out.push(`Row fit confidence here is ${c.rowConfidence.toFixed(2)}; treat the off-row distance as approximate.`);
  if (c.blob?.touchesBorder) out.push("This plant touched the edge of its imagery window; its size is a lower bound.");
  out.push("An estimate from imagery and measurements, for you to check on the ground.");
  return out;
}

/** Build the estimate. Pure. */
export function describe(
  c: Candidate,
  ctx: EventContext | null,
  crop: string,
  stage: string | null,
  plants: BlobBaseline | null,
  rowSpacingM: number,
  gsdM: number,
  sys: UnitSystem = "metric",
): Estimate {
  const sizeClass = c.blob
    ? sizeClassOf(c.blob.equivDiameterM, c.blob.gsdM, sys)
    : c.kind === "not-average region" ? "a region, not a plant" : "a tile, not a plant";
  const habit = habitOf(c);
  const colourNote = colourNoteOf(c, plants);
  const positionNote = positionNoteOf(c, rowSpacingM, sys);
  const seasonNote = seasonNoteOf(ctx, crop, stage);

  let summary: string;
  if (c.kind === "not-average region") {
    const d = c.region?.drivers[0];
    summary = `${c.region?.klass ?? "Not-average ground"}: ${d ? `${d.feature} ${d.z > 0 ? "above" : "below"} the field by ${Math.abs(d.z).toFixed(1)} typical deviations` : "differs from the field"}, across ${c.region?.tileCount ?? 0} touching tiles.`;
  } else if (!c.blob) {
    summary = `A tile that reads ${c.anomalyFeature ? `${c.anomalyFeature} ${c.anomalyZ && c.anomalyZ > 0 ? "off" : "off"} the field` : "not-average"} with no vegetation in it.`;
  } else {
    const parts: string[] = [];
    parts.push(`A ${sizeClass} plant`);
    if (habit) parts.push(habit);
    if (colourNote) parts.push(colourNote);
    if (c.kind === "off-row vegetation" || c.kind === "off-row and outlier") parts.push("between the fitted rows");
    if (c.kind === "vegetation outlier" || c.kind === "off-row and outlier") parts.push(`unlike the field's plants in ${c.blobZFeature ?? "size or colour"}`);
    summary = parts.join(", ") + ".";
    if (c.feedback?.factor && c.feedback.factor > 1 && c.feedback.species.length) {
      summary += ` Resembles what you have called "${c.feedback.species[0]}" before.`;
    } else if (c.feedback?.factor && c.feedback.factor < 1) {
      summary += " Resembles things you have dismissed before.";
    }
  }
  return {
    model: "swathwise-inhouse-v1",
    summary,
    sizeClass,
    habit,
    colourNote,
    positionNote,
    seasonNote,
    whatWouldConfirm: whatWouldConfirm(c),
    caveats: caveatsOf(c, gsdM, sys),
  };
}
