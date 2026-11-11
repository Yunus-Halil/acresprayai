// A corn twin's analysis record (analysis.ts) on its way to the account, kept on the device until it has arrived.
//
// The record goes up after the twin is saved, when the build page has already said the tab may close. So it is written
// to the browser's own database first, sent, and removed once the account's storage has it. If the tab closes, the
// device sleeps or the connection drops in between, the copy on the device is sent the next time the same account has
// the app open. It is all apart from the twin: nothing here reads or writes the twin's files, its record or its
// status, and a record that never arrives leaves a whole twin, like every twin saved before records existed.
//
// What is kept, and for how long (the numbers are in analysisConfig.ts):
//   - only records of twins that were saved, each under the account and the twin it belongs to;
//   - sent only while that same account is signed in (another account on the device neither sees nor sends it, and
//     the storage rules would refuse the folder anyway);
//   - sent only while the twin is still listed as ready; a deleted twin's waiting record is dropped, not sent;
//   - dropped after 7 days, after 8 refusals, when the account signs out on this device, or when newer records need
//     the room (5 records, 20 MB).
//
// A browser without a database of its own (some private windows) sends the record once, as before, and keeps nothing.
import { supabase } from "@/integrations/supabase/client";
import { track } from "@/lib/pilot/telemetry";
import { storageKey } from "@/lib/storage";
import { ANALYSIS_PENDING_MAX_AGE_MS, ANALYSIS_PENDING_MAX_ATTEMPTS, ANALYSIS_PENDING_MAX_BYTES, ANALYSIS_PENDING_MAX_ENTRIES, ANALYSIS_PENDING_QUIET_MS, TWIN_ANALYSIS_ENABLED } from "./analysisConfig";
import { blobBytes, packTwinAnalysis, removeTwinAnalysis, uploadTwinAnalysis } from "./store";

export type PendingAnalysis = {
  /** `<user id>/<twin folder>`: one waiting record per twin. */
  key: string;
  userId: string;
  /** The twin's record (public.field_twins) and its folder in the account. */
  twinId: string;
  storageKey: string;
  /** The record as it is stored (gzipped). */
  bytes: Uint8Array;
  createdAt: number;
  /** Times the account's storage refused it. */
  attempts: number;
  /** When it was last handed to an upload (0: free to try). */
  lastTriedAt: number;
};

/** Where waiting records are kept. The browser's database in the app; a plain map in the tests. */
export interface PendingStore {
  all(): Promise<PendingAnalysis[]>;
  put(entry: PendingAnalysis): Promise<void>;
  remove(key: string): Promise<void>;
}

// ---- the browser's database ---------------------------------------------------------------------------------------
const DB_NAME = storageKey("twin-analysis-pending"), DB_STORE = "records";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE, { keyPath: "key" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("the device's database could not be opened"));
    req.onblocked = () => reject(new Error("the device's database is busy"));
  });
}
/** One request in its own transaction; settled when the transaction is (so a write is on the device, not only asked for). */
async function inDb<T>(mode: IDBTransactionMode, ask: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode);
      const req = ask(tx.objectStore(DB_STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? req.error ?? new Error("the device's database refused"));
      tx.onabort = () => reject(tx.error ?? new Error("the device's database gave up"));
    });
  } finally { db.close(); }
}
export const deviceStore: PendingStore = {
  all: () => inDb<PendingAnalysis[]>("readonly", s => s.getAll() as IDBRequest<PendingAnalysis[]>),
  put: async entry => { await inDb("readwrite", s => s.put(entry)); },
  remove: async key => { await inDb("readwrite", s => s.delete(key)); },
};

let override: PendingStore | null | undefined;
const pendingStore = (): PendingStore | null => (override !== undefined ? override : typeof indexedDB === "undefined" ? null : deviceStore);

// ---- keeping -------------------------------------------------------------------------------------------------------
const keyOf = (userId: string, twinFolder: string) => `${userId}/${twinFolder}`;
/** Twins deleted in this tab: a record of one that arrives afterwards is taken out again. */
const deletedHere = new Set<string>();
/** Records this tab is sending right now. */
const onTheirWay = new Set<string>();

/**
 * Keep `entry` on the device, making room first: what has outlived its time goes, then the oldest, until it fits the
 * limits. False when the device keeps nothing (no database, or it refused): the caller sends the record anyway.
 */
