// Spray-mission construction: turns a field boundary plus a set of anomaly
// zones into an ordered waypoint list a sprayer drone can fly.
//
// Pure functions only — no React, no Leaflet, no network. The planner UI owns
// the parameters; this module owns the geometry and the flight semantics.
import {
  type LatLng2,
  M_PER_DEG_LAT,
  axisAnisotropy,
  bboxOfRings,
  centroidOfRings,
  distM,
  lerp,
  mPerDegLng,
  pointInRing,
  principalAxisAngle,
  rotateLL,
  segRingIntersections,
} from "./geo";
import {
  type GroupableZone, type ZoneGroup,
  DEFAULT_GROUPING_SWATHS, groupZones, groupingDistanceM,
} from "./zoneGroups";

export type { LatLng2, GroupableZone, ZoneGroup };
export { DEFAULT_GROUPING_SWATHS, groupZones, groupingDistanceM };

export type Pass = {
  segs: { a: LatLng2; b: LatLng2; spray: boolean; zoneId?: string }[];
};

/**
 * How far a zone's own long axis may sit from the field's before the passes
 * follow the zone instead of the field.
 *
 * Below this the two are the same intent expressed with rounding error, and
 * snapping to the field keeps every pass parallel to the crop rows and to the
 * treatment-grid lattice, which is laid out on the same field heading. Past it
 * the zone genuinely runs its own way and following the field would cut it
 * cornerwise into many short passes.
 *
 * TUNABLE STARTING GUESS: 15° is chosen for feel, not measured.
 */
const AXIS_SNAP_TOL_RAD = (15 * Math.PI) / 180;

/**
 * A shape this close to square has no meaningful long axis — its principal
 * axis is decided by rounding, and would flip between renders. Below this
 * ratio the field heading wins.
 */
const MIN_ELONGATION = 1.15;

/**
 * How lopsided a group's vertex covariance must be before its own axis beats
 * the field's, when its bounding box is too square to say.
 *
 * A cluster of parallel strips is the case this exists for: the box around it
 * is nearly square, so MIN_ELONGATION alone would send its passes off along the
 * field heading and cut every strip crosswise into stubs. The covariance is not
 * fooled by that (see geo.axisAnisotropy), and 1.5 is comfortably above the
 * noise floor of a genuinely round shape.
 *
 * TUNABLE STARTING GUESS: chosen to clear a cluster of strips and to leave a
 * blobby patch alone, not measured.
 */
const MIN_ANISOTROPY = 1.5;

/** Signed separation between two headings, folded into (-π/2, π/2]. */
function axisDelta(a: number, b: number): number {
  let d = (a - b) % Math.PI;
  if (d > Math.PI / 2) d -= Math.PI;
  if (d <= -Math.PI / 2) d += Math.PI;
  return d;
}

/**
 * The heading to run one group's passes along: its long axis, so the drone
 * makes the fewest and longest passes and therefore the fewest U-turns.
 *
 * Taken over the group AS A WHOLE — the principal axis of every member ring
 * together — so a cluster of parallel strips is swept the long way across the
 * cluster rather than the long way across whichever strip happened to be first.
 *
 * Snapped to the field's heading (or square to it) when the group is close to
 * either, and when it is too square for its own axis to mean anything. That
 * keeps grid-derived zones — which are unions of cells laid out on the field
 * heading — flying lanes that line up with the cells whose rates they carry,
 * instead of cutting diagonally across them.
 */
export function groupSweepHeadingRad(rings: LatLng2[][], fieldTheta: number): number {
  const usable = rings.filter(r => r.length >= 3);
  if (!usable.length) return fieldTheta;
  const theta = principalAxisAngle(usable);

  // Extents along the group's own axes decide whether it has a long one at all.
  const anchor = centroidOfRings(usable);
  const c = Math.cos(-theta), s = Math.sin(-theta);
  const bb = bboxOfRings(usable.map(r => r.map(p => rotateLL(p, anchor, c, s))));
  const alongM = (bb.maxLng - bb.minLng) * mPerDegLng(anchor.lat);
  const acrossM = (bb.maxLat - bb.minLat) * M_PER_DEG_LAT;
  const short = Math.min(alongM, acrossM);
  const boxy = !(short > 0) || Math.max(alongM, acrossM) / short < MIN_ELONGATION;
  // A square box does not mean a square shape: a cluster of parallel strips
  // fills one, and its passes still want to run along the strips.
  if (boxy && axisAnisotropy(usable) < MIN_ANISOTROPY) return fieldTheta;

  // Both the field heading and square to it keep passes on the cell lattice.
  const candidates = [fieldTheta, fieldTheta + Math.PI / 2];
  let best = candidates[0], bestDelta = Infinity;
  for (const cand of candidates) {
    const d = Math.abs(axisDelta(theta, cand));
    if (d < bestDelta) { bestDelta = d; best = cand; }
  }
  return bestDelta <= AXIS_SNAP_TOL_RAD ? best : theta;
}

