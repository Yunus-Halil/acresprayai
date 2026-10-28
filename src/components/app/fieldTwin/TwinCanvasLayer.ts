// The Field Twin's one drawing surface: Leaflet's own canvas renderer, with its path list left empty and `_draw`
// replaced by a pass over the scene's index for the viewport. The renderer gives us what it already does well
// (the padded canvas, repositioning on drag, the zoom-animation transform, retina scaling, mouse events on the
// container); this class adds the scene, the detail rules, the heatmap, the findings layer, hit-testing and timing.
//
// Everything on the map is drawn here, in one canvas: nothing else is ever stacked over it, so a click always
// reaches the object under the cursor (the earlier version lost clicks to a second canvas, 2026-10-27).
//
// Cost rules (the map lagged once already): the heatmap is one drawImage per frame from a raster built once;
// circles and outlines are batched into one path per colour; the findings layer draws from bins built once per
// query, never from the whole list; no blur, no per-frame pattern fills over the viewport, no redraw on hover.
import L from "leaflet";
import { type Finding, type FindingsResult } from "@/lib/fieldTwin/findings";
import { type HeatLevels, type HeatRaster, buildHeatLevels, pickHeatLevel } from "@/lib/fieldTwin/heatmap";
import { type Detail, GridIndex, PRESSURE_INDEX, ROW_STATUS, type Scene, WEED_STATUS, detailFor, metresPerPixel, toWorld } from "@/lib/fieldTwin/scene";
import { type TwinLayers, TWIN_COLOURS as C, badgesAllowed } from "@/lib/fieldTwin/style";

export type TwinPick =
  | { kind: "tree"; id: number } | { kind: "weed"; id: number } | { kind: "vegetation"; id: number }
  | { kind: "cluster"; index: number; lat: number; lng: number; radiusM: number }
  | { kind: "zone"; id: number; lat: number; lng: number }
  /** A patch or region of the active findings list (weed findings select the weed itself). */
  | { kind: "finding"; index: number }
  /** Several findings summarised in one marker at this zoom: the map zooms in on it. */
  | { kind: "group"; lat: number; lng: number; count: number }
  | null;

export type DrawStats = { lastDrawMs: number; drawn: Record<string, number>; level: Detail["level"]; detail: Detail | null; draws: number; labels: { placed: number; emphasized: number; qualifying: number; binLevel: number | null } };

type Ctx = CanvasRenderingContext2D;

/** Leaflet's private renderer members this class relies on (Canvas.js, Renderer.js in leaflet 1.9). */
type Internals = {
  _map: L.Map & { _animatingZoom?: boolean; _draggableMoved: (l: unknown) => boolean };
  _ctx: Ctx;
  _container: HTMLCanvasElement;
  _bounds: L.Bounds;
  _redrawRequest: number | null;
  _redraw: () => void;
  _fireEvent: (layers: unknown[] | false, e: Event, type?: string) => void;
};

/** Screen-space bins of the findings at one integer zoom: built once per query, read every frame. */
type BinLevel = { zoom: number; sizeU: number; n: number; x: Float64Array; y: Float64Array; count: Int32Array; best: Int32Array; index: GridIndex };

/** The active findings, projected: world coordinates, boundaries, and the bins per zoom level. */
type FindingsScene = {
  result: FindingsResult;
  n: number;
  x: Float64Array;
  y: Float64Array;
  /** Reach in zoom-0 units. */
  reachU: Float32Array;
  /** The median reach (zoom-0 units): the size the typical finding draws at. */
  medianReachU: number;
  /** Boundaries per finding (zoom-0 units, flat x y pairs), or null. */
  rings: (Float64Array[] | null)[];
  index: GridIndex;
  levels: Map<number, BinLevel>;
  /** The finest level built; finer zooms draw straight from the points. */
  finest: number;
};

/** Marker bin size on screen at an integer zoom (it grows to twice this before the next level takes over). */
const BIN_PX = 44;
const LEVEL_MIN = 10, LEVEL_MAX = 26;

export class TwinCanvasLayer extends L.Canvas {
  scene: Scene | null = null;
  layers: TwinLayers;
  selection: TwinPick = null;
  hover: TwinPick = null;
  stats: DrawStats = { lastDrawMs: 0, drawn: {}, level: "field", detail: null, draws: 0, labels: { placed: 0, emphasized: 0, qualifying: 0, binLevel: null } };
  private heat: HeatLevels | null = null;
  private heatCanvas = new Map<HeatRaster, HTMLCanvasElement>();
  private hatch: CanvasPattern | null = null;
  private lastDetail: Detail | null = null;
  private onDetailChange: ((d: Detail) => void) | null = null;
  private findings: FindingsScene | null = null;
  private binLevel: number | null = null;

  constructor(layers: TwinLayers, options: L.RendererOptions = {}) {
    super({ padding: 0.25, tolerance: 6, ...options });
    this.layers = layers;
  }

  setScene(scene: Scene | null) {
    this.scene = scene;
    const t0 = performance.now();
    this.heat = scene ? buildHeatLevels(scene.intel) : null;
    try { performance.measure("twin:heatmap", { start: t0, end: performance.now() }); } catch { /* older browsers */ }
    this.heatCanvas.clear(); this.findings = null; this.firstDraw = true; this.requestRedraw();
  }
  private firstDraw = true;
  setLayers(layers: TwinLayers) { this.layers = layers; this.requestRedraw(); }
  setSelection(p: TwinPick) { this.selection = p; this.requestRedraw(); }
  watchDetail(cb: ((d: Detail) => void) | null) { this.onDetailChange = cb; }

