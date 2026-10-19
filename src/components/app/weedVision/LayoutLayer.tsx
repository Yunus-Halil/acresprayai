// The field's crop rows on the map, on one canvas: the row lines (cyan), each
// crop plant (green ring), each position with no plant (red cross), tree-sized
// green that is on no row (orange dashed ring: a row or block not marked yet),
// and, while marking, the plants clicked so far (white). Clicks on the map are
// taken as plants while marking.
import { useEffect } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import { latLngOfPx } from "@/lib/weedVision/mapRun";
import { frameRunFieldRows, useFrameRun } from "@/lib/weedVision/frameRunStore";
import { addClick, useLayoutUi } from "@/lib/weedVision/layout/layoutUi";

export function LayoutLayer({ taskId }: { taskId: string }) {
  const map = useMap();
  const ui = useLayoutUi(taskId);
  const run = useFrameRun(taskId);
  const visible = ui.show || ui.clicking;
  // Redrawn when the rows change (their summary changes with them) or the marking does.
  const rowsSig = `${run.fieldRowsSource}|${run.fieldRows?.rows ?? 0}|${run.layoutStats?.plants ?? 0}|${run.layoutStats?.gaps ?? 0}|${run.fieldRowsState}`;

  useEffect(() => {
    if (!ui.clicking) return;
    const el = map.getContainer();
    const prev = el.style.cursor;
    el.style.cursor = "crosshair";
    const click = (e: L.LeafletMouseEvent) => addClick(taskId, { lat: e.latlng.lat, lng: e.latlng.lng });
    map.on("click", click);
    return () => { map.off("click", click); el.style.cursor = prev; };
  }, [map, taskId, ui.clicking]);

  useEffect(() => {
    if (!visible) return;
    const rows = frameRunFieldRows(taskId);
    const canvas = L.DomUtil.create("canvas", "leaflet-zoom-animated") as HTMLCanvasElement;
    canvas.style.pointerEvents = "none";
    canvas.setAttribute("data-testid", "layout-canvas");
    map.getPanes().overlayPane.appendChild(canvas);
    const draw = () => {
      const size = map.getSize();
      canvas.width = size.x; canvas.height = size.y;
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, size.x, size.y);
      const pt = (x: number, y: number) => { const g = latLngOfPx(rows!.left + x, rows!.top + y, rows!.z); return map.latLngToContainerPoint([g.lat, g.lng]); };
      const metre = rows ? map.latLngToContainerPoint(map.getCenter()).distanceTo(map.latLngToContainerPoint(L.latLng(map.getCenter().lat + 1 / 111_320, map.getCenter().lng))) : 0;
      if (rows) {
        ctx.lineJoin = "round";
        for (const l of rows.ctx.lines) {
          const a = pt(l.x1, l.y1), b = pt(l.x2, l.y2);
          ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 2; ctx.stroke();
        }
        for (const c of rows.ctx.crops) {
          const q = pt(c.x, c.y), r = Math.max(3, c.r * rows.mpp * metre);
          ctx.strokeStyle = "#4ade80"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.stroke();
        }
        for (const g of rows.gaps ?? []) {
          const q = pt(g.x, g.y), s = 5;
          ctx.strokeStyle = "#ff1a1a"; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(q.x - s, q.y - s); ctx.lineTo(q.x + s, q.y + s); ctx.moveTo(q.x + s, q.y - s); ctx.lineTo(q.x - s, q.y + s); ctx.stroke();
        }
        for (const u of rows.unexplained ?? []) {
          const q = pt(u.x, u.y), r = Math.max(6, u.r * rows.mpp * metre);
          ctx.strokeStyle = "#ff9100"; ctx.lineWidth = 2.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        }
      }
      for (const c of ui.clicks) {
        const q = map.latLngToContainerPoint([c.lat, c.lng]);
        ctx.strokeStyle = "#000"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(q.x, q.y, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.stroke();
      }
    };
    draw();
    map.on("moveend zoomend viewreset resize", draw);
    return () => { map.off("moveend zoomend viewreset resize", draw); canvas.remove(); };
  }, [map, taskId, visible, ui.clicks, rowsSig]);
  return null;
}
