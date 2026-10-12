// Field validation: hand-measured plants against what Swardus said about
// them. Pure: the matching and the arithmetic, so the command, a test and a
// later screen share one definition of "error".
//
// A reference plant is matched to a prediction by the finding's id when the
// person noted it, else by position within `maxDistanceM`, else by the photo
// and the pixel within `maxPixelDistance`. The report says how many matched
// and how, and claims nothing when nothing did. Every error is prediction
// minus truth in the truth's units; medians beside means because one wrong
// match should not own the number.
import type { WeedMeasurement } from "./types";

/** One plant measured on the ground. Nothing here is ever invented by the software. */
export type ReferencePlant = {
  /** The field and the scan it belongs to, when known. */
  fieldId?: string | null;
  scanId?: string | null;
  /** The original photo (the camera's filename) and the plant's canopy centre in its native pixels, when the person located it there. */
  image?: string | null;
  x?: number | null;
  y?: number | null;
  /** The finding's id in Swardus, when the person noted it from the spot. */
  plantId?: string | null;
  /** Where it stands, when a receiver or a marker gave it. */
  lat?: number | null;
  lng?: number | null;
  /** Equivalent-circle canopy diameter from a tape or a quadrat, centimetres. Required. */
  diameterCm: number;
  /** Canopy area from a quadrat or a traced photo, square centimetres. Null when not measured. */
  areaCm2?: number | null;
  /** Who measured, how, when; anything the reader should know. */
  notes?: string | null;
  measuredBy?: string | null;
  measuredAt?: string | null;
};

/** What Swardus said: a finding with its measurement, or a local measurement on a photo. */
export type Prediction = {
  id: string;
  image: string | null;
  lat: number | null;
  lng: number | null;
  /** Native pixel in the photo, when the measurement has one. */
  x: number | null;
  y: number | null;
  status: WeedMeasurement["status"];
  diameterCm: number | null;
  areaCm2: number | null;
  gsdCmPx: number | null;
  confidence: number | null;
  reason: string | null;
};

export const DEFAULT_MAX_DISTANCE_M = 0.5;
export const DEFAULT_MAX_PIXEL_DISTANCE = 60;

export type Match = {
  reference: ReferencePlant;
  prediction: Prediction | null;
  how: "id" | "position" | "image-pixel" | "none";
  /** Metres between the reference position and the prediction's, when both have one. */
  distanceM: number | null;
};

const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.hypot((a.lat - b.lat) * 111_320, (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180));

/** A prediction from a finding's stored measurement. */
export function predictionFromMeasurement(id: string, centroid: { lat: number; lng: number } | null, m: WeedMeasurement | null | undefined): Prediction {
  return {
    id, image: m?.sourceFrame ?? null, lat: centroid?.lat ?? null, lng: centroid?.lng ?? null,
    x: m?.centrePx?.x ?? null, y: m?.centrePx?.y ?? null,
    status: m?.status ?? "unavailable", diameterCm: m?.status === "measured" ? m.canopyDiameterCm : null, areaCm2: m?.status === "measured" ? m.canopyAreaCm2 : null,
    gsdCmPx: m?.gsdCmPx ?? null, confidence: m?.confidence ?? null, reason: m?.reason ?? null,
  };
}

/** Each reference plant to the prediction that is the same plant, by the surest key available. A prediction is used once. */
export function matchReferences(references: ReferencePlant[], predictions: Prediction[], opts: { maxDistanceM?: number; maxPixelDistance?: number } = {}): Match[] {
  const maxD = opts.maxDistanceM ?? DEFAULT_MAX_DISTANCE_M, maxPx = opts.maxPixelDistance ?? DEFAULT_MAX_PIXEL_DISTANCE;
  const used = new Set<string>();
  const out: Match[] = [];
  for (const r of references) {
    let best: Prediction | null = null, how: Match["how"] = "none", dist: number | null = null;
    if (r.plantId) {
      const p = predictions.find(q => q.id === r.plantId && !used.has(q.id));
      if (p) { best = p; how = "id"; dist = r.lat != null && r.lng != null && p.lat != null && p.lng != null ? metres({ lat: r.lat, lng: r.lng }, { lat: p.lat, lng: p.lng }) : null; }
    }
    if (!best && r.lat != null && r.lng != null) {
      let bd = Infinity;
      for (const p of predictions) {
        if (used.has(p.id) || p.lat == null || p.lng == null) continue;
        const d = metres({ lat: r.lat, lng: r.lng }, { lat: p.lat, lng: p.lng });
        if (d <= maxD && d < bd) { bd = d; best = p; }
      }
      if (best) { how = "position"; dist = bd; }
    }
    if (!best && r.image && r.x != null && r.y != null) {
      let bd = Infinity;
      for (const p of predictions) {
        if (used.has(p.id) || p.image !== r.image || p.x == null || p.y == null) continue;
        const d = Math.hypot(p.x - r.x, p.y - r.y);
        if (d <= maxPx && d < bd) { bd = d; best = p; }
      }
      if (best) how = "image-pixel";
    }
    if (best) used.add(best.id);
    out.push({ reference: r, prediction: best, how, distanceM: dist });
  }
  return out;
}

