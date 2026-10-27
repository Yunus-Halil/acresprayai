// The Field Twin's one drawing surface: Leaflet's own canvas renderer, with its path list left empty and `_draw`
// replaced by a pass over the scene's index for the viewport. The renderer gives us what it already does well
// (the padded canvas, repositioning on drag, the zoom-animation transform, retina scaling, mouse events on the
// container); this class adds the scene, the detail rules, hit-testing and timing.
//
// Everything on the map is drawn here, in one canvas: nothing else is ever stacked over it, so a click always
// reaches the object under the cursor (the earlier version lost clicks to a second canvas, 2026-10-27).
import L from "leaflet";
import { type Detail, PRESSURE_INDEX, ROW_STATUS, type Scene, WEED_STATUS, detailFor, metresPerPixel } from "@/lib/fieldTwin/scene";
import { type TwinLayers, TWIN_COLOURS as C } from "@/lib/fieldTwin/style";

export type TwinPick = { kind: "tree"; id: number } | { kind: "weed"; id: number } | { kind: "vegetation"; id: number } | { kind: "cluster"; index: number; lat: number; lng: number; radiusM: number } | { kind: "zone"; id: number; lat: number; lng: number } | null;

export type DrawStats = { lastDrawMs: number; drawn: Record<string, number>; level: Detail["level"]; detail: Detail | null; draws: number };

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

export class TwinCanvasLayer extends L.Canvas {
  scene: Scene | null = null;
  layers: TwinLayers;
  selection: TwinPick = null;
  hover: TwinPick = null;
  stats: DrawStats = { lastDrawMs: 0, drawn: {}, level: "field", detail: null, draws: 0 };
  private hatch: CanvasPattern | null = null;
  private lastDetail: Detail | null = null;
  private onDetailChange: ((d: Detail) => void) | null = null;

  constructor(layers: TwinLayers, options: L.RendererOptions = {}) {
    super({ padding: 0.35, tolerance: 6, ...options });
    this.layers = layers;
  }

  setScene(scene: Scene | null) { this.scene = scene; this.requestRedraw(); }
  setLayers(layers: TwinLayers) { this.layers = layers; this.requestRedraw(); }
  setSelection(p: TwinPick) { this.selection = p; this.requestRedraw(); }
  watchDetail(cb: ((d: Detail) => void) | null) { this.onDetailChange = cb; }

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
    ctx.save();
    ctx.lineJoin = "round";

