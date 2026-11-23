// Plots on this device (2026-11-23, his word: "device first"): per twin, in this browser's storage. A plot is a ring of
// latitude / longitude points (plots.ts), so the same plots can later be kept under a field in the account and measured
// on its later flights; nothing here is tied to how this twin placed its plants.
import type { LatLngPair } from "./types";
import { PLOT_COLOURS, type Plot, type PlotBox, type PlotShape } from "./plots";

const KEY = (twinId: string) => `swathwise:twin-plots:${twinId}`;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pt = (v: unknown): v is LatLngPair => Array.isArray(v) && v.length === 2 && num(v[0]) && num(v[1]) && Math.abs(v[0]) <= 90 && Math.abs(v[1]) <= 180;
const box = (v: unknown): v is PlotBox => { const b = v as Partial<PlotBox> | null; return !!b && [b.lat, b.lng, b.dirDeg, b.a0, b.a1, b.c0, b.c1].every(num); };

function shapeOf(v: unknown): PlotShape | null {
  const s = v as { tool?: string; box?: unknown; rows?: unknown } | null;
  if (!s) return null;
  if (s.tool === "polygon") return { tool: "polygon" };
  if (s.tool === "rectangle" && box(s.box)) return { tool: "rectangle", box: s.box };
  if (s.tool === "rows" && box(s.box) && num(s.rows)) return { tool: "rows", box: s.box, rows: s.rows };
  return null;
}

/** The plots saved for a twin on this device (anything unreadable is left out). */
export function loadPlots(twinId: string): Plot[] {
  try {
    const raw = localStorage.getItem(KEY(twinId));
    if (!raw) return [];
    const v = JSON.parse(raw) as { version?: number; plots?: unknown[] };
    if (v.version !== 1 || !Array.isArray(v.plots)) return [];
    const out: Plot[] = [];
    for (const x of v.plots) {
      const p = x as Partial<Plot>, shape = shapeOf(p.shape);
      if (typeof p.uid !== "string" || !num(p.number) || typeof p.name !== "string" || !Array.isArray(p.ring) || p.ring.length < 3 || !p.ring.every(pt) || !shape) continue;
      out.push({ uid: p.uid, number: p.number, name: p.name.slice(0, 80), colour: typeof p.colour === "string" && /^#[0-9a-f]{6}$/i.test(p.colour) ? p.colour : PLOT_COLOURS[0], ring: p.ring, shape, at: typeof p.at === "string" ? p.at : "", updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : "" });
    }
    return out.sort((a, b) => a.number - b.number);
  } catch { return []; }
}

/** Save a twin's plots on this device; false when the browser blocks storage. */
export function savePlots(twinId: string, plots: Plot[]): boolean {
  try { localStorage.setItem(KEY(twinId), JSON.stringify({ version: 1, plots })); return true; } catch { return false; }
}

/** The next free plot number. */
export const nextPlotNumber = (plots: Plot[]) => plots.reduce((m, p) => Math.max(m, p.number), 0) + 1;
