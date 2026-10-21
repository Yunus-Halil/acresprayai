// The field's crop rows on the map, on one canvas: the row lines (cyan), each
// planted position (green ring: a crop, by the pattern), each planted position
// with plainly bare ground (red cross: a skip), tree-sized green that is on no
// row (orange dashed ring: a row or block not marked yet), and, while marking,
// the plants clicked so far (white). Clicks on the map are taken as plants
// while marking. Nothing on a row is ever drawn as a question.
import { useEffect } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import { latLngOfPx, mercatorPx } from "@/lib/weedVision/mapRun";
import { frameRunFieldRows, useFrameRun } from "@/lib/weedVision/frameRunStore";
import { addClick, pickPosition, useLayoutUi } from "@/lib/weedVision/layout/layoutUi";

/** How each state is drawn: confirmed and expected the same green (dashed only where the canopy runs into other green), operator white-green; gaps a red cross (skip) or a grey cross (operator: no crop). */
export const STATE_COLOUR = { confirmed: "#4ade80", expected: "#4ade80", operator: "#e2ffe9" } as const;

export function LayoutLayer({ taskId }: { taskId: string }) {
  const map = useMap();
  const ui = useLayoutUi(taskId);
  const run = useFrameRun(taskId);
  const visible = ui.show || ui.clicking;
  // Redrawn when the rows change (their summary changes with them) or the marking does.
  const rowsSig = `${run.fieldRowsSource}|${run.fieldRows?.rows ?? 0}|${run.layoutStats?.plants ?? 0}|${run.layoutStats?.gaps ?? 0}|${run.fieldRowsState}|${ui.picked ? `${ui.picked.lat},${ui.picked.lng}` : ""}`;

  // A click on a plant or an expected position, when not marking, picks it for the operator's word.
  useEffect(() => {
    if (ui.clicking || !visible) return;
    const click = (e: L.LeafletMouseEvent) => {
      const rows = frameRunFieldRows(taskId);
      if (!rows || rows.source !== "layout") return;
      const [X, Y] = mercatorPx(e.latlng.lat, e.latlng.lng, rows.z);
      const fx = X - rows.left, fy = Y - rows.top;
      const typical = [...rows.ctx.crops.map(c => c.r)].sort((a, b) => a - b)[rows.ctx.crops.length >> 1] ?? (0.6 / rows.mpp);
      let best: { d: number; p: { x: number; y: number; kind: "plant" | "gap"; state: string; uncertain: boolean } } | null = null;
      for (const c of rows.ctx.crops) { const d = Math.hypot(c.x - fx, c.y - fy); if (d <= Math.max(c.r, 0.6 / rows.mpp) && (!best || d < best.d)) best = { d, p: { x: c.x, y: c.y, kind: "plant", state: c.state ?? "confirmed", uncertain: !!c.uncertain } }; }
      for (const g of rows.gaps ?? []) { const d = Math.hypot(g.x - fx, g.y - fy); if (d <= Math.max(typical, 0.6 / rows.mpp) && (!best || d < best.d)) best = { d, p: { x: g.x, y: g.y, kind: "gap", state: g.evidence ?? "none", uncertain: false } }; }
      if (!best) { pickPosition(taskId, null); return; }
      const g = latLngOfPx(rows.left + best.p.x, rows.top + best.p.y, rows.z);
      pickPosition(taskId, { lat: g.lat, lng: g.lng, kind: best.p.kind, state: best.p.state, uncertain: best.p.uncertain });
    };
    map.on("click", click);
    return () => { map.off("click", click); };
  }, [map, taskId, ui.clicking, visible]);

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
          const st = c.state ?? "confirmed";
          ctx.strokeStyle = STATE_COLOUR[st]; ctx.lineWidth = st === "operator" ? 3 : 2;
          // Dashed only when the canopy's extent is uncertain (merged with other green). Never a "?": a planted position is a crop.
          ctx.setLineDash(c.uncertain && st !== "operator" ? [5, 4] : []);
          ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
        }
        for (const g of rows.gaps ?? []) {
          const q = pt(g.x, g.y), s = 5;
          ctx.strokeStyle = g.evidence === "operator" ? "#9ca3af" : "#ff1a1a"; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(q.x - s, q.y - s); ctx.lineTo(q.x + s, q.y + s); ctx.moveTo(q.x + s, q.y - s); ctx.lineTo(q.x - s, q.y + s); ctx.stroke();
        }
        if (ui.picked) {
          const q = map.latLngToContainerPoint([ui.picked.lat, ui.picked.lng]);
          ctx.strokeStyle = "#000"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(q.x, q.y, 12, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.stroke();
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
  }, [map, taskId, visible, ui.clicks, rowsSig]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
