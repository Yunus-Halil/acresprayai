// Spray-mission construction: turns a field boundary plus a set of anomaly
// zones into an ordered waypoint list a sprayer drone can fly.
//
// Pure functions only — no React, no Leaflet, no network. The planner UI owns
// the parameters; this module owns the geometry and the flight semantics.
import {
  type LatLng2,
  M_PER_DEG_LAT,
  bboxOfRings,
  centroidOfRing,
  distM,
  lerp,
  mPerDegLng,
  pointInRing,
  principalAxisAngle,
  rotateLL,
  segRingIntersections,
} from "./geo";

export type { LatLng2 };

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

/** Signed separation between two headings, folded into (-π/2, π/2]. */
function axisDelta(a: number, b: number): number {
  let d = (a - b) % Math.PI;
  if (d > Math.PI / 2) d -= Math.PI;
  if (d <= -Math.PI / 2) d += Math.PI;
  return d;
}

/**
 * The heading to run one zone's passes along: its long axis, so the drone
 * makes the fewest and longest passes and therefore the fewest U-turns.
 *
 * Snapped to the field's heading (or square to it) when the zone is close to
 * either, and when the zone is too square for its own axis to mean anything.
 * That keeps grid-derived zones — which are unions of cells laid out on the
 * field heading — flying lanes that line up with the cells whose rates they
 * carry, instead of cutting diagonally across them.
 */
export function zoneSweepHeadingRad(ring: LatLng2[], fieldTheta: number): number {
  if (ring.length < 3) return fieldTheta;
  const theta = principalAxisAngle([ring]);

  // Extents along the zone's own axes decide whether it has a long one at all.
  const anchor = centroidOfRing(ring);
  const c = Math.cos(-theta), s = Math.sin(-theta);
  const bb = bboxOfRings([ring.map(p => rotateLL(p, anchor, c, s))]);
  const alongM = (bb.maxLng - bb.minLng) * mPerDegLng(anchor.lat);
  const acrossM = (bb.maxLat - bb.minLat) * M_PER_DEG_LAT;
  const short = Math.min(alongM, acrossM);
  if (!(short > 0) || Math.max(alongM, acrossM) / short < MIN_ELONGATION) return fieldTheta;

  // Both the field heading and square to it keep passes on the cell lattice.
  const candidates = [fieldTheta, fieldTheta + Math.PI / 2];
  let best = candidates[0], bestDelta = Infinity;
  for (const cand of candidates) {
    const d = Math.abs(axisDelta(theta, cand));
    if (d < bestDelta) { bestDelta = d; best = cand; }
  }
  return bestDelta <= AXIS_SNAP_TOL_RAD ? best : theta;
}

/**
 * Per-zone parallel lawnmower. Each anomaly zone gets its own compact set of
 * parallel passes, run along THAT zone's long axis (see zoneSweepHeadingRad),
 * so a strip lying across the field is flown down its length rather than
 * chopped into short passes by the field's heading. Passes are clipped to
 * (boundary ∩ zone), so lines exist only where the drone actually sprays — no
 * full-width rows, no skipped rows, no diagonal jumps.
 *
 * SPACING IS EXACT, AND THE PATTERN IS CENTRED. `spacingM` is one boom width
 * less its overlap (see droneSpecs.passSpacingM), so the lines must land that
 * far apart and nowhere closer: dividing the zone's width into equal shares
 * instead would quietly tighten the spacing on every zone that is not a whole
 * number of lanes wide, which is most of them, and pay for it in a second dose
 * of chemical. Lane count is rounded UP and the set is centred in the zone, so
 * the outermost lanes sit at most half a spacing from the edge and the boom —
 * which is wider than the spacing — covers the rest. No gaps, no redundancy.
 *
 * Adjacent passes within a zone alternate direction (boustrophedon) for tight
 * U-turns at the zone edge; buildMission bridges zones with a straight transit.
 *
 * `repeats` interleaves extra rows BETWEEN the base rows rather than redrawing
 * the same lines, so 2× really is half the spacing.
 */
