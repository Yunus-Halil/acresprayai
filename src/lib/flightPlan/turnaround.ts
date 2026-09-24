// The turn at the end of a line.
//
// A serpentine grid drawn as bare line segments asks the aircraft to arrive at
// the end of a line at speed, reverse direction in zero distance, and leave
// down the next one. Nothing flies that. What actually happens is the aircraft
// decelerates to a stop, yaws, and accelerates again, which costs time at every
// turn and puts the first frames of the next line in the middle of an
// acceleration. A planner that draws the impossible version is not describing
// the flight.
//
// So the turn gets a shape: the aircraft carries on past the end of the line,
// arcs round, and comes back onto the next line already straight and up to
// speed. That arc is OUTSIDE the survey area, necessarily and by design. It is
// the one part of the route that crosses ground the operator did not draw,
// which is why `turnaroundExcursionM` exists and why the UI states it: on a
// small parcel with trees at the edge, how far the aircraft swings out is a
// thing to check before taking off, not after.
import { type LatLng2, M_PER_DEG_LAT, distM, mPerDegLng } from "../geo";

/**
 * Standard gravity, m/s^2. Used for the turn radius and nothing else.
 */
const G = 9.80665;

/**
 * The bank angle a turn is planned around.
 *
 * A survey aircraft turning between lines is not being flown aggressively, and
 * 20 degrees is the conventional figure for a coordinated cruise turn. It is
 * stated as a constant because the radius below is only as meaningful as this
 * assumption, and an operator who flies theirs harder should know which number
 * to change.
 */
export const TURN_BANK_DEG = 20;

/**
 * The tightest turn an aircraft can hold at a given speed, in metres.
 *
 * r = v^2 / (g * tan(bank)), the standard coordinated-turn radius. At 6 m/s and
 * 20 degrees that is about 10 m.
 *
 * This is NOT enforced. It is compared against the turn the line spacing
 * implies, so that a plan whose turns are tighter than the aircraft can hold
 * says so, rather than quietly producing a flight that spends its time
 * decelerating. Forcing the radius instead would push the aircraft further
 * outside the boundary than the operator asked for, which is the more dangerous
 * of the two failures.
 */
export function minTurnRadiusM(speedMs: number, bankDeg = TURN_BANK_DEG): number {
  const v = Math.max(0, speedMs);
  const bank = Math.max(1, Math.min(60, bankDeg));
  return (v * v) / (G * Math.tan((bank * Math.PI) / 180));
}

export type TurnaroundParams = {
  /**
   * How far the aircraft carries on past the end of a line before it starts to
   * turn, and how far it runs in straight before the next line's first photo.
   *
   * Zero gives a clean semicircle, which is already flyable. Raising it buys
   * settling distance at the cost of flying further outside the boundary.
   */
  overshootM: number;
  /**
   * Waypoints placed around the arc, not counting its two ends.
   *
   * Every one of these is a waypoint in the exported file and counts against
   * the airframe's ceiling, so this trades smoothness against how large a field
   * can be planned in a single flight.
   */
  arcPoints: number;
};

export const DEFAULT_TURNAROUND: TurnaroundParams = { overshootM: 0, arcPoints: 6 };

/** A local metres frame, so the arc can be built with plain trigonometry. */
function frame(origin: LatLng2) {
  const mLng = mPerDegLng(origin.lat);
  return {
    toM: (p: LatLng2) => ({
      x: (p.lng - origin.lng) * mLng,
      y: (p.lat - origin.lat) * M_PER_DEG_LAT,
    }),
    toLL: (x: number, y: number): LatLng2 => ({
      lat: origin.lat + y / M_PER_DEG_LAT,
      lng: origin.lng + x / mLng,
    }),
  };
}

