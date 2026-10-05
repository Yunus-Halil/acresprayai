// The detector's boxes, back on the orthomosaic. An experimental overlay:
// each box the baseline detector drew on a native crop, carried to the
// ground through the camera pose, drawn where the map says that ground is,
// with its confidence on it. For a person to check against the photo; it
// changes no verdict and no treatment.
import { CircleMarker, Polygon, Popup, Tooltip } from "react-leaflet";
import { debugLine } from "@/lib/sourceFrames/detections";
import { useDetectionLayer } from "@/lib/sourceFrames/detectionStore";

export const DETECTION_COLOUR = "#ff4d6d";

export function DetectionOverlay({ taskId }: { taskId: string }) {
  const layer = useDetectionLayer(taskId);
  if (!layer.visible || !layer.detections.length) return null;
  return (
    <>
      {layer.detections.map(d => {
        const label = `${d.klass} ${d.confidence.toFixed(2)}`;
        const popup = (
          <Popup>
            <div className="text-[11px] text-[#f0f0f0] space-y-1" style={{ minWidth: 220 }} data-testid="detection-popup">
              <div className="font-semibold">{label} <span className="text-neutral-500 font-normal">· baseline detector, not a verdict</span></div>
              <div className="text-neutral-400">From the closer look at <span className="text-neutral-200">{d.findingTitle}</span>, photo <span className="font-mono">{d.frame}</span>.</div>
              <div className="text-neutral-400">Crop px {d.cropPx.x.toFixed(0)},{d.cropPx.y.toFixed(0)} · native px {d.nativePx.u.toFixed(0)},{d.nativePx.v.toFixed(0)} · frame px {d.framePx.u.toFixed(1)},{d.framePx.v.toFixed(1)}</div>
              {d.centre
                ? <div className="text-neutral-400">Ground {d.centre.lat.toFixed(6)}, {d.centre.lng.toFixed(6)}{d.widthM != null ? ` · ${d.widthM.toFixed(2)} × ${d.heightM!.toFixed(2)} m` : ""} · plane at {d.groundAltM.toFixed(1)} m</div>
                : <div className="text-amber-400">The ray through this box never meets the ground plane.</div>}
              <div className="text-neutral-600">Flat ground assumed; the error grows with tilt and distance from the photo's centre.</div>
            </div>
          </Popup>
        );
        if (d.ring) {
          return (
            <Polygon key={d.id} positions={d.ring.map(p => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color: DETECTION_COLOUR, weight: 2, fillColor: DETECTION_COLOUR, fillOpacity: 0.15 }}>
              <Tooltip permanent direction="top" opacity={0.95} className="scout-label">{label}</Tooltip>
              {popup}
            </Polygon>
          );
        }
        if (d.centre) {
          return (
            <CircleMarker key={d.id} center={[d.centre.lat, d.centre.lng]} radius={6}
              pathOptions={{ color: DETECTION_COLOUR, weight: 2, fillColor: DETECTION_COLOUR, fillOpacity: 0.4 }}>
              <Tooltip permanent direction="top" opacity={0.95} className="scout-label">{label}</Tooltip>
              {popup}
            </CircleMarker>
          );
        }
        return null;
      })}
    </>
  );
}

/** The whole layer as text, one line per box, for a bug report. */
export function detectionsDebugText(taskId: string, detections: ReturnType<typeof useDetectionLayer>["detections"]): string {
  return [`scan ${taskId}: ${detections.length} detection${detections.length === 1 ? "" : "s"}`, ...detections.map(debugLine)].join("\n");
}
