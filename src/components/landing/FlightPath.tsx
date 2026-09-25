import {
  FIELD_POLY, FINDINGS, HERO_FLIGHT_FROM, HERO_FLIGHT_TO, HERO_LOOP_MS, ROUTE_POINTS,
} from "@/lib/heroTelemetry";
import { HeroTelemetry } from "./HeroTelemetry";

/**
 * The hero centrepiece, in three acts on one loop: find, identify, fly.
 *
 * Act one, the scan. The boundary draws on, then a scan line sweeps the field
 * top to bottom and every finding appears as the line reaches it, each with a
 * label chip carrying the detector's own class. One finding is wet ground.
 *
 * Act two, identify. Each finding is picked out in turn, the way the review
 * screen walks them: the region brightens, its chip lifts, and the one that
 * carries a species name shows it as the operator's call.
 *
 * Act three, fly. The route draws on and the aircraft flies it, spraying only
 * inside the treated findings. It crosses the wet ground in transit with the
 * boom shut, which is the picture's whole argument.
 *
 * Keyframe percentages live in index.css and are generated from the same
 * fractions in lib/heroTelemetry.ts that the readouts read. The marker's
 * keyTimes below are derived from those constants at module load, so nothing
 * here can drift from the panel underneath it.
 *
 * WHY IT IS STILL A DRAWING. The route and findings are synthetic, and laying
 * them over a photograph would show treatment on healthy crop. The real
 * imagery is real, captioned as such, further down the page.
 */

const FIELD = FIELD_POLY.map(([x, y]) => `${x},${y}`).join(" ");
const ROUTE = ROUTE_POINTS.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
const poly = (pts: [number, number][]) => pts.map(([x, y]) => `${x},${y}`).join(" ");

/** Route segments inside a treated finding, with the keyframe that fires as the draw reaches each. */
const SPRAY = [
  { d: "M220,120 L440,120", anim: "sw-s1" },
  { d: "M440,170 L220,170", anim: "sw-s2" },
  { d: "M220,220 L430,220", anim: "sw-s3" },
  { d: "M880,270 L640,270", anim: "sw-s4" },
  { d: "M640,320 L890,320", anim: "sw-s5" },
  { d: "M580,370 L440,370", anim: "sw-s6" },
  { d: "M460,420 L570,420", anim: "sw-s7" },
];

const LOOP = `${HERO_LOOP_MS}ms linear infinite`;
const DUR = `${HERO_LOOP_MS}ms`;

/**
 * Where along the flight the aircraft enters and leaves each spray segment,
 * as fractions of the flight. Measured off the route geometry; the marker's
 * colour switches on exactly these.
 */
const SPRAY_SWITCH_REL = [
  0.01824, 0.05235, 0.22838, 0.26147, 0.30676, 0.33868, 0.45, 0.48647,
  0.65676, 0.69544, 0.78412, 0.80456, 0.91824, 0.93412,
];
const flightFrac = (rel: number) => HERO_FLIGHT_FROM + rel * (HERO_FLIGHT_TO - HERO_FLIGHT_FROM);
const MARKER_KEYTIMES = ["0", ...SPRAY_SWITCH_REL.map(r => flightFrac(r).toFixed(4))].join(";");
const MARKER_FILLS = ["#e8ece4", ...SPRAY_SWITCH_REL.map((_, i) => (i % 2 === 0 ? "#7fe25c" : "#e8ece4"))].join(";");

/** Where the aircraft parks in the reduced-motion frame: mid-pass, over a treated finding. */
const PARKED: [number, number] = [760, 270];

const AMBER = { fill: "#e8b23a", stroke: "#f0c052" };
const BLUE = { fill: "#4fb3d9", stroke: "#7ccbe8" };

const Legend = ({ swatch, label }: { swatch: string; label: string }) => (
  <span className="flex items-center gap-[7px] whitespace-nowrap">
    <span className={swatch} />
    {label}
  </span>
);