  /** The findings to draw (markers, boundaries, labels), or none. Projection and bins are built here, once. */
  setFindings(result: FindingsResult | null) {
    const s = this.scene;
    if (!result || !s) { this.findings = null; this.requestRedraw(); return; }
    const F = result.findings, n = F.length;
    const x = new Float64Array(n), y = new Float64Array(n), reachU = new Float32Array(n);
    const rings: (Float64Array[] | null)[] = new Array(n);
    const frame = s.intel.frame;
    for (let i = 0; i < n; i++) {
      const f = F[i], [wx, wy] = toWorld(f.lat, f.lng);
      x[i] = wx; y[i] = wy; reachU[i] = f.reachM / s.mpu;
      rings[i] = f.rings ? f.rings.map(r => { const out = new Float64Array(r.length * 2); r.forEach(([e, no], k) => { const [lat, lng] = frame.toLatLng(e, no); const [px, py] = toWorld(lat, lng); out[2 * k] = px; out[2 * k + 1] = py; }); return out; }) : null;
    }
    const index = new GridIndex(x, y, 4 / s.mpu);
    const levels = new Map<number, BinLevel>();
    let finest = LEVEL_MIN - 1;
    const [bx0, by0] = [s.bbox[0], s.bbox[1]];
    for (let z = LEVEL_MIN; z <= LEVEL_MAX; z++) {
      const sizeU = BIN_PX / 2 ** z;
      const KEY = 1 << 24;
      const map = new Map<number, number>();
      const bxs: number[] = [], bys: number[] = [], counts: number[] = [], best: number[] = [];
      for (let i = 0; i < n; i++) {
        const bi = Math.floor((x[i] - bx0) / sizeU), bj = Math.floor((y[i] - by0) / sizeU), k = bi * KEY + bj;
        const b = map.get(k);
        if (b === undefined) { map.set(k, bxs.length); bxs.push(x[i]); bys.push(y[i]); counts.push(1); best.push(i); }
        else { bxs[b] += x[i]; bys[b] += y[i]; counts[b]++; }
      }
      const m = bxs.length, lx = new Float64Array(m), ly = new Float64Array(m);
      for (let b = 0; b < m; b++) { lx[b] = bxs[b] / counts[b]; ly[b] = bys[b] / counts[b]; }
      levels.set(z, { zoom: z, sizeU, n: m, x: lx, y: ly, count: Int32Array.from(counts), best: Int32Array.from(best), index: new GridIndex(lx, ly, sizeU * 4) });
      finest = z;
      // Once nearly every bin holds one finding, finer levels add nothing: the points themselves are drawn.
      if (m >= 0.9 * n) break;
    }
    const sortedReach = Float32Array.from(reachU).sort();
    this.findings = { result, n, x, y, reachU, medianReachU: n ? sortedReach[n >> 1] : 0, rings, index, levels, finest };
    this.binLevel = null;
    this.requestRedraw();
  }

  /** The detail the current zoom shows, without drawing. */
  detailNow(): Detail | null {
    const me = this as unknown as Internals;
    if (!me._map || !this.scene) return null;
    return detailFor(metresPerPixel(me._map.getZoom(), this.scene.twin.origin.lat), this.scene);
  }

  requestRedraw() {
    const me = this as unknown as Internals;
    if (!me._map || me._redrawRequest) return;
    me._redrawRequest = L.Util.requestAnimFrame(() => { me._redrawRequest = null; if (me._map?._animatingZoom) { this.requestRedraw(); return; } me._redraw(); }, this);
  }

  /** The bin level for a zoom, with hysteresis: it changes only once the zoom has clearly left the level's range. */
  private levelFor(zoom: number): number {
    const f = this.findings;
    if (!f) return Math.floor(zoom);
    const want = Math.max(LEVEL_MIN, Math.min(f.finest, Math.floor(zoom)));
    const cur = this.binLevel;
    if (cur == null || zoom > cur + 1.15 || zoom < cur - 0.15) this.binLevel = want;
    return Math.max(LEVEL_MIN, Math.min(f.finest, this.binLevel!));
  }

  /**
   * How the findings are marked at this detail, from the markers layer: whether count badges may summarise them
   * (only where they are not drawn as themselves, unless "all"), and whether only the emphasised ones get a
   * marker. Weeds are drawn as themselves once the row-level discs or the plant-level outlines are on screen;
   * patches once their boundaries read as shapes (the typical one at 4 px of reach). Shared by draw and pick.
   */
  private markerPolicy(d: Detail, zoom: number): { badges: boolean; emphasisedOnly: boolean; drawnAsThemselves: boolean } {
    const F = this.findings, L_ = this.layers, markers = L_.markers;
    if (!F) return { badges: false, emphasisedOnly: false, drawnAsThemselves: false };
    const mode = F.result.query.mode;
    const drawnAsThemselves = mode === "clusters" ? F.medianReachU * 2 ** zoom >= 4 : L_.weeds && (d.outlines >= 0.5 || (L_.clusters && d.clusters >= 0.5));
    const badges = badgesAllowed(markers, drawnAsThemselves);
    return { badges, emphasisedOnly: markers === "emphasised" || (markers === "summary" && drawnAsThemselves), drawnAsThemselves };
  }

  // ----------------------------------------------------------------------------------------------------------------
  // Drawing
  // ----------------------------------------------------------------------------------------------------------------

