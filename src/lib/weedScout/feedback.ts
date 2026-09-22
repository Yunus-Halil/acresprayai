// The archive tunes the scout.
//
// Every verdict the operator saves is a labelled example: this plant, with
// these measurements, in this field, was a weed, or the crop, or a clod.
// Before the queue is shown, every new candidate is compared with the
// archived ones that resemble it most (nearest neighbours in a standardised
// feature space, the same comparison Find Similar uses on grid cells). If
// most of its neighbours were dismissed, its score drops and the reason is
// shown; if most were confirmed, it rises and the species text they carried
// is offered. Nothing is hidden: a dismissed-looking candidate is ranked
// lower, never removed.
//
// Same-field verdicts are preferred when there are enough of them, because
// "what a clod looks like" is a property of this soil, and fall back to the
// operator's whole archive when there are not. Everything stays in the
// browser: the archive rows are the operator's own, read through RLS.
import type { Candidate, CandidateKind, Feedback, FeedbackRow } from "./types";

/**
 * Neighbours within this distance count as "like this one".
 *
 * Distance is Euclidean over features divided by FIXED physical scales (below),
 * not by the archive's own spread. An archive of five rows has no spread to
 * speak of, and one dominated by a single field would make "like this one"
 * mean something different every time a row was added. A scale in known
 * units means the same thing on day one and day one thousand.
 */
export const FEEDBACK_RADIUS = 2.0;
/** Neighbours consulted per candidate. */
export const FEEDBACK_K = 7;
/** Neighbours needed before the archive is allowed an opinion. */
export const FEEDBACK_MIN_NEIGHBOURS = 3;
/** Same-field rows needed before they are used alone. */
export const SAME_FIELD_MIN = 10;
/** Score multipliers. */
export const DISMISSED_FACTOR = 0.4;
export const CONFIRMED_FACTOR = 1.25;
/** Agreement among neighbours needed to move the score. */
export const AGREEMENT = 0.75;

export type Family = "plant" | "ground";

/**
 * One unit of difference per feature, in the feature's own units.
 * Plants: a factor of two in area, 0.15 of extent, a factor of 1.5 in aspect,
 * 0.03 of chromaticity share, 0.08 of ExG, a tenth of full brightness, and
 * 0.15 of a row spacing off-row.
 */
export const PLANT_SCALES = [0.3, 0.15, 0.4, 0.03, 0.03, 0.03, 0.08, 0.1, 0.15];
/** Ground: half a decade of area, then one typical deviation per tile feature. */
export const GROUND_SCALES = [0.5, 1, 1, 1, 1, 1, 1, 1, 1, 1];

export const scalesFor = (family: Family, dim: number): number[] => {
  const base = family === "plant" ? PLANT_SCALES : GROUND_SCALES;
  return Array.from({ length: dim }, (_, i) => base[i] ?? 1);
};

/** Which feature space a candidate lives in. Plants and ground do not compare. */
export function familyOf(kind: CandidateKind, hasBlob: boolean): Family {
  if (kind === "not-average region") return "ground";
  if (kind === "field outlier" && !hasBlob) return "ground";
  return "plant";
}

/**
 * The vector a candidate is compared on. Stored with the observation so an
 * archived row can be compared without re-running anything.
 *
 * Plants: log size, shape, colour, greenness, brightness, and how far off the
 * row it sat as a fraction of the pitch (0 when unknown). Ground: log area and
 * the mean signed field deviation per tile feature.
 */
export function featureVectorOf(c: Candidate, rowSpacingM: number): number[] {
  if (familyOf(c.kind, !!c.blob) === "ground") {
    const z = c.region?.meanFieldZ ?? [];
    return [Math.log10(Math.max(1, c.areaM2)), ...z];
  }
  const b = c.blob!;
  const aspect = b.widthM > 0 && b.heightM > 0 ? Math.log(Math.max(b.widthM, b.heightM) / Math.min(b.widthM, b.heightM)) : 0;
  const offRow = c.distanceToRowM != null && rowSpacingM > 0 ? Math.abs(c.distanceToRowM) / rowSpacingM : 0;
  return [
    Math.log10(Math.max(1e-6, b.areaM2)),
    b.extent,
    aspect,
    b.chromaR, b.chromaG, b.chromaB,
    b.exgMean,
    b.brightness / 255,
    offRow,
  ];
}

