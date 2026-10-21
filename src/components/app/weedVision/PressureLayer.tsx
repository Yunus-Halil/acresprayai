// The weed-pressure grade on the map, on one canvas: each assessed cell tinted by its class (a sequence from pale to
// red, the action point and over in warm colours), "possible" cells outlined dashed rather than tinted, cells that
// were not assessed hatched white (unseen, not weed-free), the priority patches outlined, and the large escapes as
// diamonds with their size. The tint is cut away from the crop rows and crowns (the row band and each crown with
// its margin), so pressure is drawn only on the ground it was measured on and never over a tree. Nothing here is
// interactive except a click, which selects a cell for the panel.
import { useEffect } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import { frameRunFieldRows } from "@/lib/weedVision/frameRunStore";
import { latLngOfPx, mercatorPx } from "@/lib/weedVision/mapRun";
import { type PressureClass } from "@/lib/weedVision/pressure/grade";
import { selectPressureCell, usePressure } from "@/lib/weedVision/pressure/pressureStore";
import { cellAt, cellKey } from "@/lib/weedVision/twoStage/stage1";

/** Pale to red: none clear, trace barely there, low, moderate, action, high. Chosen to read on red-brown soil and green canopy. */
export const PRESSURE_COLOURS: Record<PressureClass, string> = { none: "rgba(0,0,0,0)", trace: "rgba(226,232,240,0.35)", low: "rgba(217,249,157,0.45)", moderate: "rgba(250,204,21,0.5)", action: "rgba(251,146,60,0.6)", high: "rgba(239,68,68,0.65)" };
export const PRESSURE_STROKES: Record<PressureClass, string> = { none: "transparent", trace: "#e2e8f0", low: "#d9f99d", moderate: "#facc15", action: "#fb923c", high: "#ef4444" };
export const ESCAPE_COLOUR = "#ff1a1a";
export const PATCH_COLOUR = "#ffffff";