/** One zone's sweep heading — the single-member case of the group heading. */
export const zoneSweepHeadingRad = (ring: LatLng2[], fieldTheta: number): number =>
  groupSweepHeadingRad([ring], fieldTheta);

export type SweepOptions = {
  /**
   * How close two same-rate zones must be to be swept as one group, in metres.
   *
   * Omitted, it defaults to `DEFAULT_GROUPING_SWATHS × spacing` (see
   * zoneGroups.ts — a tunable starting value, not a measured one). Zero or less
   * turns grouping OFF: every zone becomes its own group, which reproduces the
   * per-zone behaviour this planner had before grouping existed and is the
   * baseline the comparison tests measure against.
   */
  groupingDistanceM?: number;
  /**
   * The longest boom-off hop the aircraft will take WITHIN a group's sweep,
   * in metres. A sweep line that crosses unmarked ground wider than this is cut
   * there, and the two sides become separate fragments for the travel-order
   * optimiser to route around — which is the "or route around it" half of how a
   * group handles a deliberate skip.
   *
   * Omitted, it defaults to MAX_SWEEP_HOP_SWATHS × spacing when grouping is on,
   * and to Infinity when grouping is off — with one zone per group there is
   * nothing to route around that was not already the shipped behaviour, and the
   * off switch has to reproduce that exactly.
   */
  maxInPassHopM?: number;
};

/**
 * How far the sweep will fly boom-off inside a group before it is cheaper to
 * leave and come back.
 *
 * A lane-end U-turn already costs about one lane spacing, so crossing a gap of a
 * few spacings mid-pass is in the same range as the turns the aircraft is making
 * anyway. Past that the hop is a detour, and the travel-order optimiser can
 * almost always find a shorter way round.
 *
 * TUNABLE STARTING VALUE: three spacings, not a measured figure. Tried at 1, 2,
 * 3 and 5 on a fragmented strip field: all four covered the same ground, and 2
 * flew about 2% less, but it also cuts a cluster of strips whose lanes are two
 * spacings apart into three fragments — a genuinely continuous sweep chopped up
 * for a rounding difference. 3 clears an ordinary lane transition with room to
 * spare, which is what this threshold is for.
 */
export const MAX_SWEEP_HOP_SWATHS = 3;

/**
 * Parallel lawnmower, one continuous pattern per GROUP.
 *
 * A group is a cluster of same-rate zones close enough to be flown together
 * (see zoneGroups.ts). Its passes are laid out once, across the whole cluster's
 * footprint and along the cluster's long axis, so the aircraft sweeps the
 * cluster in one back-and-forth motion instead of finishing one member zone,
 * flying away, and coming back for the neighbour it was standing on.
 *
 * GROUPING CHANGES THE TRAVERSAL, NOT THE COVERAGE. Each sweep line is still
 * clipped to the member rings one at a time, so a line crossing a cluster emits
 * spray only over ground that was actually marked. Where members are separated
 * by unmarked ground the line simply produces two segments with a hole between
 * them, and buildMission flies that hole boom-off at transit altitude — the
 * same handling a concave zone's own hole has always had. Nothing between the
 * members gets sprayed because they were grouped.
 *
 * Overlapping intervals from two members of the same group are merged rather
 * than emitted twice: they are the same rate by construction, and two segments
 * over one piece of ground is a second dose.
 *
 * SPACING IS EXACT, AND THE PATTERN IS CENTRED. `spacingM` is one boom width
 * less its overlap (see droneSpecs.passSpacingM), so the lines must land that
 * far apart and nowhere closer: dividing the group's width into equal shares
 * instead would quietly tighten the spacing on every group that is not a whole
 * number of lanes wide, which is most of them, and pay for it in a second dose
 * of chemical. Lane count is rounded UP and the set is centred on the group, so
 * the outermost lanes sit at most half a spacing from the edge and the boom —
 * which is wider than the spacing — covers the rest. No gaps, no redundancy.
 *
 * Adjacent passes alternate direction (boustrophedon) across the whole group,
 * for tight U-turns at its edge; buildMission bridges groups with a straight
 * transit.
 *
 * `repeats` interleaves extra rows BETWEEN the base rows rather than redrawing
 * the same lines, so 2× really is half the spacing.
 */
