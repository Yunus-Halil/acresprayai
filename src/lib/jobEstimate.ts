// What a spray job costs in time, tank loads and battery packs, before anything
// is powered on.
//
// THE MOMENT THIS SERVES. An operator quoting a job, or loading the tender
// truck the night before, has no aircraft running and therefore no figure from
// the controller at all. The Agras can tell you what a mission will take once
// the mission exists on the aircraft; it cannot tell you at 9pm whether
// tomorrow is one truck trip or three. That gap is the whole reason this file
// exists, and it is why the estimate is built from marked ground and an
// aircraft profile rather than from a routed mission.
//
// NOT A COMPETITOR TO THE CONTROLLER'S NUMBER. Where this disagrees with what
// the Agras says, the aircraft is measuring and this is modelling, and the
// operator should be able to see in one glance which input differs. That is why
// every assumption is an explicit field on the input type and every one of them
// is rendered, editable, in the panel. A visible disagreement is a calibration;
// a hidden one is a reason to stop trusting the tool.
//
// RELATIONSHIP TO missionStats.ts. That file estimates a ROUTED mission: it has
// a real path, real segment speeds and a physics integration behind it, and it
// is what the planner and the calendar agree on. This file estimates a JOB, and
// it runs on ground and an aircraft alone. They answer different questions at
// different moments and neither replaces the other. Where both can run, the
// routed number is the better one.
import {
  type AgrasProfile, EFFECTIVE_SWATH_FACTOR_DEFAULT, IN_CANOPY_SWATH_CAP_M,
  type Range, type SwathConstraint, clampToRange, constrainSwath, maxFlowLpm,
  usableTankAtElevationL,
} from "./agrasProfiles";
import {
  M2_PER_HECTARE, type UnitSystem, altitudeUnit, altitudeValue, fmtAltitude,
  fmtFlow, fmtMass, fmtMetricRange, fmtSpeed, fmtVolume, speedUnit, speedValue,
} from "./units";

/**
 * Non-productive time, which is most of a real day and none of a spec sheet.
 *
 * No manufacturer figure includes any of this, which is why an operator who
 * plans a day off flight time alone finishes it in the dark. Every default here
 * is a starting point the operator overrides, not a measurement.
 */
export type GroundOpsInput = {
  /**
   * Round trip from the tender truck to the field, per load, minutes.
   *
   * Flight time, so it drains the pack as well as the clock. Zero when the
   * truck is parked at the field edge, which is the case worth encouraging.
   */
  ferryMinPerLoad: number;
  /** Minutes to fill the tank at a stop. The first fill happens before launch. */
  refillMin: number;
  /** Minutes to swap a battery pack. */
  batterySwapMin: number;
  /**
   * Packs in rotation, and how long one needs on the cooling station before it
   * goes back on the aircraft.
   *
   * WHY THIS IS MODELLED AT ALL. T100 field reports describe overheat warnings
   * on low-speed high-rate passes, and rotating three packs through a cooling
   * station being effectively required rather than a nicety. With too few packs
   * the aircraft sits on the ground waiting for one, and that wait is real time
   * on a real day that no endurance figure predicts.
   */
  batteriesOnHand: number;
  batteryCooldownMin: number;
};

export const DEFAULT_GROUND_OPS: GroundOpsInput = {
  ferryMinPerLoad: 0,
  refillMin: 2,
  batterySwapMin: 1.5,
  batteriesOnHand: 3,
  batteryCooldownMin: 15,
};

