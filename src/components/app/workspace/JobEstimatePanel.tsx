// The job estimate, with every assumption on the screen next to it.
//
// WHAT THIS IS FOR, AND WHEN. Quoting a job, and loading the tender truck the
// night before. Nothing is powered on at that hour, so the Agras cannot produce
// a number at all, and the operator is working off memory and a feel for the
// field. That is the gap this fills. It is not a second opinion on the
// controller's figure and it must never read like one.
//
// WHY EVERY ASSUMPTION IS RENDERED AND EDITABLE. This estimate will sometimes
// disagree with what the aircraft says once the mission is loaded. When it
// does, the operator has to be able to see in one glance WHICH input differs —
// the swath, the speed, the calibration factor — and correct it. A visible
// disagreement is a calibration exercise and the operator ends up trusting the
// tool more. A hidden one is a credibility problem, and they stop opening the
// panel. So there is no "advanced" section here and nothing is collapsed by
// default: the assumptions ARE the feature.
//
// WHAT LEADS. Treated acreage, at the top, in the largest type on the panel.
// It comes from the zones the operator confirmed, it is what the application
// record needs and what the grower is billed on, and no aircraft can produce it
// before the flight. It is the number we own. Time and battery follow it
// because they are estimates of somebody else's machine.
//
// NOT PERSISTED, ON PURPOSE. Editing an assumption here moves the estimate and
// nothing else. The flight plan keeps its own speed and altitude, because a
// number typed into a quote at 9pm is not a decision to re-plan the mission.
import { useMemo, useState } from "react";
import {
  AlertTriangle, Battery, Clock, Droplets, Fuel, Info, Ruler, Wind,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AGRAS_PROFILE_UPDATED, AGRAS_PROFILE_VERSION, EFFECTIVE_SWATH_FACTOR_DEFAULT,
  EFFECTIVE_SWATH_FACTOR_PUBLISHED, IN_CANOPY_SWATH_CAP_M, PAYLOAD_DERATE_KG_PER_1000M,
  type Range, availableNozzleCounts, midpoint, resolveAgrasProfile,
} from "@/lib/agrasProfiles";
import {
  DEFAULT_GROUND_OPS, type GroundOpsInput, estimateJob, fmtMinutes,
} from "@/lib/jobEstimate";
import {
  M2_PER_HECTARE, type MetricRangeKind, altitudeToM, altitudeUnit, altitudeValue,
  fmtAltitude, fmtArea, fmtFlow, fmtMass, fmtMetricRange, fmtRate, fmtVolume, fmtWindSpeed,
  metricRangeUnit, metricRangeValue, rateToLha, rateUnit, rateValue,
  speedToMs, speedUnit, speedValue,
} from "@/lib/units";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import type { UnitSystem } from "@/lib/units";

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

const CARD = "rounded-sm border border-[#222] p-3";
const CARD_BG = { background: "#0f0f0f" } as const;
const LABEL = "text-[10px] uppercase tracking-wider text-neutral-500";
const INPUT =
  "w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded-sm px-2 py-1 text-xs text-neutral-200 " +
  "focus:outline-none focus:border-[#4CAF50]/60";

/**
 * A number the operator edits, held in SI and shown in their units.
 *
 * The conversion happens here rather than in the estimator, which is the rule
 * the whole codebase runs on: everything is stored in SI and converted only on
 * the way to a screen. `toShown` and `fromShown` are the pair, and they must be
 * inverses or a value drifts every time the panel re-renders.
 */
function NumField({
  label, value, onChange, unit, step = 0.1, min, max, hint, warn,
  toShown = (v: number) => v, fromShown = (v: number) => v,
}: {
  label: string;
  value: number;
  onChange: (siValue: number) => void;
  unit: string;
  step?: number;
  min?: number;
  max?: number;
  hint?: string;
  /** Said out loud, in amber, when the value is outside what the aircraft does. */
  warn?: string;
  toShown?: (si: number) => number;
  fromShown?: (shown: number) => number;
}) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <span className="mt-1 flex items-center gap-1.5">
        <input
          type="number"
          className={`${INPUT} ${warn ? "border-amber-600/70" : ""}`}
          value={round2(toShown(value))}
          step={step}
          min={min}
          max={max}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(fromShown(n));
          }}
        />
        <span className="shrink-0 font-mono text-[10px] text-neutral-500">{unit}</span>
      </span>
      {warn && (
        <span className="mt-1 block text-[10px] leading-relaxed text-amber-400/90">{warn}</span>
      )}
      {hint && <span className="mt-1 block text-[10px] leading-relaxed text-neutral-600">{hint}</span>}
    </label>
  );
}

