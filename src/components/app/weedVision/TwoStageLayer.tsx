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
import { ROUTING_REASONS } from "@/lib/weedVision/twoStage/router";
import { cellAt, cellKey } from "@/lib/weedVision/twoStage/stage1";
import { patchTwoStage, twoStagePlants, useTwoStage } from "@/lib/weedVision/twoStage/twoStageStore";

export const LABEL_COLOURS = ["#9ca3af", "#d9f99d", "#facc15", "#fb923c", "#ef4444"] as const;
/**
 * Colours chosen to read on both red-brown soil and green canopy. A blue-grey tint for uncertain cells blended into
 * mauve over the orchard's soil and was hard to see (Yunus, 2026-10-19), so uncertain cells are hatched in white, and
 * candidate areas are bright with a dark halo under the outline.
 */
export const TWO_STAGE_COLOURS = { candidate: "#ff9100", highPriority: "#ff1a1a", halo: "rgba(0,0,0,0.85)", hatch: "rgba(255,255,255,0.6)" } as const;

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
      // Cells outside the view are skipped before projecting their corners: on a 50 ha field zoomed in, projecting
      // every cell took 40 ms a redraw (scripts/bench/layerRenderBench.mjs).
      const vb = map.getBounds().pad(0.05);
      const s0 = vb.getSouth(), n0 = vb.getNorth(), w0 = vb.getWest(), e0 = vb.getEast();
      const inView = (ring: { lat: number; lng: number }[]) => ring.some(q => q.lat >= s0 && q.lat <= n0 && q.lng >= w0 && q.lng <= e0);
      if (layers.pressure) {
        for (const c of stage1.cells) {
          const unsure = c.uncertain.some(r => ROUTING_REASONS.has(r));
          if (c.pressure < 0.01 && !unsure) continue;
          if (!inView(c.ring)) continue;
          const ps = c.ring.map(pt);
          if (off(ps)) continue;
          if (c.pressure >= 0.01) {
            // Yellow at a trace of pressure to red at 25% and over, never faint enough to turn muddy on soil.
            const v = Math.min(1, Math.sqrt(c.pressure / 0.25));
            path(ps); ctx.fillStyle = `rgba(255, ${Math.round(230 - 200 * v)}, 0, ${0.3 + 0.4 * v})`; ctx.fill();
          }
          if (unsure) {
            const xs = ps.map(p => p.x), ys = ps.map(p => p.y);
            const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
            path(ps);
            if (x1 - x0 < 8) { ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fill(); continue; } // too small to hatch
            ctx.save(); ctx.clip();
            ctx.strokeStyle = TWO_STAGE_COLOURS.hatch; ctx.lineWidth = 1;
            ctx.beginPath();
            for (let k = x0 - (y1 - y0); k < x1; k += 6) { ctx.moveTo(k, y1); ctx.lineTo(k + (y1 - y0), y0); }
            ctx.stroke();
            ctx.restore();
          }
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
          const col = h.highPriority ? TWO_STAGE_COLOURS.highPriority : TWO_STAGE_COLOURS.candidate;
          path(ps);
          // Orange fill for both: a red fill over brown soil turns salmon-pink, the outline says which is high priority.
          ctx.globalAlpha = 0.25; ctx.fillStyle = TWO_STAGE_COLOURS.candidate; ctx.fill(); ctx.globalAlpha = 1;
          ctx.lineJoin = "round";
          ctx.strokeStyle = TWO_STAGE_COLOURS.halo; ctx.lineWidth = h.highPriority ? 6 : 5; ctx.stroke();
          ctx.strokeStyle = col; ctx.lineWidth = h.highPriority ? 3.5 : 2.5; ctx.stroke();
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