export function buildFieldSweep(
  boundary: LatLng2[][],
  zones: GroupableZone[],
  spacingM: number,
  repeats = 1,
  opts: SweepOptions = {},
): Pass[][] {
  if (!boundary.length || !zones.length) return [];
  const fieldTheta = principalAxisAngle(boundary);
  const spacing = Math.max(0.5, spacingM);
  const distanceM = opts.groupingDistanceM ?? groupingDistanceM(spacing);
  const maxHopM = opts.maxInPassHopM ?? (distanceM > 0 ? MAX_SWEEP_HOP_SWATHS * spacing : Infinity);
  const groups = groupZones(zones, { distanceM });
  const r = Math.max(1, Math.floor(repeats));

  const fragments: Pass[][] = [];
  for (const group of groups) {
    let best: { passes: Pass[]; cost: number } | null = null;
    for (const theta of candidateHeadings(group, fieldTheta)) {
      const passes = sweepAlong(boundary, group, spacing / r, theta);
      if (!passes.length) continue;
      const cost = sweepCostM(passes, spacing);
      if (!best || cost < best.cost - 1e-6) best = { passes, cost };
    }
    if (best) fragments.push(...splitOnLongHops(best.passes, maxHopM));
  }
  return fragments;
}

/**
 * Headings worth trying for a group, best-first for tie-breaking.
 *
 * A ONE-ZONE GROUP IS NOT A CHOICE. It gets exactly the heading
 * `zoneSweepHeadingRad` has always given it, so turning grouping off reproduces
 * the shipped route to the metre.
 *
 * A MULTI-ZONE GROUP IS. Its own principal axis is a candidate, not an answer:
 * on a cluster of parallel strips the union's long axis runs ACROSS the strips
 * (six 60 m strips stacked 150 m deep are "longest" north-south, but a
 * north-south pass over them is mostly gap), and following it would cut every
 * member crosswise into stubs. So the field heading, square to it, and each
 * member's own preference are all candidates too, and the one the aircraft can
 * fly in the least distance wins.
 */
function candidateHeadings(group: ZoneGroup, fieldTheta: number): number[] {
  if (group.rings.length === 1) return [zoneSweepHeadingRad(group.rings[0], fieldTheta)];
  const raw = [
    ...group.rings.map(ring => zoneSweepHeadingRad(ring, fieldTheta)),
    groupSweepHeadingRad(group.rings, fieldTheta),
    fieldTheta,
    fieldTheta + Math.PI / 2,
  ];
  const out: number[] = [];
  for (const th of raw) {
    // Headings are axes, not directions: θ and θ+π sweep the same lines.
    const norm = ((th % Math.PI) + Math.PI) % Math.PI;
    if (out.some(o => Math.abs(axisDelta(o, norm)) < 0.01)) continue;
    out.push(norm);
    if (out.length >= 6) break;   // enough angles; this runs per group, per plan
  }
  return out;
}

/**
 * What interrupting a pass costs, over and above the ground covered.
 *
 * Every boom-off hop — a lane-end turn, or a gap crossed mid-pass — is a
 * deceleration, a climb, a descent and a re-acceleration, plus the sprayer's
 * own lag coming back on. Distance alone does not see any of that, and without
 * it the cheapest-looking heading on a cluster of strips is the one that lays
 * its lanes ACROSS them: it sprays slightly less because its lanes pack better,
 * and pays for it with fifty interruptions the pilot has to fly.
 *
 * TUNABLE STARTING GUESS: two lane spacings' worth of travel per interruption,
 * chosen to be the same order as the U-turn it resembles. Not measured.
 */
const HOP_PENALTY_SWATHS = 2;

/**
 * What one candidate heading costs the aircraft: ground covered — spray plus
 * the boom-off hops between segments and between lanes — plus a fixed charge
 * per interruption (see HOP_PENALTY_SWATHS).
 *
 * Spray and transit distance are summed at face value rather than weighted.
 * Transit is the waste and spray is the work, but a heading that trades one for
 * the other one-for-one is a wash for the pilot, and a weighting would be a
 * number nobody could justify.
 */
