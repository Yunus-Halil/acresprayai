// The model's plants on the map: every weed (and, when asked, every crop
// plant) an algorithm found in the scan's photographs, carried to the ground
// through the camera pose and drawn where the map says that ground is. Yellow
// is a weed, cyan a crop plant, white the selected one. A click opens the
// plant's own card: what the model said, how sure it was, how big it is, and
// a button that marks it on the field as an ordinary annotation. It changes
// no verdict and no treatment by itself.
import { CircleMarker, Polygon, Popup, Tooltip } from "react-leaflet";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { fmtAreaCm2, fmtLengthCm } from "@/lib/units";
import type { GroundPlant } from "@/lib/weedVision/frames";
import { patchFrameRun, useFrameRun } from "@/lib/weedVision/frameRunStore";

export const PLANT_COLOUR = { weed: "#ffe600", crop: "#40e0ff" } as const;
export const SELECTED_PLANT_COLOUR = "#ffffff";

export function ModelDetectionLayer({ taskId, onMark, showLabels = false }: { taskId: string; /** Mark a weed on the field; resolves to the annotation id, or null. */ onMark?: (plant: GroundPlant) => Promise<string | null>; showLabels?: boolean }) {
  const units = useUnitSystem();
  const run = useFrameRun(taskId);
  if (!run.plants.length) return null;
  const shown = run.plants.filter(p => (p.klass === "weed" ? run.showWeeds : run.showCrops));
  if (!shown.length) return null;
  return (
    <>
      {shown.map(p => {
        const active = p.id === run.selectedId;
        const colour = PLANT_COLOUR[p.klass];
        const markedId = run.marked[p.id];
        const label = `${p.klass}${p.score != null ? ` ${p.score.toFixed(2)}` : ""}`;
        const popup = (
          <Popup closeOnClick={false} maxWidth={320} minWidth={240} eventHandlers={{ remove: () => patchFrameRun(taskId, s => (s.selectedId === p.id ? { selectedId: null } : {})) }}>
            <div className="text-[11px] text-[#f0f0f0] space-y-1" data-testid="plant-popup">
              <div className="font-semibold">
                <span style={{ color: colour }}>{p.klass === "weed" ? "Weed" : "Crop plant"}</span>
                {p.score != null && <span className="text-neutral-400 font-normal"> · confidence {p.score.toFixed(2)}</span>}
                <span className="text-neutral-500 font-normal"> · {run.algorithmLabel ?? "model"}</span>
              </div>
              <div className="text-neutral-400">
                {p.diameterM != null ? <>About {fmtLengthCm(p.diameterM * 100, units).text} across{p.areaM2 != null ? `, ${fmtAreaCm2(p.areaM2 * 1e4, units).text} of canopy` : ""}</> : <>Size unknown: the plant could not be placed on the ground plane</>}
              </div>
              <div className="text-neutral-400">
                Seen in <span className="font-mono text-neutral-200">{p.frame}</span>{p.seenIn.length > 1 ? ` and ${p.seenIn.length - 1} other photo${p.seenIn.length > 2 ? "s" : ""}` : ""}
                {p.viewAngleDeg != null ? ` · ${p.viewAngleDeg.toFixed(0)}° off nadir` : ""}{p.fusedFromTiles > 1 ? ` · stitched from ${p.fusedFromTiles} tiles` : ""}
              </div>
              {p.flags.length > 0 && <div className="text-amber-400">{p.flags.join("; ")}</div>}
              {p.centre && <div className="text-neutral-600">Ground {p.centre.lat.toFixed(6)}, {p.centre.lng.toFixed(6)} · flat ground assumed</div>}
              {p.klass === "weed" && onMark && (
                markedId
                  ? <div className="text-[#4CAF50]">Marked on the field.</div>
                  : <button type="button" data-testid="mark-plant" className="rounded-sm border border-[#4CAF50] text-[#4CAF50] px-2 py-0.5 hover:bg-[#4CAF50]/10"
                      onClick={async () => { const id = await onMark(p); if (id) patchFrameRun(taskId, s => ({ marked: { ...s.marked, [p.id]: id } })); }}>
                      Mark on the field
                    </button>
              )}
            </div>
          </Popup>
        );
        const tooltip = showLabels ? <Tooltip direction="top" opacity={0.95} className="scout-label">{label}</Tooltip> : null;
        const select = () => patchFrameRun(taskId, { selectedId: p.id });
        if (p.ring) {
          return (
            <Polygon key={p.id} positions={p.ring.map(q => [q.lat, q.lng] as [number, number])} eventHandlers={{ click: select }}
              pathOptions={{ color: active ? SELECTED_PLANT_COLOUR : colour, weight: active ? 3 : markedId ? 2.5 : 1.5, fillColor: colour, fillOpacity: markedId ? 0.45 : p.klass === "weed" ? 0.3 : 0.15, dashArray: p.klass === "crop" ? "3 3" : undefined }}>
              {tooltip}{popup}
            </Polygon>
          );
        }
        if (p.centre) {
          return (
            <CircleMarker key={p.id} center={[p.centre.lat, p.centre.lng]} radius={active ? 8 : 5} eventHandlers={{ click: select }}
              pathOptions={{ color: active ? SELECTED_PLANT_COLOUR : colour, weight: 2, fillColor: colour, fillOpacity: 0.5 }}>
              {tooltip}{popup}
            </CircleMarker>
          );
        }
        return null;
      })}
    </>
  );
}
