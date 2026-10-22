// What the orthomosaic on screen is showing, in the corner of Field View: the finest detail the scan's tiles hold (cm or
// inches a pixel, from the deepest baked zoom at the field's latitude), and whether the view is sharp now, still
// loading its sharp tiles, an overview that zooming in will sharpen, or enlarged past what the scan holds. Asked for on
// 2026-10-22 ("there should be something that shows the quality"): a soft map with no way to tell whether it is the
// scan, the zoom or the download was the complaint.
import { useState } from "react";
import { useMapEvents } from "react-leaflet";
import { type UnitSystem, fmtLengthCm } from "@/lib/units";

/** Metres a Web Mercator pixel covers at a latitude and zoom. */
const metresPerPixel = (lat: number, z: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

export type OrthoQualityState = "loading" | "full" | "overview" | "enlarged";

/** The state for a map zoom against the deepest zoom with real tiles; loading wins while sharp tiles are on their way. */
export function orthoQualityState(zoom: number, maxNativeZoom: number, loading: boolean): OrthoQualityState {
  if (loading) return "loading";
  const z = Math.round(zoom);
  if (z > maxNativeZoom) return "enlarged";
  if (z < maxNativeZoom) return "overview";
  return "full";
}

const LABEL: Record<OrthoQualityState, string> = {
  loading: "Loading sharp tiles",
  full: "Full detail",
  overview: "Overview: zoom in for full detail",
  enlarged: "Zoomed past full detail: enlarged",
};
const DOT: Record<OrthoQualityState, string> = { loading: "#facc15", full: "#4CAF50", overview: "#9e9e9e", enlarged: "#f97316" };

export function OrthoQualityBadge({ lat, maxNativeZoom, loading, units }: { lat: number; maxNativeZoom: number; loading: boolean; units: UnitSystem }) {
  const [zoom, setZoom] = useState<number | null>(null);
  const map = useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const z = zoom ?? map.getZoom();
  const state = orthoQualityState(z, maxNativeZoom, loading);
  const detail = fmtLengthCm(metresPerPixel(lat, maxNativeZoom) * 100, units);
  return (
    <div
      data-testid="ortho-quality"
      className="absolute bottom-12 left-4 z-[1000] rounded-md bg-neutral-900/90 border border-neutral-700 px-2.5 py-1.5 text-[11px] text-neutral-200 pointer-events-none"
      title="The finest detail this scan's map tiles hold, and what the current view is showing"
    >
      <div className="text-neutral-400">Map detail {detail.text} a pixel</div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: DOT[state] }} />
        {LABEL[state]}
      </div>
    </div>
  );
}
