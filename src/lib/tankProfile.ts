// Tank state across a whole mission, precomputed so any moment can be sampled.
//
// WHY PRECOMPUTE RATHER THAN STEP LIVE. Slosh is stateful — where the fluid
// sits now depends on where it was a moment ago — but the scrubber lets an
// operator jump to 70% of a mission they have never played. A live integrator
// cannot answer that without replaying from zero, so dragging the scrubber
// would either lag or lie. Building the profile once means every sample, in any
// order, is the same value playback would have produced.
//
// It is also cheap: a few hundred steps of arithmetic, built once per mission
// and reused for every frame. This is the calculation people reach for a Web
// Worker over; it does not need one, and putting it on a worker would add async
// drift to the very clock the widget exists to stay in sync with.
import {
  type DronePhysicsConfig,
  airDensity, allUpWeightKg, computeAmpDraw, pitchFromAccel, remainingLitres,
  sloshTargetCm, staticFillOffsetCm, stepSlosh, totalCogOffsetCm,
} from "./dronePhysics";

/** One resolved instant of tank state. */
export type TankSample = {
  t: number;
  litres: number;
  /** 0–1. Drives the fill height. */
  fillFraction: number;
  auwKg: number;
  speedMs: number;
  accelMs2: number;
  pitchDeg: number;
  /** Fore/aft fluid displacement, cm. Positive is AFT. */
  sloshCm: number;
  /** Slosh plus the static offset from partial fill, cm. Positive is AFT. */
  cogOffsetCm: number;
  amps: number;
  /**
   * Amp-seconds consumed from takeoff to this instant.
   *
   * The reason the simulated battery can fall FASTER at the start of a mission
   * than at the end: a full tank draws more, so the same second of flight costs
   * more charge. A drain curve linear in time cannot express that, however
   * correct its endpoints are.
   */
  cumAmpS: number;
  spraying: boolean;
};

export type TankProfile = {
  samples: TankSample[];
  dt: number;
  total: number;
  startLitres: number;
  capacityL: number;
  /** Total amp-seconds over the whole mission — the denominator for % drained. */
  totalAmpS: number;
};

type Seg = { speed: number; spray: boolean; tStart: number; tEnd: number };

export type TankProfileOptions = {
  config: DronePhysicsConfig;
  startLitres: number;
  flowLpm?: number;
  tempC?: number;
  elevationM?: number;
  relHumidity?: number;
  /** Seconds between samples. Smaller is smoother and costs linearly. */
  dt?: number;
};

const speedAt = (segs: Seg[], t: number): Seg | null => {
  for (const s of segs) if (t >= s.tStart && t < s.tEnd) return s;
  return segs.length ? segs[segs.length - 1] : null;
};

/**
 * Walk the mission once, carrying tank mass and slosh.
 *
 * Acceleration comes from the change in commanded speed between consecutive
 * samples — the same thing the aircraft would feel crossing from a transit leg
 * into a spray leg, or braking into a turn. That is what tilts it, and the tilt
 * is what throws the fluid.
 */
