// @vitest-environment node
//
// The analysis record's copy on the device (src/lib/fieldTwin/analysisOutbox.ts): an upload cut short is finished on the
// next visit of the same account, with the record whole; nothing is sent for another account, for a twin that was
// deleted or is not ready, or after its time; the device keeps a limited number for a limited time; deleting a twin
// takes its waiting record with it; and none of it ever touches the twin. Storage and the twin list are in memory here;
// the browser's own database is exercised in a real browser (docs/features/twin-analysis-record.md).
import { gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- the account, in memory ---------------------------------------------------------------------------------------
const objects = new Map<string, Blob>();
const twins = new Map<string, { id: string; user_id: string; status: string }>();
let signedIn: string | null = "alice";
let uploadFails: string | null = null;
let listFails = false;
let uploadGate: Promise<void> | null = null;
const calls: string[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: signedIn ? { user: { id: signedIn } } : null } }) },
    from: (table: string) => ({
      // The signed-in account's own rows only, as the table's rules have it.
      select: () => ({ eq: (_col: string, id: string) => ({ maybeSingle: async () => {
        calls.push(`ask ${table} ${id}`);
        if (listFails) return { data: null, error: { message: "Failed to fetch" } };
        const row = twins.get(id);
        return { data: row && row.user_id === signedIn ? { id: row.id, status: row.status } : null, error: null };
      } }) }),
      delete: () => ({ eq: async (_col: string, id: string) => { calls.push(`delete record ${id}`); twins.delete(id); return { error: null }; } }),
    }),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, blob: Blob) => {
          calls.push(`upload ${path}`);
          if (uploadGate) await uploadGate;
          // The folder is the signed-in account's own, or the storage refuses (the bucket's rules).
          if (path.split("/")[0] !== signedIn) return { error: { message: "new row violates row-level security policy" } };
          if (uploadFails) return { error: { message: uploadFails } };
          objects.set(`${bucket}/${path}`, blob);
          return { error: null };
        },
        list: async (folder: string) => ({ data: [...objects.keys()].filter(k => k.startsWith(`${bucket}/${folder}/`)).map(k => ({ id: "x", name: k.slice(`${bucket}/${folder}/`.length) })), error: null }),
        remove: async (paths: string[]) => { for (const p of paths) { calls.push(`remove ${p}`); objects.delete(`${bucket}/${p}`); } return { error: null }; },
      }),
    },
  },
}));
const tracked: { name: string; f: Record<string, unknown> }[] = [];
vi.mock("@/lib/pilot/telemetry", () => ({ track: (name: string, f: Record<string, unknown> = {}) => { tracked.push({ name, f }); } }));

import { ANALYSIS_PENDING_MAX_AGE_MS, ANALYSIS_PENDING_MAX_ATTEMPTS, ANALYSIS_PENDING_MAX_BYTES, ANALYSIS_PENDING_MAX_ENTRIES, ANALYSIS_PENDING_QUIET_MS, TWIN_ANALYSIS_FILE } from "@/lib/fieldTwin/analysisConfig";
import { type PendingAnalysis, __setPendingStoreForTests, flushAnalysisOutbox, forgetAccountPending, forgetPendingAnalysis, memoryStore, pendingAnalyses, saveAnalysisRecord } from "@/lib/fieldTwin/analysisOutbox";
import { deleteTwin } from "@/lib/fieldTwin/registry";

const T1 = "3f2a9c1e-0000-4000-8000-000000000001", T2 = "3f2a9c1e-0000-4000-8000-000000000002";
const RECORD = { format: "swardus-twin-analysis-v1", twinId: T1, reads: [{ name: "DJI_0746", plants: [[101.25, 2000.5], [3.125, 4.0625]] }], frames: [{ name: "DJI_0746", pose: { lat: 40.000071234567, lng: -89.999995123456 } }] };
const json = (v: unknown = RECORD) => new Blob([JSON.stringify(v)], { type: "application/json" });
const pathOf = (user: string, twin: string) => `orthos/${user}/field-twins/${twin}/${TWIN_ANALYSIS_FILE}`;
const stored = async (user: string, twin: string) => JSON.parse(gunzipSync(Buffer.from(await objects.get(pathOf(user, twin))!.arrayBuffer())).toString("utf8"));
const uploads = () => calls.filter(c => c.startsWith("upload "));
const twin = (id: string, user = "alice", status = "ready") => { twins.set(id, { id, user_id: user, status }); return { id, storage_key: id }; };
const entry = (over: Partial<PendingAnalysis> = {}): PendingAnalysis => ({ key: `alice/${T1}`, userId: "alice", twinId: T1, storageKey: T1, bytes: new Uint8Array([31, 139, 8, 0]), createdAt: Date.now() - 60 * 60_000, attempts: 0, lastTriedAt: 0, ...over });

