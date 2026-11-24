// Plots on a corn twin (2026-11-23, founder only for now): the Plots card in the left column, the three ways to draw
// one on the map (a polygon; a rectangle square to the rows; snapped to the rows), naming, colour, saving, editing,
// moving, deleting, and the numbers for a plot, live while it is drawn (plots.ts). Plots are saved on this device
// (plotStore.ts) as rings of latitude / longitude points: they belong to the ground, not to this flight.
//
// Also the weed patches' numbered pins on the map (cornPatches.ts), which the corn panel's "What to look at" flies to.
import L from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LatLngPair } from "@/lib/fieldTwin/types";
import { PLOT_COLOURS, type Plot, type PlotBox, type PlotContext, type PlotNumbers, type PlotShape, acOf, boxIn, boxRing, fmtAcres, fmtFt, fmtIn, fmtPct, fmtPerAcre, measurePlot, rowsAt, snapRows } from "@/lib/fieldTwin/plots";
import { loadPlots, nextPlotNumber, savePlots } from "@/lib/fieldTwin/plotStore";
import { newUid } from "@/lib/fieldTwin/rowEdits";
import { WEED_PATCH_COLOUR, type WeedPatch } from "@/lib/fieldTwin/cornPatches";
import { fmtPerAcreShort, plotNumberTone } from "@/lib/fieldTwin/simpleView";

const panel = "rounded-md border border-[#343834] bg-[#171a17]";
type Tool = "polygon" | "rectangle" | "rows";
const TOOL_LABEL: Record<Tool, string> = { polygon: "Polygon", rectangle: "Rectangle", rows: "Snap to rows" };
const TOOL_HINT: Record<Tool, string> = {
  polygon: "Click to place each corner. Click the first corner, or double-click, to close it.",
  rectangle: "Press and drag across the field: the rectangle stays square to the rows.",
  rows: "Press on a row, drag across to pick the rows and along to pick the length.",
};
type Draft = { ring: LatLngPair[]; shape: PlotShape };
type Mode = { kind: "idle" } | { kind: "drawing"; tool: Tool } | { kind: "naming"; draft: Draft } | { kind: "editing"; uid: string; draft: Draft };

const PANE = "twinPlots";
/** A map still on the page: the twin's map is made again when its scene changes (a boundary corrected; a hot reload),
 * and an effect must not draw on the one just removed (Leaflet clears its container id on remove). */
const alive = (map: L.Map | null): map is L.Map => !!map && (map as unknown as { _containerId?: number })._containerId != null && !!map.getPane("mapPane");
/** Take layers off a map that may have gone meanwhile. */
const drop = (l: L.Layer) => { try { l.remove(); } catch { /* the map went first */ } };
function paneOf(map: L.Map): { pane: string; renderer: L.Renderer } {
  if (!map.getPane(PANE)) map.createPane(PANE).style.zIndex = "450";
  const m = map as L.Map & { __plotRenderer?: L.Renderer };
  if (!m.__plotRenderer) m.__plotRenderer = L.svg({ pane: PANE });
  return { pane: PANE, renderer: m.__plotRenderer };
}
/**
 * The Simple view's plot: an outline in the plot's own colour (the one picked when it was saved; brighter and thicker
 * when selected), its label on its top edge (the name, then plants per acre in green or amber). Until 2026-11-24 every
 * plot was drawn in one blue here, whatever colour was picked: his report, "I make my plot purple and when I save it
 * turns blue".
 */
