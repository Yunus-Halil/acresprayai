// Plots in the account beside this device's copy (2026-11-24, his conditions): device plots go up once and the device
// copy is only replaced once the account has confirmed it holds them; a change waits on the device when the account
// cannot be reached; the newer edit wins between devices; a delete reaches every device.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { type AccountPlot, type PlotBackend, backupKey, pushChange, syncOnOpen } from "@/lib/fieldTwin/plotSync";
import { loadPlots, savePlots } from "@/lib/fieldTwin/plotStore";
import type { Plot } from "@/lib/fieldTwin/plots";

const KEY = "field-2026-04-17", TWIN = "f0000000-1111-4000-8000-000000000001";
const ring: Plot["ring"] = [[31.581, -83.586], [31.581, -83.585], [31.5805, -83.585], [31.5805, -83.586]];
const plot = (n: number, colour: string, at: string, extra: Partial<Plot> = {}): Plot => ({ uid: `p${n}`, number: n, name: `Plot ${n}`, colour, ring, shape: { tool: "polygon" }, at, updatedAt: at, ...extra });

/** The account, in memory: plots by uid. `down` refuses every call; `forget` takes a put and keeps nothing. */
function account() {
  const rows = new Map<string, AccountPlot & { twin_id: string }>();
  const a = { rows, down: false as false | string, forget: false, puts: 0 } ;
  const backend: PlotBackend = {
    async list(twinId) { if (a.down) throw Object.assign(new Error(a.down), { code: a.down.startsWith("PGRST") ? a.down.split(" ")[0] : undefined }); return [...rows.values()].filter(r => r.twin_id === twinId).map(r => ({ ...r })); },
    async put(twinId, plots) { if (a.down) throw new Error(a.down); a.puts++; if (a.forget) return; for (const p of plots) rows.set(p.uid, { ...p, twin_id: twinId }); },
  };
  return Object.assign(a, { backend });
}
/** Two devices: each its own browser storage. */
const stores = new Map<string, Record<string, string>>();
let on = "computer";
function device(name: string) {
  const now: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; now[k] = localStorage.getItem(k)!; }
  stores.set(on, now);
  localStorage.clear();
  for (const [k, v] of Object.entries(stores.get(name) ?? {})) localStorage.setItem(k, v);
  on = name;
}
beforeEach(() => { stores.clear(); on = "computer"; localStorage.clear(); });
afterEach(() => localStorage.clear());

