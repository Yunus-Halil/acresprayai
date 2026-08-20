// Tank Dynamics — what the fluid is doing, right now, at this point in the run.
//
// Driven entirely off the simulation clock the rest of the planner uses. It
// holds no timer of its own, which is the only way it can stay honest across
// play, pause and — the case that actually catches people — scrubbing to a
// moment that was never played. The profile is precomputed (lib/tankProfile.ts)
// so any instant resolves to the value playback would have produced.
//
// EVERY NUMBER HERE IS A STRUCTURED ESTIMATE. The physics is real; the
// coefficients feeding it are not verified against a datasheet. See the header
// of lib/dronePhysics.ts. The widget says so rather than letting three
// confident decimal places imply otherwise.
import { useMemo } from "react";
import { ChevronDown, ChevronUp, Droplets, Info } from "lucide-react";
import type { DronePhysicsConfig } from "@/lib/dronePhysics";
import {
  type TankProfile, type TankSample, sampleTankAt, surfaceTiltDeg,
} from "@/lib/tankProfile";

/** Liquid blue-teal, deliberately outside the green/amber/red status palette. */
const LIQUID = "#22a5c7";
const LIQUID_LIGHT = "#4fc9e6";

export function TankLiquidVisual({
  sample, cfg, width = 132, height = 74,
}: {
  sample: TankSample | null;
  cfg: DronePhysicsConfig;
  width?: number;
  height?: number;
}) {
  const fill = Math.max(0, Math.min(1, sample?.fillFraction ?? 0));
  const tilt = sample ? surfaceTiltDeg(sample.sloshCm, cfg) : 0;

  // Tank interior, inset from the silhouette's stroke.
  const pad = 5;
  const iw = width - pad * 2;
  const ih = height - pad * 2;
  // Surface height above the tank floor.
  const surfaceY = pad + ih * (1 - fill);

  // The fill is a rectangle rotated about the surface's centre, then clipped to
  // the tank. Rotating the LIQUID rather than redrawing a wave keeps this to
  // one transform per frame and still reads as a tilting surface.
  const overhang = iw;   // generous, so rotation never exposes a corner

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`Spray tank ${(fill * 100).toFixed(0)} percent full`}>
      <defs>
        <clipPath id="tank-interior">
          <rect x={pad} y={pad} width={iw} height={ih} rx={9} />
        </clipPath>
        <linearGradient id="tank-liquid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={LIQUID_LIGHT} stopOpacity="0.95" />
          <stop offset="100%" stopColor={LIQUID} stopOpacity="0.75" />
        </linearGradient>
      </defs>

      {/* Tank body */}
      <rect x={pad} y={pad} width={iw} height={ih} rx={9}
        fill="#0a0a0a" stroke="#2f2f2f" strokeWidth={1.5} />

      {fill > 0.002 && (
        <g clipPath="url(#tank-interior)">
          <g transform={`rotate(${tilt} ${width / 2} ${surfaceY})`}>
            <rect
              x={pad - overhang} y={surfaceY}
              width={iw + overhang * 2} height={ih + overhang}
              fill="url(#tank-liquid)"
            />
            {/* Surface line, so the tilt is legible even at a shallow angle. */}
            <rect x={pad - overhang} y={surfaceY - 1} width={iw + overhang * 2} height={1.5}
              fill={LIQUID_LIGHT} opacity={0.9} />
          </g>
        </g>
      )}

      {/* Fill graduations — quarters, for reading the level at a glance. */}
      {[0.25, 0.5, 0.75].map(f => (
        <line key={f} x1={pad} x2={pad + 5} y1={pad + ih * (1 - f)} y2={pad + ih * (1 - f)}
          stroke="#3a3a3a" strokeWidth={1} />
      ))}

      {/* Nose marker, so "fwd" and "aft" mean something on the picture. */}
      <text x={pad + 3} y={height - 2} fill="#5a5a5a" fontSize={7} fontFamily="ui-monospace,monospace">FWD</text>
      <text x={width - pad - 16} y={height - 2} fill="#5a5a5a" fontSize={7} fontFamily="ui-monospace,monospace">AFT</text>
    </svg>
  );
}

export function TankDynamicsWidget({
  profile, cfg, simT, open, onToggle, chrome = true,
}: {
  profile: TankProfile | null;
  cfg: DronePhysicsConfig;
  /** The planner's simulation clock. This widget keeps none of its own. */
  simT: number;
  open: boolean;
  onToggle: () => void;
  /**
   * Draw the title bar and collapse control.
   *
   * False when hosted in a FloatingPanel, which already provides a draggable
   * header, a collapse toggle and a hide button — two sets of chrome stacked on
   * one card looks like a bug even when both work.
   */
  chrome?: boolean;
}) {
  const sample = useMemo(
    () => (profile ? sampleTankAt(profile, simT) : null),
    [profile, simT],
  );

  if (!profile) return null;

  const payloadKg = (sample?.litres ?? 0) * cfg.fluidDensityKgPerL;
  const cog = sample?.cogOffsetCm ?? 0;
  const cogLabel = `${cog >= 0 ? "+" : "−"}${Math.abs(cog).toFixed(1)} cm ${cog >= 0 ? "aft" : "fwd"}`;

  const body = (
    <div className="flex items-center gap-3">
      <TankLiquidVisual sample={sample} cfg={cfg} />
      <div className="text-[11px] space-y-1.5 min-w-[128px]">
        <Metric label="Payload" value={`${payloadKg.toFixed(1)} kg`} />
        <Metric label="CoG offset" value={cogLabel}
          warn={Math.abs(cog) > cfg.sloshMaxOffsetCm * 0.7} />
        <Metric label="Amp draw" value={`${(sample?.amps ?? 0).toFixed(1)} A`} />
        <div className="flex items-start gap-1 pt-1 border-t border-[#222] text-[9px] text-neutral-600 leading-snug">
          <Info className="h-2.5 w-2.5 mt-[1px] shrink-0" />
          <span>Structured estimate — coefficients are unverified, not datasheet figures.</span>
        </div>
      </div>
    </div>
  );

  if (!chrome) return body;

  return (
    <div className="rounded-md border border-[#222] overflow-hidden"
         style={{ background: "rgba(10,10,10,0.85)", backdropFilter: "blur(4px)" }}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-neutral-400 hover:text-neutral-200 transition-colors">
        <Droplets className="h-3 w-3" style={{ color: LIQUID }} />
        <span>Tank dynamics</span>
        <span className="ml-auto font-mono normal-case tracking-normal text-neutral-500">
          {payloadKg.toFixed(1)} kg
        </span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {open && <div className="px-3 pb-3">{body}</div>}
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-neutral-500">{label}</span>
      <span className={`font-mono tabular-nums ${warn ? "text-amber-300" : "text-neutral-200"}`}>
        {value}
      </span>
    </div>
  );
}

export default TankDynamicsWidget;