export type JobEstimateInput = {
  profile: AgrasProfile;
  /** False when `profile` is the generic fallback. Drives the warnings. */
  profileMatched: boolean;
  /** Ground the operator confirmed, square metres. The number we own. */
  treatedAreaM2: number;
  /** Target rate, litres per hectare. Operator agronomy, never inferred. */
  applicationRateLha: number;

  // --- the assumptions, all of which the panel renders and lets you edit ---
  /** Advertised swath the operator is planning on, metres. */
  advertisedSwathM: number;
  /** Purdue calibration factor. See EFFECTIVE_SWATH_FACTOR_DEFAULT. */
  effectiveSwathFactor: number;
  /** In-canopy work caps effective swath at IN_CANOPY_SWATH_CAP_M. */
  inCanopy: boolean;
  speedMs: number;
  heightM: number;
  /** Tank fill for this job, 0-100. */
  tankLoadPct: number;
  /** Nozzles in use, which is what the flow ceiling depends on. */
  nozzles: 2 | 4;
  /** Field elevation, metres. Feeds the DJI payload derate rule. */
  elevationM: number;
  /**
   * Tank capacity to plan against, litres, when a better figure than the
   * profile's exists — a DJI-published capacity or one the operator read off
   * their own machine. Null uses the profile's, which may be unverified.
   */
  tankCapacityL: number | null;
  ground: GroundOpsInput;
  /**
   * Units the WARNING PROSE is written in. The maths is SI throughout and does
   * not move; only the sentences do. Defaults to metric so a caller that has no
   * display preference — a test, a stored estimate — reads back the SI it
   * stored rather than a conversion that depends on who was looking.
   */
  display?: UnitSystem;
};

export type EstimateWarning = {
  /** Profile field or input the warning is about. */
  field: string;
  /**
   * "blocking" means a number could not be computed and is absent from the
   * result. "note" means a number IS shown and rests on something unverified.
   */
  severity: "blocking" | "note";
  message: string;
};

/** One tank load, and which of the two constraints ended it. */
export type LoadBreakdown = {
  index: number;
  litres: number;
  areaM2: number;
  sprayMin: number;
  /**
   * What ran out first on this load.
   *
   * "tank" is the healthy case and the one DJI designs for. "battery" means a
   * pack swap lands mid-load, in the middle of a pass, which is the thing an
   * operator wants to know about the night before rather than at the moment it
   * happens. "unknown" means no verified hover figure exists for this airframe.
   */
  binds: "tank" | "battery" | "unknown";
  /** Pack swaps that land inside this load rather than at its boundary. */
  midLoadSwaps: number;
};

/** An input held against the profile's stored envelope. */
export type EnvelopeClamp = {
  /** The value the estimate actually ran on, SI. */
  value: number;
  /** What the operator asked for, SI. */
  requested: number;
  clamped: boolean;
};

