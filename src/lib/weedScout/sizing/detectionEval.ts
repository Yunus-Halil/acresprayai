// Detection evaluation: a person's labels against Swardus's components in a
// region, one to one. Pure, so the command, a test and a later screen share
// one definition of a hit.
//
// A label is a point (and a class: weed, crop, uncertain) a person put on a
// plant in a region of a photo, with provenance. A prediction is a component
// the pipeline produced there, with its disposition. Matching is one to one:
// a label is matched to the nearest unused prediction whose centre lies
// within the larger of the tolerance and the prediction's own radius, and a
// prediction is used once, so one large prediction never counts as several
// detected weeds. Precision, recall and F1 are over the weed labels and the
// weed-candidate predictions; crop labels matched by a weed candidate are the
// crop-to-weed confusion; uncertain labels are kept out of every rate and
// counted separately. Segmentation is scored apart from classification: a
// label matched by ANY component is "segmented", whatever its disposition.
import type { Disposition } from "../structure/trace";

export type LabelClass = "weed" | "crop" | "uncertain";

export type Label = {
  id: string;
  /** Native pixel of the plant's centre in the region's photo. */
  x: number;
  y: number;
  cls: LabelClass;
  /** Canopy diameter in cm when the person measured or estimated it; null otherwise. */
  diameterCm?: number | null;
  /** Shade over the plant, when the person noted it. */
  shadow?: boolean | null;
  /** Metres from the nearest crop row, when the person noted it. */
  distanceToRowM?: number | null;
  notes?: string | null;
};

export type RegionPrediction = {
  id: string;
  x: number;
  y: number;
  /** Equivalent diameter, metres, at the scale it was read. */
  equivDiameterM: number;
  disposition: Disposition;
  reason: string | null;
  /** The measured diameter, cm, when the sizer gave one. */
  measuredCm: number | null;
  distanceToRowM: number | null;
};

/** Dispositions that mean "this is a weed candidate the operator would be shown". */
export const CANDIDATE_DISPOSITIONS: Disposition[] = ["candidate: measured", "candidate: refused", "candidate: not measured", "hidden: under the display floor"];

export type Matched = { label: Label; prediction: RegionPrediction | null; distancePx: number | null };

export const DEFAULT_MATCH_TOLERANCE_PX = 25;

/** Each label to the nearest unused prediction within reach; the reach is the larger of the tolerance and the prediction's own radius in pixels. */
export function matchLabels(labels: Label[], predictions: RegionPrediction[], gsdM: number, tolerancePx = DEFAULT_MATCH_TOLERANCE_PX): Matched[] {
  const used = new Set<string>();
  // Nearest pairs first, so a label between two predictions takes the closer and leaves the other.
  const pairs: { li: number; p: RegionPrediction; d: number }[] = [];
  labels.forEach((l, li) => {
    for (const p of predictions) {
      const d = Math.hypot(p.x - l.x, p.y - l.y);
      const reach = Math.max(tolerancePx, (p.equivDiameterM / gsdM) / 2);
      if (d <= reach) pairs.push({ li, p, d });
    }
  });
  pairs.sort((a, b) => a.d - b.d);
  const out: Matched[] = labels.map(l => ({ label: l, prediction: null, distancePx: null }));
  for (const { li, p, d } of pairs) {
    if (out[li].prediction || used.has(p.id)) continue;
    out[li].prediction = p; out[li].distancePx = d; used.add(p.id);
  }
  return out;
}

export type Rate = { n: number; hits: number; rate: number | null };
const rate = (hits: number, n: number): Rate => ({ n, hits, rate: n ? +(hits / n).toFixed(3) : null });

export type DetectionReport = {
  labels: { weed: number; crop: number; uncertain: number };
  predictions: { total: number; candidates: number };
  /** Weed labels matched by any component at all: what segmentation found, whatever it was called. */
  segmentation: { weedsSegmented: Rate; weedsMissedBySegmentation: string[] };
  /** Weed labels matched by a weed candidate. */
  classification: {
    truePositives: number; falseNegatives: number; falsePositives: number;
    precision: number | null; recall: number | null; f1: number | null;
    /** Weed labels found by a component that was not a candidate, by its disposition: detected, then lost to classification or a filter. */
    weedsLostTo: Record<string, number>;
    /** Crop labels matched by a weed candidate. */
    cropCalledWeed: number;
    /** Weed candidates that matched an uncertain label: neither right nor wrong. */
    candidatesOnUncertain: number;
  };
  bySize: { bucket: string; n: number; recall: number | null }[];
  byDistanceToRow: { bucket: string; n: number; recall: number | null }[];
  byShadow: { bucket: string; n: number; recall: number | null }[];
  measurement: { n: number; medianAbsErrorCm: number | null; medianRelativeError: number | null };
  falsePositiveIds: string[];
  falseNegativeIds: string[];
  verdict: string;
};

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

