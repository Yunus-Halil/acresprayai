// SVG overlay for the research preview, drawn in native photo pixels inside PhotoViewer.
// TEMPORARY RESEARCH INTEGRATION: see src/lib/weedVision/flag.ts.
import type { WeedInstance, WeedVisionEvaluation } from "@/lib/weedVision/client";

export const RUN_COLOURS = { primary: "#ffe600", secondary: "#40e0ff" } as const;
export const SELECTED_COLOUR = "#ff2fd2";
export const CROP_COLOUR = "#7ee787";
export const REGION_COLOURS = { true_positive: "#2ee05a", false_positive: "#ff4040", missed: "#ff00dc" } as const;

const pts = (poly: [number, number][]) => poly.map(([x, y]) => `${x},${y}`).join(" ");

export type OverlayProps = {
  instances: WeedInstance[];
  colour?: string;
  outlines: boolean;
  fills: boolean;
  numbers: boolean;
  selectedId?: number | null;
  cropRegions?: [number, number][][] | null;
  showCrops?: boolean;
  evaluation?: WeedVisionEvaluation | null;
  showRegions?: boolean;
  /** Label font size in photo pixels; the viewer scales it with the photo. */
  fontPx?: number;
  testId?: string;
};

export function WeedOverlay({ instances, colour = RUN_COLOURS.primary, outlines, fills, numbers, selectedId = null, cropRegions = null, showCrops = false, evaluation = null, showRegions = false, fontPx = 14, testId = "weed-vision-overlay" }: OverlayProps) {
  return (
    <g data-testid={testId}>
      {showCrops && cropRegions?.map((poly, k) => (
        <polygon key={`c${k}`} points={pts(poly)} fill="none" stroke={CROP_COLOUR} strokeWidth={1} strokeDasharray="4 3" style={{ vectorEffect: "non-scaling-stroke" }} />
      ))}
      {showRegions && evaluation && (Object.keys(REGION_COLOURS) as Array<keyof typeof REGION_COLOURS>).map(kind =>
        evaluation.regions_px[kind].map((poly, k) => (
          <polygon key={`${kind}${k}`} points={pts(poly)} fill={REGION_COLOURS[kind]} fillOpacity={0.35} stroke="none" data-region={kind} />
        )))}
      {instances.map(inst => {
        const sel = inst.id === selectedId;
        const c = sel ? SELECTED_COLOUR : colour;
        return (
          <g key={inst.id} data-instance-id={inst.id} data-selected={sel ? "1" : "0"}>
            {inst.polygons_px.map((poly, k) => (
              <polygon key={k} points={pts(poly)} fill={fills ? c : "none"} fillOpacity={fills ? (sel ? 0.45 : 0.28) : 0}
                stroke={outlines || sel ? c : "none"} strokeWidth={sel ? 2.5 : 1.2} style={{ vectorEffect: "non-scaling-stroke" }} />
            ))}
            {sel && (
              <line x1={inst.span_endpoints_px[0][0]} y1={inst.span_endpoints_px[0][1]} x2={inst.span_endpoints_px[1][0]} y2={inst.span_endpoints_px[1][1]}
                stroke={SELECTED_COLOUR} strokeWidth={1.5} strokeDasharray="6 4" style={{ vectorEffect: "non-scaling-stroke" }} />
            )}
            {numbers && (
              <text x={inst.centroid_px[0]} y={inst.centroid_px[1]} fontSize={fontPx} textAnchor="middle" dominantBaseline="central"
                fill="#fff" stroke="#000" strokeWidth={fontPx / 6} paintOrder="stroke" style={{ fontFamily: "ui-monospace, monospace", pointerEvents: "none" }}>{inst.id}</text>
            )}
          </g>
        );
      })}
    </g>
  );
}