  /** Replaces L.Canvas._draw: the path list is empty, the scene is drawn instead. */
  _draw() {
    const me = this as unknown as Internals;
    const ctx = me._ctx, map = me._map, scene = this.scene;
    if (!ctx || !map || !scene) return;
    const t0 = performance.now();
    const zoom = map.getZoom(), scale = 2 ** zoom, origin = map.getPixelOrigin();
    const b = me._bounds, bx0 = b.min.x, by0 = b.min.y, bx1 = b.max.x, by1 = b.max.y;
    // Viewport in zoom-0 units.
    const vx0 = (bx0 + origin.x) / scale, vy0 = (by0 + origin.y) / scale, vx1 = (bx1 + origin.x) / scale, vy1 = (by1 + origin.y) / scale;
    const X = (u: number) => u * scale - origin.x, Y = (u: number) => u * scale - origin.y;
    const mpp = metresPerPixel(zoom, scene.twin.origin.lat), pxPerM = 1 / mpp;
    const d = detailFor(mpp, scene);
    const L_ = this.layers;
    const drawn: Record<string, number> = {};
    // The part of the canvas on screen (labels are kept inside it, not the padded margin).
    const tl = map.containerPointToLayerPoint([0, 0]), size = map.getSize();
    const sx0 = tl.x, sy0 = tl.y, sx1 = tl.x + size.x, sy1 = tl.y + size.y;
    ctx.save();
    ctx.lineJoin = "round";

    // 1. Ground: charcoal everywhere (fading out where the surroundings basemap shows through), the observed ground
    //    inside the imagery hull, the block warmer. Ground inside the hull that no photograph covered keeps a hatch
    //    (clipped to the hull, so the pattern never covers the viewport). Off entirely over reference imagery.
    if (L_.ground) {
      ctx.globalAlpha = 1 - (L_.surroundings ? d.surroundings : 0);
      if (ctx.globalAlpha > 0.01) { ctx.fillStyle = C.outside; ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0); }
      ctx.globalAlpha = 1;
      if (L_.coverage) {
        ctx.beginPath(); ring(ctx, scene.imagery, X, Y); ctx.fillStyle = C.imagery; ctx.fill();
        if (!this.hatch) this.hatch = makeHatch(ctx);
        if (this.hatch) { ctx.save(); ctx.beginPath(); ring(ctx, scene.imagery, X, Y); ctx.clip(); ctx.fillStyle = this.hatch; ctx.fillRect(Math.max(bx0, X(scene.bbox[0])), Math.max(by0, Y(scene.bbox[1])), Math.min(bx1, X(scene.bbox[2])) - Math.max(bx0, X(scene.bbox[0])), Math.min(by1, Y(scene.bbox[3])) - Math.max(by0, Y(scene.bbox[1]))); ctx.restore(); }
      }
      if (scene.block) { ctx.beginPath(); ring(ctx, scene.block, X, Y); ctx.fillStyle = C.soil; ctx.fill(); }
    }

    // 2. Weed pressure: the heatmap raster, one transformed drawImage. Full at the field level, lighter as the
    //    crowns and outlines come in (they are the measurement; the heatmap stays as context).
    if (L_.pressure && this.heat) {
      const raster = pickHeatLevel(this.heat, mpp);
      if (raster) {
        const canvas = this.heatCanvasFor(raster);
        if (canvas) {
          const fr = scene.intel.frame;
          const at = (px: number, py: number): [number, number] => { const [e, no] = fr.fromField(raster.along0 + px * raster.mPerPx, raster.across0 + py * raster.mPerPx); const [lat, lng] = fr.toLatLng(e, no); const [wx, wy] = toWorld(lat, lng); return [X(wx), Y(wy)]; };
          const p00 = at(0, 0), p10 = at(raster.width, 0), p01 = at(0, raster.height);
          ctx.save();
          ctx.globalAlpha = 0.15 + 0.85 * d.pressure;
          ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
          ctx.transform((p10[0] - p00[0]) / raster.width, (p10[1] - p00[1]) / raster.width, (p01[0] - p00[0]) / raster.height, (p01[1] - p00[1]) / raster.height, p00[0], p00[1]);
          ctx.drawImage(canvas, 0, 0);
          ctx.restore();
          drawn.heatmap = 1;
        }
      }
    }

    // 3. Uncertainty: ground only one photograph saw (no second view can verify a weed there).
    if (L_.uncertainty) {
      const r = scene.cells.rings;
      let n = 0;
      ctx.fillStyle = C.uncertain;
      ctx.beginPath();
      for (let k = 0; k < scene.cells.n; k++) {
        if (scene.cells.photos[k] >= 2) continue;
        const o = r.off[k];
        if (r.xy[o] < vx0 - 0.01 || r.xy[o] > vx1 + 0.01 || r.xy[o + 1] < vy0 - 0.01 || r.xy[o + 1] > vy1 + 0.01) continue;
        packed(ctx, r, k, X, Y); ctx.closePath(); n++;
      }
      ctx.fill();
      drawn.uncertain = n;
    }