export type JobEstimate = {
  // --- the number we own, first ---
  treatedAreaM2: number;
  treatedAreaHa: number;

  // --- the envelope the estimate was allowed to run in ---
  /** Speed after the profile's stored range has had its say, m/s. */
  speed: EnvelopeClamp;
  /** Height after the profile's stored range has had its say, m. */
  height: EnvelopeClamp;

  // --- swath ---
  swath: SwathConstraint;
  /** After the calibration factor and the in-canopy cap, metres. */
  effectiveSwathM: number;
  /** True when the in-canopy cap, not the factor, set the width. */
  inCanopyCapped: boolean;

  // --- productive time ---
  /** Effective swath times speed, m²/s. */
  coverageRateM2S: number;
  /** Boom-on time. Turns, ferry and ground time are not in here. */
  sprayFlightMin: number;

  // --- chemical and loads ---
  requiredLitres: number;
  perLoadLitres: number;
  /** Ground one full load covers at the target rate, square metres. */
  areaPerLoadM2: number;
  tankLoads: number;
  /** `tankLoads - 1`. The headline: trips back to the nurse tank. */
  refillStops: number;
  leftoverLitres: number;

  // --- flow ---
  /** Litres/min the chosen rate and speed demand of the pump. */
  requiredFlowLpm: number;
  /** The pump's ceiling at this nozzle count, or null when unverified. */
  maxFlowLpm: number | null;
  /** True when the demand exceeds a KNOWN ceiling. Never true when unknown. */
  flowCeilingExceeded: boolean;
  /** Fastest the aircraft can fly and still deliver the rate, m/s, or null. */
  maxSpeedForRateMs: number | null;
  /** Tank divided by max flow: the floor on a load, continuous spray, minutes. */
  minTimePerTankMin: number | null;

  // --- battery ---
  /** Endurance per pack, minutes, from hover-at-load. Null when unverified. */
  batteryEnduranceMin: number | null;
  /** Pack swaps across the whole job. Null when endurance is unknown. */
  batteryChanges: number | null;
  /** Minutes the aircraft spends waiting for a cooled pack. */
  coolingWaitMin: number;
  loads: LoadBreakdown[];

  // --- the two totals, and the gap between them ---
  productiveMin: number;
  nonProductive: {
    ferryMin: number;
    refillMin: number;
    batterySwapMin: number;
    coolingMin: number;
    total: number;
  };
  totalJobMin: number;

  warnings: EstimateWarning[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Litres one hectare needs at a rate. Trivial, named so the units are visible. */
const litresFor = (areaM2: number, rateLha: number) => (areaM2 / M2_PER_HECTARE) * rateLha;

/**
 * The whole estimate, pure.
 *
 * Same inputs, same numbers, no clock and no storage — so the panel, a saved
 * quote and a test all agree, and a stored estimate keeps saying what it said
 * when it was made.
 */
export function estimateJob(input: JobEstimateInput): JobEstimate {
  const { profile, ground } = input;
  const display: UnitSystem = input.display ?? "metric";
  const warnings: EstimateWarning[] = [];

  // Prose helpers. SI in, the reader's units out, and nothing else in this
  // function converts anything — the arithmetic below is metric start to end.
  const len = (m: number) => `${round2(altitudeValue(m, display))} ${altitudeUnit(display)}`;
  const spd = (ms: number) => `${round2(speedValue(ms, display))} ${speedUnit(display)}`;

  // --- the envelope ------------------------------------------------------
  //
  // WHY THESE ARE HELD AND NOT JUST LABELLED. The panel used to print the
  // aircraft's range as label text and accept anything typed underneath it, so
  // a 40 ft swath or a 30 mph pass produced an estimate for an aircraft that
  // does not exist — and produced it silently, in the same type as a real one.
  // A range that only exists as a caption is decoration. Held here, at the one
  // place the estimate is computed, so every consumer gets the same guard.
  const heldTo = (v: number, r: Range): EnvelopeClamp => {
    const value = clampToRange(Number.isFinite(v) ? v : r[0], r);
    return { value, requested: v, clamped: Math.abs(value - v) > 1e-9 };
  };
  const speed = heldTo(input.speedMs, profile.speed_ms);
  const height = heldTo(input.heightM, profile.height_m);
  const speedMs = speed.value;
  const heightM = height.value;

  if (speed.clamped) {
    warnings.push({
      field: "speedMs.envelope",
      severity: "note",
      message:
        `${spd(speed.requested)} is outside the ${profile.model} envelope of ` +
        `${fmtMetricRange(profile.speed_ms, display, "speed", { keepMetric: true })}. ` +
        `Everything below is computed at ${spd(speedMs)}.`,
    });
  }
  if (height.clamped) {
    warnings.push({
      field: "heightM.envelope",
      severity: "note",
      message:
        `${len(height.requested)} is outside the ${profile.model} spray height of ` +
        `${fmtMetricRange(profile.height_m, display, "length")}. ` +
        `Everything below is computed at ${len(heightM)}.`,
    });
  }

  if (!input.profileMatched) {
    warnings.push({
      field: "profile",
      severity: "note",
      message:
        `No aircraft profile for ${profile.id === "Generic" ? "this model" : profile.id}. ` +
        "Every figure below is running on generic placeholders, not on your aircraft. " +
        "Treat it as a shape, not an estimate, until the model is added.",
    });
  }

  // --- swath -------------------------------------------------------------
  //
  // Three corrections, in order, and each one narrows: the envelope holds the
  // advertised width against the speed and height it was asked for, the Purdue
  // factor turns advertised into what actually gets treated, and the in-canopy
  // cap overrides both where the canopy rather than the boom is the limit.
  const factor = input.effectiveSwathFactor > 0
    ? input.effectiveSwathFactor
    : EFFECTIVE_SWATH_FACTOR_DEFAULT;

  /**
   * Effective swath at a candidate speed.
   *
   * A function of speed rather than a constant because the envelope makes it
   * one: flying slower narrows the swath as well as covering less ground per
   * second. Anything that reasons about a DIFFERENT speed than the one selected
   * has to go back through here, or it is reasoning about an aircraft that
   * keeps its wide pattern while slowing down, which is the exact fiction the
   * envelope exists to prevent.
   */
  const effectiveSwathAt = (atSpeedMs: number): number => {
    const w = constrainSwath(profile, input.advertisedSwathM, atSpeedMs, heightM).swathM * factor;
    return input.inCanopy ? Math.min(w, IN_CANOPY_SWATH_CAP_M) : w;
  };

  const swath = constrainSwath(profile, input.advertisedSwathM, speedMs, heightM, display);
  if (swath.clamped && swath.reason) {
    warnings.push({ field: "advertisedSwathM", severity: "note", message: swath.reason });
  }

  const factored = swath.swathM * factor;
  const inCanopyCapped = input.inCanopy && factored > IN_CANOPY_SWATH_CAP_M;
  const effectiveSwathM = inCanopyCapped ? IN_CANOPY_SWATH_CAP_M : factored;
  if (inCanopyCapped) {
    warnings.push({
      field: "inCanopy",
      severity: "note",
      message:
        `In-canopy work is capped at ${fmtAltitude(IN_CANOPY_SWATH_CAP_M, display).text} of ` +
        "effective swath. " +
        "Field measurement on this class found no more than that regardless of the " +
        "advertised width, so the cap is a measurement and not a safety margin.",
    });
  }

  const treatedAreaM2 = Math.max(0, input.treatedAreaM2);
  const treatedAreaHa = treatedAreaM2 / M2_PER_HECTARE;
  const rate = Math.max(0, input.applicationRateLha);

  // --- productive time ---------------------------------------------------
  const coverageRateM2S = effectiveSwathM * Math.max(0, speedMs);
  const sprayFlightMin = coverageRateM2S > 0 ? treatedAreaM2 / coverageRateM2S / 60 : 0;

  // --- chemical and loads ------------------------------------------------
  const requiredLitres = litresFor(treatedAreaM2, rate);

  // Capacity precedence: a figure somebody actually stated beats the profile's,
  // because several of the profile capacities are quoted rather than published
  // and two of the airframes have no DJI page left at all.
  const capacityL = input.tankCapacityL != null && input.tankCapacityL > 0
    ? input.tankCapacityL
    : profile.tank_l;
  if (input.tankCapacityL == null && profile.unverified.includes("tank_l")) {
    warnings.push({
      field: "tank_l",
      severity: "note",
      message:
        `${fmtVolume(profile.tank_l, display, 0).text} is a quoted capacity for the ${profile.model}, not one DJI ` +
        "publishes. Every load, refill and chemical figure below rests on it. Read the " +
        "capacity off your own machine and set it on the drone.",
    });
  }

  // Thin air costs payload, so at elevation the tank is not the limit the
  // aircraft can lift. This is the DJI derate rule as a planning bound, not a
  // lift model — that lives in dronePhysics.ts and is not duplicated here.
  const liftableL = usableTankAtElevationL({ ...profile, tank_l: capacityL }, input.elevationM);
  const fill = Math.max(0, Math.min(100, input.tankLoadPct)) / 100;
  const perLoadLitres = liftableL * fill;
  if (input.elevationM > 0 && liftableL < capacityL) {
    warnings.push({
      field: "elevationM",
      severity: "note",
      message:
        `At ${fmtAltitude(input.elevationM, display).text} of field elevation the payload derate takes ` +
        `${fmtMass(capacityL - liftableL, display).text} off the load, so a full tank here is ` +
        `${fmtVolume(liftableL, display).text} rather than ${fmtVolume(capacityL, display, 0).text}.`,
    });
  }

  const areaPerLoadM2 = rate > 0 ? (perLoadLitres / rate) * M2_PER_HECTARE : 0;
  const tankLoads = perLoadLitres > 0 && requiredLitres > 0
    ? Math.ceil(requiredLitres / perLoadLitres)
    : (requiredLitres > 0 ? 0 : 1);
  const refillStops = Math.max(0, tankLoads - 1);
  const leftoverLitres = tankLoads > 0 ? perLoadLitres * tankLoads - requiredLitres : 0;

  // --- flow --------------------------------------------------------------
  //
  // The rate the operator chose and the speed they chose together demand a
  // pump rate. If that exceeds what the pump can deliver, the rate does not go
  // out — the aircraft flies the pattern and lays down less than the label
  // says, which is the failure nobody sees until the pest comes back.
  const flowAt = (speedMs: number) =>
    rate * ((effectiveSwathAt(speedMs) * speedMs * 60) / M2_PER_HECTARE);

  const coverageHaPerMin = (coverageRateM2S * 60) / M2_PER_HECTARE;
  const requiredFlowLpm = rate * coverageHaPerMin;
  const ceiling = maxFlowLpm(profile, input.nozzles);
  const flowCeilingExceeded = ceiling != null && requiredFlowLpm > ceiling;
  const maxSpeedForRateMs = ceiling != null ? solveSpeedForFlow(flowAt, ceiling, profile.speed_ms) : null;
  const minTimePerTankMin = ceiling != null && ceiling > 0 ? perLoadLitres / ceiling : null;

  if (ceiling == null) {
    warnings.push({
      field: "flow_lpm",
      severity: "blocking",
      message:
        `No verified flow ceiling for the ${profile.model} at ${input.nozzles} nozzles, so ` +
        "nothing here checks whether the pump can actually deliver this rate at this speed. " +
        "It might not.",
    });
  } else if (flowCeilingExceeded) {
    const asked =
      `This rate at ${spd(speedMs)} asks the pump for ` +
      `${fmtFlow(requiredFlowLpm, display).text} and it delivers ${fmtFlow(ceiling, display).text}. `;
    warnings.push({
      field: "speedMs",
      severity: maxSpeedForRateMs == null ? "blocking" : "note",
      message: maxSpeedForRateMs != null
        ? asked +
          `Fly at or below ${fmtSpeed(maxSpeedForRateMs, display).text}, or the aircraft flies the ` +
          "pattern and lays down less than the label rate."
        : asked +
          `No speed in the ${profile.model} envelope delivers it, because slowing down ` +
          "narrows the swath as well. The rate or the nozzles have to change, not the speed.",
    });
  }

  // --- battery -----------------------------------------------------------
  //
  // FROM HOVER AT LOAD, NOT FROM A NOMINAL FLIGHT TIME. A nominal figure is
  // measured on an aircraft that is not carrying the job. Hover at max takeoff
  // weight is the worst minute of a load rather than the average one, which
  // makes it conservative in a known direction: the aircraft is at MTOW exactly
  // once, at the start, and lightens from there, so real endurance per pack
  // exceeds this. Erring toward more packs than needed is the correct error for
  // a number an operator packs a truck against.
  const batteryEnduranceMin = profile.hover?.minutes ?? null;
  if (batteryEnduranceMin == null) {
    warnings.push({
      field: "hover",
      severity: "blocking",
      message:
        `No verified hover-at-load figure for the ${profile.model}, so battery count and ` +
        "cooling waits are not computed. The time figures below assume packs are never the " +
        "thing you are waiting on, which on a long job they will be.",
    });
  } else if (profile.unverified.includes("hover.at_kg")) {
    warnings.push({
      field: "hover.at_kg",
      severity: "note",
      message:
        `The ${profile.model} hover figure is quoted as ${batteryEnduranceMin} minutes ` +
        "loaded, without the takeoff weight it was measured at. The pack count rests on it.",
    });
  }

  const sim = simulateLoads({
    tankLoads,
    perLoadLitres,
    requiredLitres,
    requiredFlowLpm,
    rate,
    batteryEnduranceMin,
    ferryMinPerLoad: Math.max(0, ground.ferryMinPerLoad),
    batterySwapMin: Math.max(0, ground.batterySwapMin),
    refillMin: Math.max(0, ground.refillMin),
    batteriesOnHand: Math.max(1, Math.floor(ground.batteriesOnHand)),
    batteryCooldownMin: Math.max(0, ground.batteryCooldownMin),
  });

  if (batteryEnduranceMin != null && sim.coolingWaitMin > 0) {
    warnings.push({
      field: "batteriesOnHand",
      severity: "note",
      message:
        `${ground.batteriesOnHand} packs on a ${ground.batteryCooldownMin} minute cooldown ` +
        `leaves the aircraft on the ground for ${Math.round(sim.coolingWaitMin)} minutes ` +
        "waiting for a cooled pack. One more pack, or a cooling station, buys that back.",
    });
  }

  // --- the two totals ----------------------------------------------------
  const ferryMin = ground.ferryMinPerLoad * Math.max(0, tankLoads);
  // Refills, not loads: the first tank is filled before the aircraft launches,
  // so it is not on this clock. The stops are.
  const refillMin = ground.refillMin * refillStops;
  const batterySwapMin = sim.batteryChanges != null
    ? ground.batterySwapMin * sim.batteryChanges
    : 0;
  const coolingMin = sim.coolingWaitMin;
  const nonProductiveTotal = ferryMin + refillMin + batterySwapMin + coolingMin;

  return {
    treatedAreaM2,
    treatedAreaHa,
    speed,
    height,
    swath,
    effectiveSwathM,
    inCanopyCapped,
    coverageRateM2S,
    sprayFlightMin,
    requiredLitres,
    perLoadLitres,
    areaPerLoadM2,
    tankLoads,
    refillStops,
    leftoverLitres,
    requiredFlowLpm,
    maxFlowLpm: ceiling,
    flowCeilingExceeded,
    maxSpeedForRateMs,
    minTimePerTankMin,
    batteryEnduranceMin,
    batteryChanges: sim.batteryChanges,
    coolingWaitMin: sim.coolingWaitMin,
    loads: sim.loads,
    productiveMin: sprayFlightMin,
    nonProductive: {
      ferryMin,
      refillMin,
      batterySwapMin,
      coolingMin,
      total: nonProductiveTotal,
    },
    totalJobMin: sprayFlightMin + nonProductiveTotal,
    warnings,
  };
}

/**
 * The fastest speed in the aircraft's envelope whose flow demand still fits the
 * pump, or null when none of it does.
 *
 * WHY THIS IS SOLVED RATHER THAN DIVIDED. The obvious answer is
 * `speed x ceiling / demand`, and it is wrong here, because slowing down does
 * not only cover less ground per second, it also NARROWS THE SWATH — the wide
 * pattern is a product of speed and height. So demand falls faster than
 * linearly as the aircraft slows, and the division names a speed well below the
 * one that actually works. Wrong in the safe direction, but wrong: an operator
 * told to fly 7.6 when 8.3 was available loses that difference across every
 * pass of every load, all day.
 *
 * `flowAt` is monotonically increasing in speed (swath is non-decreasing and
 * speed is increasing), so a bisection is exact to the tolerance and needs no
 * assumption about the shape of the curve between the ends. 40 iterations puts
 * the answer inside a millimetre per second of the true crossing.
 */
function solveSpeedForFlow(
  flowAt: (speedMs: number) => number, ceilingLpm: number, envelope: readonly [number, number],
): number | null {
  const [lo, hi] = envelope;
  if (flowAt(lo) > ceilingLpm) return null;   // nothing in the envelope works
  if (flowAt(hi) <= ceilingLpm) return hi;    // the whole envelope works
  let a = lo, b = hi;
  for (let i = 0; i < 40; i++) {
    const mid = (a + b) / 2;
    if (flowAt(mid) <= ceilingLpm) a = mid; else b = mid;
  }
  return a;
}

type SimInput = {
  tankLoads: number;
  perLoadLitres: number;
  requiredLitres: number;
  requiredFlowLpm: number;
  rate: number;
  batteryEnduranceMin: number | null;
  ferryMinPerLoad: number;
  batterySwapMin: number;
  refillMin: number;
  batteriesOnHand: number;
  batteryCooldownMin: number;
};

/**
 * Walk the job load by load, carrying the pack and the clock.
 *
 * WHY A WALK RATHER THAN A DIVISION. DJI sizes the tank and the battery so
 * they run out at roughly the same time, which means neither one is the
 * constraint and dividing by either alone is wrong in both directions: size the
 * day on the tank and you miss the swaps, size it on the battery and you miss
 * the refills. Stepping through the loads is what lets each one report which of
 * the two actually ended it, and it is the only way a mid-load swap — a pack
 * change landing in the middle of a pass — shows up at all.
 *
 * Ferry time drains the pack as well as the clock, because the aircraft flies
 * it. Refill time does not: the aircraft is on the ground with the motors off.
 */
function simulateLoads(s: SimInput): {
  loads: LoadBreakdown[];
  batteryChanges: number | null;
  coolingWaitMin: number;
} {
  const loads: LoadBreakdown[] = [];
  if (!(s.tankLoads > 0) || !(s.perLoadLitres > 0)) {
    return { loads, batteryChanges: s.batteryEnduranceMin != null ? 0 : null, coolingWaitMin: 0 };
  }

  const endurance = s.batteryEnduranceMin;
  // Packs are identified only by when they are next usable. A fresh fleet is
  // all available at minute zero.
  const readyAt: number[] = Array.from({ length: s.batteriesOnHand }, () => 0);
  let clock = 0;
  let packRemaining = endurance ?? Infinity;
  let swaps = 0;
  let coolingWait = 0;

  // The pack on the aircraft at the start came off the shelf, so it is not in
  // the ready queue. Take it out.
  if (readyAt.length > 0) readyAt.shift();

  const swapPack = () => {
    if (endurance == null) return;
    // The one that has been cooling longest is the one that goes on.
    readyAt.sort((a, b) => a - b);
    const next = readyAt.shift() ?? clock;
    const wait = Math.max(0, next - clock);
    coolingWait += wait;
    clock += wait + s.batterySwapMin;
    // The pack that just came off starts its own cooldown now.
    readyAt.push(clock + s.batteryCooldownMin);
    packRemaining = endurance;
    swaps += 1;
  };

  /** Fly `minutes` of airtime, swapping packs as they run out. Returns swaps. */
  const fly = (minutes: number): number => {
    let remaining = minutes;
    let midSwaps = 0;
    while (remaining > 1e-9) {
      if (endurance != null && packRemaining <= 1e-9) {
        swapPack();
        midSwaps += 1;
      }
      const chunk = Math.min(remaining, packRemaining);
      remaining -= chunk;
      clock += chunk;
      if (endurance != null) packRemaining -= chunk;
      if (endurance == null) break;   // infinite pack: one chunk finishes it
    }
    return midSwaps;
  };

  let litresLeft = s.requiredLitres;
  for (let i = 0; i < s.tankLoads; i++) {
    const litres = Math.min(s.perLoadLitres, litresLeft);
    litresLeft -= litres;
    const sprayMin = s.requiredFlowLpm > 0 ? litres / s.requiredFlowLpm : 0;
    const areaM2 = s.rate > 0 ? (litres / s.rate) * M2_PER_HECTARE : 0;

    // Half the ferry out, then the load, then half the ferry back. Split so a
    // pack that dies on the way home is counted where it happens.
    let midLoadSwaps = 0;
    midLoadSwaps += fly(s.ferryMinPerLoad / 2);
    const packBefore = packRemaining;
    midLoadSwaps += fly(sprayMin);
    midLoadSwaps += fly(s.ferryMinPerLoad / 2);

    loads.push({
      index: i,
      litres,
      areaM2,
      sprayMin,
      // The tank ends a load unless the pack gave out inside it first.
      binds: endurance == null ? "unknown" : (packBefore < sprayMin ? "battery" : "tank"),
      midLoadSwaps,
    });

    // Refill stop between loads. The aircraft is down with the motors off, so
    // the clock moves and the pack does not. Operators generally swap here too
    // rather than launch on a part-used pack, but that is a habit and not a
    // constraint, so it is not assumed: a swap only happens when a pack is
    // actually out.
    if (i < s.tankLoads - 1) clock += s.refillMin;
  }

  return { loads, batteryChanges: endurance != null ? swaps : null, coolingWaitMin: coolingWait };
}

/** Minutes as "1h 24m" / "24m". For a panel, not for storage. */
export function fmtMinutes(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return "0m";
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