let device: ReturnType<typeof memoryStore>;
beforeEach(() => {
  objects.clear(); twins.clear(); calls.length = 0; tracked.length = 0;
  signedIn = "alice"; uploadFails = null; listFails = false; uploadGate = null;
  device = memoryStore(); __setPendingStoreForTests(device);
});

describe("an upload cut short is finished on the next visit", () => {
  it("the record that could not go up waits on the device, and the next visit puts it beside the twin, whole", async () => {
    const t = twin(T1);
    uploadFails = "Failed to fetch";
    expect(await saveAnalysisRecord("alice", t, json())).toBe("waiting");
    expect(objects.size).toBe(0);
    expect(device.map.size).toBe(1);
    expect(tracked).toMatchObject([{ name: "twin_analysis_failed", f: { twinId: T1, error: "Failed to fetch", detail: { waiting: true } } }]);
    // The connection is back, the app is opened again as the same account.
    uploadFails = null;
    expect(await flushAnalysisOutbox("alice")).toEqual({ sent: 1, kept: 0, dropped: 0 });
    expect([...objects.keys()]).toEqual([pathOf("alice", T1)]);
    // Exactly the record the build made: nothing rounded, nothing lost on the way through the device.
    expect(await stored("alice", T1)).toEqual(RECORD);
    expect(device.map.size).toBe(0);
    expect(tracked.at(-1)).toMatchObject({ name: "twin_analysis_saved", f: { twinId: T1, outcome: "ok", counts: { attempts: 2 }, detail: { later: true } } });
    // Nothing left to do on the visit after that.
    calls.length = 0;
    expect(await flushAnalysisOutbox("alice")).toEqual({ sent: 0, kept: 0, dropped: 0 });
    expect(calls).toEqual([]);
  });

  it("a tab closed while the record was going up: the copy left on the device is sent later, once its upload can no longer be under way", async () => {
    twin(T1);
    const now = Date.now();
    device.map.set(`alice/${T1}`, entry({ createdAt: now - 30_000, lastTriedAt: now - 30_000 }));
    // Half a minute later it may still be another tab's upload: left alone.
    expect(await flushAnalysisOutbox("alice", now)).toEqual({ sent: 0, kept: 1, dropped: 0 });
    expect(uploads()).toEqual([]);
    expect(await flushAnalysisOutbox("alice", now - 30_000 + ANALYSIS_PENDING_QUIET_MS + 1)).toEqual({ sent: 1, kept: 0, dropped: 0 });
    expect(objects.has(pathOf("alice", T1))).toBe(true);
    expect(device.map.size).toBe(0);
  });

  it("a record that arrived and was not taken off the device is sent again as itself, and then taken off", async () => {
    const t = twin(T1);
    const original = device.remove;
    device.remove = async () => { throw new Error("the database is busy"); };
    expect(await saveAnalysisRecord("alice", t, json())).toBe("saved");
    expect(device.map.size).toBe(1);
    device.remove = original;
    expect(await flushAnalysisOutbox("alice", Date.now() + ANALYSIS_PENDING_QUIET_MS + 1)).toEqual({ sent: 1, kept: 0, dropped: 0 });
    expect(await stored("alice", T1)).toEqual(RECORD);
    expect(objects.size).toBe(1);
    expect(device.map.size).toBe(0);
  });

  it("a visit that cannot reach the account keeps the record and does not count against it", async () => {
    twin(T1);
    device.map.set(`alice/${T1}`, entry());
    listFails = true;
    expect(await flushAnalysisOutbox("alice")).toEqual({ sent: 0, kept: 1, dropped: 0 });
    expect(uploads()).toEqual([]);
    expect(device.map.get(`alice/${T1}`)).toMatchObject({ attempts: 0 });
  });

  it("two visits at once send it once", async () => {
    twin(T1);
    device.map.set(`alice/${T1}`, entry());
    const [a, b] = await Promise.all([flushAnalysisOutbox("alice"), flushAnalysisOutbox("alice")]);
    expect(a).toEqual({ sent: 1, kept: 0, dropped: 0 });
    expect(b).toBe(a);
    expect(uploads()).toHaveLength(1);
  });

  it("refused again and again, it is given up after a fixed number of tries", async () => {
    twin(T1);
    device.map.set(`alice/${T1}`, entry({ attempts: ANALYSIS_PENDING_MAX_ATTEMPTS - 2 }));
    uploadFails = "Payload too large";
    expect(await flushAnalysisOutbox("alice")).toEqual({ sent: 0, kept: 1, dropped: 0 });
    expect(device.map.get(`alice/${T1}`)).toMatchObject({ attempts: ANALYSIS_PENDING_MAX_ATTEMPTS - 1, lastTriedAt: 0 });
    expect(await flushAnalysisOutbox("alice")).toEqual({ sent: 0, kept: 0, dropped: 1 });
    expect(device.map.size).toBe(0);
    expect(tracked.at(-1)).toMatchObject({ name: "twin_analysis_failed", f: { counts: { attempts: ANALYSIS_PENDING_MAX_ATTEMPTS }, detail: { waiting: false, later: true } } });
  });
});