async function keep(entry: PendingAnalysis, now: number): Promise<boolean> {
  const store = pendingStore();
  if (!store || entry.bytes.byteLength > ANALYSIS_PENDING_MAX_BYTES) return false;
  try {
    const others = (await store.all()).filter(e => e.key !== entry.key).sort((a, b) => a.createdAt - b.createdAt);
    const live: PendingAnalysis[] = [];
    for (const e of others) { if (now - e.createdAt > ANALYSIS_PENDING_MAX_AGE_MS) await store.remove(e.key); else live.push(e); }
    let bytes = live.reduce((n, e) => n + e.bytes.byteLength, entry.bytes.byteLength);
    while (live.length && (live.length + 1 > ANALYSIS_PENDING_MAX_ENTRIES || bytes > ANALYSIS_PENDING_MAX_BYTES)) {
      const oldest = live.shift()!;
      await store.remove(oldest.key);
      bytes -= oldest.bytes.byteLength;
    }
    await store.put(entry);
    return true;
  } catch { return false; }
}

const quietly = async (run: () => Promise<unknown>) => { try { await run(); } catch { /* the device's database: never in the way */ } };

// ---- sending -------------------------------------------------------------------------------------------------------
/** Not a refusal by the account's storage: the record is not this session's to send right now. */
class NotNow extends Error {}

/** Put a record beside its twin, as the account it belongs to and no other. Returns the stored size. */
async function send(entry: PendingAnalysis): Promise<number> {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user?.id !== entry.userId) throw new NotNow("signed in as another account, or signed out");
  onTheirWay.add(entry.key);
  try {
    const size = await uploadTwinAnalysis(entry.userId, entry.storageKey, new Blob([entry.bytes as BlobPart], { type: "application/gzip" }));
    // The twin was deleted in this tab while the record was on its way: its folder is to stay empty.
    if (deletedHere.has(entry.key)) await quietly(() => removeTwinAnalysis(entry.userId, entry.storageKey));
    return size;
  } finally { onTheirWay.delete(entry.key); }
}

export type AnalysisSave = "saved" | "waiting" | "lost";

/**
 * Save a twin's record once the twin itself is saved: onto the device first, then to the account, then off the device.
 * Never throws and never touches the twin. "waiting": not in the account yet, but on the device for the next visit.
 * "lost": neither (too large, or a device that keeps nothing and an upload that failed).
 */
export async function saveAnalysisRecord(userId: string, twin: { id: string; storage_key: string }, json: Blob): Promise<AnalysisSave> {
  const t0 = Date.now();
  let entry: PendingAnalysis | null = null, kept = false;
  try {
    const packed = await packTwinAnalysis(json);
    entry = { key: keyOf(userId, twin.storage_key), userId, twinId: twin.id, storageKey: twin.storage_key, bytes: await blobBytes(packed), createdAt: t0, attempts: 0, lastTriedAt: t0 };
    kept = await keep(entry, t0);
    const bytes = await send(entry);
    if (kept) await quietly(() => pendingStore()!.remove(entry!.key));
    track("twin_analysis_saved", { twinId: twin.id, durationMs: Date.now() - t0, outcome: "ok", counts: { bytes, jsonBytes: json.size } });
    return "saved";
  } catch (e) {
    // The twin was deleted meanwhile: nothing waits for it.
    if (entry && deletedHere.has(entry.key)) kept = false;
    // Free to be tried on the next visit; a refusal by the storage counts as one.
    if (kept && entry) { const waiting = { ...entry, attempts: e instanceof NotNow ? 0 : 1, lastTriedAt: 0 }; await quietly(() => pendingStore()!.put(waiting)); }
    try { track("twin_analysis_failed", { twinId: twin.id, durationMs: Date.now() - t0, outcome: "error", error: (e as Error)?.message ?? String(e), detail: { waiting: kept } }); } catch { /* never in the way */ }
    return kept ? "waiting" : "lost";
  }
}

export type FlushResult = { sent: number; kept: number; dropped: number };
const NOTHING: FlushResult = { sent: 0, kept: 0, dropped: 0 };