function sweepCostM(passes: Pass[], spacing: number): number {
  let cost = 0;
  let prev: LatLng2 | null = null;
  for (const pass of passes) {
    for (const seg of pass.segs) {
      if (prev) cost += distM(prev, seg.a) + HOP_PENALTY_SWATHS * spacing;
      cost += distM(seg.a, seg.b);
      prev = seg.b;
    }
  }
  return cost;
}

/** One group, swept along `theta` at `step` metres between lanes. */
function sweepAlong(
  boundary: LatLng2[][], group: ZoneGroup, step: number, theta: number,
): Pass[] {
  // The group's own rotated frame, anchored on itself: sweep lines run along
  // the frame's east axis, which is `theta` after this rotation.
  const anchor = centroidOfRings(group.rings);
  const cF = Math.cos(-theta), sF = Math.sin(-theta);
  const cI = Math.cos(theta), sI = Math.sin(theta);
  const rot = (p: LatLng2) => rotateLL(p, anchor, cF, sF);
  const unrot = (p: LatLng2) => rotateLL(p, anchor, cI, sI);
  const rotBoundary = boundary.map(ring => ring.map(rot));

  const members = group.zones.map(z => ({ id: z.id, ring: z.ring.map(rot) }));
  const bb = bboxOfRings(members.map(m => m.ring));
  const heightM = (bb.maxLat - bb.minLat) * M_PER_DEG_LAT;
  if (heightM < 0.5) return [];

  const passCount = Math.max(1, Math.ceil(heightM / step));
  // Centre the lane set: whatever the group's width leaves over is split
  // evenly top and bottom rather than piled onto one edge.
  const firstOffsetM = (heightM - (passCount - 1) * step) / 2;
  const padLng = (bb.maxLng - bb.minLng) * 0.05 + 0.0002;

  const passes: Pass[] = [];
  let flip = false;
  for (let i = 0; i < passCount; i++) {
    const y = bb.minLat + (firstOffsetM + step * i) / M_PER_DEG_LAT;
    const a = { lat: y, lng: bb.minLng - padLng };
    const b = { lat: y, lng: bb.maxLng + padLng };

    // Sweep line × every member ring → candidate spray intervals, in order
    // along the line. Gaps between them are unmarked ground and stay gaps.
    const intervals: { t0: number; t1: number; zoneId: string }[] = [];
    for (const m of members) {
      const zts = [0, 1, ...segRingIntersections(a, b, m.ring)]
        .filter(t => t >= 0 && t <= 1).sort((x, y2) => x - y2);
      for (let k = 0; k < zts.length - 1; k++) {
        const t0 = zts[k], t1 = zts[k + 1];
        if (t1 - t0 < 1e-9) continue;
        const mid = lerp(a, b, (t0 + t1) / 2);
        if (!pointInRing(mid, m.ring)) continue;
        // Must also be inside the field boundary — drop slivers that hang out.
        if (!rotBoundary.some(rb => pointInRing(mid, rb))) continue;
        intervals.push({ t0, t1, zoneId: m.id });
      }
    }
    if (!intervals.length) continue;
    intervals.sort((x, y2) => x.t0 - y2.t0 || x.t1 - y2.t1);

    const segs: Pass["segs"] = [];
    let cur = { ...intervals[0] };
    const emit = () => segs.push({
      a: unrot(lerp(a, b, cur.t0)), b: unrot(lerp(a, b, cur.t1)),
      spray: true, zoneId: cur.zoneId,
    });
    for (let k = 1; k < intervals.length; k++) {
      const nxt = intervals[k];
      if (nxt.t0 <= cur.t1 + 1e-9) {
        // Touching or overlapping members of the same group: one pass over this
        // ground, not two.
        if (nxt.t1 > cur.t1) cur.t1 = nxt.t1;
        continue;
      }
      emit();
      cur = { ...nxt };
    }
    emit();

    if (flip) {
      segs.reverse();
      for (const s of segs) { const t = s.a; s.a = s.b; s.b = t; }
    }
    flip = !flip;
    passes.push({ segs });
  }
  return passes;
}
/** Break a group's serpentine wherever the next hop exceeds `maxHopM`. */
function splitOnLongHops(passes: Pass[], maxHopM: number): Pass[][] {
  if (!passes.length) return [];
  if (!Number.isFinite(maxHopM)) return [passes];

  const out: Pass[][] = [];
  let frag: Pass[] = [];
  let lane: Pass["segs"] = [];
  let laneIndex = -1;
  let prevEnd: LatLng2 | null = null;

  const flushLane = () => { if (lane.length) { frag.push({ segs: lane }); lane = []; } };
  const flushFrag = () => { flushLane(); if (frag.length) { out.push(frag); frag = []; } };

  for (let i = 0; i < passes.length; i++) {
    for (const seg of passes[i].segs) {
      if (prevEnd && distM(prevEnd, seg.a) > maxHopM) flushFrag();
      else if (i !== laneIndex) flushLane();
      laneIndex = i;
      lane.push(seg);
      prevEnd = seg.b;
    }
  }
  flushFrag();
  return out;
}

