import { useEffect, useMemo, useRef, useState } from "react";
import { TankLiquidVisual } from "@/components/app/workspace/TankDynamicsWidget";
import { T40_PHYSICS } from "@/lib/dronePhysics";
import {
  type HeroTelemetry as Telemetry,
  AMBIENT_C, HERO_LOOP_MS, buildHeroMission, heroTelemetryAt,
} from "@/lib/heroTelemetry";
import { fmtAltitude, fmtLengthCm, fmtMass, fmtSpeed, fmtTemp } from "@/lib/units";
import { useUnitSystem } from "@/hooks/useUnitSystem";

/**
 * The instruments beside the hero animation.
 *
 * EVERY NUMBER HERE IS REAL MODEL OUTPUT. The section's claim is that the
 * product simulates the whole flight; a strip of invented numbers ticking away
 * would disprove it to anyone who looked closely. So this runs the actual
 * physics modules — the ones the Flight Planner uses — over a mission built
 * from the exact geometry the animation draws, and reads the result. The tank
 * glyph is literally the product's own component, imported, not a copy.
 *
 * Which is why the payload falls as it sprays, the current draw falls with it,
 * the fluid leans through the U-turns and settles on the straights, and the
 * battery drops faster while the tank is full. Nobody scripted that; it is
 * what the model says.
 */

const Reading = ({
  label, value, tone = "ink", sub,
}: { label: string; value: string; tone?: "ink" | "green" | "cyan" | "amber"; sub?: string }) => (
  <div className="min-w-0">
    <div className="font-plex text-[9px] tracking-[0.12em] text-sw-on-dark-faint">{label}</div>
    <div
      className={`mt-1 truncate font-plex text-[15px] leading-none tabular-nums sm:text-[17px] ${
        tone === "green" ? "text-sw-bright-hi"
        : tone === "cyan" ? "text-[#4fc9e6]"
        : tone === "amber" ? "text-amber-300"
        : "text-sw-on-dark"
      }`}
    >
      {value}
    </div>
    {sub && <div className="mt-1 truncate font-plex text-[9px] text-sw-on-dark-faint">{sub}</div>}
  </div>
);

export const HeroTelemetry = () => {
  const units = useUnitSystem();
  const mission = useMemo(() => buildHeroMission(), []);
  const [tel, setTel] = useState<Telemetry>(() => heroTelemetryAt(mission, 0.66));
  const raf = useRef<number>(0);
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Reduced motion: hold one representative mid-flight frame. The panel still
    // shows real figures, it just does not animate them.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      setTel(heroTelemetryAt(mission, 0.66));
      return;
    }

    // 20 fps, not 60. These are numbers and a gentle lean; three times the
    // React renders would buy nothing visible and cost real battery on the
    // field tablets this product is aimed at.
    const FRAME_MS = 50;
    const t0 = performance.now();
    let last = 0;
    let onScreen = true;

    const tick = (now: number) => {
      raf.current = requestAnimationFrame(tick);
      if (!onScreen || now - last < FRAME_MS) return;
      last = now;
      setTel(heroTelemetryAt(mission, ((now - t0) % HERO_LOOP_MS) / HERO_LOOP_MS));
    };
    raf.current = requestAnimationFrame(tick);

    // And nothing at all while the hero is scrolled past.
    const el = host.current;
    const io = el
      ? new IntersectionObserver(es => { onScreen = es.some(e => e.isIntersecting); }, { threshold: 0.05 })
      : null;
    if (el && io) io.observe(el);

    return () => {
      cancelAnimationFrame(raf.current);
      io?.disconnect();
    };
  }, [mission]);

  const s = tel.sample;
  const payloadKg = (s?.litres ?? 0) * T40_PHYSICS.fluidDensityKgPerL;
  const cog = s?.cogOffsetCm ?? 0;
  const status = !tel.flying ? "STANDBY" : tel.spraying ? "SPRAYING" : "TRANSIT";

  return (
    <div ref={host} className="rounded-b-lg bg-sw-panel px-4 py-4 sm:px-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="font-plex text-[10px] tracking-[0.1em] text-sw-on-dark-faint">
          LIVE FLIGHT MODEL · DJI AGRAS T40
        </div>
        <div className="flex items-center gap-2 font-plex text-[10px] tracking-[0.1em]">
          <span
            className={`h-[7px] w-[7px] rounded-full ${
              status === "SPRAYING" ? "bg-sw-bright-hi"
              : status === "TRANSIT" ? "bg-sw-transit"
              : "bg-sw-on-dark-faint"
            }`}
          />
          <span className={status === "SPRAYING" ? "text-sw-bright-hi" : "text-sw-on-dark"}>
            {status}
          </span>
        </div>
      </div>

      <div className="flex items-start gap-4 sm:gap-6">
        {/* The product's own tank widget, tilting with the modelled fluid. */}
        <div className="hidden shrink-0 sm:block">
          <TankLiquidVisual sample={s} cfg={T40_PHYSICS} width={104} height={60} />
          <div className="mt-1.5 text-center font-plex text-[9px] tracking-[0.1em] text-sw-on-dark-faint">
            SLOSH
          </div>
        </div>

        <div className="grid min-w-0 flex-1 grid-cols-3 gap-x-4 gap-y-4 sm:grid-cols-6 sm:gap-x-5">
          <Reading
            label="BATTERY"
            value={`${tel.batteryPct.toFixed(0)}%`}
            tone={tel.batteryPct < 30 ? "amber" : "green"}
          />
          <Reading label="PAYLOAD" value={fmtMass(payloadKg, units).text} tone="cyan" />
          <Reading
            label="CoG"
            value={`${cog >= 0 ? "+" : "−"}${fmtLengthCm(Math.abs(cog), units).text}`}
            sub={cog >= 0 ? "aft" : "fwd"}
          />
          <Reading label="CURRENT" value={`${(s?.amps ?? 0).toFixed(0)} A`} />
          <Reading label="ALTITUDE" value={fmtAltitude(tel.altitudeM, units).text} sub="AGL" />
          <Reading
            label="SPEED"
            value={fmtSpeed(s?.speedMs ?? 0, units).text}
            sub={`${fmtTemp(AMBIENT_C, units).text} ambient`}
          />
        </div>
      </div>

      <div className="mt-4 border-t border-white/10 pt-3 font-plex text-[9px] leading-[1.8] text-sw-on-dark-faint">
        Computed live by the same tank-dynamics and endurance model the planner runs. The
        payload drains as it sprays, current falls as the aircraft lightens, and the fluid
        leans through every turn. Engineering estimates for planning, not certified flight data.
      </div>
    </div>
  );
};
