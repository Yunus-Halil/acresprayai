// Plots in the account (2026-11-24, his word; public.twin_plots, migration 20261124120000), beside the copy on this
// device (plotStore.ts). The device copy is never thrown away: it is what the page shows when the account cannot be
// reached (an iPad in the field), and it is only ever replaced by the account's list after the account has said it
// holds every plot this device sent.
//
// The rules:
//   first open on a device  every plot on this device is sent up once (a plot the account already holds in a newer
//                           version, or deleted later than this copy was edited, is not); the account is read back,
//                           and only when every plot sent is in it does the device take the account's list and note
//                           that its plots went up. The device's plots as they were before are also kept apart, once
//                           (`backupKey`), and never removed by the page.
//   a change                saved on the device first, marked to send, then sent; the mark goes when the account
//                           took it. A change that could not be sent goes at the next open, or when the device is
//                           back online.
//   two devices             the newer edit of a plot wins (each plot carries when it was last edited).
//   delete                  a mark in the account (deleted_at), never a removal: it reaches every device.
// Founder-only for now: the page only syncs for the founder, and the database refuses everyone else.
import { supabase } from "@/integrations/supabase/client";
import { type Plot, type PlotShape } from "./plots";
import { loadPlots, savePlots } from "./plotStore";
import type { LatLngPair } from "./types";

/** A plot as the account keeps it. */
export type AccountPlot = {
  uid: string; number: number; name: string; colour: string; ring: LatLngPair[]; shape: PlotShape;
  drawn_at: string | null; edited_at: string; deleted_at: string | null;
};

/** What the sync needs from the account (the database in the app; an in-memory one in the tests). */
export type PlotBackend = {
  /** Every plot of the twin, those marked deleted too. */
  list(twinId: string): Promise<AccountPlot[]>;
  /** Write plots (a plot already there, by its uid, is replaced). */
  put(twinId: string, plots: AccountPlot[]): Promise<void>;
};

/** What this device has done with the account, per twin. */
type Meta = { twinId: string; uploadedAt: string | null; pending: string[]; deleted: { uid: string; at: string }[] };
const metaKey = (twinKey: string) => `swathwise:twin-plots-account:${twinKey}`;
/** The device's plots as they were before they first went to the account (kept, never removed by the page). */
export const backupKey = (twinKey: string) => `swathwise:twin-plots-before-account:${twinKey}`;

function loadMeta(twinKey: string, twinId: string): Meta {
  const none: Meta = { twinId, uploadedAt: null, pending: [], deleted: [] };
  try {
    const v = JSON.parse(localStorage.getItem(metaKey(twinKey)) ?? "null") as Partial<Meta> | null;
    if (!v || v.twinId !== twinId) return none;
    return {
      twinId,
      uploadedAt: typeof v.uploadedAt === "string" ? v.uploadedAt : null,
      pending: Array.isArray(v.pending) ? v.pending.filter((u): u is string => typeof u === "string") : [],
      deleted: Array.isArray(v.deleted) ? v.deleted.filter((d): d is { uid: string; at: string } => !!d && typeof d.uid === "string" && typeof d.at === "string") : [],
    };
  } catch { return none; }
}
function saveMeta(twinKey: string, m: Meta): boolean {
  try { localStorage.setItem(metaKey(twinKey), JSON.stringify(m)); return true; } catch { return false; }
}

const time = (s: string | null | undefined) => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : 0; };
export const toAccount = (p: Plot, deletedAt: string | null = null): AccountPlot => ({ uid: p.uid, number: p.number, name: p.name, colour: p.colour, ring: p.ring, shape: p.shape, drawn_at: p.at || null, edited_at: p.updatedAt || p.at || new Date().toISOString(), deleted_at: deletedAt });
const fromAccount = (a: AccountPlot): Plot => ({ uid: a.uid, number: a.number, name: a.name, colour: a.colour, ring: a.ring, shape: a.shape, at: a.drawn_at ?? a.edited_at, updatedAt: a.edited_at });
/** The last thing the account knows happened to a plot: its edit, or its delete. */
const lastOf = (a: AccountPlot) => Math.max(time(a.edited_at), time(a.deleted_at));

export type SyncResult =
  | { where: "account"; plots: Plot[]; sent: number }
  | { where: "device"; plots: Plot[]; why: string };

/** Why the account could not be used, in words for the plot card. */
export function syncProblem(e: unknown): string {
  const msg = `${(e as { code?: string })?.code ?? ""} ${(e as Error)?.message ?? e}`;
  if (/twin_plots/.test(msg) && /does not exist|PGRST205|schema cache/i.test(msg)) return "Kept on this device: saving plots in your account is not switched on yet.";
  if (/row-level security|permission denied|42501/i.test(msg)) return "Kept on this device: your account cannot keep plots yet.";
  return "Kept on this device: your account could not be reached. Plots will be sent when it can.";
}

