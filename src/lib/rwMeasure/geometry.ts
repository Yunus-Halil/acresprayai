// The arithmetic of the experiment: units, scale, span, width across, area.
// Pure, tested on its own.
import { CM_PER_INCH, type Pt } from "./types";

export const inchesToCm = (inches: number): number => inches * CM_PER_INCH;

/** Pixels per centimetre from an inch in pixels. */
export const pixelsPerCmFromInchPx = (inchPx: number): number => inchPx / CM_PER_INCH;

export const pxToCm = (px: number, pixelsPerCm: number): number => px / pixelsPerCm;

/** Monotone-chain convex hull. */
export function convexHull(points: Pt[]): Pt[] {
  if (points.length < 3) return [...points];
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/** The two hull points furthest apart. Null under two points. */
export function maxSpan(hull: Pt[]): { a: Pt; b: Pt; lengthPx: number } | null {
  if (hull.length < 2) return null;
  let best = -1, a = hull[0], b = hull[0];
  for (let i = 0; i < hull.length; i++) for (let j = i + 1; j < hull.length; j++) {
    const d = Math.hypot(hull[i].x - hull[j].x, hull[i].y - hull[j].y);
    if (d > best) { best = d; a = hull[i]; b = hull[j]; }
  }
  return { a, b, lengthPx: best };
}

/**
 * The extent of a set of boundary points perpendicular to the span axis, and
 * the two extreme points that set it (projected onto the span's midline so
 * they draw as one line across the canopy).
 */
export function perpendicularSpan(points: Pt[], span: { a: Pt; b: Pt }): { a: Pt; b: Pt; lengthPx: number } | null {
  const dx = span.b.x - span.a.x, dy = span.b.y - span.a.y, len = Math.hypot(dx, dy);
  if (!(len > 0) || points.length < 2) return null;
  const nx = -dy / len, ny = dx / len;
  let lo = Infinity, hi = -Infinity, pLo = points[0], pHi = points[0];
  for (const p of points) { const t = (p.x - span.a.x) * nx + (p.y - span.a.y) * ny; if (t < lo) { lo = t; pLo = p; } if (t > hi) { hi = t; pHi = p; } }
  const mid = { x: (span.a.x + span.b.x) / 2, y: (span.a.y + span.b.y) / 2 };
  // Each extreme point, slid along the span direction onto the line through the midpoint, so the drawn line crosses the canopy at its middle.
  const slide = (p: Pt) => { const t = (p.x - mid.x) * (dx / len) + (p.y - mid.y) * (dy / len); return { x: p.x - t * (dx / len), y: p.y - t * (dy / len) }; };
  return { a: slide(pLo), b: slide(pHi), lengthPx: hi - lo };
}

export const equivalentDiameterCm = (areaCm2: number): number => 2 * Math.sqrt(areaCm2 / Math.PI);

/** Round to a sensible number of figures for a centimetre measurement: one decimal under 10 cm, none above. */
export const roundCm = (cm: number): number => (cm < 10 ? +cm.toFixed(1) : Math.round(cm));

/**
 * Pixels per centimetre from a person's points on the tape: every pair of
 * points gives a scale from its pixel distance and its inch difference; the
 * median is the scale and the spread the uncertainty. Needs two points at
 * least 2 inches apart.
 */
export function scaleFromRulerPoints(points: { x: number; y: number; inches: number }[]): { pixelsPerCm: number; relativeUncertainty: number } | null {
  const est: number[] = [];
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const din = Math.abs(points[i].inches - points[j].inches);
    if (din < 2) continue;
    est.push(Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) / inchesToCm(din));
  }
  if (!est.length) return null;
  const s = [...est].sort((a, b) => a - b), med = s[Math.floor(s.length / 2)];
  const spread = s.length > 1 ? (s[s.length - 1] - s[0]) / med : 0.01;
  return { pixelsPerCm: med, relativeUncertainty: Math.max(0.005, spread / 2) };
}