async function flush(userId: string, now: number): Promise<FlushResult> {
  const store = pendingStore();
  if (!store || !TWIN_ANALYSIS_ENABLED) return NOTHING;
  const out: FlushResult = { sent: 0, kept: 0, dropped: 0 };
  let entries: PendingAnalysis[];
  try { entries = await store.all(); } catch { return NOTHING; }
  for (const e of entries.sort((a, b) => a.createdAt - b.createdAt)) {
    try {
      const mine = e.userId === userId;
      if (now - e.createdAt > ANALYSIS_PENDING_MAX_AGE_MS) {
        // Whoever it belongs to. Only this account's own loss is recorded, under this account.
        await store.remove(e.key); out.dropped++;
        if (mine) track("twin_analysis_failed", { twinId: e.twinId, outcome: "error", error: "not sent in time", counts: { attempts: e.attempts }, detail: { waiting: false, later: true } });
        continue;
      }
      // Another account's stays as it is: not read further, not sent, not removed.
      if (!mine) continue;
      if (now - e.lastTriedAt < ANALYSIS_PENDING_QUIET_MS) { out.kept++; continue; }
      // Is the twin still there? Asked as the signed-in account: its own row, or nothing.
      const { data, error } = await supabase.from("field_twins").select("id, status").eq("id", e.twinId).maybeSingle();
      if (error) { out.kept++; continue; }
      if (!data) { await store.remove(e.key); out.dropped++; continue; }
      if ((data as { status?: string }).status !== "ready") { out.kept++; continue; }
      await store.put({ ...e, lastTriedAt: now });
      const t0 = Date.now();
      try {
        const bytes = await send(e);
        await store.remove(e.key); out.sent++;
        track("twin_analysis_saved", { twinId: e.twinId, durationMs: Date.now() - t0, outcome: "ok", counts: { bytes, attempts: e.attempts + 1 }, detail: { later: true } });
      } catch (err) {
        if (err instanceof NotNow) { await store.put({ ...e, lastTriedAt: 0 }); out.kept++; continue; }
        const attempts = e.attempts + 1, giveUp = attempts >= ANALYSIS_PENDING_MAX_ATTEMPTS;
        if (giveUp) { await store.remove(e.key); out.dropped++; } else { await store.put({ ...e, attempts, lastTriedAt: 0 }); out.kept++; }
        track("twin_analysis_failed", { twinId: e.twinId, durationMs: Date.now() - t0, outcome: "error", error: (err as Error)?.message ?? String(err), counts: { attempts }, detail: { waiting: !giveUp, later: true } });
      }
    } catch { out.kept++; /* the device's database, mid-way: next time */ }
  }
  return out;
}

let flushing: Promise<FlushResult> | null = null;
/**
 * Send the records waiting on this device for `userId`, the signed-in account. One at a time in a tab, and in one tab
 * at a time where the browser can say so. Never throws.
 */
export function flushAnalysisOutbox(userId: string, now: number = Date.now()): Promise<FlushResult> {
  if (flushing) return flushing;
  const run = async (): Promise<FlushResult> => {
    try {
      const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
      if (locks?.request) return await locks.request(`${DB_NAME}.flush`, { ifAvailable: true }, lock => (lock ? flush(userId, now) : Promise.resolve(NOTHING)));
      return await flush(userId, now);
    } catch { return NOTHING; }
  };
  flushing = run().finally(() => { flushing = null; });
  return flushing;
}

/**
 * A twin was deleted (its files and its record are gone): its waiting record goes too. One that was on its way while
 * the twin's folder was being emptied may have landed just after: it is taken out here, and one still in the air is
 * taken out when it lands (send). Never throws.
 */
export async function forgetPendingAnalysis(userId: string, twinFolder: string): Promise<void> {
  const key = keyOf(userId, twinFolder);
  deletedHere.add(key);
  const store = pendingStore();
  let waiting = onTheirWay.has(key);
  if (store) await quietly(async () => { waiting = waiting || (await store.all()).some(e => e.key === key); await store.remove(key); });
  if (waiting) await quietly(() => removeTwinAnalysis(userId, twinFolder));
}

/** The account signed out on this device: nothing of it stays behind. Never throws. */
export async function forgetAccountPending(userId: string): Promise<void> {
  const store = pendingStore();
  if (!store) return;
  await quietly(async () => { for (const e of await store.all()) if (e.userId === userId) await store.remove(e.key); });
}

/** The records waiting on this device (every account's; the caller filters). Empty when the device keeps none. */
export async function pendingAnalyses(): Promise<PendingAnalysis[]> {
  const store = pendingStore();
  if (!store) return [];
  try { return await store.all(); } catch { return []; }
}

/** Tests only: where waiting records are kept (null: a device that keeps nothing; undefined: the browser's own). */
export function __setPendingStoreForTests(store: PendingStore | null | undefined) { override = store; deletedHere.clear(); flushing = null; }
/** Tests only: a store in memory. */
export function memoryStore(): PendingStore & { map: Map<string, PendingAnalysis> } {
  const map = new Map<string, PendingAnalysis>();
  return { map, all: async () => [...map.values()].map(e => ({ ...e })), put: async e => { map.set(e.key, { ...e }); }, remove: async k => { map.delete(k); } };
}
