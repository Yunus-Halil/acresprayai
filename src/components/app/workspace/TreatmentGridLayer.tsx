// The treatment grid, drawn on the map.
//
// ONE CANVAS, NOT N POLYGONS. The obvious implementation is an L.polygon per
// cell, the way AiZonesLayer draws its handful of zones. It does not survive
// contact with this data: the grid ceiling is 20,000 cells, and 20,000 Leaflet
// layers means 20,000 SVG nodes, 20,000 event listeners and a layout pass on
// every pan. So the whole grid is painted onto a single canvas, cells are
// culled to the viewport, and detail drops as they shrink — the arithmetic for
// all three lives in lib/gridRender.ts, where it can be tested.
//
// Hit testing is done here rather than by the browser for the same reason:
// there are no DOM nodes to click. A click is a point-in-ring search over the
// culled list, which costs the viewport instead of the field.
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { LatLng2 } from "@/lib/geo";
import type { CellId, TreatmentGrid } from "@/lib/treatmentGrid";
import {
  type CellBounds, type DetailLevel,
  cellAt, cellBoundsOf, cellPaint, cellsNear, detailFor, metresPerPixel,
  paintList, rateRange, visibleCells,
} from "@/lib/gridRender";

/** What the layer reports back about what it just drew, for the status line. */
export type GridRenderInfo = {
  level: DetailLevel;
  /** Cells in the viewport. */
  visible: number;
  /** Cells actually painted — differs from `visible` only at sparse detail. */
  painted: number;
  /** Cell size on screen, in pixels. */
  cellPx: number;
};