export function buildFieldSweep(
  boundary: LatLng2[][],
  zones: { id: string; ring: LatLng2[] }[],
  spacingM: number,
  repeats = 1,
): Pass[][] {
  if (!boundary.length || !zones.length) return [];
  const fieldTheta = principalAxisAngle(boundary);
  const spacing = Math.max(0.5, spacingM);

  const fragments: Pass[][] = [];
  for (const zone of zones) {
    // Each zone gets its own rotated frame, anchored on itself: sweep lines run
    // along the frame's east axis, which is the zone's long axis after this
    // rotation.
    const theta = zoneSweepHeadingRad(zone.ring, fieldTheta);
    const anchor = centroidOfRing(zone.ring);
    const cF = Math.cos(-theta), sF = Math.sin(-theta);
    const cI = Math.cos(theta), sI = Math.sin(theta);
    const rot = (p: LatLng2) => rotateLL(p, anchor, cF, sF);
    const unrot = (p: LatLng2) => rotateLL(p, anchor, cI, sI);
    const rotBoundary = boundary.map(r => r.map(rot));

    const rotRing = zone.ring.map(rot);
    const bb = bboxOfRings([rotRing]);
    const heightM = (bb.maxLat - bb.minLat) * M_PER_DEG_LAT;
    if (heightM < 0.5) continue;

    const r = Math.max(1, Math.floor(repeats));
    const step = spacing / r;
    const passCount = Math.max(1, Math.ceil(heightM / step));
    // Centre the lane set: whatever the zone's width leaves over is split
    // evenly top and bottom rather than piled onto one edge.
    const firstOffsetM = (heightM - (passCount - 1) * step) / 2;
    const padLng = (bb.maxLng - bb.minLng) * 0.05 + 0.0002;

    const passes: Pass[] = [];
    let flip = false;
    for (let i = 0; i < passCount; i++) {
      const y = bb.minLat + (firstOffsetM + step * i) / M_PER_DEG_LAT;
      const a = { lat: y, lng: bb.minLng - padLng };
      const b = { lat: y, lng: bb.maxLng + padLng };

      // Sweep line × zone ring → candidate spray intervals.
      const zts = [0, 1, ...segRingIntersections(a, b, rotRing)]
        .filter(t => t >= 0 && t <= 1).sort((x, y2) => x - y2);
      const segs: Pass["segs"] = [];
      for (let k = 0; k < zts.length - 1; k++) {
        const t0 = zts[k], t1 = zts[k + 1];
        if (t1 - t0 < 1e-9) continue;
        const mid = lerp(a, b, (t0 + t1) / 2);
        if (!pointInRing(mid, rotRing)) continue;
        // Must also be inside the field boundary — drop slivers that hang out.
        if (!rotBoundary.some(rb => pointInRing(mid, rb))) continue;
        segs.push({
          a: unrot(lerp(a, b, t0)),
          b: unrot(lerp(a, b, t1)),
          spray: true,
          zoneId: zone.id,
        });
      }
      if (!segs.length) continue;
      if (flip) {
        segs.reverse();
        for (const s of segs) { const t = s.a; s.a = s.b; s.b = t; }
      }
      flip = !flip;
      passes.push({ segs });
    }
    if (passes.length) fragments.push(passes);
  }
  return fragments;
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
};

export function buildMission(
  boundary: LatLng2[][],
  zones: { id: string; ring: LatLng2[] }[],
  p: MissionParams,
): Mission {
  const wps: MissionWP[] = [];
  const transitSegments: LatLng2[][] = [];
  const spraySegments: LatLng2[][] = [];
  let transitDist = 0, sprayDist = 0, sprayOnCount = 0;

  wps.push({ ...p.home, alt: p.transitAltM, speed: p.transitSpeed, action: "TAKEOFF" });

  const fragments = buildFieldSweep(boundary, zones, p.spacingM, p.repeats ?? 1);

  // Order fragments by nearest endpoint to the running exit point, choosing for
  // each the orientation (pass order × per-pass flip) that minimises the hop in.
  // The drone therefore enters each fragment from the side closest to where it
  // already is, and separate field sections are bridged by one straight transit.
  const orderedPasses: Pass[] = [];
  const remaining = fragments.slice();
  let runningExit: LatLng2 = p.home;
  while (remaining.length) {
    let bestIdx = -1, bestDist = Infinity, bestRev = false, bestFlip = false;
    remaining.forEach((frag, idx) => {
      const first = frag[0], last = frag[frag.length - 1];
      if (!first.segs.length || !last.segs.length) return;
      const candidates: { rev: boolean; flip: boolean; pt: LatLng2 }[] = [
        { rev: false, flip: false, pt: first.segs[0].a },
        { rev: false, flip: true, pt: first.segs[first.segs.length - 1].b },
        { rev: true, flip: false, pt: last.segs[0].a },
        { rev: true, flip: true, pt: last.segs[last.segs.length - 1].b },
      ];
      for (const c of candidates) {
        const d = distM(runningExit, c.pt);
        if (d < bestDist) { bestDist = d; bestIdx = idx; bestRev = c.rev; bestFlip = c.flip; }
      }
    });
    if (bestIdx < 0) break;
    const frag = remaining.splice(bestIdx, 1)[0];
    if (bestRev) frag.reverse();
    if (bestFlip) {
      for (const pass of frag) {
        pass.segs.reverse();
        for (const s of pass.segs) { const t = s.a; s.a = s.b; s.b = t; }
      }
    }
    orderedPasses.push(...frag);
    const lastPass = frag[frag.length - 1];
    runningExit = lastPass.segs[lastPass.segs.length - 1].b;
  }

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
