// Stage 2 routing: which map windows RF-DETR inspects.
//
// Windows are squares of the map at the model's zoom, each sized so that,
// with its overlap, it is exactly one model tile (one forward pass). A window
// is inspected when it holds a hotspot candidate's cell or an uncertain cell,
// and a random share of the rest is inspected as an audit: drawn with a
// recorded seed, spread over blocks of windows so the audit covers the whole
// field, not one corner. What the audit finds outside the candidates is how
// often Stage 1 and RF-DETR disagree there; it is not a measured miss rate.
import type { LatLng2 } from "../../geo";
import { type MapChunk, MAP_OVERLAP_PX, planMapChunks } from "../mapRun";
import type { GridFrame, Stage1Result, UncertainReason } from "./stage1";

/**
 * The uncertainties that send a window to the model. "mostly crop row" only describes a cell: a weed inside the
 * row band is set aside as the crop whoever finds it, so inspecting it buys nothing, and in an orchard nearly every
 * window holds a row (a synthetic orchard with 5 m rows routed every window until this was split out).
 */
export const ROUTING_REASONS: ReadonlySet<UncertainReason> = new Set(["no rows", "partly imaged", "shadow"]);

export type WindowReason = "hotspot" | "uncertain" | "audit" | "skipped";

export type RouterParams = { auditShare: number; auditMin: number; seed: number; blockWindows: number };
export const DEFAULT_ROUTER: RouterParams = { auditShare: 0.05, auditMin: 3, seed: 20261019, blockWindows: 4 };

export type MapWindow = MapChunk & { cx: number; cy: number };

/** The windows over the field: owned squares of `tilePx - 2 * overlap` map pixels, one model tile each with the overlap. */
export function planWindows(rings: LatLng2[][], z: number, tilePx: number, overlap = MAP_OVERLAP_PX): MapWindow[] {
  const size = Math.max(64, tilePx - 2 * overlap);
  return planMapChunks(rings, z, size, overlap).map(c => {
    const cx = Math.round(c.x0 / size), cy = Math.round(c.y0 / size);
    return { ...c, name: `map/z${z}/w${size}/${cx}_${cy}`, cx, cy };
  });
}

/** The cells (keys) each window's owned square overlaps. Cells are in the Stage 1 grid at its own zoom. */
export function cellsOfWindows(windows: MapWindow[], g: GridFrame, cellKeys: Set<string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const w of windows) {
    const f = 2 ** (g.z - w.z);
    const X0 = w.x0 * f, Y0 = w.y0 * f, X1 = (w.x0 + w.size) * f, Y1 = (w.y0 + w.size) * f;
    const i0 = Math.floor((X0 - g.left) / g.cellPx), i1 = Math.ceil((X1 - g.left) / g.cellPx) - 1;
    const j0 = Math.floor((Y0 - g.top) / g.cellPx), j1 = Math.ceil((Y1 - g.top) / g.cellPx) - 1;
    const keys: string[] = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = `${i}:${j}`; if (cellKeys.has(k)) keys.push(k); }
    out.set(w.name, keys);
  }
  return out;
}

/** A small seeded generator (mulberry32), so an audit can be drawn again exactly. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Routing = {
  params: RouterParams;
  reasons: Record<string, WindowReason>;
  cellsOf: Map<string, string[]>;
  counts: Record<WindowReason, number>;
  /** Windows to run, hotspots first, then uncertain, then the audit. */
  order: string[];
};

export function routeWindows(windows: MapWindow[], stage1: Stage1Result, params: RouterParams = DEFAULT_ROUTER): Routing {
  const keys = new Set(stage1.cells.map(c => c.key));
  const cellsOf = cellsOfWindows(windows, stage1.grid, keys);
  const candidate = new Set(stage1.hotspots.flatMap(h => h.cells));
  const uncertain = new Set(stage1.cells.filter(c => c.uncertain.some(r => ROUTING_REASONS.has(r))).map(c => c.key));
  const reasons: Record<string, WindowReason> = {};
  const rest: MapWindow[] = [];
  for (const w of windows) {
    const cs = cellsOf.get(w.name) ?? [];
    if (cs.some(k => candidate.has(k))) reasons[w.name] = "hotspot";
    else if (cs.some(k => uncertain.has(k))) reasons[w.name] = "uncertain";
    else { reasons[w.name] = "skipped"; if (cs.length) rest.push(w); }
  }
  // The audit: blocks of blockWindows x blockWindows windows, shuffled with the seed; one window per block in turn.
  const quota = Math.min(rest.length, Math.max(params.auditMin, Math.ceil(params.auditShare * rest.length)));
  const rnd = seeded(params.seed);
  const blocks = new Map<string, MapWindow[]>();
  for (const w of rest) {
    const k = `${Math.floor(w.cx / params.blockWindows)}:${Math.floor(w.cy / params.blockWindows)}`;
    const b = blocks.get(k);
    if (b) b.push(w); else blocks.set(k, [w]);
  }
  const shuffle = <T,>(a: T[]): T[] => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const order = shuffle([...blocks.keys()].sort()).map(k => shuffle([...blocks.get(k)!].sort((a, b) => a.name.localeCompare(b.name))));
  let picked = 0;
  for (let round = 0; picked < quota; round++) {
    let any = false;
    for (const b of order) {
      if (picked >= quota) break;
      if (round < b.length) { reasons[b[round].name] = "audit"; picked++; any = true; }
    }
    if (!any) break;
  }
  const counts: Record<WindowReason, number> = { hotspot: 0, uncertain: 0, audit: 0, skipped: 0 };
  for (const r of Object.values(reasons)) counts[r]++;
  const rank: Record<WindowReason, number> = { hotspot: 0, uncertain: 1, audit: 2, skipped: 3 };
  const run = windows.filter(w => reasons[w.name] !== "skipped").sort((a, b) => rank[reasons[a.name]] - rank[reasons[b.name]] || a.cy - b.cy || a.cx - b.cx);
  return { params, reasons, cellsOf, counts, order: run.map(w => w.name) };
}
