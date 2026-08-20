import { FIELD_POLY, ROUTE_POINTS, ZONE_POLYS } from "@/lib/heroTelemetry";
import { HeroTelemetry } from "./HeroTelemetry";

/**
 * The hero centrepiece: one spray mission, drawn the way the product builds it.
 *
 * Sequence over a single 16s linear loop - field boundary draws on, AI
 * treatment zones fade in, the boustrophedon route draws on row by row, each
 * segment that falls inside a zone overdraws thick green at the moment the
 * route reaches it, then a marker flies the whole path once.
 *
 * The point of the picture is the negative space: most of the field is never
 * sprayed. Keyframes live in index.css (sw-b / sw-z / sw-r / sw-s1..7) because
 * the segment timings are tied to this exact geometry.
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

export const FlightPath = () => (
  <div
    data-sw-anim="true"
    className="sw-load-lg mt-10 overflow-hidden rounded-lg border border-sw-rule bg-sw-card sm:mt-16"
    style={{ animationDelay: "0.55s" }}
  >
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-sw-line px-4 py-3.5 font-plex text-[10px] tracking-[0.08em] text-sw-faint sm:px-5 sm:text-[11px]">
      <span>SPRAY MISSION · GENERATED FROM AI TREATMENT ZONES</span>
      <span className="flex items-center gap-5">
        <span className="flex items-center gap-[7px]">
          <span className="h-[3px] w-4 bg-sw-green" />
          SPRAYING
        </span>
        <span className="flex items-center gap-[7px]">
          <span className="h-[2px] w-4 bg-sw-transit" />
          TRANSIT
        </span>
      </span>
    </div>

    <div
      style={{
        backgroundImage:
          "linear-gradient(rgba(20,23,18,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(20,23,18,0.05) 1px, transparent 1px)",
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
        <polygon points={FIELD} fill="#f0efe3" fillOpacity="0.6" stroke="none" />
        <polygon
          points={FIELD}
          fill="none"
          stroke="#141712"
          strokeWidth="1.5"
          pathLength="1"
          strokeDasharray="1"
          style={{ animation: `sw-b ${LOOP}` }}
        />

        <g style={{ animation: `sw-z ${LOOP}` }}>
          {ZONES.map((points) => (
            <polygon
              key={points}
              points={points}
              fill="#4faa39"
              fillOpacity="0.13"
              stroke="#2f7a24"
              strokeOpacity="0.55"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          ))}
        </g>

        <path
          d={ROUTE}
          fill="none"
          stroke="#c3c8b8"
          strokeWidth="1.5"
          pathLength="1"
          strokeDasharray="1"
          style={{ animation: `sw-r ${LOOP}` }}
        />

        {SPRAY.map(({ d, anim }) => (
          <path
            key={anim}
            d={d}
            fill="none"
            stroke="#2f7a24"
            strokeWidth="4"
            strokeLinecap="butt"
            pathLength="1"
            strokeDasharray="1"
            style={{ animation: `${anim} ${LOOP}` }}
          />
        ))}

        <circle data-sw-marker r="5" fill="#6b6f64" opacity="0">
          <animateMotion
            dur="16s"
            repeatCount="indefinite"
            calcMode="linear"
            keyPoints="0;0;1;1"
            keyTimes="0;0.48;0.92;1"
            path={ROUTE}
          />
          <animate
            attributeName="opacity"
            dur="16s"
            repeatCount="indefinite"
            calcMode="discrete"
            values="0;1;0"
            keyTimes="0;0.48;0.92"
          />
          {/* Grey in transit, green while spraying - the switch points are the
              entry and exit of each segment above. */}
          <animate
            attributeName="fill"
            dur="16s"
            repeatCount="indefinite"
            calcMode="discrete"
            values="#6b6f64;#2f7a24;#6b6f64;#2f7a24;#6b6f64;#2f7a24;#6b6f64;#2f7a24;#6b6f64;#2f7a24;#6b6f64;#2f7a24;#6b6f64;#2f7a24;#6b6f64"
            keyTimes="0;0.488;0.503;0.5805;0.595;0.615;0.629;0.678;0.694;0.769;0.786;0.825;0.834;0.884;0.891"
          />
        </circle>
      </svg>
    </div>

    <HeroTelemetry />
  </div>
);
