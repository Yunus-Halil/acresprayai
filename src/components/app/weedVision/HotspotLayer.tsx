// The review areas on the map (the Priority view): a few outlines, numbered
// by their review order, coloured by the operator's word on them. Nothing else
// at field zoom. Selecting one flies the map to it; close in, its cells are
// shaded faintly so the grid the grouping used is visible, and the plants
// inside it are drawn by the detections layer. The heatmap view shades every
// occupied cell by candidate weed canopy on one canvas.
import { useEffect } from "react";
import L from "leaflet";
import { Polygon, Tooltip, useMap } from "react-leaflet";
import type { Hotspot, HotspotCell, HotspotReview } from "@/lib/weedVision/hotspots";
import { selectHotspot, useFrameRun } from "@/lib/weedVision/frameRunStore";

export const REVIEW_COLOUR: Record<HotspotReview | "unreviewed", string> = { unreviewed: "#ff9800", confirmed: "#4CAF50", dismissed: "#6b7280", uncertain: "#ffe600" };
export const SELECTED_AREA_COLOUR = "#ffffff";
/** From this zoom in, the selected area's cells are shaded. */
export const CELLS_ZOOM = 17;

export function reviewOf(h: Hotspot, reviews: Record<string, { verdict: HotspotReview }>): HotspotReview | "unreviewed" {
  return reviews[h.id]?.verdict ?? "unreviewed";
}

/** Flies to the session's focus box whenever its nonce changes. */
export function HotspotFocus({ taskId, fieldBounds }: { taskId: string; fieldBounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  const run = useFrameRun(taskId);
  const nonce = run.focus?.nonce ?? 0;
  useEffect(() => {
    if (!run.focus) return;
    if (run.selectedHotspotId) map.fitBounds([[run.focus.south, run.focus.west], [run.focus.north, run.focus.east]], { padding: [60, 60], maxZoom: 20 });
    else if (fieldBounds) map.fitBounds(fieldBounds, { padding: [40, 40] });
  }, [nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function HotspotLayer({ taskId }: { taskId: string }) {
  const run = useFrameRun(taskId);
  const hs = run.hotspots;
  if (!hs || run.viewMode !== "priority") return null;
  const selected = run.selectedHotspotId ? hs.hotspots.find(h => h.id === run.selectedHotspotId) ?? null : null;
  return (
    <>
      {hs.hotspots.map(h => {
        const review = reviewOf(h, run.reviews);
        const active = h.id === run.selectedHotspotId;
        const colour = REVIEW_COLOUR[review];
        return (
          <Polygon key={h.id} positions={h.ring.map(q => [q.lat, q.lng] as [number, number])} eventHandlers={{ click: () => selectHotspot(taskId, h.id) }}
            pathOptions={{ color: active ? SELECTED_AREA_COLOUR : colour, weight: active ? 3 : 2, fillColor: colour, fillOpacity: review === "dismissed" ? 0.05 : active ? 0.2 : 0.12, dashArray: review === "dismissed" ? "4 4" : undefined }}>
            <Tooltip permanent direction="center" opacity={0.95} className="scout-label">{h.rank}</Tooltip>
          </Polygon>
        );
      })}
      {selected && <SelectedCells cells={selected.cellRings} />}
    </>
  );
}

function SelectedCells({ cells }: { cells: Hotspot["cellRings"] }) {
  const map = useMap();
  if (map.getZoom() < CELLS_ZOOM) return null;
  return <>{cells.map((ring, i) => <Polygon key={i} positions={ring.map(q => [q.lat, q.lng] as [number, number])} interactive={false} pathOptions={{ color: "#ffffff", weight: 0.6, fillColor: "#ffffff", fillOpacity: 0.05 }} />)}</>;
}

/** Every occupied cell shaded by candidate weed canopy (or plant count when canopy is unknown), on one canvas. */
export function HeatmapLayer({ taskId }: { taskId: string }) {
  const map = useMap();
  const run = useFrameRun(taskId);
  const cells = run.viewMode === "heatmap" ? run.hotspots?.cells ?? null : null;
  useEffect(() => {
    if (!cells || !cells.length) return;
    const canvas = L.DomUtil.create("canvas", "leaflet-zoom-animated") as HTMLCanvasElement;
    canvas.style.pointerEvents = "none";
    canvas.setAttribute("data-testid", "heatmap-canvas");
    map.getPanes().overlayPane.appendChild(canvas);
    const value = (c: HotspotCell) => (c.coveredM2 != null ? c.coveredM2 : c.plants * 0.01);
    const max = Math.max(1e-9, ...cells.map(value));
    const draw = () => {
      const size = map.getSize();
      canvas.width = size.x; canvas.height = size.y;
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, size.x, size.y);
      for (const c of cells) {
        const v = Math.sqrt(value(c) / max); // square root: a few huge cells must not blank the rest
        const pts = c.ring.map(q => map.latLngToContainerPoint([q.lat, q.lng]));
        if (pts.every(p => p.x < 0 || p.y < 0 || p.x > size.x || p.y > size.y)) continue;
        ctx.fillStyle = `rgba(255, ${Math.round(230 - 150 * v)}, 0, ${0.15 + 0.55 * v})`;
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y); ctx.closePath(); ctx.fill();
        if (c.onRow && !c.plants) { ctx.strokeStyle = "rgba(64,224,255,0.6)"; ctx.lineWidth = 1; ctx.stroke(); }
      }
    };
    draw();
    map.on("moveend zoomend viewreset resize", draw);
    return () => { map.off("moveend zoomend viewreset resize", draw); canvas.remove(); };
  }, [map, cells]);
  return null;
}
