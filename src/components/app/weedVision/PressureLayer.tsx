// The weed-pressure grade on the map, on one canvas, kept simple: each assessed cell filled lightly in one of three
// colours (low green, medium yellow, high red: red is the published action point and over), "possible" cells a
// little fainter, the large escapes as small diamonds, the selected cell outlined. Nothing else: no hatching, no
// labels, no patch outlines (the panel carries those). The fill is cut away from the crop rows and crowns (the row
// band and each crown with its margin), so pressure is drawn only on the ground it was measured on and never over a
// tree. A click selects a cell for the panel.
import { useEffect } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import { frameRunFieldRows } from "@/lib/weedVision/frameRunStore";
import { PAINT_CROWN_MARGIN_M, rowsForGround } from "@/lib/weedVision/layout/rowBand";
import { latLngOfPx, mercatorPx } from "@/lib/weedVision/mapRun";
import { type PressureBand, drawnBandOf } from "@/lib/weedVision/pressure/grade";
import { selectPressureCell, usePressure } from "@/lib/weedVision/pressure/pressureStore";
import { cellAt, cellKey } from "@/lib/weedVision/twoStage/stage1";

/** Low green, medium yellow, high red; light, so the ground reads through. */
export const BAND_FILL: Record<PressureBand, string> = { none: "rgba(0,0,0,0)", low: "rgba(74,222,128,0.28)", medium: "rgba(250,204,21,0.34)", high: "rgba(239,68,68,0.4)" };
export const BAND_SWATCH: Record<PressureBand, string> = { none: "transparent", low: "#4ade80", medium: "#facc15", high: "#ef4444" };
export const ESCAPE_COLOUR = "#ff1a1a";

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
      // The border thins as the cells draw small, so a zoomed-out field reads as fills, not as a mesh of lines.
      const first = grade.cells.find(c => c.assessed);
      const cellScreenPx = first ? Math.hypot(pt(first.ring[1]).x - pt(first.ring[0]).x, pt(first.ring[1]).y - pt(first.ring[0]).y) : 20;
      const borderPx = Math.min(1.5, Math.max(0.5, cellScreenPx / 10));
      for (const c of grade.cells) {
        if (!c.assessed || c.klass === "none") continue;
        const ps = c.ring.map(pt);
        if (off(ps)) continue;
        const b = drawnBandOf(c);
        path(ps);
        ctx.globalAlpha = c.tier === "possible" ? 0.6 : 1;
        ctx.fillStyle = BAND_FILL[b]; ctx.fill();
        // A solid border in the band's colour: a light fill over green weeds reads as green whatever its colour.
        ctx.strokeStyle = BAND_SWATCH[b]; ctx.lineWidth = borderPx; ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // Cut the crop out of the tint: the rows' bands and the crowns, as the grade's own ground excluded them (each
      // crown at Stage 1's ground cut: an expected crown small, every other with its margin).
      const fieldRows = frameRunFieldRows(taskId);
      const rows = fieldRows ? rowsForGround(fieldRows, PAINT_CROWN_MARGIN_M / fieldRows.mpp) : null;
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
          const q = fp(c.x, c.y), r = Math.max(3, (c.paint ?? c.r) * rows.mpp * metre);
          ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
      for (const e of grade.escapes) {
        const q = pt(e.centre);
        if (q.x < -20 || q.y < -20 || q.x > size.x + 20 || q.y > size.y + 20) continue;
        const r = 6;
        ctx.beginPath(); ctx.moveTo(q.x, q.y - r); ctx.lineTo(q.x + r, q.y); ctx.lineTo(q.x, q.y + r); ctx.lineTo(q.x - r, q.y); ctx.closePath();
        ctx.strokeStyle = "rgba(0,0,0,0.85)"; ctx.lineWidth = 3.5; ctx.stroke();
        ctx.strokeStyle = ESCAPE_COLOUR; ctx.lineWidth = 1.5; ctx.stroke();
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
