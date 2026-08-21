// Holding the spray back from the field edge.
//
// WHY A PLAN SHOULD NOT REACH THE BOUNDARY. The passes used to run to the
// literal edge of the field. Nobody flies that way: the aircraft needs ground to
// turn around in, and the last thing an operator wants is chemical crossing a
// property line, a road, or a watercourse. DJI's own planner draws an inner
// boundary inside the field boundary for exactly this, and every sprayer pilot
// calls the strip between them the headland.
//
// WHAT THIS MODULE IS. An inward offset of a ring, in metres, plus an honest
// account of when it could not be done. It is geometry only — no drone, no
// rates, no React — and the planner applies it in ONE place, before both the
// route and the area the chemical is priced on, so the two cannot disagree
// about what is being sprayed.
//
// THE SEAM FOR PER-EDGE BUFFERS. `insetRing` takes either a distance or a
// function of the edge. Today the planner passes a number and every edge is
// held back equally. The next step — a wider buffer where the field meets a
// house, a waterway or a road, and a narrow one along an open edge shared with
// more of the same crop — is that same function returning different distances,
// with the edge classification coming from whatever eventually knows it
// (boundary metadata, a map layer, the operator drawing it). That is a real
// agronomic and regulatory concern, not a nicety: drift onto a neighbour's
// orchard or into a creek is the kind of mistake that ends a spray licence.
// Nothing below assumes the distance is uniform.
import {
  type LatLng2, M_PER_DEG_LAT, mPerDegLng, polygonAreaM2,
} from "./geo";
import { minWidthM } from "./treatmentGrid";

/**
 * Default headland width, metres.
 *
 * TUNABLE STARTING VALUE, NOT A VERIFIED FIGURE. Three metres is a plausible
 * working default for a small field — roughly a third of a T40's boom — chosen
 * so the effect is visible and conservative rather than because any standard
 * prescribes it. The right number depends on the aircraft's turn, the wind on
 * the day, what borders the field, and local buffer-zone rules, which vary by
 * jurisdiction and by product label. Operators can change it per field; nobody
 * should read this constant as a compliance boundary.
 */
export const DEFAULT_HEADLAND_M = 3;

/** Nothing sensible happens past this; the UI caps the slider here too. */
export const MAX_HEADLAND_M = 30;

/** Per-edge distance, or one distance for every edge. */
export type InsetSpec = number | ((edgeIndex: number, a: LatLng2, b: LatLng2) => number);

const insetAt = (spec: InsetSpec, i: number, a: LatLng2, b: LatLng2): number =>
  typeof spec === "number" ? spec : spec(i, a, b);

type Pt = { x: number; y: number };

/** Signed area in the local metric frame; positive means counter-clockwise. */
function signedArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/**
 * Offset every edge inward and re-intersect the neighbours.
 *
 * Exact for a convex ring, which is what a field boundary and a grid zone's
 * outline almost always are. On a concave ring it can pull a reflex corner past
 * itself, so the caller validates the result rather than trusting it — see
 * `applyHeadland`, which throws the whole attempt away if the shape comes back
 * inverted, collapsed or larger than it started.
 *
 * Returns null when the ring is too small to offset at all.
 */
export function insetRing(ring: LatLng2[], inset: InsetSpec): LatLng2[] | null {
  if (!ring || ring.length < 3) return null;

  // Work in metres about the ring's own centroid: offsetting in degrees would
  // push the north and south edges by different distances.
  const origin = {
    lat: ring.reduce((s, p) => s + p.lat, 0) / ring.length,
    lng: ring.reduce((s, p) => s + p.lng, 0) / ring.length,
  };
  const mLng = mPerDegLng(origin.lat);
  const toLocal = (p: LatLng2): Pt => ({
    x: (p.lng - origin.lng) * mLng,
    y: (p.lat - origin.lat) * M_PER_DEG_LAT,
  });
  const toWorld = (p: Pt): LatLng2 => ({
    lat: origin.lat + p.y / M_PER_DEG_LAT,
    lng: origin.lng + p.x / mLng,
  });

  let pts = ring.map(toLocal);
  // Drop repeated vertices; a zero-length edge has no direction to offset along.
  pts = pts.filter((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return Math.hypot(q.x - p.x, q.y - p.y) > 1e-9;
  });
  if (pts.length < 3) return null;

  // "Inward" depends on winding, so establish it rather than assuming it.
  const ccw = signedArea(pts) > 0;

  // Each edge becomes a line moved toward the interior by its own distance.
  const lines: { px: number; py: number; dx: number; dy: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return null;
    const ux = dx / len, uy = dy / len;
    // Left normal for a counter-clockwise ring points inward; right normal for
    // a clockwise one.
    const nx = ccw ? -uy : uy;
    const ny = ccw ? ux : -ux;
    const d = Math.max(0, insetAt(inset, i, toWorld(a), toWorld(b)));
    lines.push({ px: a.x + nx * d, py: a.y + ny * d, dx: ux, dy: uy });
  }

  // A new vertex is where consecutive offset edges cross.
  const out: Pt[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l1 = lines[(i - 1 + lines.length) % lines.length];
    const l2 = lines[i];
    const denom = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(denom) < 1e-9) {
      // Parallel neighbours (a straight-through vertex): the offset lines are
      // collinear, so the moved vertex is simply on the second line.
      out.push({ x: l2.px, y: l2.py });
      continue;
    }
    const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / denom;
    out.push({ x: l1.px + l1.dx * t, y: l1.py + l1.dy * t });
  }

  if (out.length < 3) return null;
  return out.map(toWorld);
}

