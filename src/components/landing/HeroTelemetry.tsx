import { useEffect, useMemo, useRef, useState } from "react";
import { T40_PHYSICS } from "@/lib/dronePhysics";
import {
  FIELD_AREA_M2, FINDINGS, HERO_FLIGHT_FROM, HERO_IDENTIFY_FROM, HERO_IDENTIFY_TO, HERO_LOOP_MS,
  HERO_SCAN_FROM, HERO_SCAN_TO, HERO_SWATH_M, appearAt,
  buildHeroMission, heroTelemetryAt, identifyWindow, polyAreaM2,
} from "@/lib/heroTelemetry";
import { fmtArea, fmtVolume } from "@/lib/units";
import { useUnitSystem } from "@/hooks/useUnitSystem";

/**
 * The readouts under the hero animation: outcomes, not instruments.
 *
 * This panel used to show battery, amps and centre of gravity. Those are a
 * pilot's numbers, and they said "drone software" to a farmer who wanted to
 * know what was found and what it would cost to fix. The numbers here are the
 * ones a grower plans a season on: how big the field is, how much of it was
 * flagged, how much gets treated, how much is left alone, how many loads and
 * how long. Every one is read off the same geometry and the same flight model
 * as before; only the choice of what to show changed.
 */

type Tone = "ink" | "green" | "cyan" | "amber" | "blue";

const Reading = ({ label, value, tone = "ink", sub }: { label: string; value: string; tone?: Tone; sub?: string }) => (
  <div className="min-w-0">
    <div className="font-plex text-[10px] tracking-[0.1em] text-sw-on-dark">{label}</div>
    <div
      className={`mt-1.5 truncate font-plex text-[17px] leading-none tabular-nums sm:text-[18px] ${
        tone === "green" ? "text-sw-bright-hi"
        : tone === "cyan" ? "text-[#5fd3ec]"
        : tone === "amber" ? "text-[#f0c052]"
        : tone === "blue" ? "text-[#7ccbe8]"
        : "text-sw-paper"
      }`}
    >
      {value}
    </div>
    {sub && <div className="mt-1 truncate font-plex text-[10px] text-sw-on-dark">{sub}</div>}
  </div>
);