// =============================================================================
// Mission building: TAKEOFF → TRANSIT (high, fast, sprayer off) → SPRAY (low,
// slow, sprayer on) → TRANSIT → … → RTH → LAND
// =============================================================================
export type MissionAction =
  | "TAKEOFF" | "TRANSIT" | "SPEED_CHANGE" | "ALTITUDE_CHANGE"
  | "SPRAY_ON" | "SPRAY_WP" | "SPRAY_OFF" | "RTH" | "LAND";

export type MissionWP = {
  lat: number; lng: number; alt: number; speed: number;
  action: MissionAction; zoneId?: string;
};

export type Mission = {
  waypoints: MissionWP[];
  transitDistM: number;
  sprayDistM: number;
  transitTimeS: number;
  sprayTimeS: number;
  sprayOnCount: number;
  transitSegments: LatLng2[][];   // dashed polylines (between/over healthy ground)
  spraySegments: LatLng2[][];     // solid polylines (inside zones)
  home: LatLng2;
};

export type MissionParams = {
  home: LatLng2;
  transitAltM: number;   // default 30
  sprayAltM: number;     // default 3
  transitSpeed: number;  // default 10 m/s
  spraySpeed: number;    // default 3 m/s
  spacingM: number;      // swath
  repeats?: number;      // how many times to re-cover each zone (1 = once)
  /**
   * How close two same-rate zones must be to be swept as one continuous group.
   * Omitted → the default in zoneGroups.ts. Zero → grouping off, one group per
   * zone, which is the pre-grouping behaviour.
   */
  groupingDistanceM?: number;
  /**
   * Ground the aircraft comes back to mid-mission: the nurse tank, a battery
   * pad. Home is always included, so this is only for pads that are somewhere
   * else. Used to ORDER the groups (see orderFragments) — the route is steered
   * so the point where a load runs dry lands near a pad instead of at the far
   * corner of the field.
   */
  servicePoints?: LatLng2[];
  /**
   * Fractions of SPRAYED distance at which a load runs dry, ascending — i.e.
   * `RefillPlan.dryFractions`. Chemical demand is known before the route is,
   * so these can be fed in and the ordering can account for them.
   */
  serviceAtSprayFractions?: number[];
};

/** One way round a fragment: pass order reversed, and/or each pass flipped. */
type Orient = { rev: boolean; flip: boolean; start: LatLng2; end: LatLng2 };

function orientationsOf(frag: Pass[]): Orient[] | null {
  const first = frag[0], last = frag[frag.length - 1];
  if (!first?.segs.length || !last?.segs.length) return null;
  const fa = first.segs[0].a, fb = first.segs[first.segs.length - 1].b;
  const la = last.segs[0].a, lb = last.segs[last.segs.length - 1].b;
  return [
    { rev: false, flip: false, start: fa, end: lb },
    { rev: false, flip: true, start: fb, end: la },
    { rev: true, flip: false, start: la, end: fb },
    { rev: true, flip: true, start: lb, end: fa },
  ];
}

/** Apply an orientation in place. */
function orient(frag: Pass[], o: Orient): void {
  if (o.rev) frag.reverse();
  if (o.flip) {
    for (const pass of frag) {
      pass.segs.reverse();
      for (const s of pass.segs) { const t = s.a; s.a = s.b; s.b = t; }
    }
  }
}

const fragSprayLenM = (frag: Pass[]): number =>
  frag.reduce((a, pass) => a + pass.segs.reduce((b, s) => b + distM(s.a, s.b), 0), 0);

