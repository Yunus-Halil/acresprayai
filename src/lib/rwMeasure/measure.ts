// From a mask and a scale to centimetres, with the assumption stated.
import { boundary } from "./canopy";
import { convexHull, equivalentDiameterCm, maxSpan, perpendicularSpan, pxToCm, roundCm } from "./geometry";
import type { Calibration, GroundTruth, Measurement, Pt, SegmentationQuality } from "./types";

/** Off-nadir beyond this, degrees, a uniform scale over the plant is not claimed and the area is withheld. */
export const MAX_OFF_NADIR_DEG = 8;

export function measureCanopy(mask: Uint8Array, w: number, h: number, scale: number, cal: Calibration, seg: SegmentationQuality, gimbalPitchDeg: number | null): { measurement: Measurement; outlinePx: Pt[] | null } {
  const refuse = (reason: string, assumption: string): { measurement: Measurement; outlinePx: Pt[] | null } => ({
    measurement: { status: "refused", reason, maxSpanCm: null, perpendicularSpanCm: null, canopyAreaCm2: null, equivalentDiameterCm: null, spanEndpoints: null, perpendicularEndpoints: null, scaleAssumption: assumption },
    outlinePx: null,
  });
  const offNadir = gimbalPitchDeg == null ? null : Math.abs(-90 - gimbalPitchDeg);
  const assumption = offNadir == null
    ? "the camera's pitch is unknown; a uniform scale over the plant is assumed and not justified"
    : offNadir <= MAX_OFF_NADIR_DEG
      ? `near nadir (${offNadir.toFixed(1)} degrees off): the tape's scale is taken as uniform over the plant in both directions; leaves above the tape's plane read slightly large (about their height over the camera height)`
      : `${offNadir.toFixed(1)} degrees off nadir: the tape constrains scale along its length only; across it the scale is not established, so the area is withheld`;
  if (cal.status === "failed" || cal.pixelsPerCm == null) return refuse(`no scale: ${cal.reason ?? "calibration failed"}`, assumption);
  if (seg.status === "failed") return refuse(`no canopy: ${seg.reason ?? "segmentation failed"}`, assumption);
  const pts = boundary(mask, w, h).map(p => ({ x: (p.x + 0.5) * scale, y: (p.y + 0.5) * scale }));
  if (pts.length < 3) return refuse("the canopy mask has under three boundary pixels", assumption);
  const hull = convexHull(pts);
  const span = maxSpan(hull);
  if (!span) return refuse("no span", assumption);
  const perp = perpendicularSpan(pts, span);
  const ppcm = cal.pixelsPerCm;
  let n = 0; for (let i = 0; i < w * h; i++) if (mask[i]) n++;
  const areaValid = offNadir != null && offNadir <= MAX_OFF_NADIR_DEG && seg.status !== "edge-cut";
  const areaCm2 = areaValid ? (n * scale * scale) / (ppcm * ppcm) : null;
  // The outline for drawing: boundary points thinned.
  const step = Math.max(1, Math.ceil(pts.length / 400));
  const outlinePx = pts.filter((_, i) => i % step === 0);
  return {
    measurement: {
      status: "measured", reason: seg.status === "edge-cut" ? "the canopy is cut by the picture's edge: the span is a lower bound and the area is withheld" : seg.status === "merged" ? "another plant is inside the mask: the numbers are the clump's, not one plant's" : null,
      maxSpanCm: roundCm(pxToCm(span.lengthPx, ppcm)),
      perpendicularSpanCm: perp ? roundCm(pxToCm(perp.lengthPx, ppcm)) : null,
      canopyAreaCm2: areaCm2 == null ? null : Math.round(areaCm2),
      equivalentDiameterCm: areaCm2 == null ? null : roundCm(equivalentDiameterCm(areaCm2)),
      spanEndpoints: [span.a, span.b], perpendicularEndpoints: perp ? [perp.a, perp.b] : null,
      scaleAssumption: assumption,
    },
    outlinePx,
  };
}

/** Prediction against a person's tape measurement; unavailable without one. */
export function compare(m: Measurement, gt: GroundTruth | null | undefined): { absoluteErrorCm: number | null; signedErrorCm: number | null; percentError: number | null; available: boolean } {
  if (!gt || gt.maxSpanCm == null || m.status !== "measured" || m.maxSpanCm == null) return { absoluteErrorCm: null, signedErrorCm: null, percentError: null, available: false };
  const signed = m.maxSpanCm - gt.maxSpanCm;
  return { absoluteErrorCm: +Math.abs(signed).toFixed(1), signedErrorCm: +signed.toFixed(1), percentError: gt.maxSpanCm > 0 ? +((signed / gt.maxSpanCm) * 100).toFixed(0) : null, available: true };
}
