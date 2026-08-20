// The hero animation's telemetry — real model output, not decoration.
//
// The point of the hero is the claim "this simulates the whole flight". A
// strip of invented numbers ticking beside the picture would undercut exactly
// that claim to anyone who checked. So these figures come from the SAME
// physics the product runs: dronePhysics + tankProfile, the modules the Flight
// Planner uses, over a mission built from the very geometry the animation
// draws.
//
// ONE GEOMETRY, TWO READERS. The route and zones live here and FlightPath.tsx
// renders them, so the numbers cannot drift from the picture. A drone shown
// inside a green zone is spraying in the model too, because "spraying" is
// decided by the same point-in-polygon test that put the green there.
import { pointInRing } from "./geo";
import { T40_PHYSICS } from "./dronePhysics";
import { DRONE_SPECS } from "./droneSpecs";
import { type TankProfile, type TankSample, buildTankProfile, sampleTankAt } from "./tankProfile";

/** The animation's loop, and the window inside it when the marker is flying. */
export const HERO_LOOP_MS = 16_000;
export const HERO_FLIGHT_FROM = 0.48;
export const HERO_FLIGHT_TO = 0.92;

/**
 * SVG units to metres.
 *
 * The drawing is 1120×520 units. At 0.5 m per unit that is a 560 × 260 m
 * field — about 14.5 ha, a normal block — and the route comes out around 3.4 km,
 * which a T40 can fly inside its endurance. Chosen so the numbers on screen are
 * ones a grower would recognise rather than ones that merely fit the picture.
 */
export const METRES_PER_UNIT = 0.5;

export const FIELD_POLY: [number, number][] = [
  [70, 70], [780, 45], [1050, 110], [1045, 450], [420, 478], [75, 430],
];

/** Boustrophedon, matching the picture's `ROUTE` exactly. */
export const ROUTE_POINTS: [number, number][] = [
  [90, 120], [1010, 120], [1010, 170], [90, 170], [90, 220], [1010, 220],
  [1010, 270], [90, 270], [90, 320], [1010, 320], [1010, 370], [90, 370],
  [90, 420], [1010, 420],
];

export const ZONE_POLYS: [number, number][][] = [
  [[205, 95], [350, 88], [462, 102], [470, 185], [438, 238], [210, 232], [196, 150]],
  [[620, 238], [900, 232], [912, 300], [895, 345], [628, 342], [612, 285]],
  [[436, 344], [592, 338], [598, 438], [448, 446]],
];

/** Altitudes the demo mission flies, metres AGL — the planner's own defaults. */
export const SPRAY_ALT_M = 3;
export const TRANSIT_ALT_M = 30;
const SPRAY_SPEED_MS = 4;
const TRANSIT_SPEED_MS = 9;
/**
 * A boustrophedon does not hold speed through its U-turns, and that matters
 * here: acceleration is what pitches the aircraft, and pitch is what throws
 * the fluid. Modelling the row ends is what makes the slosh readout show
 * something — and it is also simply what the aircraft does.
 */
const TURN_SPEED_MS = 1.5;
/** Metres either side of a corner over which speed ramps down and back up. */
const TURN_RAMP_M = 14;
/** Ambient the model derates against. An input, not a reading. */
export const AMBIENT_C = 22;

const toRing = (poly: [number, number][]) => poly.map(([x, y]) => ({ lat: y, lng: x }));
const ZONE_RINGS = ZONE_POLYS.map(toRing);

/** Whether a point on the route is over a treatment zone — the picture's rule. */
export function sprayingAt(x: number, y: number): boolean {
  return ZONE_RINGS.some(r => pointInRing({ lat: y, lng: x }, r));
}

export type HeroSeg = {
  speed: number; spray: boolean; tStart: number; tEnd: number;
  /** Distance along the whole route at which this segment starts, metres. */
  distStart: number; distEnd: number;
};

export type HeroMission = {
  segs: HeroSeg[];
  totalTimeS: number;
  totalDistM: number;
  profile: TankProfile;
  requiredLitres: number;
};

/**
 * Walk the route, splitting it wherever it crosses a zone edge, and hand the
 * result to the production tank model.
 *
 * Sampled finely rather than solved analytically: the crossing points only
 * need to be accurate to a metre or so for the readouts, and a sampler is far
 * easier to see the correctness of than a polygon-clipping routine.
 */