const fragCentroid = (frag: Pass[]): LatLng2 => {
  let lat = 0, lng = 0, n = 0;
  for (const pass of frag) for (const s of pass.segs) {
    lat += s.a.lat + s.b.lat; lng += s.a.lng + s.b.lng; n += 2;
  }
  return n ? { lat: lat / n, lng: lng / n } : { lat: 0, lng: 0 };
};

/**
 * Transit cost of one order, with the entry/exit of every fragment chosen
 * optimally for that order.
 *
 * Exact given the order: four orientations per fragment is a chain small enough
 * to solve by dynamic programming rather than greedily, which matters because a
 * greedy entry choice can leave the aircraft at the wrong end of a long group
 * and pay for it on the very next hop. The closing leg back to home is part of
 * the cost — otherwise the optimiser happily finishes at the far fence.
 */
function tourCost(
  order: number[], orients: Orient[][], home: LatLng2,
): { cost: number; choice: number[] } {
  if (!order.length) return { cost: 0, choice: [] };
  let dp = orients[order[0]].map(o => distM(home, o.start));
  const back: number[][] = [];
  for (let i = 1; i < order.length; i++) {
    const prev = orients[order[i - 1]], cur = orients[order[i]];
    const nd = cur.map(() => Infinity), bk = cur.map(() => 0);
    for (let j = 0; j < cur.length; j++) {
      for (let k = 0; k < prev.length; k++) {
        const v = dp[k] + distM(prev[k].end, cur[j].start);
        if (v < nd[j]) { nd[j] = v; bk[j] = k; }
      }
    }
    dp = nd; back.push(bk);
  }
  const lastOr = orients[order[order.length - 1]];
  let bestJ = 0, best = Infinity;
  for (let j = 0; j < lastOr.length; j++) {
    const v = dp[j] + distM(lastOr[j].end, home);
    if (v < best) { best = v; bestJ = j; }
  }
  const choice = new Array<number>(order.length);
  choice[order.length - 1] = bestJ;
  for (let i = order.length - 1; i > 0; i--) choice[i - 1] = back[i - 1][choice[i]];
  return { cost: best, choice };
}

/**
 * What the mid-mission returns cost, given an order.
 *
 * A load runs dry at a known fraction of SPRAYED distance (chemical demand is
 * area × rate, so it is known before the route is). Walk the order to find
 * which group the aircraft is over at that moment and charge the round trip to
 * the nearest pad. This steers the ORDER only — the legs themselves are not
 * emitted here, because when the tank actually empties is a fact about the
 * plan the operator confirms, not about the geometry. Without it the optimiser
 * is free to schedule the dry point at the far fence for no extra cost.
 */
function serviceCost(
  order: number[], sprayLens: number[], centroids: LatLng2[],
  stations: LatLng2[], fractions: number[],
): number {
  if (!stations.length || !fractions.length) return 0;
  const total = order.reduce((a, i) => a + sprayLens[i], 0);
  if (!(total > 0)) return 0;
  let cost = 0;
  for (const f of fractions) {
    if (!(f > 0) || f >= 1) continue;
    let target = total * f, at = order[order.length - 1];
    for (const i of order) {
      if (target <= sprayLens[i]) { at = i; break; }
      target -= sprayLens[i];
    }
    const c = centroids[at];
    cost += 2 * stations.reduce((m, s) => Math.min(m, distM(c, s)), Infinity);
  }
  return cost;
}

/**
 * Order the groups, and the entry/exit point of each, to keep transit short.
 *
 * Nearest-neighbour to get a sane start, then 2-opt to unpick the crossings NN
 * always leaves — reverse a run of the order, keep it if the total shortened,
 * repeat until nothing improves. Not optimal and does not need to be: the job
 * is to stop the aircraft criss-crossing the field, and a handful of 2-opt
 * passes over a few dozen groups does that in microseconds.
 */