export function TreatmentGridLayer({
  grid, selected, candidates, brushM, onPaintCells, onPickCell, onRender,
}: {
  grid: TreatmentGrid;
  /** Cells drawn with a selection halo. */
  selected: ReadonlySet<CellId>;
  /**
   * Cells suggested by Find Similar — drawn with a dashed amber outline,
   * deliberately unlike both the treated ramp and the skip blue: suggested is
   * neither decided nor default, and must not read as either.
   */
  candidates?: ReadonlySet<CellId>;
  /**
   * Brush radius in metres, or null when the layer is read-only. A number turns
   * click and drag into painting; null leaves the map draggable and clicks
   * merely select.
   */
  brushM: number | null;
  onPaintCells: (ids: CellId[]) => void;
  onPickCell: (id: CellId | null) => void;
  onRender?: (info: GridRenderInfo) => void;
}) {
  const map = useMap();

  // Props the draw loop and the event handlers read. Held in refs so that
  // changing the brush or the selection does not tear down the canvas and
  // rebuild the projection cache — those change on every click.
  const props = useRef({ grid, selected, candidates, brushM, onPaintCells, onPickCell, onRender });
  props.current = { grid, selected, candidates, brushM, onPaintCells, onPickCell, onRender };

  const boundsRef = useRef<CellBounds>(new Float64Array(0));
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const redrawRef = useRef<() => void>(() => {});
  const hoverRef = useRef<Set<number>>(new Set());

  // Cell bounding boxes, recomputed only when the grid itself changes.
  useEffect(() => { boundsRef.current = cellBoundsOf(grid.cells); }, [grid]);

  useEffect(() => {
    const canvas = L.DomUtil.create("canvas", "leaflet-layer leaflet-zoom-hide") as HTMLCanvasElement;
    canvas.style.pointerEvents = "none";      // the map keeps its own events
    canvas.style.zIndex = "350";
    map.getPanes().overlayPane.appendChild(canvas);
    canvasRef.current = canvas;
    const ctx = canvas.getContext("2d");

    // Absolute Web Mercator pixel coordinates per vertex at the current zoom,
    // with ring boundaries in a parallel offset table.
    //
    // Projecting every vertex on every frame is the thing that makes a pan
    // stutter, and a pan does not change the projection — only the origin the
    // canvas is drawn about. So this is rebuilt on zoom and merely translated
    // on pan.
    let proj = new Float64Array(0);
    let offsets = new Int32Array(0);
    let projZoom = NaN;
    let projGrid: TreatmentGrid | null = null;

    const reproject = () => {
      const cells = props.current.grid.cells;
      const zoom = map.getZoom();
      let total = 0;
      for (const c of cells) total += c.ring.length;
      if (proj.length !== total * 2) proj = new Float64Array(total * 2);
      if (offsets.length !== cells.length + 1) offsets = new Int32Array(cells.length + 1);
      let k = 0;
      for (let i = 0; i < cells.length; i++) {
        offsets[i] = k;
        for (const p of cells[i].ring) {
          const pt = map.project([p.lat, p.lng], zoom);
          proj[k * 2] = pt.x; proj[k * 2 + 1] = pt.y;
          k++;
        }
      }
      offsets[cells.length] = k;
      projZoom = zoom;
      projGrid = props.current.grid;
    };

    const draw = () => {
      if (!ctx) return;
      const { grid: g, selected: sel, candidates: cand, onRender: report } = props.current;
      const size = map.getSize();
      const dpr = window.devicePixelRatio || 1;

      if (canvas.width !== Math.round(size.x * dpr) || canvas.height !== Math.round(size.y * dpr)) {
        canvas.width = Math.round(size.x * dpr);
        canvas.height = Math.round(size.y * dpr);
        canvas.style.width = `${size.x}px`;
        canvas.style.height = `${size.y}px`;
      }
      // Keep the canvas pinned to the visible viewport as the pane moves.
      const topLeft = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(canvas, topLeft);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);

      if (projZoom !== map.getZoom() || projGrid !== g) reproject();

      const b = map.getBounds();
      const view = {
        north: b.getNorth(), south: b.getSouth(),
        east: b.getEast(), west: b.getWest(),
      };
      // One cell of padding, so a pan does not reveal an unpainted edge.
      const padDeg = (g.cellSizeM / 111_320) * 1.5;
      const visible = visibleCells(boundsRef.current, view, padDeg);

      const mpp = metresPerPixel(map.getCenter().lat, map.getZoom());
      const cellPx = g.cellSizeM / mpp;
      const level = detailFor(cellPx, visible.length);
      const list = paintList(g.cells, visible, level);

      const range = rateRange(g);
      const originX = map.getPixelOrigin().x + topLeft.x;
      const originY = map.getPixelOrigin().y + topLeft.y;
      const hover = hoverRef.current;

      // Fills first, then strokes, so a stroke is never buried under the fill
      // of the cell drawn after it.
      for (const i of list) {
        const paint = cellPaint(g.cells[i], range);
        ctx.beginPath();
        for (let k = offsets[i]; k < offsets[i + 1]; k++) {
          const x = proj[k * 2] - originX, y = proj[k * 2 + 1] - originY;
          if (k === offsets[i]) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = paint.fill;
        ctx.fill();
      }

      if (level === "outline") {
        ctx.lineWidth = 1;
        for (const i of list) {
          ctx.beginPath();
          for (let k = offsets[i]; k < offsets[i + 1]; k++) {
            const x = proj[k * 2] - originX, y = proj[k * 2 + 1] - originY;
            if (k === offsets[i]) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.strokeStyle = cellPaint(g.cells[i], range).stroke;
          ctx.stroke();
        }
      }

      // Selection and hover always stroke, at every detail level. They are the
      // operator's own pointer feedback — dropping them because the field is
      // large would remove the one thing telling them what a click will hit.
      const halo = (idx: number, colour: string, width: number) => {
        ctx.beginPath();
        for (let k = offsets[idx]; k < offsets[idx + 1]; k++) {
          const x = proj[k * 2] - originX, y = proj[k * 2 + 1] - originY;
          if (k === offsets[idx]) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = colour;
        ctx.lineWidth = width;
        ctx.stroke();
      };
      // Candidates stroke at EVERY detail level, like selection: a suggestion
      // the operator cannot see is chemical they will be asked to approve
      // blind. Dashed, so it cannot be mistaken for a decided cell.
      if (cand?.size) {
        ctx.setLineDash([5, 4]);
        for (const i of visible) {
          if (!cand.has(g.cells[i].id)) continue;
          ctx.beginPath();
          for (let k = offsets[i]; k < offsets[i + 1]; k++) {
            const x = proj[k * 2] - originX, y = proj[k * 2 + 1] - originY;
            if (k === offsets[i]) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fillStyle = "rgba(245,158,11,0.18)";
          ctx.fill();
          ctx.strokeStyle = "rgba(245,158,11,0.95)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      if (sel.size) {
        for (const i of visible) if (sel.has(g.cells[i].id)) halo(i, "rgba(255,255,255,0.95)", 2);
      }
      for (const i of hover) halo(i, "rgba(76,175,80,0.95)", 2);

      report?.({ level, visible: visible.length, painted: list.length, cellPx });
    };

    redrawRef.current = draw;
    reproject();
    draw();

    // `move` rather than `moveend`: the canvas is pinned to the viewport, so it
    // has to follow the pane while the pane is moving or the grid lags the
    // basemap under the cursor. Zoom animation is handled by leaflet-zoom-hide,
    // which hides the canvas mid-animation and lets zoomend repaint it.
    map.on("move zoom viewreset zoomend resize", draw);
    return () => {
      map.off("move zoom viewreset zoomend resize", draw);
      canvas.remove();
      canvasRef.current = null;
    };
  }, [map]);

  // Redraw when anything the draw loop reads from props changes.
  useEffect(() => { redrawRef.current(); }, [grid, selected, candidates, brushM]);

  // --- pointer handling ----------------------------------------------------
  useEffect(() => {
    let painting = false;
    // Cells already painted during this drag. Without it, a drag that wobbles
    // over one cell re-fires it dozens of times, and each fire is a state
    // update on a grid of up to 20,000 cells.
    const stroked = new Set<CellId>();

    // Candidates are the viewport, not the click point: culling once per
    // interaction is what keeps a click O(screen) instead of O(field).
    const candidates = () => {
      const b = map.getBounds();
      return visibleCells(boundsRef.current, {
        north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest(),
      }, (props.current.grid.cellSizeM / 111_320) * 2);
    };

    const under = (latlng: L.LatLng): number[] => {
      const pt = { lat: latlng.lat, lng: latlng.lng };
      const cand = candidates();
      const brush = props.current.brushM;
      if (brush && brush > props.current.grid.cellSizeM * 0.5) {
        return cellsNear(props.current.grid.cells, cand, pt, brush);
      }
      const hit = cellAt(props.current.grid.cells, boundsRef.current, cand, pt);
      return hit === null ? [] : [hit];
    };

    const applyStroke = (idxs: number[]) => {
      const cells = props.current.grid.cells;
      const fresh = idxs.map(i => cells[i].id).filter(id => !stroked.has(id));
      if (!fresh.length) return;
      for (const id of fresh) stroked.add(id);
      props.current.onPaintCells(fresh);
    };

    const onMove = (e: L.LeafletMouseEvent) => {
      const idxs = under(e.latlng);
      const next = new Set(idxs);
      const prev = hoverRef.current;
      const changed = next.size !== prev.size || [...next].some(i => !prev.has(i));
      hoverRef.current = next;
      if (changed) redrawRef.current();
      if (painting) applyStroke(idxs);
    };

    const onDown = (e: L.LeafletMouseEvent) => {
      if (props.current.brushM === null) return;
      painting = true;
      stroked.clear();
      // Otherwise the map pans out from under the brush on the first drag.
      map.dragging.disable();
      applyStroke(under(e.latlng));
    };

    const stop = () => {
      if (!painting) return;
      painting = false;
      stroked.clear();
      map.dragging.enable();
    };

    const onClick = (e: L.LeafletMouseEvent) => {
      if (props.current.brushM !== null) return;   // painting already handled it
      const pt = { lat: e.latlng.lat, lng: e.latlng.lng };
      const hit = cellAt(props.current.grid.cells, boundsRef.current, candidates(), pt);
      props.current.onPickCell(hit === null ? null : props.current.grid.cells[hit].id);
    };

    const onOut = () => {
      if (!hoverRef.current.size) return;
      hoverRef.current = new Set();
      redrawRef.current();
    };

    map.on("mousemove", onMove);
    map.on("mousedown", onDown);
    map.on("mouseup", stop);
    map.on("mouseout", onOut);
    map.on("click", onClick);
    // A pointerup outside the map still ends the stroke — otherwise the brush
    // stays armed and the next hover paints without a click.
    window.addEventListener("pointerup", stop);
    return () => {
      map.off("mousemove", onMove);
      map.off("mousedown", onDown);
      map.off("mouseup", stop);
      map.off("mouseout", onOut);
      map.off("click", onClick);
      window.removeEventListener("pointerup", stop);
      if (painting) map.dragging.enable();
    };
  }, [map]);

  return null;
}

export default TreatmentGridLayer;