describe("never stale, never another account's", () => {
  it("another account on the same device neither sends nor removes it, and it is not looked up", async () => {
    twin(T1);
    device.map.set(`alice/${T1}`, entry());
    signedIn = "bob";
    expect(await flushAnalysisOutbox("bob")).toEqual({ sent: 0, kept: 0, dropped: 0 });
    expect(calls).toEqual([]);
    expect(device.map.size).toBe(1);
    // Alice is back: it goes to her folder.
    signedIn = "alice";
    expect(await flushAnalysisOutbox("alice")).toEqual({ sent: 1, kept: 0, dropped: 0 });
    expect([...objects.keys()]).toEqual([pathOf("alice", T1)]);
  });

  it("the page thinking it is one account while the session is another sends nothing, and that is not counted as a refusal", async () => {
    twins.set(T1, { id: T1, user_id: "bob", status: "ready" });
    // A record under Alice's name, a page still holding Alice's id, a session that is Bob's (who can see a twin of that id).
    device.map.set(`alice/${T1}`, entry());
    signedIn = "bob";
    expect(await flushAnalysisOutbox("alice")).toEqual({ sent: 0, kept: 1, dropped: 0 });
    expect(uploads()).toEqual([]);
    expect(device.map.get(`alice/${T1}`)).toMatchObject({ attempts: 0, lastTriedAt: 0 });
    // Signed out altogether: the same.
    signedIn = null; twins.set(T1, { id: T1, user_id: "alice", status: "ready" });
    await flushAnalysisOutbox("alice");
    expect(uploads()).toEqual([]);
  });

  it("a build's own upload is not sent as another account either: it waits for its owner", async () => {
    const t = twin(T1);
    signedIn = "bob";
    expect(await saveAnalysisRecord("alice", t, json())).toBe("waiting");
    expect(uploads()).toEqual([]);
    expect(objects.size).toBe(0);
    expect(device.map.get(`alice/${T1}`)).toMatchObject({ attempts: 0, lastTriedAt: 0 });
  });

  it("signing out leaves nothing of that account on the device, and another account's records alone", async () => {
    device.map.set(`alice/${T1}`, entry());
    device.map.set("alice/other", entry({ key: "alice/other", storageKey: "other" }));
    device.map.set(`bob/${T2}`, entry({ key: `bob/${T2}`, userId: "bob", twinId: T2, storageKey: T2 }));
    await forgetAccountPending("alice");
    expect([...device.map.keys()]).toEqual([`bob/${T2}`]);
    expect(calls).toEqual([]);
  });

  it("a twin deleted since (on any device) has its waiting record dropped, not sent", async () => {
    device.map.set(`alice/${T1}`, entry());
    expect(await flushAnalysisOutbox("alice")).toEqual({ sent: 0, kept: 0, dropped: 1 });
    expect(uploads()).toEqual([]);
    expect(device.map.size).toBe(0);
    // Nothing failed: no event.
    expect(tracked).toEqual([]);
  });

  it("a twin that is not ready is not given a record; the record waits", async () => {
    twin(T1, "alice", "incomplete");
    device.map.set(`alice/${T1}`, entry());
    expect(await flushAnalysisOutbox("alice")).toEqual({ sent: 0, kept: 1, dropped: 0 });
    expect(uploads()).toEqual([]);
  });

  it("after its time a record is dropped unsent, whoever it belongs to; only the signed-in account's own loss is recorded", async () => {
    twin(T1); twin(T2, "bob");
    const old = Date.now() - ANALYSIS_PENDING_MAX_AGE_MS - 1;
    device.map.set(`alice/${T1}`, entry({ createdAt: old, attempts: 3 }));
    device.map.set(`bob/${T2}`, entry({ key: `bob/${T2}`, userId: "bob", twinId: T2, storageKey: T2, createdAt: old }));
    expect(await flushAnalysisOutbox("alice")).toEqual({ sent: 0, kept: 0, dropped: 2 });
    expect(calls).toEqual([]);
    expect(device.map.size).toBe(0);
    expect(tracked).toMatchObject([{ name: "twin_analysis_failed", f: { twinId: T1, error: "not sent in time", counts: { attempts: 3 } } }]);
  });
});