export function detectionReport(matches: Matched[], predictions: RegionPrediction[]): DetectionReport {
  const weeds = matches.filter(m => m.label.cls === "weed");
  const crops = matches.filter(m => m.label.cls === "crop");
  const uncertain = matches.filter(m => m.label.cls === "uncertain");
  const isCandidate = (p: RegionPrediction | null) => !!p && CANDIDATE_DISPOSITIONS.includes(p.disposition);
  const tp = weeds.filter(m => isCandidate(m.prediction));
  const fn = weeds.filter(m => !isCandidate(m.prediction));
  const matchedIds = new Set(matches.map(m => m.prediction?.id).filter(Boolean) as string[]);
  const candidates = predictions.filter(p => CANDIDATE_DISPOSITIONS.includes(p.disposition));
  // A candidate that matched no weed label and no uncertain label is a false positive; one on a crop label is the confusion.
  const onUncertainIds = new Set(uncertain.map(m => m.prediction?.id).filter(Boolean) as string[]);
  const onCropIds = new Set(crops.map(m => m.prediction?.id).filter(Boolean) as string[]);
  const fp = candidates.filter(p => !matchedIds.has(p.id) || onCropIds.has(p.id));
  const precision = candidates.length - onUncertainIds.size ? tp.length / (tp.length + fp.length) : null;
  const recall = weeds.length ? tp.length / weeds.length : null;
  const f1 = precision != null && recall != null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  const lostTo: Record<string, number> = {};
  for (const m of fn) if (m.prediction) lostTo[m.prediction.disposition] = (lostTo[m.prediction.disposition] ?? 0) + 1;
  const bucket = (ms: Matched[], key: (m: Matched) => string | null) => {
    const g = new Map<string, Matched[]>();
    for (const m of ms) { const k = key(m); if (k == null) continue; g.set(k, [...(g.get(k) ?? []), m]); }
    return [...g.entries()].sort().map(([b, list]) => ({ bucket: b, n: list.length, recall: rate(list.filter(m => isCandidate(m.prediction)).length, list.length).rate }));
  };
  const sizeOf = (m: Matched) => m.label.diameterCm ?? (m.prediction ? m.prediction.equivDiameterM * 100 : null);
  const measured = tp.filter(m => m.label.diameterCm != null && m.prediction!.measuredCm != null);
  const errs = measured.map(m => Math.abs(m.prediction!.measuredCm! - m.label.diameterCm!));
  const rel = measured.map(m => Math.abs(m.prediction!.measuredCm! - m.label.diameterCm!) / m.label.diameterCm!);
  const verdict = matches.length === 0
    ? "No labels: detection accuracy cannot be calculated."
    : weeds.length < 20
      ? `${weeds.length} weed label(s): under 20, so the rates describe these plants only and establish nothing.`
      : `${weeds.length} weed labels: the rates are the measured performance on this set.`;
  return {
    labels: { weed: weeds.length, crop: crops.length, uncertain: uncertain.length },
    predictions: { total: predictions.length, candidates: candidates.length },
    segmentation: { weedsSegmented: rate(weeds.filter(m => m.prediction).length, weeds.length), weedsMissedBySegmentation: weeds.filter(m => !m.prediction).map(m => m.label.id) },
    classification: {
      truePositives: tp.length, falseNegatives: fn.length, falsePositives: fp.length,
      precision: precision == null ? null : +precision.toFixed(3), recall: recall == null ? null : +recall.toFixed(3), f1: f1 == null ? null : +f1.toFixed(3),
      weedsLostTo: lostTo, cropCalledWeed: crops.filter(m => isCandidate(m.prediction)).length, candidatesOnUncertain: uncertain.filter(m => isCandidate(m.prediction)).length,
    },
    bySize: bucket(weeds, m => { const s = sizeOf(m); return s == null ? null : s < 10 ? "under 10 cm" : s < 30 ? "10 to 30 cm" : "30 cm and over"; }),
    byDistanceToRow: bucket(weeds, m => { const d = m.label.distanceToRowM ?? m.prediction?.distanceToRowM ?? null; return d == null ? null : Math.abs(d) < 0.3 ? "under 30 cm from a row" : Math.abs(d) < 1 ? "30 cm to 1 m" : "over 1 m"; }),
    byShadow: bucket(weeds, m => (m.label.shadow == null ? null : m.label.shadow ? "in shadow" : "in sun")),
    measurement: { n: measured.length, medianAbsErrorCm: errs.length ? +median(errs)!.toFixed(1) : null, medianRelativeError: rel.length ? +median(rel)!.toFixed(3) : null },
    falsePositiveIds: fp.map(p => p.id),
    falseNegativeIds: fn.map(m => m.label.id),
    verdict,
  };
}

export function detectionLines(r: DetectionReport): string[] {
  const c = r.classification;
  const pct = (v: number | null) => (v == null ? "-" : `${(v * 100).toFixed(0)}%`);
  const out = [r.verdict];
  out.push(`Labels: ${r.labels.weed} weed, ${r.labels.crop} crop, ${r.labels.uncertain} uncertain. Predictions: ${r.predictions.total} components, ${r.predictions.candidates} weed candidates.`);
  if (r.labels.weed) {
    out.push(`Segmentation: ${r.segmentation.weedsSegmented.hits} of ${r.segmentation.weedsSegmented.n} weeds found by some component (${pct(r.segmentation.weedsSegmented.rate)}).`);
    out.push(`Classification: precision ${pct(c.precision)}, recall ${pct(c.recall)}, F1 ${pct(c.f1)}; ${c.truePositives} hits, ${c.falseNegatives} missed, ${c.falsePositives} false candidates; crop called weed ${c.cropCalledWeed}; candidates on uncertain plants ${c.candidatesOnUncertain}.`);
    if (Object.keys(c.weedsLostTo).length) out.push(`Weeds detected but lost to: ${Object.entries(c.weedsLostTo).map(([k, v]) => `${v} ${k}`).join("; ")}.`);
    for (const b of r.bySize) out.push(`  ${b.bucket}: ${b.n}, recall ${pct(b.recall)}`);
    for (const b of r.byDistanceToRow) out.push(`  ${b.bucket}: ${b.n}, recall ${pct(b.recall)}`);
    for (const b of r.byShadow) out.push(`  ${b.bucket}: ${b.n}, recall ${pct(b.recall)}`);
    if (r.measurement.n) out.push(`Measurement (${r.measurement.n} with a labelled diameter): median abs error ${r.measurement.medianAbsErrorCm} cm, relative ${pct(r.measurement.medianRelativeError)}.`);
  }
  return out;
}