    // 1. Ground: charcoal everywhere (fading out where the surroundings basemap shows through), hatched where no
    //    photograph looked, olive where photographs did, soil in the block. Off entirely over reference imagery.
    if (L_.ground) {
      ctx.globalAlpha = 1 - (L_.surroundings ? d.surroundings : 0);
      ctx.fillStyle = C.outside;
      ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
      if (L_.coverage) {
        if (!this.hatch) this.hatch = makeHatch(ctx);
        if (this.hatch) { ctx.fillStyle = this.hatch; ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0); }
      }
      ctx.globalAlpha = 1;
      if (L_.coverage) { ctx.beginPath(); ring(ctx, scene.imagery, X, Y); ctx.fillStyle = C.imagery; ctx.fill(); }
      if (scene.block) { ctx.beginPath(); ring(ctx, scene.block, X, Y); ctx.fillStyle = C.soil; ctx.fill(); }
    }

    // 2. Weed pressure: a faint wash of one hue, its strength the cover averaged over neighbouring cells, so the
    //    field reads as regions of more and less rather than a grid. Faded by the detail rule.
    if (L_.pressure && d.pressure > 0.02) {
      const r = scene.cells.rings;
      let n = 0;
      // Plain fills: the 3 x 3 smoothing already takes the grid out of it, and a canvas blur cost more than every
      // other step together (laggy on a real screen, 2026-10-27).
      ctx.fillStyle = C.pressureWash;
      for (let k = 0; k < scene.cells.n; k++) {
        const v = scene.cells.smoothPct[k];
        if (v < 0.05) continue;
        const o = r.off[k];
        if (r.xy[o] < vx0 - 0.01 || r.xy[o] > vx1 + 0.01 || r.xy[o + 1] < vy0 - 0.01 || r.xy[o + 1] > vy1 + 0.01) continue;
        ctx.beginPath(); packed(ctx, r, k, X, Y);
        ctx.globalAlpha = d.pressure * Math.min(0.34, 0.05 + 0.065 * v);
        ctx.fill();
        n++;
      }
      ctx.globalAlpha = 1;
      drawn.cells = n;
    }

    // 3. Uncertainty: ground only one photograph saw (no second view can verify a weed there).
    if (L_.uncertainty) {
      const r = scene.cells.rings;
      let n = 0;
      ctx.fillStyle = C.uncertain;
      for (let k = 0; k < scene.cells.n; k++) {
        if (scene.cells.photos[k] >= 2) continue;
        const o = r.off[k];
        if (r.xy[o] < vx0 - 0.01 || r.xy[o] > vx1 + 0.01 || r.xy[o + 1] < vy0 - 0.01 || r.xy[o + 1] > vy1 + 0.01) continue;
        ctx.beginPath(); packed(ctx, r, k, X, Y); ctx.fill(); n++;
      }
      drawn.uncertain = n;
    }

    // 4. Boundaries: the orchard block, the imagery hull, the photo footprints (diagnostics).
    if (L_.footprints) {
      ctx.strokeStyle = C.footprint; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
      for (let k = 0; k < scene.twin.footprints.length; k++) { ctx.beginPath(); packed(ctx, scene.footprints, k, X, Y); ctx.closePath(); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    if (L_.coverage) { ctx.beginPath(); ring(ctx, scene.imagery, X, Y); ctx.strokeStyle = C.imageryEdge; ctx.lineWidth = 1; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]); }
    if (scene.block) { ctx.beginPath(); ring(ctx, scene.block, X, Y); ctx.strokeStyle = C.blockEdge; ctx.lineWidth = 1.5; ctx.stroke(); }

    // 6. Scouting zones: filled regions with rounded edges, coloured by priority, labels on the ones that matter.
    //    The region is the zone's own cells (chained and corner-rounded); nothing is merged for looks.
    if (L_.zones && d.zones > 0.02) {
      let n = 0;
      for (let p = 3; p >= 1; p--) for (const z of scene.zones) {
        if (z.priority !== p || !z.rings.length) continue;
        ctx.beginPath();
        for (const r of z.rings) ring(ctx, r, X, Y);
        ctx.fillStyle = C.zoneFill[p]; ctx.globalAlpha = d.zones * (p === 1 ? 0.36 : p === 2 ? 0.28 : 0.2); ctx.fill("evenodd");
        ctx.strokeStyle = C.zoneEdge[p]; ctx.lineWidth = p === 1 ? 1.2 : 0.8; ctx.globalAlpha = d.zones * 0.7; ctx.stroke();
        n++;
      }
      if (d.zoneLabels) {
        ctx.font = "600 11px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        for (const z of scene.zones) {
          if (z.priority === 3 || (z.priority === 2 && !d.zoneLabelsAll)) continue;
          const x = X(z.cx), y = Y(z.cy);
          if (x < bx0 || x > bx1 || y < by0 || y > by1) continue;
          const text = `Zone ${z.id}`;
          const w = ctx.measureText(text).width + 12;
          ctx.globalAlpha = d.zones;
          ctx.fillStyle = C.labelBg; ctx.fillRect(x - w / 2, y - 9, w, 18);
          ctx.fillStyle = C.labelText; ctx.fillText(text, x, y);
        }
      }
      ctx.globalAlpha = 1;
      drawn.zones = n;
    }
    // 6b. The field within its surroundings: a halo on the imagery hull and the field's name, while zoomed out.
    if (L_.surroundings && L_.ground && d.surroundings > 0.3) {
      ctx.globalAlpha = (d.surroundings - 0.3) / 0.7;
      ctx.beginPath(); ring(ctx, scene.imagery, X, Y);
      ctx.strokeStyle = C.fieldHalo; ctx.lineWidth = 2; ctx.stroke();
      const cx = (X(scene.bbox[0]) + X(scene.bbox[2])) / 2, top = Y(scene.bbox[1]) - 14;
      ctx.font = "600 12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const w = ctx.measureText(scene.twin.name).width + 14;
      ctx.fillStyle = C.labelBg; ctx.fillRect(cx - w / 2, top - 10, w, 20);
      ctx.fillStyle = C.labelText; ctx.fillText(scene.twin.name, cx, top);
      ctx.globalAlpha = 1;
    }

    // 5. Rows: one straight line each, quiet at the field level and firmer close in; dropped candidates dashed.
    if (L_.structure) {
      ctx.lineWidth = d.rowWidth;
      ctx.globalAlpha = 0.45 + 0.4 * d.crowns;
      let n = 0;
      for (let k = 0; k < scene.rows.n; k++) {
        const kept = scene.rows.kept[k] === 1;
        if (!kept && !L_.droppedRows) continue;
        ctx.strokeStyle = kept ? C.row : C.rowDropped; ctx.setLineDash(kept ? [] : [8, 6]);
        ctx.beginPath(); ctx.moveTo(X(scene.rows.x1[k]), Y(scene.rows.y1[k])); ctx.lineTo(X(scene.rows.x2[k]), Y(scene.rows.y2[k])); ctx.stroke(); n++;
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      drawn.rows = n;
    }

    // 7. Trees: crowns at their measured radius, or points; inferred positions dashed.
    if (L_.structure) {
      const T = scene.trees, pad = T.maxRM / scene.mpu;
      const idx = T.index.query(vx0, vy0, vx1, vy1, pad);
      if (d.crowns > 0.02) {
        ctx.globalAlpha = d.crowns;
        ctx.strokeStyle = C.tree; ctx.fillStyle = C.treeFill; ctx.lineWidth = 1.5;
        for (const k of idx) { const r = T.rM[k] * pxPerM; ctx.beginPath(); ctx.arc(X(T.x[k]), Y(T.y[k]), r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); }
        if (L_.inferred && d.inferred > 0.02) {
          ctx.globalAlpha = d.inferred * 0.9; ctx.strokeStyle = C.tree; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
          const r = scene.inferred.rM * pxPerM;
          for (let k = 0; k < scene.inferred.n; k++) { const x = X(scene.inferred.x[k]), y = Y(scene.inferred.y[k]); if (x < bx0 - r || x > bx1 + r || y < by0 - r || y > by1 + r) continue; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.stroke(); }
          ctx.setLineDash([]);
        }
      }
      if (d.treePoints > 0.02) {
        ctx.globalAlpha = d.treePoints; ctx.fillStyle = C.tree;
        const r = Math.max(1.2, Math.min(3, (T.maxRM * pxPerM) / 2));
        for (const k of idx) { ctx.beginPath(); ctx.arc(X(T.x[k]), Y(T.y[k]), r, 0, 2 * Math.PI); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      drawn.trees = idx.length;
    }

    // 8. Other vegetation: measured patches, at the plant level.
    if (L_.vegetation && d.outlines > 0.02) {
      const V = scene.vegetation, idx = V.index.query(vx0, vy0, vx1, vy1, V.maxRM / scene.mpu);
      ctx.globalAlpha = d.outlines; ctx.strokeStyle = C.vegetation; ctx.fillStyle = C.vegetationFill; ctx.lineWidth = 1;
      for (const k of idx) { ctx.beginPath(); packed(ctx, V.rings, k, X, Y); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      ctx.globalAlpha = 1;
      drawn.vegetation = idx.length;
    }

    // 9. Weeds: clusters at the row level, every measured outline at the plant level. Never dots.
    if (L_.weeds) {
      if (d.clusters > 0.02) {
        const K = scene.clusters, idx = K.index.query(vx0, vy0, vx1, vy1, K.maxRM / scene.mpu);
        ctx.globalAlpha = d.clusters;
        for (const k of idx) {
          if (!L_.singleView && K.verified[k] === 0) continue;
          // A lone candidate is not a patch: it waits for the plant level, where its outline is drawn.
          if ((L_.singleView ? K.count[k] : K.verified[k]) < 2) continue;
          const x = X(K.x[k]), y = Y(K.y[k]), r = K.rM[k] * pxPerM;
          ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
          // A soft disc: the ground the candidates stand on, denser where more of them do.
          ctx.globalAlpha = d.clusters * Math.min(0.42, 0.1 + 0.06 * Math.min(6, K.count[k]));
          ctx.fillStyle = K.verified[k] ? C.weed : C.weedSingle; ctx.fill();
          ctx.globalAlpha = d.clusters * 0.35; ctx.strokeStyle = K.verified[k] ? C.weed : C.weedSingle; ctx.lineWidth = 1; ctx.stroke();
          ctx.globalAlpha = d.clusters;
        }
        if (d.clusterLabels) {
          ctx.font = "600 10px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = C.labelOnField;
          for (const k of idx) { if (K.count[k] < 2 || (!L_.singleView && K.verified[k] === 0)) continue; ctx.fillText(String(L_.singleView ? K.count[k] : K.verified[k]), X(K.x[k]), Y(K.y[k])); }
        }
        ctx.globalAlpha = 1;
        drawn.clusters = idx.length;
      }
      if (d.outlines > 0.02) {
        const W = scene.weeds, idx = W.index.query(vx0, vy0, vx1, vy1, W.maxRM / scene.mpu);
        ctx.globalAlpha = d.outlines; ctx.lineWidth = 1.2;
        let n = 0;
        for (const k of idx) {
          const st = W.status[k];
          if (st === WEED_STATUS.onTree) { if (!L_.onTree) continue; }
          else if (st === WEED_STATUS.single && !L_.singleView) continue;
          const col = st === WEED_STATUS.onTree ? C.weedOnTree : st === WEED_STATUS.single ? C.weedSingle : W.row[k] === ROW_STATUS.onRow ? C.weedOnRow : C.weed;
          ctx.strokeStyle = col; ctx.fillStyle = col;
          ctx.setLineDash(st === WEED_STATUS.single ? [3, 3] : []);
          const o = W.rings.off[k], e = W.rings.off[k + 1];
          ctx.beginPath();
          if (e - o >= 6) packed(ctx, W.rings, k, X, Y); else ctx.arc(X(W.x[k]), Y(W.y[k]), Math.max(1.5, W.rM[k] * pxPerM), 0, 2 * Math.PI);
          ctx.closePath();
          ctx.globalAlpha = d.outlines * (st === WEED_STATUS.verified ? 0.28 : 0.1); ctx.fill();
          ctx.globalAlpha = d.outlines; ctx.stroke();
          n++;
        }
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        drawn.weeds = n;
      }
    }

    // 10. The selection ring, on this same canvas. (Hover only changes the cursor: a redraw per mouse move is what
    //     made the map drag its feet.)
    if (this.selection) {
      const g = this.geometryOf(this.selection);
      if (g) { ctx.beginPath(); ctx.arc(X(g[0]), Y(g[1]), Math.max(6, g[2] * pxPerM + 4), 0, 2 * Math.PI); ctx.strokeStyle = C.selection; ctx.lineWidth = 2.5; ctx.stroke(); }
    }
    ctx.restore();
    this.stats = { lastDrawMs: performance.now() - t0, drawn, level: d.level, detail: d, draws: this.stats.draws + 1 };
    if (!this.lastDetail || this.lastDetail.level !== d.level || Math.abs(this.lastDetail.mpp - d.mpp) > 1e-9) { this.lastDetail = d; this.onDetailChange?.(d); }
  }

  /** Centre and radius (metres) of a pick, zoom-0 units, for the highlight. */
  private geometryOf(p: TwinPick): [number, number, number] | null {
    const s = this.scene;
    if (!s || !p) return null;
    if (p.kind === "tree") { const k = indexOfId(s.trees.id, p.id); return k < 0 ? null : [s.trees.x[k], s.trees.y[k], s.trees.rM[k]]; }
    if (p.kind === "weed") { const k = indexOfId(s.weeds.id, p.id); return k < 0 ? null : [s.weeds.x[k], s.weeds.y[k], s.weeds.rM[k]]; }
    if (p.kind === "vegetation") { const k = indexOfId(s.vegetation.id, p.id); return k < 0 ? null : [s.vegetation.x[k], s.vegetation.y[k], s.vegetation.rM[k]]; }
    if (p.kind === "cluster") return [s.clusters.x[p.index], s.clusters.y[p.index], s.clusters.rM[p.index]];
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
    if (L_.zones && d.zones >= 0.5) {
      for (const z of s.zones) {
        if (z.priority === 3 && d.zones < 0.9) continue;
        // Inside the zone: the point's cell is one of the zone's cells (a cell holds the point when its ring does).
        const cellU = s.intel.grid.cellM / s.mpu;
        if (Math.hypot(z.cx - x, z.cy - y) > Math.sqrt(z.areaM2) / s.mpu + cellU) continue;
        const ll = map.unproject(L.point(x * scale, y * scale), zoom);
        const [e, n] = s.intel.frame.toLocal(ll.lat, ll.lng);
        const [al, ac] = s.intel.frame.toField(e, n);
        const i = Math.floor(al / s.intel.grid.cellM), j = Math.floor(ac / s.intel.grid.cellM);
        if (s.intel.zones[z.id - 1]?.cells.some(c => c.i === i && c.j === j)) { const cz = map.unproject(L.point(z.cx * scale, z.cy * scale), zoom); return { kind: "zone", id: z.id, lat: cz.lat, lng: cz.lng }; }
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

function indexOfId(ids: Int32Array, id: number): number { for (let i = 0; i < ids.length; i++) if (ids[i] === id) return i; return -1; }

function ring(ctx: Ctx, xy: Float64Array, X: (u: number) => number, Y: (u: number) => number) {
  for (let i = 0; i < xy.length; i += 2) { if (i === 0) ctx.moveTo(X(xy[0]), Y(xy[1])); else ctx.lineTo(X(xy[i]), Y(xy[i + 1])); }
  ctx.closePath();
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