function orderFragments(fragments: Pass[][], p: MissionParams): Pass[] {
  const kept: Pass[][] = [];
  const orients: Orient[][] = [];
  for (const frag of fragments) {
    const o = orientationsOf(frag);
    if (!o) continue;
    kept.push(frag); orients.push(o);
  }
  if (!kept.length) return [];

  const sprayLens = kept.map(fragSprayLenM);
  const centroids = kept.map(fragCentroid);
  const stations = [p.home, ...(p.servicePoints ?? [])];
  const fractions = p.serviceAtSprayFractions ?? [];
  const total = (order: number[]) =>
    tourCost(order, orients, p.home).cost +
    serviceCost(order, sprayLens, centroids, stations, fractions);

  // 1) Nearest neighbour from home.
  const order: number[] = [];
  const unused = new Set(kept.map((_, i) => i));
  let cur = p.home;
  while (unused.size) {
    let bestI = -1, bestD = Infinity, bestEnd = cur;
    for (const i of unused) {
      for (const o of orients[i]) {
        const d = distM(cur, o.start);
        if (d < bestD) { bestD = d; bestI = i; bestEnd = o.end; }
      }
    }
    if (bestI < 0) break;
    order.push(bestI); unused.delete(bestI); cur = bestEnd;
  }

  // 2) 2-opt. Bounded so a pathological field cannot spin here.
  let cost = total(order);
  const MAX_SWEEPS = 12;
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const trial = order.slice();
        // Reverse the run [i..j]: the classic 2-opt move.
        for (let a = i, b = j; a < b; a++, b--) { const t = trial[a]; trial[a] = trial[b]; trial[b] = t; }
        const c = total(trial);
        if (c < cost - 1e-6) {
          order.splice(0, order.length, ...trial);
          cost = c; improved = true;
        }
      }
    }
    if (!improved) break;
  }

  const { choice } = tourCost(order, orients, p.home);
  const out: Pass[] = [];
  order.forEach((idx, i) => {
    const frag = kept[idx];
    orient(frag, orients[idx][choice[i]]);
    out.push(...frag);
  });
  return out;
}

export function buildMission(
  boundary: LatLng2[][],
  zones: GroupableZone[],
  p: MissionParams,
): Mission {
  const wps: MissionWP[] = [];
  const transitSegments: LatLng2[][] = [];
  const spraySegments: LatLng2[][] = [];
  let transitDist = 0, sprayDist = 0, sprayOnCount = 0;

  wps.push({ ...p.home, alt: p.transitAltM, speed: p.transitSpeed, action: "TAKEOFF" });

  const fragments = buildFieldSweep(boundary, zones, p.spacingM, p.repeats ?? 1, {
    groupingDistanceM: p.groupingDistanceM,
  });

  const orderedPasses = orderFragments(fragments, p);

  let prev: LatLng2 | null = null;
  let sprayOn = false;

  for (const pass of orderedPasses) {
    for (const seg of pass.segs) {
      // Connector from the previous pass end (or home) to this segment's start.
      // Always taken at transit altitude — never a low diagonal jump.
      const connectorFrom = prev ?? p.home;
      if (distM(connectorFrom, seg.a) > 0.5) {
        if (sprayOn) {
          wps.push({ ...connectorFrom, alt: p.sprayAltM, speed: p.spraySpeed, action: "SPRAY_OFF" });
          sprayOn = false;
        }
        wps.push({ ...connectorFrom, alt: p.transitAltM, speed: p.transitSpeed, action: "ALTITUDE_CHANGE" });
        wps.push({ ...connectorFrom, alt: p.transitAltM, speed: p.transitSpeed, action: "SPEED_CHANGE" });
        wps.push({ ...seg.a, alt: p.transitAltM, speed: p.transitSpeed, action: "TRANSIT" });
        transitSegments.push([connectorFrom, seg.a]);
        transitDist += distM(connectorFrom, seg.a);
      }

      if (seg.spray) {
        if (!sprayOn) {
          wps.push({ ...seg.a, alt: p.sprayAltM, speed: p.spraySpeed, action: "ALTITUDE_CHANGE", zoneId: seg.zoneId });
          wps.push({ ...seg.a, alt: p.sprayAltM, speed: p.spraySpeed, action: "SPEED_CHANGE", zoneId: seg.zoneId });
          wps.push({ ...seg.a, alt: p.sprayAltM, speed: p.spraySpeed, action: "SPRAY_ON", zoneId: seg.zoneId });
          sprayOn = true;
          sprayOnCount++;
        }
        wps.push({ ...seg.b, alt: p.sprayAltM, speed: p.spraySpeed, action: "SPRAY_WP", zoneId: seg.zoneId });
        spraySegments.push([seg.a, seg.b]);
        sprayDist += distM(seg.a, seg.b);
      } else {
        // Healthy ground inside the same pass — sprayer off, climb, speed up.
        if (sprayOn) {
          wps.push({ ...seg.a, alt: p.sprayAltM, speed: p.spraySpeed, action: "SPRAY_OFF" });
          sprayOn = false;
        }
        wps.push({ ...seg.a, alt: p.transitAltM, speed: p.transitSpeed, action: "ALTITUDE_CHANGE" });
        wps.push({ ...seg.a, alt: p.transitAltM, speed: p.transitSpeed, action: "SPEED_CHANGE" });
        wps.push({ ...seg.b, alt: p.transitAltM, speed: p.transitSpeed, action: "TRANSIT" });
        transitSegments.push([seg.a, seg.b]);
        transitDist += distM(seg.a, seg.b);
      }
      prev = seg.b;
    }
  }

  if (prev && sprayOn) {
    wps.push({ ...prev, alt: p.sprayAltM, speed: p.spraySpeed, action: "SPRAY_OFF" });
    sprayOn = false;
  }
  if (prev) {
    // Straight-line RTH at transit altitude — nothing to hit up there.
    wps.push({ ...prev, alt: p.transitAltM, speed: p.transitSpeed, action: "ALTITUDE_CHANGE" });
    wps.push({ ...p.home, alt: p.transitAltM, speed: p.transitSpeed, action: "RTH" });
    transitSegments.push([prev, p.home]);
    transitDist += distM(prev, p.home);
  }
  wps.push({ ...p.home, alt: 0, speed: 1, action: "LAND" });

  return {
    waypoints: wps,
    transitDistM: transitDist,
    sprayDistM: sprayDist,
    transitTimeS: transitDist / Math.max(0.1, p.transitSpeed),
    sprayTimeS: sprayDist / Math.max(0.1, p.spraySpeed),
    sprayOnCount,
    transitSegments,
    spraySegments,
    home: p.home,
  };
}