const TONE = { green: "#4ade80", amber: "#f0a63a" };
/** A plot's outline in the Simple view: its own colour, lightened toward white and thicker when selected. */
export function simpleOutline(colour: string, on: boolean): { stroke: string; weight: number } {
  const m = /^#([0-9a-f]{6})$/i.exec(colour);
  if (!m || !on) return { stroke: colour, weight: on ? 3 : 1.5 };
  const v = parseInt(m[1], 16), lift = (c: number) => Math.round(c + (255 - c) * 0.45).toString(16).padStart(2, "0");
  return { stroke: `#${lift((v >> 16) & 255)}${lift((v >> 8) & 255)}${lift(v & 255)}`, weight: 3 };
}
/** Where a plot's label sits: its top-most corner (the western one of two as high as each other). */
function topCorner(ring: LatLngPair[]): LatLngPair {
  const top = Math.max(...ring.map(p => p[0])), span = Math.max(1e-9, top - Math.min(...ring.map(p => p[0])));
  return ring.filter(p => top - p[0] <= 0.02 * span).reduce((b, p) => (p[1] < b[1] ? p : b));
}
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const labelIcon = (name: string, number: string | null, tone: "green" | "amber", on: boolean, colour: string) => L.divIcon({ className: "", iconSize: [0, 0], iconAnchor: [0, 0], html: `<div style="position:absolute;left:-1px;bottom:3px;white-space:nowrap;cursor:pointer;background:rgba(0,0,0,.82);border:1px solid ${simpleOutline(colour, on).stroke};color:${simpleOutline(colour, on).stroke};font:${on ? 700 : 600} 11px system-ui,sans-serif;padding:1px 5px;border-radius:2px">${esc(name)}${number ? ` <span style="color:#6b7280">·</span> <span style="color:${TONE[tone]}">${number}</span>` : ""}</div>` });
const centroid = (ring: LatLngPair[]): LatLngPair => [ring.reduce((t, p) => t + p[0], 0) / ring.length, ring.reduce((t, p) => t + p[1], 0) / ring.length];
const numberIcon = (n: number | string, colour: string, on: boolean) => L.divIcon({ className: "", iconSize: [24, 24], iconAnchor: [12, 12], html: `<div style="width:24px;height:24px;border-radius:50%;background:${colour};color:#1b1d1b;font:800 12px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;border:2px solid #1b1d1b;box-shadow:${on ? "0 0 0 3px #fff,0 0 14px rgba(255,255,255,.6)" : "0 0 0 2px rgba(0,0,0,.35)"};cursor:pointer">${n}</div>` });
const tipIcon = (text: string) => L.divIcon({ className: "", iconSize: [0, 0], iconAnchor: [-14, 18], html: `<div style="white-space:nowrap;background:rgba(20,22,20,.92);border:1px solid #444;color:#f2f2f2;font:600 11px system-ui,sans-serif;padding:3px 7px;border-radius:3px;pointer-events:none">${text}</div>` });
const handleIcon = (kind: "vertex" | "edge" | "mid" | "move") => L.divIcon({ className: "", iconSize: [kind === "move" ? 22 : 14, kind === "move" ? 22 : 14], iconAnchor: [kind === "move" ? 11 : 7, kind === "move" ? 11 : 7], html: kind === "move" ? `<div title="Drag to move the plot" style="width:22px;height:22px;border-radius:50%;background:#171a17;border:2px solid #fff;color:#fff;font:700 13px system-ui;display:flex;align-items:center;justify-content:center;cursor:move">✥</div>` : `<div style="width:${kind === "mid" ? 10 : 14}px;height:${kind === "mid" ? 10 : 14}px;margin:${kind === "mid" ? 2 : 0}px;border-radius:${kind === "edge" ? 3 : 50}%;background:${kind === "mid" ? "rgba(255,255,255,.55)" : "#fff"};border:2px solid #1b1d1b;cursor:grab"></div>` });

/** The words for a shape while it is drawn: "4 rows · 30 ft", "30 × 12 ft", or its area. */
function shapeLabel(shape: PlotShape, n: PlotNumbers | null): string {
  const plants = n ? ` · ${n.plants.toLocaleString("en-US")} plants` : "";
  if (shape.tool === "rows") return `${shape.rows} row${shape.rows === 1 ? "" : "s"} · ${fmtFt(shape.box.a1 - shape.box.a0)}${plants}`;
  if (shape.tool === "rectangle") return `${fmtFt(shape.box.a1 - shape.box.a0)} × ${fmtFt(shape.box.c1 - shape.box.c0)}${plants}`;
  return `${n ? fmtAcres(n.areaM2) : ""}${plants}`;
}
const sameFrame = (b: PlotBox, ctx: PlotContext) => Math.abs(b.lat - ctx.origin.lat) < 1e-9 && Math.abs(b.lng - ctx.origin.lng) < 1e-9 && Math.abs(b.dirDeg - ctx.dirDeg) < 1e-6;
/** The lines halfway between neighbouring rows at `a` (and half a spacing beyond the outer two), across. */
function midlines(ctx: PlotContext, a: number): number[] {
  const r = rowsAt(ctx, a);
  if (!r.length) return [];
  const out = [r[0].c - ctx.spacingM / 2];
  for (let i = 1; i < r.length; i++) out.push((r[i - 1].c + r[i].c) / 2);
  out.push(r[r.length - 1].c + ctx.spacingM / 2);
  return out;
}
const nearestOf = (v: number[], x: number) => v.reduce((b, y) => (Math.abs(y - x) < Math.abs(b - x) ? y : b), v[0]);