type Act = "STANDBY" | "SCANNING" | "IDENTIFYING" | "PLANNING" | "SPRAYING" | "TRANSIT" | "DONE";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export const HeroTelemetry = () => {
  const units = useUnitSystem();
  const mission = useMemo(() => buildHeroMission(), []);
  const [frac, setFrac] = useState(0.75);
  const raf = useRef<number>(0);
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Reduced motion: hold one mid-flight frame. Real figures, no ticking.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      setFrac(0.75);
      return;
    }
    const FRAME_MS = 50;
    const t0 = performance.now();
    let last = 0;
    let onScreen = true;

    const tick = (now: number) => {
      raf.current = requestAnimationFrame(tick);
      if (!onScreen || now - last < FRAME_MS) return;
      last = now;
      setFrac(((now - t0) % HERO_LOOP_MS) / HERO_LOOP_MS);
    };
    raf.current = requestAnimationFrame(tick);

    const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; });
    if (host.current) io.observe(host.current);
    return () => { cancelAnimationFrame(raf.current); io.disconnect(); };
  }, []);

  const tel = heroTelemetryAt(mission, frac);

  // Act one and two: what the sweep has reached, and which finding is up.
  const found = FINDINGS.filter(f => frac >= appearAt(f));
  const flaggedM2 = found.reduce((n, f) => n + polyAreaM2(f.poly), 0);
  const activeIdx = FINDINGS.findIndex((_, i) => {
    const [a, b] = identifyWindow(i);
    return frac >= a && frac < b;
  });
  const active = activeIdx >= 0 ? FINDINGS[activeIdx] : null;

  // TREATED is sprayed distance under the aircraft times the boom, in every
  // act. That is what the planner calls treated area, and it is what the
  // passes in the picture actually cover. It is smaller than the flagged
  // polygons, because at this drawing's scale the passes sit 25 m apart
  // against a 9 m boom, and quoting the polygon area before takeoff and the
  // swath area after it would make the number drop the moment the aircraft
  // left the ground.
  const sprayedTotalM = mission.segs.reduce((n, s) => n + (s.spray ? s.distEnd - s.distStart : 0), 0);
  const sprayedSoFarM = mission.segs.reduce((n, s) => {
    if (!s.spray) return n;
    return n + Math.max(0, Math.min(s.distEnd, tel.distanceM) - s.distStart);
  }, 0);
  const treatedPlannedM2 = sprayedTotalM * HERO_SWATH_M;
  const treatedSoFarM2 = sprayedSoFarM * HERO_SWATH_M;

  const act: Act =
    frac < HERO_SCAN_FROM ? "STANDBY"
    : frac < HERO_SCAN_TO ? "SCANNING"
    : frac >= HERO_IDENTIFY_FROM && frac < HERO_IDENTIFY_TO ? "IDENTIFYING"
    : frac < HERO_FLIGHT_FROM ? "PLANNING"
    : tel.flying ? (tel.spraying ? "SPRAYING" : "TRANSIT")
    : "DONE";

  const flying = act === "SPRAYING" || act === "TRANSIT";
  const leftAlonePct = 100 * (1 - treatedPlannedM2 / FIELD_AREA_M2);
  const loads = Math.max(1, Math.ceil(mission.requiredLitres / T40_PHYSICS.tankCapacityL));
  const area = (m2: number) => fmtArea(m2, units).text;

  const dot =
    act === "SPRAYING" ? "bg-sw-bright-hi"
    : act === "SCANNING" ? "bg-[#c8ff9e]"
    : act === "IDENTIFYING" ? "bg-[#f0c052]"
    : act === "TRANSIT" || act === "PLANNING" ? "bg-sw-transit"
    : "bg-sw-on-dark-faint";

  // The header's right side names the act, and during identify it names the
  // finding being looked at, the way the review screen does.
  const status =
    act === "IDENTIFYING" && active
      ? `${active.label}${active.name ? ` · ${active.name.toUpperCase()}` : ""}${!active.treat ? " · LEFT ALONE" : ""}`
      : act;

  return (
    <div ref={host} className="rounded-b-lg bg-sw-panel px-4 py-5 sm:px-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="font-plex text-[11px] tracking-[0.1em] text-sw-on-dark">
          LIVE MODEL · FIND, IDENTIFY, FLY
        </div>
        <div className="flex min-w-0 items-center gap-2 font-plex text-[11px] tracking-[0.1em]">
          <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${dot}`} />
          <span className={`truncate ${act === "SPRAYING" ? "text-sw-bright-hi" : act === "IDENTIFYING" ? "text-[#f0c052]" : "text-sw-on-dark"}`}>
            {status}
          </span>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-6">
        <Reading label="FIELD" value={area(FIELD_AREA_M2)} />
        <Reading
          label="FOUND"
          value={String(found.length)}
          tone={found.length ? "amber" : "ink"}
          sub={found.length ? `${found.filter(f => f.treat).length} to treat, ${found.filter(f => !f.treat).length} left alone` : "scanning"}
        />
        <Reading label="FLAGGED" value={area(flaggedM2)} tone={flaggedM2 > 0 ? "amber" : "ink"} sub="ground that stood out" />
        <Reading
          label="TREATED"
          value={area(flying || act === "DONE" ? treatedSoFarM2 : treatedPlannedM2)}
          tone="green"
          sub={flying ? "so far" : act === "DONE" ? "flown" : "planned"}
        />
        <Reading label="LEFT ALONE" value={`${leftAlonePct.toFixed(0)}%`} tone="blue" sub="of the field, never sprayed" />
        <Reading
          label={flying ? "TIME LEFT" : "TIME"}
          value={mmss(flying ? mission.totalTimeS * (1 - tel.progress) : mission.totalTimeS)}
          sub={`${loads} load${loads === 1 ? "" : "s"} · ${fmtVolume(mission.requiredLitres, units, 0).text}`}
        />
      </div>
    </div>
  );
};