describe("plots in the account", () => {
  it("sends this device's plots up once, takes the account's list only after it holds them, and keeps the plots as they were apart", async () => {
    const A = account();
    savePlots(KEY, [plot(1, "#ba68c8", "2026-11-23T10:00:00Z", { name: "UMD Plot" }), plot(2, "#4fc3f7", "2026-11-23T11:00:00Z")]);
    const r = await syncOnOpen(KEY, TWIN, A.backend);
    expect(r.where).toBe("account");
    expect([...A.rows.keys()].sort()).toEqual(["p1", "p2"]);
    expect(A.rows.get("p1")).toMatchObject({ name: "UMD Plot", colour: "#ba68c8", ring, shape: { tool: "polygon" }, deleted_at: null });
    expect(loadPlots(KEY).map(p => [p.uid, p.colour])).toEqual([["p1", "#ba68c8"], ["p2", "#4fc3f7"]]);
    expect(JSON.parse(localStorage.getItem(backupKey(KEY))!).plots).toHaveLength(2);
    // Opened again: nothing is sent twice.
    const puts = A.puts;
    await syncOnOpen(KEY, TWIN, A.backend);
    expect(A.puts).toBe(puts);
  });

  it("leaves the device exactly as it was when the account cannot be reached, and sends at the next open that can", async () => {
    const A = account();
    savePlots(KEY, [plot(1, "#ba68c8", "2026-11-23T10:00:00Z")]);
    const stored = localStorage.getItem(`swathwise:twin-plots:${KEY}`);
    A.down = "Failed to fetch";
    const r = await syncOnOpen(KEY, TWIN, A.backend);
    expect(r).toMatchObject({ where: "device", why: expect.stringMatching(/could not be reached/) });
    expect(localStorage.getItem(`swathwise:twin-plots:${KEY}`)).toBe(stored);
    A.down = false;
    expect((await syncOnOpen(KEY, TWIN, A.backend)).where).toBe("account");
    expect(A.rows.has("p1")).toBe(true);
  });

  it("does not replace the device copy when the account does not confirm it kept the plots", async () => {
    const A = account();
    A.forget = true;
    savePlots(KEY, [plot(1, "#ba68c8", "2026-11-23T10:00:00Z")]);
    const r = await syncOnOpen(KEY, TWIN, A.backend);
    expect(r.where).toBe("device");
    expect(loadPlots(KEY).map(p => p.uid)).toEqual(["p1"]);
    // Still not marked as sent: the next open tries again.
    A.forget = false;
    await syncOnOpen(KEY, TWIN, A.backend);
    expect(A.rows.has("p1")).toBe(true);
  });

  it("says when saving in the account is not switched on yet (the table is not there), and keeps the device's plots", async () => {
    const A = account();
    savePlots(KEY, [plot(1, "#ba68c8", "2026-11-23T10:00:00Z")]);
    A.down = "PGRST205 Could not find the table 'public.twin_plots' in the schema cache";
    const r = await syncOnOpen(KEY, TWIN, A.backend);
    expect(r).toMatchObject({ where: "device", why: "Kept on this device: saving plots in your account is not switched on yet." });
    expect(r.plots.map(p => p.uid)).toEqual(["p1"]);
  });

  it("shows a plot drawn on the computer on the iPad, and the iPad's later colour change on the computer", async () => {
    const A = account();
    savePlots(KEY, [plot(1, "#f5d547", "2026-11-23T10:00:00Z")]);
    await syncOnOpen(KEY, TWIN, A.backend);
    device("ipad");
    const onIpad = await syncOnOpen(KEY, TWIN, A.backend);
    expect(onIpad.plots.map(p => [p.uid, p.colour])).toEqual([["p1", "#f5d547"]]);
    const next = onIpad.plots.map(p => ({ ...p, colour: "#ba68c8", updatedAt: "2026-11-24T08:00:00Z" }));
    savePlots(KEY, next);
    expect(await pushChange(KEY, TWIN, A.backend, onIpad.plots, next)).toBeNull();
    device("computer");
    expect((await syncOnOpen(KEY, TWIN, A.backend)).plots.map(p => p.colour)).toEqual(["#ba68c8"]);
  });

  it("never lets an older copy on another device overwrite a newer edit", async () => {
    const A = account();
    // The iPad held an old copy of plot 1 before it ever went to the account.
    device("ipad");
    savePlots(KEY, [plot(1, "#f5d547", "2026-11-20T10:00:00Z")]);
    device("computer");
    savePlots(KEY, [plot(1, "#ba68c8", "2026-11-23T10:00:00Z")]);
    await syncOnOpen(KEY, TWIN, A.backend);
    device("ipad");
    expect((await syncOnOpen(KEY, TWIN, A.backend)).plots.map(p => p.colour)).toEqual(["#ba68c8"]);
    expect(A.rows.get("p1")!.colour).toBe("#ba68c8");
  });

  it("carries a delete to every device, as a mark in the account, and an older copy does not bring the plot back", async () => {
    const A = account();
    savePlots(KEY, [plot(1, "#ba68c8", "2026-11-23T10:00:00Z"), plot(2, "#4fc3f7", "2026-11-23T10:00:00Z")]);
    const first = await syncOnOpen(KEY, TWIN, A.backend);
    device("ipad");
    await syncOnOpen(KEY, TWIN, A.backend);
    device("computer");
    const next = first.plots.filter(p => p.uid !== "p2");
    savePlots(KEY, next);
    expect(await pushChange(KEY, TWIN, A.backend, first.plots, next)).toBeNull();
    expect(A.rows.get("p2")!.deleted_at).not.toBeNull();
    device("ipad");
    expect((await syncOnOpen(KEY, TWIN, A.backend)).plots.map(p => p.uid)).toEqual(["p1"]);
  });

  it("keeps a change made offline on the device, says so, and sends it at the next open", async () => {
    const A = account();
    savePlots(KEY, [plot(1, "#ba68c8", "2026-11-23T10:00:00Z")]);
    const open = await syncOnOpen(KEY, TWIN, A.backend);
    A.down = "Failed to fetch";
    const next = [...open.plots, plot(2, "#81c784", "2026-11-24T09:00:00Z", { name: "Wet corner" })];
    savePlots(KEY, next);
    expect(await pushChange(KEY, TWIN, A.backend, open.plots, next)).toMatch(/^Saved on this device, not yet in your account/);
    expect(loadPlots(KEY).map(p => p.uid)).toEqual(["p1", "p2"]);
    A.down = false;
    const back = await syncOnOpen(KEY, TWIN, A.backend);
    expect(back.where).toBe("account");
    expect(A.rows.get("p2")!.name).toBe("Wet corner");
    expect(back.plots.map(p => p.uid)).toEqual(["p1", "p2"]);
  });
});