/**
 * QGC WPL 110 / Mission Planner format. Action waypoints are encoded with the
 * MAVLink-equivalent commands so Mission Planner and DJI converters preserve them:
 *   cmd 22  NAV_TAKEOFF
 *   cmd 16  NAV_WAYPOINT
 *   cmd 178 DO_CHANGE_SPEED  (p2 = speed m/s)
 *   cmd 183 DO_SET_SERVO     (p1 = servo #, p2 = PWM; 2000 ON / 1000 OFF)
 *   cmd 20  NAV_RETURN_TO_LAUNCH
 *   cmd 21  NAV_LAND
 */
export function missionToWaypointText(m: Mission): string {
  const lines: string[] = ["QGC WPL 110"];
  const SPRAY_SERVO = 8;
  const row = (
    idx: number, current: 0 | 1, frame: number, cmd: number,
    p1: number, p2: number, p3: number, p4: number,
    lat: number, lng: number, alt: number,
  ) => lines.push(
    `${idx}\t${current}\t${frame}\t${cmd}\t${p1.toFixed(2)}\t${p2.toFixed(2)}\t${p3.toFixed(2)}\t${p4.toFixed(2)}\t${lat.toFixed(8)}\t${lng.toFixed(8)}\t${alt.toFixed(2)}\t1`,
  );
  row(0, 1, 0, 16, 0, 0, 0, 0, m.home.lat, m.home.lng, m.waypoints[0]?.alt ?? 0);
  let idx = 1;
  for (const w of m.waypoints) {
    if (w.action === "TAKEOFF") row(idx++, 0, 3, 22, 0, 0, 0, 0, w.lat, w.lng, w.alt);
    else if (w.action === "SPEED_CHANGE") row(idx++, 0, 3, 178, 1, w.speed, -1, 0, 0, 0, 0);
    else if (w.action === "SPRAY_ON") row(idx++, 0, 3, 183, SPRAY_SERVO, 2000, 0, 0, 0, 0, 0);
    else if (w.action === "SPRAY_OFF") row(idx++, 0, 3, 183, SPRAY_SERVO, 1000, 0, 0, 0, 0, 0);
    else if (w.action === "RTH") row(idx++, 0, 3, 20, 0, 0, 0, 0, w.lat, w.lng, w.alt);
    else if (w.action === "LAND") row(idx++, 0, 3, 21, 0, 0, 0, 0, w.lat, w.lng, w.alt);
    else row(idx++, 0, 3, 16, 0, 0, 0, 0, w.lat, w.lng, w.alt);
  }
  return lines.join("\n") + "\n";
}

export function exportMissionFile(m: Mission): Blob {
  return new Blob([missionToWaypointText(m)], { type: "text/plain" });
}
