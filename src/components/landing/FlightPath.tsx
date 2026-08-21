import { FIELD_POLY, ROUTE_POINTS, ZONE_POLYS } from "@/lib/heroTelemetry";
import { HeroTelemetry } from "./HeroTelemetry";

/**
 * The hero centrepiece: one spray mission, drawn the way the product builds it.
 *
 * Sequence over a single 16s linear loop: field boundary draws on, AI treatment
 * zones fade in, the boustrophedon route draws on row by row, each segment that
 * falls inside a zone overdraws thick green at the moment the route reaches it,
 * then the aircraft flies the whole path. Keyframes live in index.css
 * (sw-b / sw-z / sw-r / sw-s1..7) because the segment timings are tied to this
 * exact geometry.
 *
 * The point of the picture is the negative space: most of the field is never
 * sprayed.
 *
 * WHY IT IS DARK. This used to be ink-on-cream, and it read as a faint
 * schematic: the zones and the route were barely separable from the field at a
 * glance, and it sat directly above the black instrument panel it belongs to,
 * so the two halves looked like two components. Dark ground lets the flagged
 * ground go amber, the sprayed passes go bright lime, and the transit stay
 * quiet, which is the whole story of the picture told in three values. It also
 * makes the visual one block with the telemetry beneath it.
 *
 * WHY IT IS STILL A DRAWING. The obvious upgrade is to put a real orthomosaic
 * underneath. We do not, because the route and zones here are synthetic, and
 * laying them over a photograph of a real field would show treatment zones
 * sitting on healthy-looking crop and passes that ignore the ground beneath
 * them. That is the kind of composite the screenshots on this page exist to
 * avoid. The real imagery is real, and it is captioned as such, further down.
 */

// Geometry is shared with lib/heroTelemetry.ts, which runs the real flight
// model over these exact shapes. One source, two readers: the drone cannot be
// drawn inside a zone while the instruments say it is in transit.
const FIELD = FIELD_POLY.map(([x, y]) => `${x},${y}`).join(" ");