/**
 * A field bound to an operating range the profile actually stores.
 *
 * WHY THIS IS A SEPARATE THING. The range used to exist only as label text, so
 * the panel would print "9 to 11 m" and then accept a 40 ft swath underneath it
 * without a word. The estimator now holds the value to the envelope, and this
 * is the half of that which the operator can see: the input carries the real
 * min and max, and a value outside them says so in amber and says what the
 * estimate is using instead.
 *
 * `range` is SI, because that is how the profile stores it. Nothing here
 * converts by hand — `fmtMetricRange` writes the label and `metricRangeValue`
 * moves the bounds onto the input.
 */
function RangeField({
  label, range, kind, keepMetric, units, value, onChange, step, hint,
}: {
  label: string;
  range: Range;
  kind: MetricRangeKind;
  /** Keep the metric visible alongside the conversion. Swath and speed only. */
  keepMetric?: boolean;
  units: UnitSystem;
  value: number;
  onChange: (si: number) => void;
  step: number;
  hint?: string;
}) {
  const toShown = (si: number) => metricRangeValue(si, units, kind);
  const fromShown = (shown: number) =>
    kind === "speed" ? speedToMs(shown, units) : altitudeToM(shown, units);
  const out = value < range[0] - 1e-9 || value > range[1] + 1e-9;
  const held = Math.min(range[1], Math.max(range[0], value));
  return (
    <NumField
      label={`${label}, ${fmtMetricRange(range, units, kind, { keepMetric })}`}
      value={value}
      onChange={onChange}
      unit={metricRangeUnit(units, kind)}
      step={step}
      min={round2(toShown(range[0]))}
      max={round2(toShown(range[1]))}
      toShown={toShown}
      fromShown={fromShown}
      warn={out
        ? `Outside this aircraft's range. The estimate is using ` +
          `${round2(toShown(held))} ${metricRangeUnit(units, kind)}.`
        : undefined}
      hint={hint}
    />
  );
}

/** A headline figure. Size is the ranking: acreage is biggest, deliberately. */
function Headline({
  label, value, sub, tone = "green",
}: { label: string; value: string; sub: string; tone?: "green" | "amber" | "plain" }) {
  const colour =
    tone === "green" ? "text-[#4CAF50]" : tone === "amber" ? "text-amber-300" : "text-neutral-200";
  return (
    <div className={CARD} style={CARD_BG}>
      <div className={LABEL}>{label}</div>
      <div className={`mt-1 font-mono text-[26px] leading-none ${colour}`}>{value}</div>
      <div className="mt-2 text-[11px] leading-relaxed text-neutral-400">{sub}</div>
    </div>
  );
}

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11px]">
      <span className="text-neutral-500">{label}</span>
      <span className={`font-mono ${muted ? "text-neutral-600" : "text-neutral-200"}`}>{value}</span>
    </div>
  );
}

export type JobEstimatePanelProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The model string on the active fleet drone. Null when none is selected. */
  droneModel: string | null;
  /**
   * Tank capacity from the directory or the operator, litres, or null when
   * nobody has stated one. Null makes the estimator fall back to the profile's
   * capacity and say that it did.
   */
  statedTankL: number | null;
  /** Confirmed zone area, square metres. The number we own. */
  treatedAreaM2: number;
  /** Chemical the confirmed zones need at their own rates, litres. */
  requiredLitres: number;
  /** Seeds from the flight plan. Editing them here does not write them back. */
  tankLoadPct: number;
  spraySpeedMs: number;
  sprayAltM: number;
};