export function PressureLayer({ taskId }: { taskId: string }) {
  const map = useMap();
  const s = usePressure(taskId);
  const { grade, show, selectedCell } = s;

  useEffect(() => {
    if (!grade || !show) return;
    const click = (e: L.LeafletMouseEvent) => {
      const [X, Y] = mercatorPx(e.latlng.lat, e.latlng.lng, grade.cells.length ? gridZ(grade) : 23);
      const g = gridOf(grade);
      if (!g) return;
      const c = cellAt(g, X, Y);
      selectPressureCell(taskId, c ? cellKey(c.i, c.j) : null);
    };
    map.on("click", click);
    return () => { map.off("click", click); };
  }, [map, taskId, grade, show]);

  useEffect(() => {
    if (!grade || !show) return;
    const canvas = L.DomUtil.create("canvas", "leaflet-zoom-animated") as HTMLCanvasElement;
    canvas.style.pointerEvents = "none";
    canvas.setAttribute("data-testid", "pressure-canvas");
    map.getPanes().overlayPane.appendChild(canvas);
    const byKey = new Map(grade.cells.map(c => [c.key, c]));
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
      for (const c of grade.cells) {
        const ps = c.ring.map(pt);
        if (off(ps)) continue;
        if (!c.assessed) {
          // Hatched white: unseen, not weed-free.
          path(ps); ctx.save(); ctx.clip();
          ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 1;
          const x0 = Math.min(...ps.map(p => p.x)), x1 = Math.max(...ps.map(p => p.x)), y0 = Math.min(...ps.map(p => p.y)), y1 = Math.max(...ps.map(p => p.y));
          for (let d = -(y1 - y0); d < x1 - x0; d += 8) { ctx.beginPath(); ctx.moveTo(x0 + d, y0); ctx.lineTo(x0 + d + (y1 - y0), y1); ctx.stroke(); }
          ctx.restore();
          continue;
        }
        if (c.klass === "none") continue;
        path(ps);
        if (c.tier === "possible") { ctx.strokeStyle = PRESSURE_STROKES[c.klass]; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]); }
        else { ctx.fillStyle = PRESSURE_COLOURS[c.klass]; ctx.fill(); }
        if (c.treatWhileSmall) { const q = pt(c.centre); ctx.fillStyle = "#ffffff"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("small", q.x, q.y); }
      }
      // Cut the crop out of the tint: the rows' bands and the crowns, as the grade's own ground excluded them.
      const rows = frameRunFieldRows(taskId);
      if (rows) {
        const metre = map.latLngToContainerPoint(map.getCenter()).distanceTo(map.latLngToContainerPoint(L.latLng(map.getCenter().lat + 1 / 111_320, map.getCenter().lng)));
        const fp = (x: number, y: number) => { const q = latLngOfPx(rows.left + x, rows.top + y, rows.z); return map.latLngToContainerPoint([q.lat, q.lng]); };
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.lineCap = "round";
        for (const l of rows.ctx.lines) {
          const a = fp(l.x1, l.y1), b = fp(l.x2, l.y2);
          ctx.strokeStyle = "#000"; ctx.lineWidth = Math.max(2, 2 * (l.band ?? rows.ctx.bandPx) * rows.mpp * metre);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        for (const c of rows.ctx.crops) {
          const q = fp(c.x, c.y), r = Math.max(3, (c.r * rows.mpp + 0.3) * metre);
          ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
      for (const p of grade.patches.filter(p => p.priority)) {
        for (const k of p.cells) {
          const c = byKey.get(k);
          if (!c) continue;
          const ps = c.ring.map(pt);
          if (off(ps)) continue;
          path(ps); ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.lineWidth = 4; ctx.stroke(); ctx.strokeStyle = PATCH_COLOUR; ctx.lineWidth = 2; ctx.stroke();
        }
      }
      for (const e of grade.escapes) {
        const q = pt(e.centre);
        if (q.x < -20 || q.y < -20 || q.x > size.x + 20 || q.y > size.y + 20) continue;
        const r = 7;
        ctx.beginPath(); ctx.moveTo(q.x, q.y - r); ctx.lineTo(q.x + r, q.y); ctx.lineTo(q.x, q.y + r); ctx.lineTo(q.x - r, q.y); ctx.closePath();
        ctx.strokeStyle = "rgba(0,0,0,0.85)"; ctx.lineWidth = 4; ctx.stroke();
        ctx.strokeStyle = ESCAPE_COLOUR; ctx.lineWidth = 2; if (e.tier === "possible") ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
      }
      if (selectedCell) {
        const c = byKey.get(selectedCell);
        if (c) { const ps = c.ring.map(pt); path(ps); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]); }
      }
    };
    draw();
    map.on("moveend zoomend viewreset resize", draw);
    return () => { map.off("moveend zoomend viewreset resize", draw); canvas.remove(); };
  }, [map, grade, show, selectedCell]);
  return null;
}

/** The grid the grade's cells sit on, rebuilt from the cells (the grade carries no grid of its own). */
function gridOf(grade: NonNullable<ReturnType<typeof usePressure>["grade"]>) {
  const first = grade.cells[0];
  if (!first) return null;
  const z = gridZ(grade);
  const [X0, Y0] = mercatorPx(first.ring[0].lat, first.ring[0].lng, z), [X1] = mercatorPx(first.ring[1].lat, first.ring[1].lng, z);
  const cellPx = Math.max(1, Math.round(X1 - X0));
  const left = X0 - first.i * cellPx, top = Y0 - first.j * cellPx;
  const nx = Math.max(...grade.cells.map(c => c.i)) + 1, ny = Math.max(...grade.cells.map(c => c.j)) + 1;
  return { z, left, top, mpp: grade.detectionFloorM / grade.params.floorPx, cellPx, nx, ny };
}
const gridZ = (grade: { cells: { ring: { lat: number; lng: number }[] }[]; detectionFloorM: number; params: { floorPx: number } }) => {
  // The zoom whose pixel is the grade's: 23 at 1.5 cm near 38° N; derived from the floor so the layer needs no store of its own.
  const mpp = grade.detectionFloorM / grade.params.floorPx;
  const lat = grade.cells[0]?.ring[0].lat ?? 0;
  const m0 = (156543.03392 * Math.cos((lat * Math.PI) / 180));
  return Math.round(Math.log2(m0 / mpp));
};