export type Bucket = { bucket: string; n: number; medianAbsDiameterErrorCm: number | null; medianRelativeError: number | null };

export type ValidationReport = {
  references: number;
  matched: number;
  /** Matched AND measured: the ones a diameter error exists for. */
  measured: number;
  matchRate: number;
  measuredRate: number;
  howMatched: Record<Match["how"], number>;
  meanAbsDiameterErrorCm: number | null;
  medianAbsDiameterErrorCm: number | null;
  /** |prediction - truth| / truth. */
  meanRelativeError: number | null;
  medianRelativeError: number | null;
  /** Signed, so a bias shows: prediction minus truth, median. */
  medianSignedDiameterErrorCm: number | null;
  area: { n: number; meanAbsErrorCm2: number | null; medianAbsErrorCm2: number | null; medianRelativeError: number | null };
  position: { n: number; meanErrorM: number | null; medianErrorM: number | null };
  byGsd: Bucket[];
  byQuality: Bucket[];
  unmatched: string[];
  refused: { id: string; reason: string | null }[];
  verdict: string;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const r1 = (v: number | null) => (v == null ? null : +v.toFixed(1));
const r3 = (v: number | null) => (v == null ? null : +v.toFixed(3));

/** Plants needed before the verdict will call the accuracy measured. */
export const MIN_PLANTS_FOR_A_CLAIM = 20;

export function validationReport(matches: Match[]): ValidationReport {
  const matched = matches.filter(m => m.prediction);
  const measured = matched.filter(m => m.prediction!.diameterCm != null);
  const dErr = measured.map(m => m.prediction!.diameterCm! - m.reference.diameterCm);
  const rel = measured.map(m => Math.abs(m.prediction!.diameterCm! - m.reference.diameterCm) / m.reference.diameterCm);
  const withArea = measured.filter(m => m.reference.areaCm2 != null && m.prediction!.areaCm2 != null);
  const aErr = withArea.map(m => Math.abs(m.prediction!.areaCm2! - m.reference.areaCm2!));
  const aRel = withArea.map(m => Math.abs(m.prediction!.areaCm2! - m.reference.areaCm2!) / m.reference.areaCm2!);
  const pos = matched.filter(m => m.distanceM != null).map(m => m.distanceM!);
  const bucketBy = (key: (m: Match) => string): Bucket[] => {
    const groups = new Map<string, Match[]>();
    for (const m of measured) { const k = key(m); groups.set(k, [...(groups.get(k) ?? []), m]); }
    return [...groups.entries()].sort().map(([bucket, ms]) => ({
      bucket, n: ms.length,
      medianAbsDiameterErrorCm: r1(median(ms.map(m => Math.abs(m.prediction!.diameterCm! - m.reference.diameterCm)))),
      medianRelativeError: r3(median(ms.map(m => Math.abs(m.prediction!.diameterCm! - m.reference.diameterCm) / m.reference.diameterCm))),
    }));
  };
  const gsdBucket = (m: Match) => { const g = m.prediction!.gsdCmPx; return g == null ? "unknown" : g < 1.5 ? "under 1.5 cm/px" : g < 3 ? "1.5 to 3 cm/px" : "3 cm/px and over"; };
  const qualityBucket = (m: Match) => { const c = m.prediction!.confidence; return c == null ? "unknown" : c < 0.5 ? "confidence under 0.5" : c < 0.8 ? "confidence 0.5 to 0.8" : "confidence 0.8 and over"; };
  const how: Record<Match["how"], number> = { id: 0, position: 0, "image-pixel": 0, none: 0 };
  for (const m of matches) how[m.how]++;
  const verdict = matches.length === 0
    ? "No reference plants: accuracy is unverified."
    : measured.length < MIN_PLANTS_FOR_A_CLAIM
      ? `${measured.length} of ${matches.length} reference plant(s) matched a measured prediction; under ${MIN_PLANTS_FOR_A_CLAIM}, so accuracy is NOT established. The errors below describe these plants only.`
      : `${measured.length} reference plants matched a measured prediction: the errors below are the measured accuracy on this set.`;
  return {
    references: matches.length, matched: matched.length, measured: measured.length,
    matchRate: matches.length ? matched.length / matches.length : 0, measuredRate: matches.length ? measured.length / matches.length : 0,
    howMatched: how,
    meanAbsDiameterErrorCm: r1(mean(dErr.map(Math.abs))), medianAbsDiameterErrorCm: r1(median(dErr.map(Math.abs))),
    meanRelativeError: r3(mean(rel)), medianRelativeError: r3(median(rel)), medianSignedDiameterErrorCm: r1(median(dErr)),
    area: { n: withArea.length, meanAbsErrorCm2: r1(mean(aErr)), medianAbsErrorCm2: r1(median(aErr)), medianRelativeError: r3(median(aRel)) },
    position: { n: pos.length, meanErrorM: r3(mean(pos)), medianErrorM: r3(median(pos)) },
    byGsd: bucketBy(gsdBucket), byQuality: bucketBy(qualityBucket),
    unmatched: matches.filter(m => !m.prediction).map(m => m.reference.plantId ?? (m.reference.image ? `${m.reference.image}@${m.reference.x},${m.reference.y}` : `${m.reference.lat},${m.reference.lng}`)),
    refused: matched.filter(m => m.prediction!.diameterCm == null).map(m => ({ id: m.prediction!.id, reason: m.prediction!.reason })),
    verdict,
  };
}

/** The reference file's rows, checked: a row without a diameter is an error, not a plant. */
export function readReferences(json: unknown): { references: ReferencePlant[]; errors: string[] } {
  const errors: string[] = [];
  const references: ReferencePlant[] = [];
  if (!Array.isArray(json)) return { references, errors: ["the reference file must be a JSON array of plants"] };
  json.forEach((row, i) => {
    const r = row as Partial<ReferencePlant> & { _comment?: string };
    if (r._comment && Object.keys(r).length === 1) return;
    if (typeof r.diameterCm !== "number" || !(r.diameterCm > 0)) { errors.push(`row ${i}: diameterCm is required and must be a positive number`); return; }
    if (!r.plantId && !(r.lat != null && r.lng != null) && !(r.image && r.x != null && r.y != null)) { errors.push(`row ${i}: give plantId, or lat and lng, or image with x and y, so the plant can be matched`); return; }
    references.push({
      fieldId: r.fieldId ?? null, scanId: r.scanId ?? null, image: r.image ?? null, x: r.x ?? null, y: r.y ?? null, plantId: r.plantId ?? null,
      lat: r.lat ?? null, lng: r.lng ?? null, diameterCm: r.diameterCm, areaCm2: typeof r.areaCm2 === "number" ? r.areaCm2 : null,
      notes: r.notes ?? null, measuredBy: r.measuredBy ?? null, measuredAt: r.measuredAt ?? null,
    });
  });
  return { references, errors };
}

/** The report as a few lines a person reads. */
export function reportLines(r: ValidationReport): string[] {
  const out = [r.verdict];
  out.push(`Matched ${r.matched} of ${r.references} (${r.howMatched.id} by id, ${r.howMatched.position} by position, ${r.howMatched["image-pixel"]} by photo and pixel); ${r.measured} with a measured diameter.`);
  if (r.measured) {
    out.push(`Diameter: mean abs error ${r.meanAbsDiameterErrorCm} cm, median abs ${r.medianAbsDiameterErrorCm} cm, median signed ${r.medianSignedDiameterErrorCm} cm (positive reads large), relative median ${((r.medianRelativeError ?? 0) * 100).toFixed(0)}%.`);
    out.push(r.area.n ? `Area (${r.area.n} with a reference): median abs error ${r.area.medianAbsErrorCm2} cm², relative median ${((r.area.medianRelativeError ?? 0) * 100).toFixed(0)}%.` : "Area: no reference areas given.");
    out.push(r.position.n ? `Position (${r.position.n} with coordinates): median ${r.position.medianErrorM} m, mean ${r.position.meanErrorM} m.` : "Position: no reference coordinates given.");
    for (const b of r.byGsd) out.push(`  ${b.bucket}: ${b.n} plant(s), median abs ${b.medianAbsDiameterErrorCm} cm (${((b.medianRelativeError ?? 0) * 100).toFixed(0)}%)`);
    for (const b of r.byQuality) out.push(`  ${b.bucket}: ${b.n} plant(s), median abs ${b.medianAbsDiameterErrorCm} cm (${((b.medianRelativeError ?? 0) * 100).toFixed(0)}%)`);
  }
  if (r.refused.length) out.push(`Refused by the measurement: ${r.refused.map(x => `${x.id} (${x.reason ?? "?"})`).join("; ")}`);
  if (r.unmatched.length) out.push(`Unmatched: ${r.unmatched.join(", ")}`);
  return out;
}