describe("what the device keeps is limited", () => {
  it("one record per twin, and at most a fixed number: the oldest make room", async () => {
    signedIn = null; // nothing can go up: every record stays
    for (let k = 0; k < ANALYSIS_PENDING_MAX_ENTRIES + 2; k++) {
      await saveAnalysisRecord("alice", { id: `twin-${k}`, storage_key: `twin-${k}` }, json({ k }));
      await new Promise(r => setTimeout(r, 2));
    }
    await saveAnalysisRecord("alice", { id: "twin-6", storage_key: "twin-6" }, json({ k: 6, again: true }));
    const kept = (await pendingAnalyses()).map(e => e.storageKey).sort();
    expect(kept).toEqual(["twin-2", "twin-3", "twin-4", "twin-5", "twin-6"]);
  });

  it("and at most a fixed size together", async () => {
    const big = new Uint8Array(ANALYSIS_PENDING_MAX_BYTES / 2 - 1000);
    device.map.set("alice/a", entry({ key: "alice/a", storageKey: "a", bytes: big, createdAt: Date.now() - 3000 }));
    device.map.set("alice/b", entry({ key: "alice/b", storageKey: "b", bytes: big, createdAt: Date.now() - 2000 }));
    signedIn = null;
    await saveAnalysisRecord("alice", { id: "c", storage_key: "c" }, json(Array.from({ length: 400 }, (_, i) => `incompressible ${Math.random()} ${i}`)));
    expect((await pendingAnalyses()).map(e => e.storageKey).sort()).toEqual(["b", "c"]);
  });

  it("records past their time are cleared when a new one is kept", async () => {
    device.map.set(`bob/${T2}`, entry({ key: `bob/${T2}`, userId: "bob", twinId: T2, storageKey: T2, createdAt: Date.now() - ANALYSIS_PENDING_MAX_AGE_MS - 1 }));
    signedIn = null;
    await saveAnalysisRecord("alice", twin(T1), json());
    expect((await pendingAnalyses()).map(e => e.key)).toEqual([`alice/${T1}`]);
  });
});

describe("deleting a twin", () => {
  it("removes its files, its record in storage, its list entry and its waiting record", async () => {
    const t = twin(T1);
    for (const f of ["twin.json.gz", "atlas-0.jpg", TWIN_ANALYSIS_FILE]) objects.set(`orthos/alice/field-twins/${T1}/${f}`, new Blob(["x"]));
    objects.set(`orthos/alice/field-twins/${T2}/twin.json.gz`, new Blob(["other twin"]));
    device.map.set(`alice/${T1}`, entry());
    device.map.set(`alice/${T2}`, entry({ key: `alice/${T2}`, twinId: T2, storageKey: T2 }));
    await deleteTwin("alice", t);
    expect([...objects.keys()]).toEqual([`orthos/alice/field-twins/${T2}/twin.json.gz`]);
    expect(twins.has(T1)).toBe(false);
    expect([...device.map.keys()]).toEqual([`alice/${T2}`]);
    // And nothing brings it back on a later visit.
    await flushAnalysisOutbox("alice");
    expect(objects.has(pathOf("alice", T1))).toBe(false);
  });

  it("a record still in the air when its twin is deleted is taken out when it lands", async () => {
    const t = twin(T1);
    objects.set(`orthos/alice/field-twins/${T1}/twin.json.gz`, new Blob(["x"]));
    let open!: () => void;
    uploadGate = new Promise<void>(r => { open = r; });
    const saving = saveAnalysisRecord("alice", t, json());
    await new Promise(r => setTimeout(r, 5));
    expect(uploads()).toHaveLength(1);
    await deleteTwin("alice", t);
    open();
    expect(await saving).toBe("saved");
    expect([...objects.keys()]).toEqual([]);
    expect(device.map.size).toBe(0);
  });

  it("forgetting a twin that has nothing waiting touches nothing in the account", async () => {
    await forgetPendingAnalysis("alice", T1);
    expect(calls).toEqual([]);
  });
});

describe("a device that keeps nothing", () => {
  it("has nothing to send, and says so without asking anything", async () => {
    __setPendingStoreForTests(null);
    expect(await flushAnalysisOutbox("alice")).toEqual({ sent: 0, kept: 0, dropped: 0 });
    expect(await pendingAnalyses()).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("a database that fails is the same as none: nothing thrown, nothing sent", async () => {
    __setPendingStoreForTests({ all: async () => { throw new Error("blocked"); }, put: async () => { throw new Error("blocked"); }, remove: async () => { throw new Error("blocked"); } });
    expect(await flushAnalysisOutbox("alice")).toEqual({ sent: 0, kept: 0, dropped: 0 });
    await expect(forgetPendingAnalysis("alice", T1)).resolves.toBeUndefined();
    expect(await pendingAnalyses()).toEqual([]);
  });
});