export function buildHeroMission(): HeroMission {
  const STEP_UNITS = 6;

  // Cumulative distance of every route vertex, so the turn ramps can be
  // measured against the nearest corner rather than guessed per leg.
  const vertexDist: number[] = [0];
  for (let i = 1; i < ROUTE_POINTS.length; i++) {
    const [x0, y0] = ROUTE_POINTS[i - 1];
    const [x1, y1] = ROUTE_POINTS[i];
    vertexDist.push(vertexDist[i - 1] + Math.hypot(x1 - x0, y1 - y0) * METRES_PER_UNIT);
  }
  const routeM = vertexDist[vertexDist.length - 1];

  /** Speed at a distance along the route: base, easing through the corners. */
  const speedAtDist = (d: number, spray: boolean): number => {
    const base = spray ? SPRAY_SPEED_MS : TRANSIT_SPEED_MS;
    let nearest = Infinity;
    for (let i = 1; i < vertexDist.length - 1; i++) {
      nearest = Math.min(nearest, Math.abs(d - vertexDist[i]));
    }
    if (nearest >= TURN_RAMP_M) return base;
    const f = nearest / TURN_RAMP_M;              // 0 at the corner, 1 at the ramp edge
    return TURN_SPEED_MS + (base - TURN_SPEED_MS) * f;
  };

  const segs: HeroSeg[] = [];
  let t = 0;
  let dist = 0;

  for (let i = 1; i < ROUTE_POINTS.length; i++) {
    const [x0, y0] = ROUTE_POINTS[i - 1];
    const [x1, y1] = ROUTE_POINTS[i];
    const legUnits = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.round(legUnits / STEP_UNITS));
    const stepM = (legUnits / steps) * METRES_PER_UNIT;

    for (let sIdx = 0; sIdx < steps; sIdx++) {
      const f = (sIdx + 0.5) / steps;
      const spray = sprayingAt(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
      const speed = speedAtDist(dist + stepM / 2, spray);
      const dt = stepM / speed;
      // One segment per step, each with its own speed: buildTankProfile reads
      // acceleration from the change between consecutive samples, so a smooth
      // ramp through a corner gives smooth pitch and smooth slosh rather than
      // a single-step impulse that decays before anyone sees it.
      segs.push({
        speed, spray, tStart: t, tEnd: t + dt,
        distStart: dist, distEnd: dist + stepM,
      });
      t += dt;
      dist += stepM;
    }
  }
  void routeM;

  // Chemical for the sprayed ground: swath × sprayed distance × rate.
  const SWATH_M = 9;              // T40's effective swath
  const RATE_LHA = 22;
  const sprayedM = segs.reduce((a, s) => a + (s.spray ? s.distEnd - s.distStart : 0), 0);
  const requiredLitres = ((sprayedM * SWATH_M) / 10_000) * RATE_LHA;

  const startLitres = Math.min(T40_PHYSICS.tankCapacityL, Math.max(requiredLitres, 1));
  const sprayS = segs.reduce((a, s) => a + (s.spray ? s.tEnd - s.tStart : 0), 0);

  const profile = buildTankProfile(segs, t, {
    config: T40_PHYSICS,
    startLitres,
    // Flow the prescription implies, exactly as the planner derives it.
    flowLpm: sprayS > 0 ? requiredLitres / (sprayS / 60) : undefined,
    tempC: AMBIENT_C,
    dt: 0.4,
  });

  return { segs, totalTimeS: t, totalDistM: dist, profile, requiredLitres };
}

export type HeroTelemetry = {
  /** True once the marker is airborne; before that the panel shows standby. */
  flying: boolean;
  /** 0..1 through the flight itself. */
  progress: number;
  sample: TankSample | null;
  batteryPct: number;
  altitudeM: number;
  distanceM: number;
  spraying: boolean;
};

/**
 * Telemetry at a moment in the animation's loop.
 *
 * `loopFraction` is 0..1 across the 16 s cycle. The marker only flies between
 * HERO_FLIGHT_FROM and HERO_FLIGHT_TO — before that the boundary, zones and
 * route are still drawing on, and the honest reading is "on the ground".
 */
export function heroTelemetryAt(mission: HeroMission, loopFraction: number): HeroTelemetry {
  const f = ((loopFraction % 1) + 1) % 1;
  if (f < HERO_FLIGHT_FROM) {
    return {
      flying: false, progress: 0, sample: sampleTankAt(mission.profile, 0),
      batteryPct: 100, altitudeM: 0, distanceM: 0, spraying: false,
    };
  }
  const progress = Math.min(1, (f - HERO_FLIGHT_FROM) / (HERO_FLIGHT_TO - HERO_FLIGHT_FROM));
  const t = mission.totalTimeS * progress;
  const sample = sampleTankAt(mission.profile, t);

  // Battery by charge actually spent, the same amp-second integration the
  // planner uses — not a straight line through time.
  const spent = mission.profile.totalAmpS > 0
    ? (sample?.cumAmpS ?? 0) / mission.profile.totalAmpS
    : progress;
  const enduranceMin = DRONE_SPECS["DJI Agras T40"].max_flight_min;
  const drawPct = ((mission.totalTimeS / 60) / enduranceMin) * 100;
  const batteryPct = Math.max(0, 100 - spent * drawPct);

  return {
    flying: true,
    progress,
    sample,
    batteryPct,
    altitudeM: sample?.spraying ? SPRAY_ALT_M : TRANSIT_ALT_M,
    distanceM: mission.totalDistM * progress,
    spraying: !!sample?.spraying,
  };
}