const isDismissed = (v: FeedbackRow["verdict"]) => v === "not_weed" || v === "crop" || v === "not_vegetation";

/**
 * Compare every candidate with the archive and adjust its score.
 *
 * Pure. Returns new candidate objects; the input is untouched.
 */
export function applyFeedback(
  candidates: Candidate[],
  rows: FeedbackRow[],
  rowSpacingM: number,
  fieldId: string | null,
): Candidate[] {
  if (!rows.length) return candidates;
  const out: Candidate[] = [];
  for (const family of ["plant", "ground"] as Family[]) {
    const mine = candidates.filter(c => familyOf(c.kind, !!c.blob) === family);
    if (!mine.length) continue;
    const vectors = mine.map(c => featureVectorOf(c, rowSpacingM));
    const dim = vectors[0].length;
    let pool = rows.filter(r => familyOf(r.kind, r.kind !== "not-average region") === family && r.vector.length === dim && r.verdict !== "unsure");
    const sameField = fieldId ? pool.filter(r => r.fieldId === fieldId) : [];
    if (sameField.length >= SAME_FIELD_MIN) pool = sameField;
    if (pool.length < FEEDBACK_MIN_NEIGHBOURS) { out.push(...mine); continue; }

    const scales = scalesFor(family, dim);
    mine.forEach((c, i) => {
      const v = vectors[i];
      const near = pool
        .map(row => {
          let d2 = 0;
          for (let k = 0; k < dim; k++) { const d = (v[k] - row.vector[k]) / scales[k]; d2 += d * d; }
          return { d: Math.sqrt(d2), row };
        })
        .filter(n => n.d <= FEEDBACK_RADIUS)
        .sort((a, b) => a.d - b.d)
        .slice(0, FEEDBACK_K);
      if (near.length < FEEDBACK_MIN_NEIGHBOURS) { out.push(c); return; }
      // Votes are weighted by closeness, so five near twins outvote two
      // cousins at the edge of the radius.
      const weight = (d: number) => 1 / (d + 0.1);
      let wAll = 0, wDismissed = 0, wConfirmed = 0;
      for (const n of near) {
        const w = weight(n.d);
        wAll += w;
        if (isDismissed(n.row.verdict)) wDismissed += w;
        else if (n.row.verdict === "weed") wConfirmed += w;
      }
      const dismissed = near.filter(n => isDismissed(n.row.verdict)).length;
      const confirmed = near.filter(n => n.row.verdict === "weed").length;
      let factor = 1;
      if (wDismissed / wAll >= AGREEMENT) factor = DISMISSED_FACTOR;
      else if (wConfirmed / wAll >= AGREEMENT) factor = CONFIRMED_FACTOR;
      const speciesCount = new Map<string, number>();
      for (const n of near) {
        if (n.row.verdict !== "weed" || !n.row.species) continue;
        const s = n.row.species.trim();
        if (s) speciesCount.set(s, (speciesCount.get(s) ?? 0) + 1);
      }
      const species = [...speciesCount.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
      const feedback: Feedback = { confirmed, dismissed, species, factor };
      out.push({ ...c, score: Math.max(0, Math.min(1, c.score * factor)), feedback });
    });
  }
  // Candidates of neither family (none today) would be dropped; keep order by score.
  return out.sort((a, b) => b.score - a.score);
}

/** One line for the UI. */
export function describeFeedback(f: Feedback): string {
  const n = f.confirmed + f.dismissed;
  if (f.factor < 1) return `Resembles ${f.dismissed} of ${n} you dismissed before; ranked lower.`;
  if (f.factor > 1) {
    const sp = f.species.length ? ` (${f.species.slice(0, 3).join(", ")})` : "";
    return `Resembles ${f.confirmed} of ${n} you confirmed before${sp}; ranked higher.`;
  }
  return `Resembles ${n} archived observations with mixed verdicts.`;
}