/**
 * Open a twin's plots: send what this device holds that the account does not (all of it, the first time), read the
 * account back, and take its list when it holds everything sent. Anything going wrong leaves the device as it was.
 */
export async function syncOnOpen(twinKey: string, twinId: string, backend: PlotBackend): Promise<SyncResult> {
  const device = loadPlots(twinKey), meta = loadMeta(twinKey, twinId);
  try {
    const before = await backend.list(twinId), byUid = new Map(before.map(a => [a.uid, a]));
    const first = !meta.uploadedAt;
    if (first && device.length) { try { if (!localStorage.getItem(backupKey(twinKey))) localStorage.setItem(backupKey(twinKey), JSON.stringify({ version: 1, plots: device, at: new Date().toISOString() })); } catch { /* storage full: the device copy itself still stands */ } }
    const pending = new Set(meta.pending), send: AccountPlot[] = [];
    for (const p of device) {
      if (!first && !pending.has(p.uid)) continue;
      const a = byUid.get(p.uid);
      if (!a || time(p.updatedAt || p.at) > lastOf(a)) send.push(toAccount(p));
    }
    for (const d of meta.deleted) {
      const a = byUid.get(d.uid);
      if (a && !a.deleted_at && time(d.at) >= time(a.edited_at)) send.push({ ...a, deleted_at: d.at });
    }
    if (send.length) await backend.put(twinId, send);
    const after = send.length ? await backend.list(twinId) : before, got = new Map(after.map(a => [a.uid, a]));
    // Confirmed: every plot sent is in the account, as sent or newer.
    const missing = send.filter(s => { const a = got.get(s.uid); return !a || lastOf(a) < Math.max(time(s.edited_at), time(s.deleted_at)); });
    if (missing.length) throw new Error(`the account did not keep ${missing.length} plot(s)`);
    const plots = after.filter(a => !a.deleted_at).map(fromAccount).sort((a, b) => a.number - b.number || a.at.localeCompare(b.at));
    if (!savePlots(twinKey, plots)) return { where: "account", plots, sent: send.length };
    saveMeta(twinKey, { twinId, uploadedAt: meta.uploadedAt ?? new Date().toISOString(), pending: [], deleted: [] });
    return { where: "account", plots, sent: send.length };
  } catch (e) {
    return { where: "device", plots: device, why: syncProblem(e) };
  }
}

/**
 * A change on this device: `next` the plots now, `prev` before. Saved on the device and marked to send first; then
 * sent. Resolves to null when the account took it, else to the words for why it waits on this device.
 */
export async function pushChange(twinKey: string, twinId: string, backend: PlotBackend, prev: Plot[], next: Plot[]): Promise<string | null> {
  const meta = loadMeta(twinKey, twinId), was = new Map(prev.map(p => [p.uid, p])), now = new Date().toISOString();
  const changed = next.filter(p => was.get(p.uid) !== p), gone = prev.filter(p => !next.some(q => q.uid === p.uid));
  const marked: Meta = { ...meta, pending: [...new Set([...meta.pending, ...changed.map(p => p.uid)])], deleted: [...meta.deleted.filter(d => !gone.some(g => g.uid === d.uid)), ...gone.map(g => ({ uid: g.uid, at: now }))] };
  saveMeta(twinKey, marked);
  // Before this device's plots first went up, the next open sends all of them: nothing more to do now.
  if (!meta.uploadedAt) return "Saved on this device; it goes to your account the next time this twin opens.";
  try {
    const send = [...changed.map(p => toAccount(p)), ...gone.map(g => toAccount(g, now))];
    if (send.length) await backend.put(twinId, send);
    const left = loadMeta(twinKey, twinId);
    saveMeta(twinKey, { ...left, pending: left.pending.filter(u => !changed.some(p => p.uid === u)), deleted: left.deleted.filter(d => !gone.some(g => g.uid === d.uid)) });
    return null;
  } catch (e) {
    return `${syncProblem(e).replace(/^Kept on this device: /, "Saved on this device, not yet in your account: ")}`;
  }
}

/** The account in the app: public.twin_plots. */
export const accountPlots: PlotBackend = {
  async list(twinId) {
    const { data, error } = await (supabase.from("twin_plots" as never).select("uid, number, name, colour, ring, shape, drawn_at, edited_at, deleted_at").eq("twin_id", twinId) as unknown as PromiseLike<{ data: AccountPlot[] | null; error: { code?: string; message: string } | null }>);
    if (error) throw Object.assign(new Error(`twin_plots: ${error.message}`), { code: error.code });
    return data ?? [];
  },
  async put(twinId, plots) {
    const rows = plots.map(p => ({ ...p, twin_id: twinId }));
    const { error } = await (supabase.from("twin_plots" as never).upsert(rows as never, { onConflict: "user_id,uid" }) as unknown as PromiseLike<{ error: { code?: string; message: string } | null }>);
    if (error) throw Object.assign(new Error(`twin_plots: ${error.message}`), { code: error.code });
  },
};