    // 4. Boundaries: the imagery hull, the orchard block, the photo footprints (diagnostics).
    if (L_.footprints) {
      ctx.strokeStyle = C.footprint; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
      ctx.beginPath();
      for (let k = 0; k < scene.twin.footprints.length; k++) { packed(ctx, scene.footprints, k, X, Y); ctx.closePath(); }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (L_.coverage) { ctx.beginPath(); ring(ctx, scene.imagery, X, Y); ctx.strokeStyle = C.imageryEdge; ctx.lineWidth = 1; ctx.globalAlpha = 0.8; ctx.stroke(); ctx.globalAlpha = 1; }
    if (scene.block) { ctx.beginPath(); ring(ctx, scene.block, X, Y); ctx.strokeStyle = C.blockEdge; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.85; ctx.stroke(); ctx.globalAlpha = 1; }

    // 5. The field within its surroundings: a halo on the imagery hull and the field's name, while zoomed out.
    if (L_.surroundings && L_.ground && d.surroundings > 0.3) {
      ctx.globalAlpha = (d.surroundings - 0.3) / 0.7;
      ctx.beginPath(); ring(ctx, scene.imagery, X, Y);
      ctx.strokeStyle = C.fieldHalo; ctx.lineWidth = 1.5; ctx.stroke();
      const cx = (X(scene.bbox[0]) + X(scene.bbox[2])) / 2, top = Y(scene.bbox[1]) - 14;
      ctx.font = "600 12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const w = ctx.measureText(scene.twin.name).width + 14;
      ctx.fillStyle = C.labelBg; ctx.fillRect(cx - w / 2, top - 10, w, 20);
      ctx.fillStyle = C.labelText; ctx.fillText(scene.twin.name, cx, top);
      ctx.globalAlpha = 1;
    }

    // 6. Rows: one straight line each from first to last observed tree, quiet at the field level and firmer close
    //    in; dropped candidates dashed. One path per style.
    if (L_.structure) {
      // Without the crowns (the Simple stop) the rows are orientation, not structure: thinner and quieter.
      ctx.lineWidth = L_.crowns ? d.rowWidth : Math.max(1, d.rowWidth * 0.6);
      ctx.globalAlpha = L_.crowns ? 0.6 + 0.3 * d.crowns : 0.45 + 0.2 * d.crowns;
      let n = 0;
      for (const kept of [1, 0]) {
        if (!kept && !L_.droppedRows) continue;
        ctx.strokeStyle = kept ? C.row : C.rowDropped; ctx.setLineDash(kept ? [] : [8, 6]);
        ctx.beginPath();
        for (let k = 0; k < scene.rows.n; k++) { if (scene.rows.kept[k] !== kept) continue; ctx.moveTo(X(scene.rows.x1[k]), Y(scene.rows.y1[k])); ctx.lineTo(X(scene.rows.x2[k]), Y(scene.rows.y2[k])); n++; }
        ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      drawn.rows = n;
    }

    // 7. Trees: crowns at their measured radius, or points; inferred positions dashed. All crowns in one path.
    //    With the crowns layer off they still come in at the plant level, where they are the measurement.
    if (L_.structure && (L_.crowns || d.outlines >= 0.5)) {
      const T = scene.trees, pad = T.maxRM / scene.mpu;
      const idx = T.index.query(vx0, vy0, vx1, vy1, pad);
      if (d.crowns > 0.02) {
        ctx.globalAlpha = d.crowns;
        ctx.strokeStyle = C.tree; ctx.fillStyle = C.treeFill; ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (const k of idx) { const r = T.rM[k] * pxPerM, x = X(T.x[k]), y = Y(T.y[k]); ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 2 * Math.PI); }
        ctx.fill(); ctx.stroke();
        if (L_.inferred && d.inferred > 0.02) {
          ctx.globalAlpha = d.inferred * 0.9; ctx.strokeStyle = C.tree; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
          const r = scene.inferred.rM * pxPerM;
          ctx.beginPath();
          for (let k = 0; k < scene.inferred.n; k++) { const x = X(scene.inferred.x[k]), y = Y(scene.inferred.y[k]); if (x < bx0 - r || x > bx1 + r || y < by0 - r || y > by1 + r) continue; ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 2 * Math.PI); }
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      if (d.treePoints > 0.02) {
        ctx.globalAlpha = d.treePoints; ctx.fillStyle = C.tree;
        const r = Math.max(1.2, Math.min(3, (T.maxRM * pxPerM) / 2));
        ctx.beginPath();
        for (const k of idx) { const x = X(T.x[k]), y = Y(T.y[k]); ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 2 * Math.PI); }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      drawn.trees = idx.length;
    }

    // 8. Other vegetation: measured patches, at the plant level, one path.
    if (L_.vegetation && d.outlines > 0.02) {
      const V = scene.vegetation, idx = V.index.query(vx0, vy0, vx1, vy1, V.maxRM / scene.mpu);
      ctx.globalAlpha = d.outlines; ctx.strokeStyle = C.vegetation; ctx.fillStyle = C.vegetationFill; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const k of idx) { packed(ctx, V.rings, k, X, Y); ctx.closePath(); }
      ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;
      drawn.vegetation = idx.length;
    }

    // 9. Weeds: clusters at the row level, every measured outline at the plant level. Never dots.
    if (L_.weeds) {
      if (L_.clusters && d.clusters > 0.02) {
        const K = scene.clusters, idx = K.index.query(vx0, vy0, vx1, vy1, K.maxRM / scene.mpu);
        // Soft discs of the ground the candidates stand on, denser where more of them do: one path per density step.
        const steps = [2, 3, 4, 5, 6];
        for (let si = 0; si < steps.length; si++) {
          const lo = steps[si], hi = si + 1 < steps.length ? steps[si + 1] : Infinity;
          let any = false;
          ctx.beginPath();
          for (const k of idx) {
            const cnt = L_.singleView ? K.count[k] : K.verified[k];
            if (cnt < lo || cnt >= hi) continue;
            if (!L_.singleView && K.verified[k] === 0) continue;
            const x = X(K.x[k]), y = Y(K.y[k]), r = K.rM[k] * pxPerM;
            ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 2 * Math.PI); any = true;
          }
          if (!any) continue;
          ctx.fillStyle = C.weed; ctx.globalAlpha = d.clusters * Math.min(0.46, 0.12 + 0.06 * lo); ctx.fill();
          ctx.strokeStyle = C.weed; ctx.lineWidth = 1; ctx.globalAlpha = d.clusters * 0.4; ctx.stroke();
        }
        if (d.clusterLabels) {
          ctx.globalAlpha = d.clusters; ctx.font = "600 10px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = C.labelOnField;
          for (const k of idx) { if (K.count[k] < 2 || (!L_.singleView && K.verified[k] === 0)) continue; ctx.fillText(String(L_.singleView ? K.count[k] : K.verified[k]), X(K.x[k]), Y(K.y[k])); }
        }
        ctx.globalAlpha = 1;
        drawn.clusters = idx.length;
      }
      if (d.outlines > 0.02) {
        const W = scene.weeds, idx = W.index.query(vx0, vy0, vx1, vy1, W.maxRM / scene.mpu);
        ctx.lineWidth = 1.2;
        let n = 0;
        // One path per look: verified between rows, verified on a row, single sightings (dashed), on crowns.
        const groups: { test: (k: number) => boolean; colour: string; fillAlpha: number; dash: number[] }[] = [
          { test: k => W.status[k] === WEED_STATUS.verified && W.row[k] !== ROW_STATUS.onRow, colour: C.weed, fillAlpha: 0.3, dash: [] },
          { test: k => W.status[k] === WEED_STATUS.verified && W.row[k] === ROW_STATUS.onRow, colour: C.weedOnRow, fillAlpha: 0.3, dash: [] },
          { test: k => W.status[k] === WEED_STATUS.single && L_.singleView, colour: C.weedSingle, fillAlpha: 0.1, dash: [3, 3] },
          { test: k => W.status[k] === WEED_STATUS.onTree && L_.onTree, colour: C.weedOnTree, fillAlpha: 0.1, dash: [] },
        ];
        for (const g of groups) {
          let any = false;
          ctx.beginPath();
          for (const k of idx) {
            if (!g.test(k)) continue;
            const o = W.rings.off[k], e = W.rings.off[k + 1];
            if (e - o >= 6) packed(ctx, W.rings, k, X, Y); else { const r = Math.max(1.5, W.rM[k] * pxPerM), x = X(W.x[k]), y = Y(W.y[k]); ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 2 * Math.PI); }
            ctx.closePath(); any = true; n++;
          }
          if (!any) continue;
          ctx.fillStyle = g.colour; ctx.strokeStyle = g.colour; ctx.setLineDash(g.dash);
          ctx.globalAlpha = d.outlines * g.fillAlpha; ctx.fill();
          ctx.globalAlpha = d.outlines; ctx.stroke();
        }
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        drawn.weeds = n;
      }
    }

    // 10. Findings: boundaries of the regions and patches in the list, markers for every qualifying finding in
    //     view (summarised into count badges where they crowd), labels for the emphasised ones that fit.
    const labels = { placed: 0, emphasized: 0, qualifying: 0, binLevel: null as number | null };
    if (this.findings) this.drawFindings(ctx, this.findings, d, zoom, X, Y, pxPerM, vx0, vy0, vx1, vy1, sx0, sy0, sx1, sy1, drawn, labels);

    // 11. The selection ring, on this same canvas. (Hover only changes the cursor: a redraw per mouse move is what
    //     made the map drag its feet.)
    if (this.selection) {
      const g = this.geometryOf(this.selection);
      // The ring clears the object's own outline (its farthest point), not only the equal-area circle: an
      // irregular weed reaches well past that circle, and a ring through the plant reads as a mistake up close.
      if (g) { const reachPx = X(g[0] + g[3]) - X(g[0]); ctx.beginPath(); ctx.arc(X(g[0]), Y(g[1]), Math.max(6, g[2] * pxPerM + 4, reachPx + 5), 0, 2 * Math.PI); ctx.strokeStyle = C.selection; ctx.lineWidth = 2.5; ctx.stroke(); }
    }
    ctx.restore();
    this.stats = { lastDrawMs: performance.now() - t0, drawn, level: d.level, detail: d, draws: this.stats.draws + 1, labels };
    if (this.firstDraw) { this.firstDraw = false; try { performance.measure("twin:first-draw", { start: t0, end: performance.now() }); performance.mark("twin:first-draw"); } catch { /* older browsers */ } }
    if (!this.lastDetail || this.lastDetail.level !== d.level || Math.abs(this.lastDetail.mpp - d.mpp) > 1e-9) { this.lastDetail = d; this.onDetailChange?.(d); }
    this.fire("twindraw");
  }

  private heatCanvasFor(raster: HeatRaster): HTMLCanvasElement | null {
    let c = this.heatCanvas.get(raster);
    if (c) return c;
    try {
      c = document.createElement("canvas"); c.width = raster.width; c.height = raster.height;
      const g = c.getContext("2d"); if (!g) return null;
      g.putImageData(new ImageData(raster.data, raster.width, raster.height), 0, 0);
      this.heatCanvas.set(raster, c);
      return c;
    } catch { return null; }
  }

  private drawFindings(ctx: Ctx, F: FindingsScene, d: Detail, zoom: number, X: (u: number) => number, Y: (u: number) => number, pxPerM: number,
    vx0: number, vy0: number, vx1: number, vy1: number, sx0: number, sy0: number, sx1: number, sy1: number, drawn: Record<string, number>, labels: DrawStats["labels"]) {
    const res = F.result, emph = res.prominence.count, mode = res.query.mode, markers = this.layers.markers;
    labels.qualifying = F.n; labels.emphasized = emph;
    const regionMode = mode === "overview" || mode === "pressure" || mode === "extent";
    const colour = regionMode ? C.region : C.finding;
    const { badges, emphasisedOnly } = this.markerPolicy(d, zoom);
    const selIndex = this.selection?.kind === "finding" ? this.selection.index : this.selection?.kind === "weed" ? this.findingIndexOfWeed(this.selection.id) : -1;

    // Boundaries: every region in the list (they are the major affected areas); patches once they are big enough
    // to read as a shape. Emphasised ones firmer; the overview fades its outlines as the crowns come in.
    const ringAlpha = regionMode ? 0.35 + 0.65 * d.zones : 1;
    if (ringAlpha > 0.02) {
      let n = 0;
      for (const strong of [false, true]) {
        ctx.beginPath();
        let any = false;
        for (let i = 0; i < F.n; i++) {
          const rings = F.rings[i];
          if (!rings || (i < emph) !== strong) continue;
          if ((mode === "overview" || markers === "emphasised") && !strong) continue;
          if (X(F.x[i]) + F.reachU[i] * 2 ** zoom < X(vx0) || X(F.x[i]) - F.reachU[i] * 2 ** zoom > X(vx1) || Y(F.y[i]) + F.reachU[i] * 2 ** zoom < Y(vy0) || Y(F.y[i]) - F.reachU[i] * 2 ** zoom > Y(vy1)) continue;
          if (F.reachU[i] * 2 ** zoom < (res.findings[i].kind === "patch" ? 4 : 6)) continue;
          for (const r of rings) ring(ctx, r, X, Y);
          any = true; n++;
        }
        if (!any) continue;
        ctx.fillStyle = colour; ctx.globalAlpha = ringAlpha * (strong ? 0.16 : 0.06); ctx.fill("evenodd");
        ctx.strokeStyle = colour; ctx.lineWidth = strong ? 1.6 : 0.9; ctx.globalAlpha = ringAlpha * (strong ? 0.95 : 0.55); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      drawn.boundaries = n;
    }

    // Markers from the bins of this zoom's level (or the points themselves past the finest level).
    const level = this.levelFor(zoom);
    labels.binLevel = level;
    const lvl = regionMode ? undefined : F.levels.get(level);
    const scale = 2 ** zoom;
    type Mark = { x: number; y: number; count: number; best: number };
    const marks: Mark[] = [];
    if (badges && lvl && lvl.n < F.n) {
      lvl.index.each(vx0 - lvl.sizeU, vy0 - lvl.sizeU, vx1 + lvl.sizeU, vy1 + lvl.sizeU, b => marks.push({ x: X(lvl.x[b]), y: Y(lvl.y[b]), count: lvl.count[b], best: lvl.best[b] }));
    } else if (emphasisedOnly) {
      // Only the emphasised findings carry a marker: the others are on the map as themselves (or in the list).
      F.index.each(vx0, vy0, vx1, vy1, i => { if (i < emph) marks.push({ x: X(F.x[i]), y: Y(F.y[i]), count: 1, best: i }); });
    } else {
      F.index.each(vx0, vy0, vx1, vy1, i => marks.push({ x: X(F.x[i]), y: Y(F.y[i]), count: 1, best: i }));
    }
    // Single markers: a ring on the finding itself (amber for weeds and patches; regions already have their
    // boundary, so a region marker is its label only). Emphasised ones get a white ring too.
    ctx.lineWidth = 1.2;
    let singles = 0, groups = 0;
    for (const strong of [false, true]) {
      ctx.beginPath();
      let any = false;
      for (const m of marks) {
        if (m.count !== 1 || (m.best < emph) !== strong) continue;
        if (res.findings[m.best].kind === "region") continue;
        const r = Math.max(5, F.reachU[m.best] * scale + 3);
        ctx.moveTo(m.x + r, m.y); ctx.arc(m.x, m.y, r, 0, 2 * Math.PI); any = true; singles++;
      }
      if (!any) continue;
      ctx.strokeStyle = colour; ctx.globalAlpha = strong ? 1 : 0.7; ctx.lineWidth = strong ? 2 : 1.2; ctx.stroke();
      if (strong) { ctx.strokeStyle = C.selection; ctx.lineWidth = 0.8; ctx.globalAlpha = 0.9; ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    // Count badges: several findings in one marker. Their number is written; clicking one zooms in.
    ctx.font = "700 11px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const m of marks) {
      if (m.count < 2) continue;
      const r = 9 + 3 * Math.log10(m.count);
      ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = colour; ctx.globalAlpha = m.best < emph ? 0.95 : 0.75; ctx.fill();
      ctx.strokeStyle = C.labelBg; ctx.lineWidth = 1; ctx.globalAlpha = 1; ctx.stroke();
      ctx.fillStyle = C.labelOnField; ctx.fillText(m.count >= 1000 ? `${Math.round(m.count / 1000)}k` : String(m.count), m.x, m.y);
      groups++;
    }
    drawn.markers = singles; drawn.groups = groups;

    // Labels: for the emphasised findings, in rank order, each only where it does not collide with one already
    // placed and stays on screen. A marker holding several findings carries its top finding's label with "+n".
    const byBest = new Map<number, Mark>();
    for (const m of marks) if (m.best < emph && !byBest.has(m.best)) byBest.set(m.best, m);
    const placed: [number, number, number, number][] = [];
    ctx.font = "600 11px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const maxLabels = 80;
    for (let i = 0; i < emph && i < maxLabels; i++) {
      const m = byBest.get(i);
      if (!m) continue;
      const f = res.findings[i];
      const text = `${labelOf(f)}${m.count > 1 ? ` +${m.count - 1}` : ""}`;
      const w = ctx.measureText(text).width + 12, h = 18;
      const r = m.count > 1 ? 9 + 3 * Math.log10(m.count) : Math.max(5, F.reachU[i] * scale + 3);
      const x = m.x, y = m.y - r - 11;
      const rect: [number, number, number, number] = [x - w / 2 - 3, y - h / 2 - 3, x + w / 2 + 3, y + h / 2 + 3];
      if (rect[0] < sx0 || rect[2] > sx1 || rect[1] < sy0 || rect[3] > sy1) continue;
      if (placed.some(p => rect[0] < p[2] && rect[2] > p[0] && rect[1] < p[3] && rect[3] > p[1])) continue;
      placed.push(rect);
      ctx.fillStyle = i === selIndex ? C.selection : C.labelBg; ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.fillStyle = i === selIndex ? C.labelOnField : C.labelText; ctx.fillText(text, x, y);
    }
    labels.placed = placed.length;

    // The selected finding's boundary, if it has one, in white.
    if (selIndex >= 0 && F.rings[selIndex]) {
      ctx.beginPath(); for (const r of F.rings[selIndex]!) ring(ctx, r, X, Y);
      ctx.strokeStyle = C.selection; ctx.lineWidth = 2.5; ctx.globalAlpha = 1; ctx.stroke();
    }
    void pxPerM;
  }

  private findingIndexOfWeed(id: number): number {
    const F = this.findings;
    if (!F) return -1;
    for (let i = 0; i < F.n; i++) if (F.result.findings[i].kind === "weed" && F.result.findings[i].id === id) return i;
    return -1;
  }

  /** Centre (zoom-0 units), radius (metres) and outline reach (zoom-0 units, 0 without an outline) of a pick, for the highlight. */
  private geometryOf(p: TwinPick): [number, number, number, number] | null {
    const s = this.scene;
    if (!s || !p) return null;
    if (p.kind === "tree") { const k = indexOfId(s.trees.id, p.id); return k < 0 ? null : [s.trees.x[k], s.trees.y[k], s.trees.rM[k], 0]; }
    if (p.kind === "weed") { const k = indexOfId(s.weeds.id, p.id); return k < 0 ? null : [s.weeds.x[k], s.weeds.y[k], s.weeds.rM[k], reach(s.weeds.rings, k, s.weeds.x[k], s.weeds.y[k])]; }
    if (p.kind === "vegetation") { const k = indexOfId(s.vegetation.id, p.id); return k < 0 ? null : [s.vegetation.x[k], s.vegetation.y[k], s.vegetation.rM[k], reach(s.vegetation.rings, k, s.vegetation.x[k], s.vegetation.y[k])]; }
    if (p.kind === "cluster") return [s.clusters.x[p.index], s.clusters.y[p.index], s.clusters.rM[p.index], 0];
    return null;
  }

  // ----------------------------------------------------------------------------------------------------------------
  // Hit-testing: what is under a layer point at the current detail.
  // ----------------------------------------------------------------------------------------------------------------

  pickAt(point: L.Point): TwinPick {
    const me = this as unknown as Internals;
    const s = this.scene, map = me._map;
    if (!s || !map) return null;
    const d = detailFor(metresPerPixel(map.getZoom(), s.twin.origin.lat), s);
    const zoom = map.getZoom(), scale = 2 ** zoom, origin = map.getPixelOrigin();
    const x = (point.x + origin.x) / scale, y = (point.y + origin.y) / scale;
    const tol = (this.options as { tolerance?: number }).tolerance ?? 6, tolU = tol / scale, L_ = this.layers;
    const within = (cx: number, cy: number, rM: number) => Math.hypot(cx - x, cy - y) <= rM / s.mpu + tolU;
    // Findings markers first: they are what the user asked to see.
    const F = this.findings;
    if (F) {
      const regionMode = F.result.findings[0]?.kind === "region";
      const level = this.levelFor(zoom), lvl = regionMode ? undefined : F.levels.get(level);
      const policy = this.markerPolicy(d, zoom), emph = F.result.prominence.count;
      let best = -1, bd = Infinity, bestMark: { count: number; x: number; y: number; best: number } | null = null;
      const consider = (mx: number, my: number, count: number, bi: number) => {
        const rPx = count > 1 ? 9 + 3 * Math.log10(count) : Math.max(5, F.reachU[bi] * scale + 3);
        const dPx = Math.hypot((mx - x) * scale, (my - y) * scale);
        if (dPx <= rPx + tol && dPx < bd) { bd = dPx; best = bi; bestMark = { count, x: mx, y: my, best: bi }; }
      };
      const r = (60 + tol) / scale;
      if (policy.badges && lvl && lvl.n < F.n) lvl.index.each(x - r, y - r, x + r, y + r, b => consider(lvl.x[b], lvl.y[b], lvl.count[b], lvl.best[b]));
      else F.index.each(x - r, y - r, x + r, y + r, i => { if (!policy.emphasisedOnly || i < emph) consider(F.x[i], F.y[i], 1, i); });
      if (bestMark) {
        const bm = bestMark as { count: number; x: number; y: number; best: number };
        if (bm.count > 1) { const ll = map.unproject(L.point(bm.x * scale, bm.y * scale), zoom); return { kind: "group", lat: ll.lat, lng: ll.lng, count: bm.count }; }
        const f = F.result.findings[best];
        return f.kind === "weed" ? { kind: "weed", id: f.id } : { kind: "finding", index: best };
      }
      // Inside a boundary (region or patch); weed lists have none, so a million-row list is never walked here.
      if (F.result.findings[0]?.kind !== "weed") for (let i = 0; i < F.n; i++) { const rings = F.rings[i]; if (!rings) continue; if (Math.hypot(F.x[i] - x, F.y[i] - y) > F.reachU[i] * 1.2 + tolU) continue; if (inFlatRing(x, y, rings[0])) return { kind: "finding", index: i }; }
    }
    if (L_.weeds && d.outlines >= 0.5) {
      const idx = s.weeds.index.query(x - tolU, y - tolU, x + tolU, y + tolU, s.weeds.maxRM / s.mpu);
      let best = -1, bd = Infinity;
      for (const k of idx) {
        const st = s.weeds.status[k];
        if ((st === WEED_STATUS.onTree && !L_.onTree) || (st === WEED_STATUS.single && !L_.singleView)) continue;
        if (!within(s.weeds.x[k], s.weeds.y[k], s.weeds.rM[k])) continue;
        const dd = Math.hypot(s.weeds.x[k] - x, s.weeds.y[k] - y);
        if (dd < bd) { bd = dd; best = k; }
      }
      if (best >= 0) return { kind: "weed", id: s.weeds.id[best] };
    }
    if (L_.structure && (d.crowns >= 0.5 || d.treePoints >= 0.5)) {
      const k = s.trees.index.nearest(x, y, (d.crowns >= 0.5 ? s.trees.maxRM : 0.6) / s.mpu + tolU);
      if (k >= 0 && (d.crowns < 0.5 || within(s.trees.x[k], s.trees.y[k], s.trees.rM[k]))) return { kind: "tree", id: s.trees.id[k] };
    }
    if (L_.vegetation && d.outlines >= 0.5) {
      const k = s.vegetation.index.nearest(x, y, s.vegetation.maxRM / s.mpu);
      if (k >= 0 && within(s.vegetation.x[k], s.vegetation.y[k], s.vegetation.rM[k])) return { kind: "vegetation", id: s.vegetation.id[k] };
    }
    if (L_.weeds && d.clusters >= 0.5) {
      const k = s.clusters.index.nearest(x, y, s.clusters.maxRM / s.mpu + tolU);
      if (k >= 0 && (L_.singleView || s.clusters.verified[k] > 0) && within(s.clusters.x[k], s.clusters.y[k], s.clusters.rM[k])) {
        const ll = map.unproject(L.point(s.clusters.x[k] * scale, s.clusters.y[k] * scale), zoom);
        return { kind: "cluster", index: k, lat: ll.lat, lng: ll.lng, radiusM: s.clusters.rM[k] };
      }
    }
    return null;
  }

  // Leaflet's canvas event hooks, pointed at the scene instead of the (empty) path list.
  _onClick(e: MouseEvent) {
    const me = this as unknown as Internals;
    if (!me._map) return;
    if (e.type === "click" && me._map._draggableMoved(this)) return;
    if (e.type !== "click") return;
    const pick = this.pickAt(me._map.mouseEventToLayerPoint(e));
    this.fire("twinclick", { pick, originalEvent: e });
    L.DomEvent.stop(e);
  }
  private hoverPending = false;
  _onMouseMove(e: MouseEvent) {
    const me = this as unknown as Internals;
    if (!me._map || this.hoverPending || (me._map.dragging as unknown as { moving: () => boolean }).moving() || me._map._animatingZoom) return;
    // At most one hit-test per animation frame; the result only sets the cursor.
    this.hoverPending = true;
    L.Util.requestAnimFrame(() => {
      this.hoverPending = false;
      if (!me._map || !me._container) return;
      const pick = this.pickAt(me._map.mouseEventToLayerPoint(e));
      const was = !!this.hover;
      this.hover = pick;
      if (!!pick !== was) { me._container.style.cursor = pick ? "pointer" : ""; this.fire("twinhover", { pick }); }
    });
  }
  _handleMouseOut() {
    const me = this as unknown as Internals;
    if (!this.hover) return;
    this.hover = null;
    if (me._container) me._container.style.cursor = "";
    this.fire("twinhover", { pick: null });
  }
}

/** The short text on a finding's label: its rank and the quantity it is ranked by. */
function labelOf(f: Finding): string {
  const kind = f.kind === "region" ? "Region" : f.kind === "patch" ? "Patch" : "Weed";
  switch (f.valueOf) {
    case "weed area m2": case "footprint m2": return `${kind} ${f.id} · ${f.value < 1 ? `${Math.round(f.value * 10_000)} cm²` : `${f.value.toFixed(1)} m²`}`;
    case "affected ground m2": case "verified cover m2": return `${kind} ${f.id} · ${f.value >= 10_000 ? `${(f.value / 10_000).toFixed(2)} ha` : `${Math.round(f.value)} m²`}`;
    case "cover % of observable ground": return `${kind} ${f.id} · ${f.value.toFixed(1)} %`;
    case "model score": return `${kind} ${f.id} · ${Math.round(f.value * 100)} %`;
  }
}

function indexOfId(ids: Int32Array, id: number): number { for (let i = 0; i < ids.length; i++) if (ids[i] === id) return i; return -1; }

function ring(ctx: Ctx, xy: Float64Array, X: (u: number) => number, Y: (u: number) => number) {
  for (let i = 0; i < xy.length; i += 2) { if (i === 0) ctx.moveTo(X(xy[0]), Y(xy[1])); else ctx.lineTo(X(xy[i]), Y(xy[i + 1])); }
  ctx.closePath();
}
function inFlatRing(x: number, y: number, xy: Float64Array): boolean {
  let inside = false;
  const n = xy.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = xy[2 * i], yi = xy[2 * i + 1], xj = xy[2 * j], yj = xy[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** The farthest point of an outline from a centre, in the outline's own (zoom-0) units. */
function reach(r: { xy: Float64Array; off: Int32Array }, k: number, cx: number, cy: number): number {
  let m = 0;
  for (let i = r.off[k]; i < r.off[k + 1]; i += 2) m = Math.max(m, Math.hypot(r.xy[i] - cx, r.xy[i + 1] - cy));
  return m;
}
function packed(ctx: Ctx, r: { xy: Float64Array; off: Int32Array }, k: number, X: (u: number) => number, Y: (u: number) => number) {
  const o = r.off[k], e = r.off[k + 1];
  for (let i = o; i < e; i += 2) { if (i === o) ctx.moveTo(X(r.xy[i]), Y(r.xy[i + 1])); else ctx.lineTo(X(r.xy[i]), Y(r.xy[i + 1])); }
}
/** A faint diagonal hatch for ground no photograph covered. */
function makeHatch(ctx: Ctx): CanvasPattern | null {
  try {
    const c = document.createElement("canvas"); c.width = 12; c.height = 12;
    const g = c.getContext("2d"); if (!g) return null;
    g.strokeStyle = C.hatch; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 12); g.lineTo(12, 0); g.stroke();
    return ctx.createPattern(c, "repeat");
  } catch { return null; }
}
export const PRESSURE_CLASSES = PRESSURE_INDEX;