/**
 * The discriminant is a string rather than a boolean because this project
 * compiles with `strict` off, where narrowing a union by a boolean literal is
 * not reliable. `kind` narrows either way, and reads better at the call site.
 */
export type HeadlandOutcome =
  | {
      kind: "applied";
      /** The ring the passes should be planned inside. */
      ring: LatLng2[];
      /**
       * Sprayed area ÷ original area, 0–1.
       *
       * Carried as a RATIO rather than an absolute area on purpose. A grid zone
       * already knows its own true clipped area — summed from its member cells,
       * which is the number the prescription is priced on — and recomputing an
       * area from ring geometry would quietly replace that with a different and
       * slightly wrong one. Scaling preserves the zone's own arithmetic and
       * applies only the headland's proportional bite.
       */
      areaScale: number;
      insetM: number;
    }
  | {
      kind: "waived";
      /** Unchanged. The zone is still sprayed, just without a headland. */
      ring: LatLng2[];
      reason: string;
      insetM: number;
    };

/**
 * Hold a ring back from its own edge, or explain why that was not possible.
 *
 * THE DEGENERATE CASE IS THE POINT. A zone narrower than twice the inset has no
 * inside left once both sides are held back, and the naive answer — an empty or
 * inverted polygon — plans no passes at all. A small patch that silently
 * vanishes from the plan is the worst outcome available here: the operator
 * believes it was treated. So a zone that cannot take the headland keeps its
 * full extent and says so, and the caller surfaces that rather than dropping it.
 */
export function applyHeadland(
  ring: LatLng2[],
  insetM: number,
  opts: { label?: string } = {},
): HeadlandOutcome {
  const what = opts.label ?? "This zone";
  if (!ring || ring.length < 3) {
    return { kind: "waived", ring, reason: `${what} has no usable outline.`, insetM };
  }
  if (!(insetM > 0)) {
    return { kind: "waived", ring, reason: "No headland is set.", insetM: 0 };
  }

  const origin = {
    lat: ring.reduce((s, p) => s + p.lat, 0) / ring.length,
    lng: ring.reduce((s, p) => s + p.lng, 0) / ring.length,
  };
  // The same narrowest-width measure the treatment grid uses to warn about
  // plots thinner than the boom. Measured across the convex hull, so it can
  // only overstate the width — it will never waive a headland that would in
  // fact have fitted.
  const widthM = minWidthM(ring, origin);
  // The tolerance matters at the exact boundary of the degenerate case: a zone
  // measured at 10.0000001 m across, asked for two 5 m headlands, is not a zone
  // with a millionth of a metre left in the middle. Without the slack it slips
  // past this guard and comes back as a hairline polygon with a positive area,
  // which is worse than either honest answer.
  if (widthM > 0 && widthM <= insetM * 2 + 1e-6) {
    return {
      kind: "waived",
      ring,
      reason:
        `${what} is about ${widthM.toFixed(1)} m across, narrower than a ${insetM.toFixed(1)} m ` +
        `headland on both sides. It is planned to its full extent instead of being dropped.`,
      insetM,
    };
  }

  const inner = insetRing(ring, insetM);
  const before = Math.abs(polygonAreaM2(ring));
  const after = inner ? Math.abs(polygonAreaM2(inner)) : 0;

  // Validation, because the offset is exact only for convex rings. An inverted
  // or grown result means a corner folded through itself; better to fly the
  // zone whole than to fly a shape nobody intended.
  //
  // COLLAPSE_FLOOR is the backstop for the same failure the width check above
  // catches head-on: a concave ring can survive that check and still be reduced
  // to a sliver by the offset. A shape with a hundredth of its area left is not
  // a zone the aircraft can fly; it is a line with a rounding error for a width.
  const COLLAPSE_FLOOR = 0.01;
  if (!inner || inner.length < 3 || !(after > 0) || after >= before
      || after < before * COLLAPSE_FLOOR) {
    return {
      kind: "waived",
      ring,
      reason: `${what} could not be inset cleanly at ${insetM.toFixed(1)} m, so it is planned to its full extent.`,
      insetM,
    };
  }

  return { kind: "applied", ring: inner, areaScale: after / before, insetM };
}

/** Convenience for callers that only need the ratio. */
export const headlandAreaScale = (o: HeadlandOutcome): number =>
  o.kind === "applied" ? o.areaScale : 1;

/**
 * Why the headland was not applied, or null when it was.
 *
 * Offered as a function rather than left to callers to read `.reason` off the
 * union: this project compiles with `strict` off, where narrowing a
 * discriminated union by its boolean discriminant does not reliably hold, and a
 * caller working around that with a cast is a caller who can cast the wrong
 * way. There is one place that knows the shape, and this is it.
 */
export const headlandReason = (o: HeadlandOutcome): string | null =>
  o.kind === "applied" ? null : o.reason;