export function buildTankProfile(
  segs: Seg[], total: number, opts: TankProfileOptions,
): TankProfile {
  const cfg = opts.config;
  const dt = opts.dt ?? 0.25;
  const capacityL = cfg.tankCapacityL;
  const startLitres = Math.max(0, Math.min(capacityL, opts.startLitres));
  const rho = airDensity(opts.tempC ?? 20, opts.elevationM ?? 0, opts.relHumidity ?? 0.5);

  // Flow: measured if known, otherwise whatever empties the load over the spray
  // legs. The fallback drains evenly rather than pretending to know a pump curve.
  const sprayS = segs.reduce((a, s) => a + (s.spray ? s.tEnd - s.tStart : 0), 0);
  const flowLpm = opts.flowLpm && opts.flowLpm > 0
    ? opts.flowLpm
    : (sprayS > 0 ? startLitres / (sprayS / 60) : 0);

  const samples: TankSample[] = [];
  let slosh = 0;
  let sprayedS = 0;
  let prevSpeed = 0;
  let cumAmpS = 0;

  const steps = Math.max(1, Math.ceil(total / dt));
  for (let i = 0; i <= steps; i++) {
    const t = Math.min(total, i * dt);
    const seg = speedAt(segs, t);
    const speedMs = seg?.speed ?? 0;
    const spraying = !!seg?.spray;
    if (spraying && i > 0) sprayedS += dt;

    const litres = remainingLitres(startLitres, sprayedS, flowLpm);
    const fillFraction = capacityL > 0 ? litres / capacityL : 0;
    const auwKg = allUpWeightKg(cfg, litres);

    const accelMs2 = i === 0 ? 0 : (speedMs - prevSpeed) / dt;
    prevSpeed = speedMs;

    const pitchDeg = pitchFromAccel(accelMs2, cfg);
    slosh = stepSlosh(slosh, sloshTargetCm(pitchDeg, fillFraction, cfg), fillFraction, dt, cfg);
    const cogOffsetCm = totalCogOffsetCm(staticFillOffsetCm(fillFraction, cfg), slosh);

    const amps = computeAmpDraw(auwKg, cogOffsetCm, rho, cfg);
    if (i > 0) cumAmpS += amps * dt;

    samples.push({
      t, litres, fillFraction, auwKg, speedMs, accelMs2, pitchDeg,
      sloshCm: slosh, cogOffsetCm, amps, cumAmpS, spraying,
    });
  }

  return { samples, dt, total, startLitres, capacityL, totalAmpS: cumAmpS };
}

/**
 * Tank state at an arbitrary moment, interpolated between samples.
 *
 * Interpolating rather than snapping matters: the render loop runs faster than
 * the profile's step, and snapping to the nearest sample makes a smooth drain
 * look like a staircase.
 */
export function sampleTankAt(profile: TankProfile, t: number): TankSample | null {
  const { samples, dt } = profile;
  if (!samples.length) return null;
  const clamped = Math.max(0, Math.min(profile.total, t));
  const idx = Math.min(samples.length - 1, Math.floor(clamped / dt));
  const a = samples[idx];
  const b = samples[Math.min(samples.length - 1, idx + 1)];
  if (a === b) return a;
  const f = Math.max(0, Math.min(1, (clamped - a.t) / Math.max(1e-6, b.t - a.t)));
  const lerp = (x: number, y: number) => x + (y - x) * f;
  return {
    t: clamped,
    litres: lerp(a.litres, b.litres),
    fillFraction: lerp(a.fillFraction, b.fillFraction),
    auwKg: lerp(a.auwKg, b.auwKg),
    speedMs: lerp(a.speedMs, b.speedMs),
    accelMs2: lerp(a.accelMs2, b.accelMs2),
    pitchDeg: lerp(a.pitchDeg, b.pitchDeg),
    sloshCm: lerp(a.sloshCm, b.sloshCm),
    cogOffsetCm: lerp(a.cogOffsetCm, b.cogOffsetCm),
    amps: lerp(a.amps, b.amps),
    cumAmpS: lerp(a.cumAmpS, b.cumAmpS),
    spraying: f < 0.5 ? a.spraying : b.spraying,
  };
}

/**
 * Surface tilt, degrees, for a given fore/aft displacement.
 *
 * Purely presentational: the physics tracks where the fluid MASS sits, and the
 * drawing needs an angle for the surface. Proportional, clamped so a violent
 * manoeuvre cannot tip the liquid past the point of looking like liquid.
 */
export function surfaceTiltDeg(sloshCm: number, cfg: DronePhysicsConfig): number {
  const norm = Math.max(-1, Math.min(1, sloshCm / Math.max(1, cfg.sloshMaxOffsetCm)));
  return norm * 18;
}