/**
 * The path from the end of one line to the start of the next.
 *
 * Returns only the points BETWEEN them: the caller already has both ends, and
 * duplicating them would put two waypoints on the same spot, which DJI accepts
 * and an operator reading a waypoint count does not.
 *
 * The shape is a straight run-out, a half circle whose diameter is the gap
 * between the two lines, and a straight run-in. The half circle is what makes
 * it flyable: its radius is half the line spacing, the aircraft leaves the line
 * on its own heading and rejoins the next one already pointing down it.
 *
 * `heading` is the direction of travel at `from`, which is not always the
 * direction from `from` to `to`, and cannot be recovered from the two points
 * alone: at the moment of the turn the aircraft is travelling along the line it
 * is leaving, not towards the line it is joining.
 */
export function turnaroundPath(
  from: LatLng2,
  to: LatLng2,
  heading: LatLng2,
  params: TurnaroundParams = DEFAULT_TURNAROUND,
): LatLng2[] {
  const f = frame(from);
  const a = f.toM(from);
  const b = f.toM(to);
  const h = f.toM(heading);

  // Unit vector along the line being left.
  const hx = h.x - a.x, hy = h.y - a.y;
  const hLen = Math.hypot(hx, hy);
  if (!(hLen > 0)) return [];
  const ux = hx / hLen, uy = hy / hLen;

  // The gap to the next line, and its component across the direction of travel.
  // Only the across-track part is what the half circle has to span; any along
  // track difference is absorbed by the run-out, which keeps the shape correct
  // when the two lines do not end level with each other.
  const gx = b.x - a.x, gy = b.y - a.y;
  const across = -uy * gx + ux * gy;
  const r = Math.abs(across) / 2;
  if (!(r > 0.05)) return [];

  // Unit vector across track, pointing at the next line.
  const sign = across >= 0 ? 1 : -1;
  const nx = -uy * sign, ny = ux * sign;

  const e = Math.max(0, params.overshootM);
  const steps = Math.max(1, Math.round(params.arcPoints) + 1);

  // Run-out, then the arc's centre sits level with it, half way across.
  const outX = a.x + ux * e, outY = a.y + uy * e;
  const cx = outX + nx * r, cy = outY + ny * r;

  const out: LatLng2[] = [];
  if (e > 0) out.push(f.toLL(outX, outY));

  // Sweep from the run-out point round to the far side. Parameterised on the
  // two unit vectors rather than on an absolute angle, so it needs no knowledge
  // of which way north is and works at any grid heading.
  for (let i = 1; i < steps; i++) {
    const t = (i / steps) * Math.PI;
    const px = cx + (-nx) * r * Math.cos(t) + ux * r * Math.sin(t);
    const py = cy + (-ny) * r * Math.cos(t) + uy * r * Math.sin(t);
    out.push(f.toLL(px, py));
  }

  if (e > 0) out.push(f.toLL(b.x + ux * e, b.y + uy * e));
  return out;
}

/**
 * How far outside the survey lines the turn reaches, in metres.
 *
 * The overshoot plus the arc's radius. This is the number that matters on a
 * small parcel: it is the distance beyond the end of every line that has to be
 * clear of trees, poles and buildings, and nothing else in the plan states it.
 */
export function turnaroundExcursionM(lineSpacingM: number, params: TurnaroundParams): number {
  return Math.max(0, params.overshootM) + Math.max(0, lineSpacingM) / 2;
}

/** The radius the line spacing implies, which the aircraft has to be able to hold. */
export const turnRadiusM = (lineSpacingM: number): number => Math.max(0, lineSpacingM) / 2;

/**
 * Whether the planned turns are tighter than the aircraft can hold at speed.
 *
 * Not a blocker. The aircraft will simply slow down for each turn, so the
 * flight takes longer than the estimate says. Saying so is the point.
 */
export function turnIsTight(lineSpacingM: number, speedMs: number, bankDeg = TURN_BANK_DEG): boolean {
  const needed = minTurnRadiusM(speedMs, bankDeg);
  return needed > 0 && turnRadiusM(lineSpacingM) < needed;
}

/** Length of a path, for the distance and time estimates. */
export function pathLengthM(points: LatLng2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distM(points[i - 1], points[i]);
  return total;
}