/** A label chip in the SVG: mono, dark, sized to its text. */
const Chip = ({ x, y, text, tone }: { x: number; y: number; text: string; tone: "amber" | "blue" }) => {
  const w = text.length * 7.6 + 18;
  const c = tone === "amber" ? AMBER : BLUE;
  return (
    <g transform={`translate(${x},${y})`}>
      <rect width={w} height={20} rx={2} fill="#0b0f0a" stroke={c.stroke} strokeOpacity="0.9" strokeWidth="1" />
      <text x={9} y={13.5} fill={c.stroke} fontFamily="'IBM Plex Mono', ui-monospace, monospace" fontSize="10.5" letterSpacing="0.08em">
        {text}
      </text>
    </g>
  );
};

export const FlightPath = () => (
  <div
    data-sw-anim="true"
    className="sw-load-lg mt-10 overflow-hidden rounded-lg bg-sw-panel shadow-[0_40px_90px_-40px_rgba(20,23,18,0.55)] sm:mt-16"
    style={{ animationDelay: "0.55s" }}
  >
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-white/10 px-4 py-3.5 font-plex text-[11px] tracking-[0.08em] text-sw-on-dark sm:px-5">
      <span>ONE SCAN, ONE MISSION · FOUND, THEN TREATED</span>
      <span className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <Legend swatch="h-[9px] w-[9px] rounded-[1px] border border-[#f0c052] bg-[#e8b23a]/30" label="FINDING" />
        <Legend swatch="h-[9px] w-[9px] rounded-[1px] border border-[#7ccbe8] bg-[#4fb3d9]/30" label="LEFT ALONE" />
        <Legend swatch="h-[4px] w-4 rounded-[1px] bg-[#7fe25c]" label="SPRAYING" />
        <Legend swatch="h-[2px] w-4 bg-[#8b9683]" label="TRANSIT" />
      </span>
    </div>

    <div
      style={{
        backgroundColor: "#0b0f0a",
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
        backgroundSize: "56px 56px",
        backgroundPosition: "28px 14px",
      }}
    >
      <svg
        viewBox="0 0 1120 520"
        className="block h-auto w-full"
        role="img"
        aria-label="Animated scan and spray mission: a scan line sweeps the field and findings appear with their labels, each is picked out in turn, then the aircraft flies a route that sprays only inside the treated findings and crosses the wet ground with the boom shut"
      >
        <defs>
          <pattern id="sw-rows" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(-2)">
            <rect width="10" height="10" fill="#1a2415" />
            <line x1="0" y1="0" x2="10" y2="0" stroke="#2b3b21" strokeWidth="3.5" />
          </pattern>
          <linearGradient id="sw-field-tint" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#33461f" stopOpacity="0.30" />
            <stop offset="100%" stopColor="#0b0f0a" stopOpacity="0.38" />
          </linearGradient>
          {/* The scan band: bright at the line, fading behind it. */}
          <linearGradient id="sw-scan-band" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7fe25c" stopOpacity="0" />
            <stop offset="85%" stopColor="#7fe25c" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#c8ff9e" stopOpacity="0.55" />
          </linearGradient>
          <clipPath id="sw-field-clip">
            <polygon points={FIELD} />
          </clipPath>
        </defs>

        <g clipPath="url(#sw-field-clip)">
          <polygon points={FIELD} fill="url(#sw-rows)" />
          <polygon points={FIELD} fill="url(#sw-field-tint)" />

          {/* Act one: the sweep. A 90-unit band that travels the height of the
              field, clipped to it, with a hard bright line at its leading edge. */}
          <g opacity="0" style={{ animation: `sw-scan ${LOOP}` }}>
            <rect x="0" y="-90" width="1120" height="90" fill="url(#sw-scan-band)" />
            <line x1="0" y1="0" x2="1120" y2="0" stroke="#c8ff9e" strokeWidth="1.5" strokeOpacity="0.9" />
          </g>
        </g>

        <polygon
          points={FIELD}
          fill="none"
          stroke="#c3c8b8"
          strokeWidth="1.75"
          pathLength="1"
          strokeDasharray="1"
          style={{ animation: `sw-b ${LOOP}` }}
        />

        {/* The findings, each appearing as the sweep reaches it, each with a
            chip. In act two a highlight ring pulses around them one at a time. */}
        {FINDINGS.map((f, i) => {
          const c = f.treat ? AMBER : BLUE;
          const pts = poly(f.poly);
          const n = i + 1;
          return (
            <g key={f.id} style={{ animation: `sw-f${n} ${LOOP}` }}>
              <polygon points={pts} fill="none" stroke={c.fill} strokeOpacity="0.14" strokeWidth="7" />
              <polygon
                points={pts}
                fill={c.fill}
                fillOpacity="0.17"
                stroke={c.stroke}
                strokeOpacity="0.9"
                strokeWidth="1.4"
                strokeDasharray="5 4"
              />
              {/* The identify highlight: invisible except during this finding's turn. */}
              <polygon
                points={pts}
                fill={c.fill}
                fillOpacity="0.22"
                stroke={c.stroke}
                strokeWidth="3"
                opacity="0"
                style={{ animation: `sw-h${n} ${LOOP}` }}
              />
              <g style={{ animation: `sw-c${n} ${LOOP}` }}>
                <Chip x={f.chipAt[0]} y={f.chipAt[1]} text={f.label} tone={f.treat ? "amber" : "blue"} />
                {f.name && (
                  <g data-sw-static-show opacity="0" style={{ animation: `sw-n${n} ${LOOP}` }}>
                    <Chip x={f.chipAt[0]} y={f.chipAt[1] + 24} text={`${f.name.toUpperCase()} · YOUR CALL`} tone="amber" />
                  </g>
                )}
                {!f.treat && (
                  <g data-sw-static-show opacity="0" style={{ animation: `sw-n${n} ${LOOP}` }}>
                    <Chip x={f.chipAt[0]} y={f.chipAt[1] + 24} text="NOT SPRAYED" tone="blue" />
                  </g>
                )}
              </g>
            </g>
          );
        })}

        {/* Act three: the route, drawing on. */}
        <path
          d={ROUTE}
          fill="none"
          stroke="#8b9683"
          strokeWidth="1.6"
          pathLength="1"
          strokeDasharray="1"
          style={{ animation: `sw-r ${LOOP}` }}
        />

        {SPRAY.map(({ d, anim }) => (
          <g key={anim}>
            <path d={d} fill="none" stroke="#7fe25c" strokeOpacity="0.22" strokeWidth="12" strokeLinecap="butt"
              pathLength="1" strokeDasharray="1" style={{ animation: `${anim} ${LOOP}` }} />
            <path d={d} fill="none" stroke="#7fe25c" strokeWidth="5" strokeLinecap="butt"
              pathLength="1" strokeDasharray="1" style={{ animation: `${anim} ${LOOP}` }} />
          </g>
        ))}

        {/* The aircraft. Pale in transit, lime while spraying. */}
        <g data-sw-marker opacity="0">
          <animateMotion
            dur={DUR}
            repeatCount="indefinite"
            calcMode="linear"
            keyPoints="0;0;1;1"
            keyTimes={`0;${HERO_FLIGHT_FROM};${HERO_FLIGHT_TO};1`}
            path={ROUTE}
          />
          <animate
            attributeName="opacity"
            dur={DUR}
            repeatCount="indefinite"
            calcMode="discrete"
            values="0;1;0"
            keyTimes={`0;${HERO_FLIGHT_FROM};${HERO_FLIGHT_TO}`}
          />
          <circle r="13" fill="#7fe25c" opacity="0.18" />
          <circle r="6" fill="#e8ece4" stroke="#0b0f0a" strokeWidth="1.5">
            <animate
              attributeName="fill"
              dur={DUR}
              repeatCount="indefinite"
              calcMode="discrete"
              values={MARKER_FILLS}
              keyTimes={MARKER_KEYTIMES}
            />
          </circle>
        </g>

        {/* Reduced motion: the finished picture, every finding and chip shown,
            the route drawn, the aircraft parked mid-pass. */}
        <g data-sw-static-marker opacity="0" transform={`translate(${PARKED[0]},${PARKED[1]})`}>
          <circle r="13" fill="#7fe25c" opacity="0.18" />
          <circle r="6" fill="#7fe25c" stroke="#0b0f0a" strokeWidth="1.5" />
        </g>
      </svg>
    </div>

    <HeroTelemetry />
  </div>
);