const ROUTE = ROUTE_POINTS
  .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`)
  .join(" ");

const ZONES = ZONE_POLYS.map(z => z.map(([x, y]) => `${x},${y}`).join(" "));

/** Route segments that fall inside a treatment zone, with the keyframe that
 *  fires as the route draw passes each one. */
const SPRAY = [
  { d: "M220,120 L440,120", anim: "sw-s1" },
  { d: "M440,170 L220,170", anim: "sw-s2" },
  { d: "M220,220 L430,220", anim: "sw-s3" },
  { d: "M880,270 L640,270", anim: "sw-s4" },
  { d: "M640,320 L890,320", anim: "sw-s5" },
  { d: "M580,370 L440,370", anim: "sw-s6" },
  { d: "M460,420 L570,420", anim: "sw-s7" },
];

const LOOP = "16s linear infinite";

/** Where the aircraft parks in the reduced-motion frame: mid-pass, over zone 2. */
const PARKED: [number, number] = [760, 270];

const Legend = ({ swatch, label }: { swatch: string; label: string }) => (
  <span className="flex items-center gap-[7px] whitespace-nowrap">
    <span className={swatch} />
    {label}
  </span>
);

export const FlightPath = () => (
  <div
    data-sw-anim="true"
    className="sw-load-lg mt-10 overflow-hidden rounded-lg bg-sw-panel shadow-[0_40px_90px_-40px_rgba(20,23,18,0.55)] sm:mt-16"
    style={{ animationDelay: "0.55s" }}
  >
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-white/10 px-4 py-3.5 font-plex text-[11px] tracking-[0.08em] text-sw-on-dark sm:px-5">
      <span>SPRAY MISSION · GENERATED FROM AI TREATMENT ZONES</span>
      <span className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <Legend
          swatch="h-[9px] w-[9px] rounded-[1px] border border-[#f0c052] bg-[#e8b23a]/30"
          label="TREATMENT ZONE"
        />
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
        aria-label="Animated spray mission: the drone path sprays only inside flagged treatment zones and flies dark between them"
      >
        <defs>
          {/* Crop rows. Cheap, static, and the reason the ground reads as a
              field rather than as a grey polygon. */}
          <pattern id="sw-rows" width="10" height="10" patternUnits="userSpaceOnUse"
                   patternTransform="rotate(-2)">
            <rect width="10" height="10" fill="#1a2415" />
            <line x1="0" y1="0" x2="10" y2="0" stroke="#2b3b21" strokeWidth="3.5" />
          </pattern>
          {/* Just enough to keep the far edge from competing with the passes.
              Any heavier and the rows disappear, which is the whole point of
              having them. */}
          <linearGradient id="sw-field-tint" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#33461f" stopOpacity="0.30" />
            <stop offset="100%" stopColor="#0b0f0a" stopOpacity="0.38" />
          </linearGradient>
          <clipPath id="sw-field-clip">
            <polygon points={FIELD} />
          </clipPath>
        </defs>

        <g clipPath="url(#sw-field-clip)">
          <polygon points={FIELD} fill="url(#sw-rows)" />
          <polygon points={FIELD} fill="url(#sw-field-tint)" />
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

        <g style={{ animation: `sw-z ${LOOP}` }}>
          {ZONES.map((points) => (
            <g key={points}>
              {/* Halo instead of an SVG filter: a filter over a 1120x520 region
                  re-rasterises on every frame of the draw-on and is the one
                  thing here that would jank a mid-range laptop. */}
              <polygon points={points} fill="none" stroke="#e8b23a" strokeOpacity="0.14" strokeWidth="7" />
              <polygon
                points={points}
                fill="#e8b23a"
                fillOpacity="0.17"
                stroke="#f0c052"
                strokeOpacity="0.9"
                strokeWidth="1.4"
                strokeDasharray="5 4"
              />
            </g>
          ))}
        </g>

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
            <path
              d={d}
              fill="none"
              stroke="#7fe25c"
              strokeOpacity="0.22"
              strokeWidth="12"
              strokeLinecap="butt"
              pathLength="1"
              strokeDasharray="1"
              style={{ animation: `${anim} ${LOOP}` }}
            />
            <path
              d={d}
              fill="none"
              stroke="#7fe25c"
              strokeWidth="5"
              strokeLinecap="butt"
              pathLength="1"
              strokeDasharray="1"
              style={{ animation: `${anim} ${LOOP}` }}
            />
          </g>
        ))}

        {/* The aircraft. Halo and core travel together on one animateMotion;
            only the core switches colour, so the glow stays constant and the
            state change is unmistakable. */}
        <g data-sw-marker opacity="0">
          <animateMotion
            dur="16s"
            repeatCount="indefinite"
            calcMode="linear"
            keyPoints="0;0;1;1"
            keyTimes="0;0.28;0.96;1"
            path={ROUTE}
          />
          <animate
            attributeName="opacity"
            dur="16s"
            repeatCount="indefinite"
            calcMode="discrete"
            values="0;1;0"
            keyTimes="0;0.28;0.96"
          />
          <circle r="13" fill="#7fe25c" opacity="0.18" />
          <circle r="6" fill="#e8ece4" stroke="#0b0f0a" strokeWidth="1.5">
            {/* Pale in transit, lime while spraying: the switch points are the
                entry and exit of each segment above. */}
            <animate
              attributeName="fill"
              dur="16s"
              repeatCount="indefinite"
              calcMode="discrete"
              values="#e8ece4;#7fe25c;#e8ece4;#7fe25c;#e8ece4;#7fe25c;#e8ece4;#7fe25c;#e8ece4;#7fe25c;#e8ece4;#7fe25c;#e8ece4;#7fe25c;#e8ece4"
              keyTimes="0;0.2924;0.3156;0.4353;0.4578;0.4886;0.5103;0.586;0.6108;0.7266;0.7529;0.8132;0.8271;0.9044;0.9152"
            />
          </circle>
        </g>

        {/* Reduced motion: the same aircraft, parked mid-pass over a zone, so
            the still frame is a mission in progress rather than an empty map.
            Revealed by the media query in index.css. */}
        <g data-sw-static-marker opacity="0" transform={`translate(${PARKED[0]},${PARKED[1]})`}>
          <circle r="13" fill="#7fe25c" opacity="0.18" />
          <circle r="6" fill="#7fe25c" stroke="#0b0f0a" strokeWidth="1.5" />
        </g>
      </svg>
    </div>

    <HeroTelemetry />
  </div>
);