/** The numbers for a plot (US units, his brief). */
export function PlotNumbersView({ n, shape }: { n: PlotNumbers; shape: PlotShape | null }) {
  const [rowsOpen, setRowsOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const row = (label: React.ReactNode, value: React.ReactNode) => <><dt className="text-neutral-400">{label}</dt><dd className="text-right tabular-nums text-neutral-100">{value}</dd></>;
  return (
    <div className="mt-1.5" role="group" aria-label="Plot numbers">
      <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 text-[11.5px]">
        {row("Plants", n.plants.toLocaleString("en-US"))}
        {row("Plants per acre", n.perAcre != null ? fmtPerAcre(n.perAcre) : "–")}
        {row("Area", `${fmtAcres(n.areaM2)}${shape?.tool === "rows" ? ` · ${shape.rows} row${shape.rows === 1 ? "" : "s"}` : ""}`)}
        {row("Rows read in the photos", n.readShare != null ? fmtPct(n.readShare) : "no row inside")}
        {row("Plant spacing", n.spacing ? `${fmtIn(n.spacing.meanM)} avg` : "–")}
        {n.spacing && row(<span className="pl-2 text-neutral-500">spread · CV</span>, `±${fmtIn(n.spacing.sdM)} · ${fmtPct(n.spacing.cv)}`)}
        {n.spacing && n.spacing.long > 0 && <p className="col-span-2 -mt-0.5 pl-2 text-[10px] leading-snug text-neutral-500">Includes plants the photos missed: {n.spacing.long.toLocaleString("en-US")} spacing{n.spacing.long === 1 ? " is" : "s are"} over 1.5 × the median (a missed plant or a skip).</p>}
        {row("Plant span (leaf tip to tip)", n.span ? `${fmtIn(n.span.medianM)} median` : "–")}
        {row("Possible weeds", `${n.possibleWeeds.total.toLocaleString("en-US")} ${n.possibleWeeds.confirmed ? `(${n.possibleWeeds.confirmed} confirmed)` : "(unconfirmed)"}`)}
        {row("Gaps", n.gaps.measured ? `${n.gaps.confirmed}${n.gaps.confirmed ? ` · ${fmtIn(n.gaps.lengthM, 0)}` : ""}` : "Not measured on this flight")}
      </dl>
      <button type="button" className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-neutral-400 hover:text-neutral-200" onClick={() => setHowOpen(o => !o)} aria-expanded={howOpen}>
        <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-neutral-500 text-[9px] font-bold leading-none" aria-hidden="true">?</span>How these are measured
      </button>
      {howOpen && <div className="mt-1 space-y-0.5 border-l border-[#2e322e] pl-2 text-[10px] leading-snug text-neutral-500">
        <p>Plants per acre: the plants counted inside ÷ (the row inside with plants seen × the field's row spacing), the same rule as the Stand.</p>
        <p>Rows read in the photos: of the row inside, the share with plants seen along it.</p>
        {n.spacing && <p>Plant spacing: between neighbouring plants on each row, both inside the plot. Over 1.5 × the plot's median ({fmtIn(n.spacing.medianM)}) the photos can't tell a missed plant from a skip.</p>}
        {n.span && <p>Plant span: the whole plant's leaf line, tip to tip, on {n.span.n.toLocaleString("en-US")} of its plants; not one leaf's length.</p>}
        <p>Possible weeds: green on no row (not counted) plus weed candidates, each place once; often a weed, sometimes dark ground or shadow.</p>
      </div>}
      {n.small && <p className="mt-1 rounded-sm border border-[#6b4f1d] bg-[rgba(64,46,14,0.55)] px-2 py-1 text-[10.5px] leading-snug text-[#f3c97a]">Small plot: {n.small.why === "plants" ? `${n.plants} plants` : `${fmtFt(n.seenM)} of row with plants seen`}, so the per-acre number could be off by about ±{Math.round(100 * n.small.margin)} %. Draw at least 100 plants and 50 ft of row for a stable number.</p>}
      {n.rows.length > 0 && <>
        <button type="button" className="mt-1 text-[10.5px] text-neutral-400 hover:text-neutral-200" onClick={() => setRowsOpen(o => !o)} aria-expanded={rowsOpen}>{rowsOpen ? "▾" : "▸"} Spacing per row ({n.rows.length})</button>
        {rowsOpen && <table className="mt-1 w-full text-[10.5px] tabular-nums text-neutral-300">
          <thead><tr className="text-neutral-500"><th className="text-left font-normal">Row</th><th className="text-right font-normal">Plants</th><th className="text-right font-normal">Avg</th><th className="text-right font-normal">CV</th><th className="text-right font-normal">Over 1.5×</th></tr></thead>
          <tbody>{n.rows.map(r => <tr key={r.row}><td title={`field row ${r.row}`}>{r.order} <span className="text-neutral-600">({r.row})</span></td><td className="text-right">{r.plants}</td><td className="text-right">{fmtIn(r.meanM)}</td><td className="text-right">{fmtPct(r.cv)}</td><td className="text-right">{r.long}</td></tr>)}</tbody>
        </table>}
      </>}
    </div>
  );
}

/**
 * The Plots card and everything plots do on the map. `onBusy` says when a tool or an edit holds the map (the twin's own
 * clicks are then not picks).
 */
export function PlotWorkbench({ map, ctx, twinId, onBusy, simple = false, fieldPerAcre = null }: { map: L.Map | null; ctx: PlotContext; twinId: string; onBusy: (busy: boolean) => void; /** The Simple view is on: plots as outlines in their own colour with a label on their top edge. */ simple?: boolean; /** The field's own plants per acre (a plot well under it gets an amber number). */ fieldPerAcre?: number | null }) {
  const [plots, setPlots] = useState<Plot[]>(() => loadPlots(twinId));
  useEffect(() => { setPlots(loadPlots(twinId)); setSelected(null); setMode({ kind: "idle" }); }, [twinId]);
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [selected, setSelected] = useState<string | null>(null);
  const [live, setLive] = useState<{ ring: LatLngPair[]; shape: PlotShape } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [shown, setShown] = useState(true);
  const [name, setName] = useState("");
  const [colour, setColour] = useState(PLOT_COLOURS[0]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [vertices, setVertices] = useState(0);
  const polygonApi = useRef<{ undo: () => void; finish: () => void } | null>(null);
  // Naming counts: a click on the map then must not select a plant under the new plot.
  const busy = mode.kind !== "idle";
  const holding = mode.kind === "drawing" || mode.kind === "editing";
  useEffect(() => { onBusy(busy); }, [busy, onBusy]);
  useEffect(() => () => onBusy(false), [onBusy]);

  const commit = useCallback((next: Plot[]) => {
    setPlots(next);
    setNote(savePlots(twinId, next) ? null : "Not saved: this browser blocks storage. The plots are on screen only.");
  }, [twinId]);
  const selectedPlot = plots.find(p => p.uid === selected) ?? null;
  const numbers = useMemo(() => {
    const ring = live?.ring ?? (mode.kind === "naming" || mode.kind === "editing" ? mode.draft.ring : selectedPlot?.ring);
    return ring && ring.length >= 3 ? measurePlot(ctx, ring) : null;
  }, [ctx, live, mode, selectedPlot]);
  // Every saved plot's numbers, for its label on the map (a fraction of a millisecond each).
  const plotNumbers = useMemo(() => new Map(plots.map(p => [p.uid, measurePlot(ctx, p.ring)])), [ctx, plots]);
  const shapeNow = live?.shape ?? (mode.kind === "naming" || mode.kind === "editing" ? mode.draft.shape : selectedPlot?.shape ?? null);

  const start = (tool: Tool) => { setSelected(null); setLive(null); setNote(null); setVertices(0); setConfirmDelete(false); setMode({ kind: "drawing", tool }); };
  const cancel = () => { setLive(null); setNote(null); setMode({ kind: "idle" }); };
  const finished = useCallback((draft: Draft) => {
    setLive(null);
    setName(""); setColour(PLOT_COLOURS[(nextPlotNumber(plots) - 1) % PLOT_COLOURS.length]);
    setMode({ kind: "naming", draft });
  }, [plots]);
  const saveNew = () => {
    if (mode.kind !== "naming") return;
    const now = new Date().toISOString(), number = nextPlotNumber(plots);
    const p: Plot = { uid: newUid(), number, name: name.trim().slice(0, 80) || `Plot ${number}`, colour, ring: mode.draft.ring, shape: mode.draft.shape, at: now, updatedAt: now };
    commit([...plots, p]); setSelected(p.uid); setMode({ kind: "idle" });
  };
  const startEdit = () => { if (!selectedPlot) return; setConfirmDelete(false); setName(selectedPlot.name); setColour(selectedPlot.colour); setMode({ kind: "editing", uid: selectedPlot.uid, draft: { ring: selectedPlot.ring, shape: selectedPlot.shape } }); };
  const saveEdit = () => {
    if (mode.kind !== "editing") return;
    commit(plots.map(p => (p.uid === mode.uid ? { ...p, ring: mode.draft.ring, shape: mode.draft.shape, name: name.trim().slice(0, 80) || p.name, colour, updatedAt: new Date().toISOString() } : p)));
    setLive(null); setMode({ kind: "idle" });
  };
  const remove = () => { if (!selectedPlot) return; commit(plots.filter(p => p.uid !== selectedPlot.uid)); setSelected(null); setConfirmDelete(false); };
  const zoomTo = (p: Plot) => { if (alive(map)) map.flyToBounds(L.latLngBounds(p.ring.map(([a, b]) => L.latLng(a, b))).pad(0.6), { duration: 0.5, maxZoom: 25 }); };

  // Esc cancels a tool or an edit; Enter closes a polygon.
  useEffect(() => {
    if (!holding) return;
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
      if (e.key === "Escape") { setLive(null); setMode({ kind: "idle" }); }
      if (e.key === "Enter") polygonApi.current?.finish();
      if (e.key === "Backspace") polygonApi.current?.undo();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [holding]);

  // The saved plots on the map: an outline in their colour, their number at the middle (a click selects).
  useEffect(() => {
    if (!alive(map) || !shown) return;
    const { pane, renderer } = paneOf(map), g = L.layerGroup().addTo(map);
    for (const p of plots) {
      if (mode.kind === "editing" && mode.uid === p.uid) continue;
      const on = p.uid === selected, pick = (e: L.LeafletEvent) => { L.DomEvent.stop(e as unknown as Event); if (mode.kind === "idle") { setSelected(p.uid); setConfirmDelete(false); } };
      if (simple) {
        // Simple: an outline in the plot's own colour (brighter and thicker when selected), nothing filled over the boxes, the label on its top edge.
        const n = plotNumbers.get(p.uid) ?? null, line = simpleOutline(p.colour, on);
        L.polygon(p.ring, { pane, renderer, color: line.stroke, weight: line.weight, opacity: 1, fill: false, interactive: false }).addTo(g);
        L.marker(topCorner(p.ring), { icon: labelIcon(p.name, n?.perAcre != null ? fmtPerAcreShort(n.perAcre) : null, plotNumberTone(n?.perAcre ?? null, fieldPerAcre, !!n?.small), on, p.colour), keyboard: false, title: `${p.name}: open its numbers`, zIndexOffset: on ? 500 : 0 }).on("click", pick).addTo(g);
        continue;
      }
      L.polygon(p.ring, { pane, renderer, color: p.colour, weight: on ? 3 : 2, opacity: 0.95, fillColor: p.colour, fillOpacity: on ? 0.16 : 0.07, interactive: false }).addTo(g);
      L.marker(centroid(p.ring), { icon: numberIcon(p.number, p.colour, on), keyboard: false, title: p.name, zIndexOffset: on ? 500 : 0 }).on("click", pick).addTo(g);
    }
    return () => { drop(g); };
  }, [map, plots, selected, shown, mode, simple, plotNumbers, fieldPerAcre]);

  // A tool: the shape follows the pointer, its words beside it, the numbers in the card.
  const toolNow = mode.kind === "drawing" ? mode.tool : null;
  useEffect(() => {
    if (!alive(map) || !toolNow) return;
    const tool = toolNow, el = map.getContainer(), { pane, renderer } = paneOf(map);
    const draft = L.polygon([], { pane, renderer, color: "#ffffff", weight: 2, dashArray: "6 4", fillColor: "#ffffff", fillOpacity: 0.1, interactive: false }).addTo(map);
    const line = L.polyline([], { pane, renderer, color: "#ffffff", weight: 2, dashArray: "6 4", interactive: false }).addTo(map);
    const tip = L.marker(map.getCenter(), { icon: tipIcon(""), interactive: false, keyboard: false });
    let raf = 0;
    const show = (ring: LatLngPair[], shape: PlotShape, at: L.LatLng | null) => {
      draft.setLatLngs(ring);
      const n = ring.length >= 3 ? measurePlot(ctx, ring) : null;
      if (at) { tip.setLatLng(at).setIcon(tipIcon(shapeLabel(shape, n))); if (!map.hasLayer(tip)) tip.addTo(map); }
      cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setLive({ ring, shape }));
    };
    el.style.cursor = "crosshair";
    map.doubleClickZoom.disable();
    const cleanups: (() => void)[] = [];
    if (tool === "polygon") {
      const pts: LatLngPair[] = [];
      const finish = () => { if (pts.length >= 3) finished({ ring: [...pts], shape: { tool: "polygon" } }); };
      // The twin's canvas stops the map's own click once it has picked (TwinCanvasLayer), so a corner comes from the
      // pointer itself: a press and release that hardly moved is a tap (a longer move is a pan, left to the map); a
      // second tap on the last corner within 350 ms is a double tap and closes the polygon.
      let press: { x: number; y: number; t: number } | null = null, lastTap = { x: -99, y: -99, t: 0 };
      const at = (ev: PointerEvent) => { const r = el.getBoundingClientRect(); return L.point(ev.clientX - r.left, ev.clientY - r.top); };
      const down = (ev: PointerEvent) => {
        if ((ev.target as HTMLElement).closest(".leaflet-control, .leaflet-marker-icon")) return;
        if (ev.pointerType === "mouse" && ev.button !== 0) return;
        const q = at(ev); press = { x: q.x, y: q.y, t: ev.timeStamp };
      };
      const up = (ev: PointerEvent) => {
        if (!press) return;
        const q = at(ev), moved = Math.hypot(q.x - press.x, q.y - press.y);
        press = null;
        if (moved > 6) return;
        const dbl = ev.timeStamp - lastTap.t < 350 && Math.hypot(q.x - lastTap.x, q.y - lastTap.y) < 8;
        lastTap = { x: q.x, y: q.y, t: ev.timeStamp };
        if (dbl) { finish(); return; }
        if (pts.length >= 3 && map.latLngToContainerPoint(pts[0]).distanceTo(q) < 12) { finish(); return; }
        const ll = map.containerPointToLatLng(q);
        pts.push([ll.lat, ll.lng]); setVertices(pts.length);
        line.setLatLngs(pts); show([...pts], { tool: "polygon" }, ll);
      };
      const move = (ev: PointerEvent) => { if (!pts.length || press) return; const ll = map.containerPointToLatLng(at(ev)); const ring: LatLngPair[] = [...pts, [ll.lat, ll.lng]]; line.setLatLngs(ring); show(ring, { tool: "polygon" }, ll); };
      el.addEventListener("pointerdown", down, true); el.addEventListener("pointerup", up, true); el.addEventListener("pointermove", move);
      polygonApi.current = { undo: () => { pts.pop(); setVertices(pts.length); line.setLatLngs(pts); show([...pts], { tool: "polygon" }, null); }, finish };
      cleanups.push(() => { el.removeEventListener("pointerdown", down, true); el.removeEventListener("pointerup", up, true); el.removeEventListener("pointermove", move); polygonApi.current = null; });
    } else {
      map.dragging.disable();
      let from: [number, number] | null = null, last: { ring: LatLngPair[]; shape: PlotShape } | null = null;
      const shapeTo = (a: number, c: number): { ring: LatLngPair[]; shape: PlotShape } | null => {
        if (!from) return null;
        if (tool === "rectangle") { const b = boxIn(ctx, from[0], a, from[1], c); return { ring: boxRing(b), shape: { tool: "rectangle", box: b } }; }
        const sn = snapRows(ctx, from[0], from[1], a, c);
        return sn ? { ring: boxRing(sn.box), shape: { tool: "rows", box: sn.box, rows: sn.rows } } : null;
      };
      const down = (ev: PointerEvent) => {
        if ((ev.target as HTMLElement).closest(".leaflet-control, .leaflet-marker-icon")) return;
        if (ev.pointerType === "mouse" && ev.button !== 0) return;
        const p = map.mouseEventToLatLng(ev as unknown as MouseEvent), [a, c] = acOf(ctx, p.lat, p.lng);
        if (tool === "rows" && !rowsAt(ctx, a).length) { setNote("Start on a row: press on one of the field's rows, then drag."); return; }
        setNote(null); from = [a, c]; last = null;
        ev.preventDefault(); ev.stopPropagation();
      };
      const move = (ev: PointerEvent) => {
        if (!from) return;
        const p = map.mouseEventToLatLng(ev as unknown as MouseEvent), [a, c] = acOf(ctx, p.lat, p.lng), r = shapeTo(a, c);
        if (r) { last = r; show(r.ring, r.shape, p); }
      };
      const up = () => {
        if (!from) return;
        from = null;
        const b = last && last.shape.tool !== "polygon" ? last.shape.box : null;
        if (last && b && b.a1 - b.a0 >= 0.3 && b.c1 - b.c0 >= 0.1) finished(last);
        else { draft.setLatLngs([]); map.removeLayer(tip); setLive(null); }
      };
      el.addEventListener("pointerdown", down, true); window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
      cleanups.push(() => { el.removeEventListener("pointerdown", down, true); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); if (alive(map)) map.dragging.enable(); });
    }
    return () => { cancelAnimationFrame(raf); for (const f of cleanups) { try { f(); } catch { /* the map went first */ } } drop(draft); drop(line); drop(tip); el.style.cursor = ""; if (alive(map)) map.doubleClickZoom.enable(); };
  }, [map, toolNow, ctx, finished]);

  // A draft waiting for its name, or a plot being edited: its outline, and in an edit its handles.
  const draftNow = mode.kind === "naming" || mode.kind === "editing" ? mode.draft : null;
  const editing = mode.kind === "editing";
  useEffect(() => {
    if (!alive(map) || !draftNow) return;
    const { pane, renderer } = paneOf(map), g = L.layerGroup().addTo(map);
    const poly = L.polygon(draftNow.ring, { pane, renderer, color: colour, weight: 2.5, dashArray: editing ? "6 4" : undefined, fillColor: colour, fillOpacity: 0.14, interactive: false }).addTo(g);
    if (!editing) return () => { drop(g); };
    const d = draftNow;
    const done = (next: Draft) => { setLive(null); setMode(m => (m.kind === "editing" ? { ...m, draft: next } : m)); };
    const preview = (next: Draft) => { poly.setLatLngs(next.ring); setLive({ ring: next.ring, shape: next.shape }); };
    const handle = (at: LatLngPair, kind: "vertex" | "edge" | "mid" | "move", drag: (ll: L.LatLng, from: L.LatLng) => Draft | null) => {
      let from: L.LatLng | null = null, last: Draft | null = null;
      L.marker(at, { draggable: true, icon: handleIcon(kind), keyboard: false, zIndexOffset: kind === "move" ? 800 : 600 })
        .on("dragstart", e => { from = (e.target as L.Marker).getLatLng(); })
        .on("drag", e => { if (!from) return; const n = drag((e.target as L.Marker).getLatLng(), from); if (n) { last = n; preview(n); } })
        .on("dragend", () => { if (last) done(last); else done(d); })
        .addTo(g);
    };
    const shift = (ll: L.LatLng, from: L.LatLng): [number, number] => { const [a1, c1] = acOf(ctx, ll.lat, ll.lng), [a0, c0] = acOf(ctx, from.lat, from.lng); return [a1 - a0, c1 - c0]; };
    const S = d.shape;
    if (S.tool !== "polygon" && sameFrame(S.box, ctx)) {
      const b = S.box, am = (b.a0 + b.a1) / 2, cmid = (b.c0 + b.c1) / 2, ll = (a: number, c: number): LatLngPair => { const [e, n] = ctx.fromAC(a, c); return ctx.frame.toLL(e, n); };
      const make = (nb: PlotBox): Draft | null => {
        if (nb.a1 - nb.a0 < 0.3 || nb.c1 - nb.c0 < 0.1) return null;
        if (S.tool === "rows") { const rows = rowsAt(ctx, (nb.a0 + nb.a1) / 2).filter(r => r.c > nb.c0 && r.c < nb.c1).length; if (!rows) return null; return { ring: boxRing(nb), shape: { tool: "rows", box: nb, rows } }; }
        return { ring: boxRing(nb), shape: { tool: "rectangle", box: nb } };
      };
      const snapC = (c: number) => { if (S.tool !== "rows") return c; const m = midlines(ctx, am); return m.length ? nearestOf(m, c) : c; };
      handle(ll(b.a0, cmid), "edge", p => { const [a] = acOf(ctx, p.lat, p.lng); return make({ ...b, a0: Math.min(a, b.a1 - 0.3) }); });
      handle(ll(b.a1, cmid), "edge", p => { const [a] = acOf(ctx, p.lat, p.lng); return make({ ...b, a1: Math.max(a, b.a0 + 0.3) }); });
      handle(ll(am, b.c0), "edge", p => { const [, c] = acOf(ctx, p.lat, p.lng); return make({ ...b, c0: Math.min(snapC(c), b.c1 - 0.1) }); });
      handle(ll(am, b.c1), "edge", p => { const [, c] = acOf(ctx, p.lat, p.lng); return make({ ...b, c1: Math.max(snapC(c), b.c0 + 0.1) }); });
      handle(ll(am, cmid), "move", (p, from) => { const [da, dc] = shift(p, from); const c0 = snapC(b.c0 + dc), dcs = c0 - b.c0; return make({ ...b, a0: b.a0 + da, a1: b.a1 + da, c0, c1: b.c1 + dcs }); });
    } else {
      // A polygon (or a box drawn in another frame): its corners, a handle halfway along each edge to add one, and a move handle.
      const ring = d.ring;
      ring.forEach((pt, i) => handle(pt, "vertex", p => { const r = ring.map((q, k): LatLngPair => (k === i ? [p.lat, p.lng] : q)); return { ring: r, shape: { tool: "polygon" } }; }));
      ring.forEach((pt, i) => { const q = ring[(i + 1) % ring.length]; handle([(pt[0] + q[0]) / 2, (pt[1] + q[1]) / 2], "mid", p => { const r = [...ring]; r.splice(i + 1, 0, [p.lat, p.lng]); return { ring: r, shape: { tool: "polygon" } }; }); });
      handle(centroid(ring), "move", (p, from) => { const dLat = p.lat - from.lat, dLng = p.lng - from.lng; return { ring: ring.map(([a, b]): LatLngPair => [a + dLat, b + dLng]), shape: { tool: "polygon" } }; });
    }
    return () => { drop(g); };
  }, [map, draftNow, editing, colour, ctx]);

  const removeCorner = () => {
    if (mode.kind !== "editing" || mode.draft.shape.tool !== "polygon" || mode.draft.ring.length <= 3) return;
    setMode({ ...mode, draft: { ...mode.draft, ring: mode.draft.ring.slice(0, -1) } });
  };
  const btn = "rounded-sm border border-[#3a3f3a] px-2 py-1 text-[11px] text-neutral-200 hover:bg-[#262a26] disabled:opacity-40";
  const primary = "rounded-sm bg-[#f0a63a] px-2 py-1 text-[11px] font-semibold text-[#171a18] disabled:opacity-40";
  const colours = (
    <div className="mt-1.5 flex items-center gap-1.5" role="radiogroup" aria-label="Plot colour">
      {PLOT_COLOURS.map(c => <button key={c} type="button" role="radio" aria-checked={colour === c} aria-label={`Colour ${c}`} onClick={() => setColour(c)} className={`h-5 w-5 rounded-full border-2 ${colour === c ? "border-white" : "border-[#1b1d1b]"}`} style={{ background: c }} />)}
    </div>
  );

  return (
    <div className={`px-3 py-2.5 text-xs ${panel}`} role="group" aria-label="Plots">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-400">Plots</span>
        <label className="flex items-center gap-1 text-[10.5px] text-neutral-500"><input type="checkbox" className="accent-[#f0a63a]" checked={shown} onChange={e => setShown(e.target.checked)} />on the map</label>
      </div>
      {mode.kind === "idle" && <>
        <div className="mt-1.5 grid grid-cols-3 gap-0.5 rounded-sm border border-[#3a3f3a] bg-[#111311] p-0.5" role="group" aria-label="Draw a plot">
          {(["polygon", "rectangle", "rows"] as Tool[]).map(t => <button key={t} type="button" onClick={() => start(t)} className="rounded-[2px] px-1 py-1.5 text-[10.5px] text-neutral-200 hover:bg-[#262a26]">{TOOL_LABEL[t]}</button>)}
        </div>
        {plots.length === 0 && <p className="mt-1.5 text-[10px] leading-snug text-neutral-500">Draw a region to get its numbers: plants, plants per acre, spacing, plant span, green that is not corn. Saved on this device, in ground coordinates.</p>}
        {plots.length > 0 && <ul className="mt-1.5 space-y-0.5" aria-label="Saved plots">
          {plots.map(p => { const n = p.uid === selected ? numbers : null; return (
            <li key={p.uid}><button type="button" onClick={() => { setSelected(p.uid === selected ? null : p.uid); setConfirmDelete(false); if (p.uid !== selected) zoomTo(p); }} className={`flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-[11.5px] hover:bg-[#232723] ${p.uid === selected ? "bg-[#232723]" : ""}`}>
              <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-[#1b1d1b]" style={{ background: p.colour }}>{p.number}</span>
              <span className="truncate text-neutral-200">{p.name}</span>
              <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-neutral-500">{n?.perAcre != null ? `${fmtPerAcre(n.perAcre)} /ac` : p.shape.tool === "rows" ? `${p.shape.rows} rows` : ""}</span>
            </button></li>); })}
        </ul>}
        {selectedPlot && numbers && <div className="mt-1.5 border-t border-[#262a26] pt-1.5">
          <div className="flex items-baseline justify-between gap-2"><span className="truncate text-[12px] font-semibold text-neutral-100">{selectedPlot.name}</span><span className="shrink-0 text-[10.5px] text-neutral-500">{shapeLabel(selectedPlot.shape, null) || TOOL_LABEL.polygon}</span></div>
          <PlotNumbersView n={numbers} shape={selectedPlot.shape} />
          {!confirmDelete ? <div className="mt-1.5 flex flex-wrap gap-1"><button type="button" className={btn} onClick={startEdit}>Edit or move</button><button type="button" className={btn} onClick={() => zoomTo(selectedPlot)}>Show</button><button type="button" className={btn} onClick={() => setConfirmDelete(true)}>Delete</button></div>
            : <div className="mt-1.5 flex flex-wrap items-center gap-1"><span className="text-[11px] text-neutral-300">Delete {selectedPlot.name}?</span><button type="button" className={btn} onClick={remove}>Delete</button><button type="button" className={btn} onClick={() => setConfirmDelete(false)}>Keep</button></div>}
        </div>}
      </>}
      {mode.kind === "drawing" && <>
        <p className="mt-1.5 text-[11px] font-semibold text-neutral-100">{TOOL_LABEL[mode.tool]}</p>
        <p className="mt-0.5 text-[10.5px] leading-snug text-neutral-400">{TOOL_HINT[mode.tool]}</p>
        {live && <p className="mt-1 text-[11px] text-neutral-200">{shapeLabel(live.shape, numbers)}</p>}
        {numbers && <PlotNumbersView n={numbers} shape={shapeNow} />}
        <div className="mt-1.5 flex flex-wrap gap-1">
          {mode.tool === "polygon" && <><button type="button" className={primary} disabled={vertices < 3} onClick={() => polygonApi.current?.finish()}>Finish</button><button type="button" className={btn} disabled={vertices === 0} onClick={() => polygonApi.current?.undo()}>Undo corner</button></>}
          <button type="button" className={btn} onClick={cancel}>Cancel</button>
        </div>
      </>}
      {(mode.kind === "naming" || mode.kind === "editing") && <>
        <p className="mt-1.5 text-[11px] font-semibold text-neutral-100">{mode.kind === "naming" ? `New plot ${nextPlotNumber(plots)}` : "Edit or move"}</p>
        {mode.kind === "editing" && <p className="mt-0.5 text-[10.5px] leading-snug text-neutral-400">{mode.draft.shape.tool === "polygon" ? "Drag a corner; drag a small dot to add a corner; drag ✥ to move it." : mode.draft.shape.tool === "rows" ? "Drag a side to take in or let go of a row, an end to change the length; drag ✥ to move it (it stays on the rows)." : "Drag a side or an end; drag ✥ to move it."}</p>}
        <input type="text" value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder={mode.kind === "naming" ? `Plot ${nextPlotNumber(plots)}` : "Name"} aria-label="Plot name"
          className="mt-1.5 w-full rounded-sm border border-[#3a3f3a] bg-[#111311] px-2 py-1 text-[11.5px] text-neutral-100 placeholder:text-neutral-600" />
        {colours}
        <p className="mt-1.5 text-[11px] text-neutral-300">{shapeLabel(mode.draft.shape, null)}</p>
        {numbers && <PlotNumbersView n={numbers} shape={shapeNow} />}
        <div className="mt-1.5 flex flex-wrap gap-1">
          <button type="button" className={primary} onClick={mode.kind === "naming" ? saveNew : saveEdit}>Save</button>
          {mode.kind === "editing" && mode.draft.shape.tool === "polygon" && mode.draft.ring.length > 3 && <button type="button" className={btn} onClick={removeCorner}>Remove last corner</button>}
          <button type="button" className={btn} onClick={cancel}>{mode.kind === "naming" ? "Discard" : "Cancel"}</button>
        </div>
      </>}
      {note && <p role="alert" className="mt-1 text-[10.5px] text-amber-300/90">{note}</p>}
    </div>
  );
}

/** The weed patches' numbered pins, and the active one's outline (dashed, its cells' edge). A pin's click is a choice. */
export function PatchPins({ map, ctx, patches, active, onPick }: { map: L.Map | null; ctx: PlotContext; patches: WeedPatch[]; active: number | null; onPick: (p: WeedPatch) => void }) {
  const onPickRef = useRef(onPick); onPickRef.current = onPick;
  useEffect(() => {
    if (!alive(map) || !patches.length) return;
    const { pane, renderer } = paneOf(map), g = L.layerGroup().addTo(map);
    for (const p of patches) {
      L.marker([p.lat, p.lng], { icon: numberIcon(p.number, WEED_PATCH_COLOUR, p.number === active), keyboard: false, title: `Weed patch ${p.number}: ${fmtAcres(p.areaM2)}, unconfirmed`, zIndexOffset: p.number === active ? 400 : -100 })
        .on("click", e => { L.DomEvent.stop(e as unknown as Event); onPickRef.current(p); }).addTo(g);
    }
    const a = patches.find(p => p.number === active);
    if (a) {
      // The outline: every cell side with no cell of the patch beyond it.
      const set = new Set(a.cells.map(([e, n]) => `${Math.round(e * 100)},${Math.round(n * 100)}`)), has = (e: number, n: number) => set.has(`${Math.round(e * 100)},${Math.round(n * 100)}`);
      const segs: LatLngPair[][] = [], ll = (e: number, n: number) => ctx.frame.toLL(e, n);
      for (const [e, n] of a.cells) {
        if (!has(e, n - 1)) segs.push([ll(e, n), ll(e + 1, n)]);
        if (!has(e, n + 1)) segs.push([ll(e, n + 1), ll(e + 1, n + 1)]);
        if (!has(e - 1, n)) segs.push([ll(e, n), ll(e, n + 1)]);
        if (!has(e + 1, n)) segs.push([ll(e + 1, n), ll(e + 1, n + 1)]);
      }
      L.polyline(segs, { pane, renderer, color: "#ffffff", weight: 2, dashArray: "5 4", opacity: 0.9, interactive: false }).addTo(g);
    }
    return () => { drop(g); };
  }, [map, ctx, patches, active]);
  return null;
}