export function JobEstimatePanel({
  open, onOpenChange, droneModel, statedTankL, treatedAreaM2, requiredLitres,
  tankLoadPct, spraySpeedMs, sprayAltM,
}: JobEstimatePanelProps) {
  const units = useUnitSystem();
  const resolved = useMemo(() => resolveAgrasProfile(droneModel), [droneModel]);
  const profile = resolved.profile;

  // The blended rate the marked ground actually asks for. Derived from the
  // volume rather than typed, so it cannot drift from the per-zone rates the
  // planner and the export are using.
  const seedRateLha = treatedAreaM2 > 0 && requiredLitres > 0
    ? requiredLitres / (treatedAreaM2 / M2_PER_HECTARE)
    : 25;

  // --- the assumptions ---------------------------------------------------
  //
  // Seeded from the profile and the flight plan, then owned by this panel.
  // Keyed on the model so switching aircraft re-seeds rather than carrying a
  // T10's swath onto a T100.
  const [swathM, setSwathM] = useState(() => midpoint(profile.swath_m));
  const [factor, setFactor] = useState(EFFECTIVE_SWATH_FACTOR_DEFAULT);
  const [inCanopy, setInCanopy] = useState(false);
  const [speedMs, setSpeedMs] = useState(spraySpeedMs);
  const [heightM, setHeightM] = useState(sprayAltM);
  const [rateLha, setRateLha] = useState(seedRateLha);
  const [fillPct, setFillPct] = useState(tankLoadPct);
  const [nozzles, setNozzles] = useState<2 | 4>(4);
  const [elevationM, setElevationM] = useState(0);
  const [ground, setGround] = useState<GroundOpsInput>({ ...DEFAULT_GROUND_OPS });
  const [seededFor, setSeededFor] = useState<string | null>(droneModel);

  if (seededFor !== droneModel) {
    // Re-seed on aircraft change, during render rather than in an effect so the
    // panel never paints one frame of the previous aircraft's envelope.
    setSeededFor(droneModel);
    setSwathM(midpoint(profile.swath_m));
    setSpeedMs(midpoint(profile.speed_ms));
    setHeightM(midpoint(profile.height_m));
  }

  const est = useMemo(() => estimateJob({
    profile,
    profileMatched: resolved.matched,
    treatedAreaM2,
    applicationRateLha: rateLha,
    advertisedSwathM: swathM,
    effectiveSwathFactor: factor,
    inCanopy,
    speedMs,
    heightM,
    tankLoadPct: fillPct,
    nozzles,
    elevationM,
    tankCapacityL: statedTankL,
    ground,
    display: units,
  }), [profile, resolved.matched, treatedAreaM2, rateLha, swathM, factor, inCanopy,
       speedMs, heightM, fillPct, nozzles, elevationM, statedTankL, ground, units]);

  const nozzleChoices = availableNozzleCounts(profile);
  const blocking = est.warnings.filter(w => w.severity === "blocking");
  const notes = est.warnings.filter(w => w.severity === "note");
  const factorOutsideBand =
    factor < EFFECTIVE_SWATH_FACTOR_PUBLISHED[0] || factor > EFFECTIVE_SWATH_FACTOR_PUBLISHED[1];

  const batteryBound = est.loads.filter(l => l.binds === "battery").length;
  const tankBound = est.loads.filter(l => l.binds === "tank").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Job estimate
            <span className="rounded-sm border border-amber-700/50 bg-amber-950/30 px-1.5 py-0.5 font-plex text-[10px] font-normal uppercase tracking-wider text-amber-300">
              Planning estimate
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* The framing, before any number. An operator who reads this as a rival
            to the controller's figure will find a disagreement and conclude the
            tool is wrong; one who reads it as a quote for tomorrow will use it
            for what it is good for. */}
        <p className="m-0 text-[11px] leading-relaxed text-neutral-400">
          For quoting a job and loading the tender truck the night before, when nothing is
          powered on and the aircraft cannot tell you anything yet. Once the mission is on
          the Agras, the aircraft is measuring and this is modelling, so the aircraft wins.
          Every assumption behind these numbers is on the right and every one is editable:
          if this disagrees with your controller, the input that differs is in that column.
        </p>

        <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_320px]">
          {/* ---------------- results ---------------- */}
          <div className="space-y-3">
            <Headline
              label="Treated acreage"
              value={fmtArea(est.treatedAreaM2, units).text}
              sub={
                "From the zones you confirmed. This is what the application record reports " +
                "and what the grower is billed on, and it is the one figure here that does " +
                "not depend on the aircraft at all."
              }
            />

            <Headline
              label="Refill stops"
              tone={est.refillStops > 0 ? "amber" : "green"}
              value={String(est.refillStops)}
              sub={
                est.tankLoads > 0
                  ? `${est.tankLoads} tank load${est.tankLoads === 1 ? "" : "s"} at ` +
                    `${fmtVolume(est.perLoadLitres, units).text} a load, covering ` +
                    `${fmtArea(est.areaPerLoadM2, units).text} each. The job needs ` +
                    `${fmtVolume(est.requiredLitres, units).text} in total, and the last load ` +
                    `finishes with ${fmtVolume(Math.max(0, est.leftoverLitres), units).text} left.`
                  : "No load size to work from. Set a tank capacity and a fill."
              }
            />

            <div className={CARD} style={CARD_BG}>
              <div className="mb-2 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-neutral-500" />
                <span className={LABEL}>Time on the job</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="font-mono text-[20px] leading-none text-neutral-200">
                    {fmtMinutes(est.totalJobMin)}
                  </div>
                  <div className="mt-1 text-[10px] uppercase tracking-wider text-neutral-500">
                    Total job
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[20px] leading-none text-[#4CAF50]">
                    {fmtMinutes(est.productiveMin)}
                  </div>
                  <div className="mt-1 text-[10px] uppercase tracking-wider text-neutral-500">
                    Boom on
                  </div>
                </div>
              </div>
              <div className="mt-3 space-y-1 border-t border-[#1f1f1f] pt-2">
                <Row label="Ferry, truck to field and back" value={fmtMinutes(est.nonProductive.ferryMin)} />
                <Row label={`Refills, ${est.refillStops} stop${est.refillStops === 1 ? "" : "s"}`} value={fmtMinutes(est.nonProductive.refillMin)} />
                <Row label="Battery swaps" value={fmtMinutes(est.nonProductive.batterySwapMin)} />
                <Row label="Waiting on a cooled pack" value={fmtMinutes(est.nonProductive.coolingMin)} />
              </div>
              <p className="m-0 mt-2 text-[10px] leading-relaxed text-neutral-500">
                {fmtMinutes(est.nonProductive.total)} of the day is not spraying. No
                manufacturer figure includes any of it, which is why a day planned on flight
                time alone finishes in the dark. The first tank is filled before launch, so
                it is not on this clock.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className={CARD} style={CARD_BG}>
                <div className="mb-2 flex items-center gap-1.5">
                  <Battery className="h-3.5 w-3.5 text-neutral-500" />
                  <span className={LABEL}>Battery</span>
                </div>
                {est.batteryEnduranceMin == null ? (
                  <p className="m-0 text-[11px] leading-relaxed text-amber-300/90">
                    No verified hover-at-load figure for the {profile.model}, so pack count is
                    not computed. The times above assume packs are never what you are waiting
                    on, which on a long job they will be.
                  </p>
                ) : (
                  <div className="space-y-1">
                    <Row label="Pack swaps" value={String(est.batteryChanges ?? 0)} />
                    <Row label="Endurance a pack" value={`${est.batteryEnduranceMin} min`} />
                    <Row label="Loads the tank ended" value={String(tankBound)} />
                    <Row label="Loads the pack ended" value={String(batteryBound)} />
                    <p className="m-0 pt-1 text-[10px] leading-relaxed text-neutral-500">
                      Endurance is hover at max takeoff weight: the worst minute of a load, not
                      the average one. The aircraft is at that weight once, at the start, and
                      lightens from there, so this errs toward packing one pack too many.
                      {batteryBound > 0 && (
                        <span className="text-amber-500/90">
                          {" "}A pack gives out mid-load {batteryBound} time
                          {batteryBound === 1 ? "" : "s"}, which lands the swap in the middle
                          of a pass rather than at a refill.
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </div>

              <div className={CARD} style={CARD_BG}>
                <div className="mb-2 flex items-center gap-1.5">
                  <Droplets className="h-3.5 w-3.5 text-neutral-500" />
                  <span className={LABEL}>Pump</span>
                </div>
                <div className="space-y-1">
                  <Row label="Rate needs" value={fmtFlow(est.requiredFlowLpm, units).text} />
                  <Row
                    label={`Pump delivers, ${nozzles} nozzles`}
                    value={est.maxFlowLpm != null ? fmtFlow(est.maxFlowLpm, units).text : "not verified"}
                    muted={est.maxFlowLpm == null}
                  />
                  <Row
                    label="Tank at full flow"
                    value={est.minTimePerTankMin != null ? fmtMinutes(est.minTimePerTankMin) : "-"}
                    muted={est.minTimePerTankMin == null}
                  />
                  <Row
                    label="Fastest that still delivers"
                    value={est.maxSpeedForRateMs != null
                      ? `${round1(speedValue(est.maxSpeedForRateMs, units))} ${speedUnit(units)}`
                      : "-"}
                    muted={est.maxSpeedForRateMs == null}
                  />
                </div>
              </div>
            </div>

            {blocking.length > 0 && (
              <div className="rounded-sm border border-amber-700/60 bg-amber-950/25 p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Not computed, because nobody has verified the figure it needs
                </div>
                {blocking.map((w, i) => (
                  <p key={i} className="m-0 mt-1 text-[11px] leading-relaxed text-neutral-300">
                    {w.message}
                  </p>
                ))}
              </div>
            )}

            {notes.length > 0 && (
              <div className={CARD} style={CARD_BG}>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5 text-neutral-500" />
                  <span className={LABEL}>What these numbers rest on</span>
                </div>
                {notes.map((w, i) => (
                  <p key={i} className="m-0 mt-1.5 text-[11px] leading-relaxed text-neutral-400">
                    {w.message}
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* ---------------- assumptions ---------------- */}
          <div className="space-y-3">
            <div className={CARD} style={CARD_BG}>
              <div className={LABEL}>Aircraft</div>
              <div className="mt-1 font-mono text-sm text-neutral-200">
                {resolved.matched ? profile.id : (droneModel || "No aircraft selected")}
              </div>
              {resolved.matched ? (
                <p className="m-0 mt-1.5 text-[10px] leading-relaxed text-neutral-500">
                  Profile v{AGRAS_PROFILE_VERSION}, {AGRAS_PROFILE_UPDATED}. Operating ranges
                  are {profile.source === "dji-spec" ? "from DJI" : "field-derived"}, and every
                  default below is the middle of its range rather than the top of it.
                </p>
              ) : (
                <p className="m-0 mt-1.5 text-[10px] leading-relaxed text-amber-400/90">
                  No profile for this aircraft, so the estimate is running on generic
                  placeholders. DJI Agras airframes are profiled; nothing else is yet. Read
                  this as a shape, not an estimate.
                </p>
              )}
              {profile.wind_limit_ms != null && (
                <div className="mt-2 flex items-center gap-1.5 border-t border-[#1f1f1f] pt-2 text-[10px] text-neutral-500">
                  <Wind className="h-3 w-3" />
                  Wind limit {fmtWindSpeed(profile.wind_limit_ms, units).text}. Not applied to anything here; it is
                  a go or no-go on the day.
                </div>
              )}
            </div>

            <div className={`${CARD} space-y-2.5`} style={CARD_BG}>
              <div className="flex items-center gap-1.5">
                <Ruler className="h-3.5 w-3.5 text-neutral-500" />
                <span className={LABEL}>Swath</span>
              </div>

              <RangeField
                label="Advertised swath"
                range={profile.swath_m}
                kind="length"
                keepMetric
                units={units}
                value={swathM}
                onChange={setSwathM}
                step={units === "metric" ? 0.5 : 1}
                hint={est.swath.clamped ? est.swath.reason : undefined}
              />

              <NumField
                label="Effective swath factor"
                value={factor}
                onChange={setFactor}
                unit="x"
                step={0.05}
                min={0.4}
                max={1}
                hint={
                  `Purdue Extension puts effective swath at ${EFFECTIVE_SWATH_FACTOR_PUBLISHED[0]} ` +
                  `to ${EFFECTIVE_SWATH_FACTOR_PUBLISHED[1]} of advertised. ` +
                  (factorOutsideBand
                    ? "This is outside that band, so it is your measurement rather than theirs."
                    : "Spray cards on your own field beat both.")
                }
              />

              <label className="flex items-start gap-2 text-[11px] text-neutral-300">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[#4CAF50]"
                  checked={inCanopy}
                  onChange={(e) => setInCanopy(e.target.checked)}
                />
                <span>
                  In-canopy work
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-neutral-500">
                    Caps effective swath at {fmtAltitude(IN_CANOPY_SWATH_CAP_M, units).text}.
                    Field measurement on T50-class aircraft found
                    no more than that for in-canopy fungicide passes, whatever the advertised
                    width said.
                  </span>
                </span>
              </label>

              <div className="border-t border-[#1f1f1f] pt-2">
                <Row
                  label="Effective swath in use"
                  value={`${round2(altitudeValue(est.effectiveSwathM, units))} ${altitudeUnit(units)}`}
                />
              </div>
            </div>

            <div className={`${CARD} space-y-2.5`} style={CARD_BG}>
              <span className={LABEL}>Flying</span>
              <RangeField
                label="Speed"
                range={profile.speed_ms}
                kind="speed"
                keepMetric
                units={units}
                value={speedMs}
                onChange={setSpeedMs}
                step={0.5}
              />
              <RangeField
                label="Height"
                range={profile.height_m}
                kind="length"
                units={units}
                value={heightM}
                onChange={setHeightM}
                step={units === "metric" ? 0.5 : 1}
                hint="Speed and height together set how wide the pattern actually lays. The widest swath needs both at the top of their ranges."
              />
              <NumField
                label="Application rate"
                value={rateLha}
                onChange={setRateLha}
                unit={rateUnit(units)}
                step={1}
                toShown={(lha) => rateValue(lha, units)}
                fromShown={(v) => rateToLha(v, units)}
                hint={`Seeded from your zones: ${fmtRate(seedRateLha, units).text} blended across ${fmtArea(treatedAreaM2, units).text}.`}
              />
            </div>

            <div className={`${CARD} space-y-2.5`} style={CARD_BG}>
              <div className="flex items-center gap-1.5">
                <Fuel className="h-3.5 w-3.5 text-neutral-500" />
                <span className={LABEL}>Tank</span>
              </div>
              <NumField
                label="Tank fill"
                value={fillPct}
                onChange={setFillPct}
                unit="%"
                step={5}
                min={0}
                max={100}
                hint={
                  statedTankL != null
                    ? `${fmtVolume(statedTankL, units).text} capacity, from the aircraft you registered.`
                    : `${fmtVolume(profile.tank_l, units).text} capacity, from the profile. ` +
                      "Set it on the drone in Fleet if your machine differs."
                }
              />
              <NumField
                label="Field elevation"
                value={elevationM}
                onChange={setElevationM}
                unit={altitudeUnit(units)}
                step={units === "metric" ? 50 : 100}
                min={0}
                toShown={(m) => altitudeValue(m, units)}
                fromShown={(v) => altitudeToM(v, units)}
                hint={`DJI derates payload by ${fmtMass(PAYLOAD_DERATE_KG_PER_1000M, units).text} per ` +
                  `${fmtAltitude(1000, units).text}, so a full tank is smaller up high.`}
              />
              <label className="block">
                <span className={LABEL}>Nozzles</span>
                <select
                  className={`${INPUT} mt-1`}
                  value={nozzles}
                  onChange={(e) => setNozzles(Number(e.target.value) === 2 ? 2 : 4)}
                >
                  <option value={2}>2 nozzles</option>
                  <option value={4}>4 nozzles</option>
                </select>
                <span className="mt-1 block text-[10px] leading-relaxed text-neutral-600">
                  {nozzleChoices.length === 0
                    ? `No verified flow figure for the ${profile.model} at any nozzle count, so nothing checks the pump against your rate.`
                    : `Flow is published for ${nozzleChoices.join(" and ")} nozzles on this airframe.`}
                </span>
              </label>
            </div>

            <div className={`${CARD} space-y-2.5`} style={CARD_BG}>
              <span className={LABEL}>Ground time</span>
              <NumField
                label="Ferry per load, round trip"
                value={ground.ferryMinPerLoad}
                onChange={(v) => setGround(g => ({ ...g, ferryMinPerLoad: Math.max(0, v) }))}
                unit="min" step={0.5} min={0}
                hint="Zero if the tender truck is parked at the field edge. This is flight time, so it drains the pack as well as the clock."
              />
              <NumField
                label="Refill a tank"
                value={ground.refillMin}
                onChange={(v) => setGround(g => ({ ...g, refillMin: Math.max(0, v) }))}
                unit="min" step={0.5} min={0}
              />
              <NumField
                label="Swap a battery"
                value={ground.batterySwapMin}
                onChange={(v) => setGround(g => ({ ...g, batterySwapMin: Math.max(0, v) }))}
                unit="min" step={0.5} min={0}
              />
              <NumField
                label="Packs in rotation"
                value={ground.batteriesOnHand}
                onChange={(v) => setGround(g => ({ ...g, batteriesOnHand: Math.max(1, Math.round(v)) }))}
                unit="packs" step={1} min={1}
              />
              <NumField
                label="Cooldown before a pack goes back on"
                value={ground.batteryCooldownMin}
                onChange={(v) => setGround(g => ({ ...g, batteryCooldownMin: Math.max(0, v) }))}
                unit="min" step={1} min={0}
                hint="Too few packs on too long a cooldown and the aircraft sits on the ground waiting for one. That wait is in the total above."
              />
            </div>

            <p className="m-0 px-1 text-[10px] leading-relaxed text-neutral-600">
              Editing anything here moves the estimate and nothing else. Your flight plan keeps
              its own speed, altitude and fill.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default JobEstimatePanel;
