// The two-stage prototype on the map, on one canvas: Stage 1's pressure per
// cell (grey where uncertain), its candidate areas, the RF-DETR windows
// (white: routed for a candidate or uncertainty, cyan dashed: random audit),
// and the weeds the windows that ran found. In labelling mode none of that is
// drawn: only the cell being labelled and the operator's own labels, so a
// label is never a copy of the model.
import { useEffect } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import { latLngOfPx, mercatorPx } from "@/lib/weedVision/mapRun";
import { isOnRow } from "@/lib/weedVision/rowFilter";
import { cellAt, cellKey } from "@/lib/weedVision/twoStage/stage1";
import { patchTwoStage, twoStagePlants, useTwoStage } from "@/lib/weedVision/twoStage/twoStageStore";

export const LABEL_COLOURS = ["#9ca3af", "#d9f99d", "#facc15", "#fb923c", "#ef4444"] as const;

export function TwoStageLayer({ taskId }: { taskId: string }) {
  const map = useMap();
  const s = useTwoStage(taskId);
  const { stage1, routing, windows, runs, layers, labelMode, labels, activeCell, focus } = s;

  useEffect(() => {
    if (focus) map.setView([focus.lat, focus.lng], Math.max(map.getZoom(), 21));
  }, [focus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!stage1) return;
    const canvas = L.DomUtil.create("canvas", "leaflet-zoom-animated") as HTMLCanvasElement;
    canvas.style.pointerEvents = "none";
    canvas.setAttribute("data-testid", "two-stage-canvas");
    map.getPanes().overlayPane.appendChild(canvas);
    const weeds = labelMode || !layers.weeds ? [] : twoStagePlants({ runs }).filter(p => p.klass === "weed" && p.centre && !isOnRow(p.rowStatus));
    const byKey = new Map(stage1.cells.map(c => [c.key, c]));
    const draw = () => {
      const size = map.getSize();
      canvas.width = size.x; canvas.height = size.y;
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, size.x, size.y);
      const pt = (q: { lat: number; lng: number }) => map.latLngToContainerPoint([q.lat, q.lng]);
      const off = (ps: L.Point[]) => ps.every(p => p.x < 0 || p.y < 0 || p.x > size.x || p.y > size.y);
      const path = (ps: L.Point[]) => { ctx.beginPath(); ctx.moveTo(ps[0].x, ps[0].y); for (const p of ps.slice(1)) ctx.lineTo(p.x, p.y); ctx.closePath(); };
      if (labelMode) {
        for (const [k, l] of Object.entries(labels)) {
          const c = byKey.get(k);
          if (!c) continue;
          const ps = c.ring.map(pt);
          if (off(ps)) continue;
          path(ps); ctx.strokeStyle = LABEL_COLOURS[l.coverClass]; ctx.lineWidth = l.highPriority ? 3 : 1.5; ctx.stroke();
        }
        const a = activeCell ? byKey.get(activeCell) : null;
        if (a) { const ps = a.ring.map(pt); path(ps); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]); }
        return;
      }
      if (layers.pressure) {
        for (const c of stage1.cells) {
          if (c.pressure <= 0 && !c.uncertain.length) continue;
          const ps = c.ring.map(pt);
          if (off(ps)) continue;
          path(ps);
          if (c.uncertain.length) ctx.fillStyle = "rgba(156,163,175,0.25)";
          else { const v = Math.min(1, Math.sqrt(c.pressure / 0.25)); ctx.fillStyle = `rgba(255, ${Math.round(220 - 180 * v)}, 0, ${0.1 + 0.5 * v})`; }
          ctx.fill();
        }
      }
      if (layers.windows && routing) {
        for (const w of windows) {
          const r = routing.reasons[w.name];
          if (r === "skipped" && !runs[w.name]) continue;
          const ring = [[w.x0, w.y0], [w.x0 + w.size, w.y0], [w.x0 + w.size, w.y0 + w.size], [w.x0, w.y0 + w.size]].map(([X, Y]) => pt(latLngOfPx(X, Y, w.z)));
          if (off(ring)) continue;
          path(ring);
          if (runs[w.name]) { ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.fill(); }
          ctx.strokeStyle = r === "audit" ? "#22d3ee" : r === "skipped" ? "#6b7280" : "#ffffff";
          ctx.lineWidth = 1;
          ctx.setLineDash(r === "audit" ? [5, 4] : []);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      if (layers.candidates) {
        for (const h of stage1.hotspots) {
          const ps = h.ring.map(pt);
          if (ps.length < 3 || off(ps)) continue;
          path(ps); ctx.strokeStyle = h.highPriority ? "#ef4444" : "#ff9800"; ctx.lineWidth = h.highPriority ? 2.5 : 1.5; ctx.stroke();
        }
      }
      if (weeds.length) {
        const r = map.getZoom() >= 19 ? 3 : 2;
        ctx.fillStyle = "#ffe600";
        for (const p of weeds) {
          const q = pt(p.centre!);
          if (q.x < -r || q.y < -r || q.x > size.x + r || q.y > size.y + r) continue;
          ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill();
        }
      }
    };
    const click = (e: L.LeafletMouseEvent) => {
      if (!labelMode) return;
      const [X, Y] = mercatorPx(e.latlng.lat, e.latlng.lng, stage1.grid.z);
      const c = cellAt(stage1.grid, X, Y);
      const k = c ? cellKey(c.i, c.j) : null;
      if (k && byKey.has(k)) patchTwoStage(taskId, { activeCell: k });
    };
    draw();
    map.on("moveend zoomend viewreset resize", draw);
    map.on("click", click);
    return () => { map.off("moveend zoomend viewreset resize", draw); map.off("click", click); canvas.remove(); };
  }, [map, taskId, stage1, routing, windows, runs, layers, labelMode, labels, activeCell]);
  return null;
}
