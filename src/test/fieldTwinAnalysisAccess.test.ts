// @vitest-environment node
//
// Where the analysis record lives and who can reach it: stored gzipped in the twin's own folder and read back whole;
// too large a record is refused before any upload; the folder is the account's own under the pilot's storage rules
// (run as real SQL); and the founder's twin viewer is never handed it, even for a participant who allowed
// troubleshooting access.
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- storage, in memory -------------------------------------------------------------------------------------------
const objects = new Map<string, { blob: Blob; contentType?: string }>();
let failUpload: string | null = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, blob: Blob, opts?: { contentType?: string }) => {
          if (failUpload) return { error: { message: failUpload } };
          objects.set(`${bucket}/${path}`, { blob, contentType: opts?.contentType });
          return { error: null };
        },
        download: async (path: string) => { const o = objects.get(`${bucket}/${path}`); return o ? { data: o.blob, error: null } : { data: null, error: { message: "Object not found" } }; },
      }),
    },
  },
}));

import { TWIN_ANALYSIS_FILE, TWIN_ANALYSIS_MAX_BYTES } from "@/lib/fieldTwin/analysisConfig";
import { loadTwin, loadTwinAnalysisJson, saveTwin, saveTwinAnalysis } from "@/lib/fieldTwin/store";
import { CORN_TWIN } from "./fixtures/cornTwin";
import { ALICE, BOB, type Db, FOUNDER, STRANGER, freshDb } from "./sql/pgHarness";
import { type SupabaseMock, installDenoGlobal, jsonResponse, loadFunction, makeSupabase, mockFetch, postJson } from "./edge/harness";
import { __setMockClient } from "./edge/supabaseClientMock";

const USER = "aaaaaaaa-0000-0000-0000-000000000001", TWIN = "3f2a9c1e-0000-4000-8000-000000000001";
const record = { format: "swardus-twin-analysis-v1", twinId: TWIN, reads: [{ name: "746", plants: [[1, 2], [3, 4]] }] };
const json = (v: unknown) => new Blob([JSON.stringify(v)], { type: "application/json" });

beforeEach(() => { objects.clear(); failUpload = null; });

describe("the record in the account's storage", () => {
  it("is stored gzipped under the twin's own folder, and reads back whole", async () => {
    const bytes = await saveTwinAnalysis(USER, TWIN, json(record));
    expect([...objects.keys()]).toEqual([`orthos/${USER}/field-twins/${TWIN}/${TWIN_ANALYSIS_FILE}`]);
    const stored = objects.get(`orthos/${USER}/field-twins/${TWIN}/analysis.json.gz`)!;
    expect(stored.contentType).toBe("application/gzip");
    expect(bytes).toBe(stored.blob.size);
    expect(JSON.parse(gunzipSync(Buffer.from(await stored.blob.arrayBuffer())).toString("utf8"))).toEqual(record);
    expect(await loadTwinAnalysisJson(USER, TWIN)).toEqual(record);
  });

  it("a twin without one has none, and is opened exactly as before", async () => {
    await saveTwin(USER, { ...CORN_TWIN, id: TWIN }, new Map([["twin.json", json({ ...CORN_TWIN, id: TWIN })], ["atlas-0.jpg", new Blob(["x"])]]));
    expect([...objects.keys()].sort()).toEqual([`orthos/${USER}/field-twins/${TWIN}/atlas-0.jpg`, `orthos/${USER}/field-twins/${TWIN}/twin.json.gz`]);
    expect(await loadTwinAnalysisJson(USER, TWIN)).toBeNull();
    const before = await loadTwin(USER, TWIN);
    // With a record beside it the twin that opens is the same twin.
    await saveTwinAnalysis(USER, TWIN, json(record));
    expect(await loadTwin(USER, TWIN)).toEqual(before);
    expect(before.corn!.weeds).toHaveLength(2);
  });

  it("refuses a record over the size kept per twin, before anything is uploaded; a failed upload says why", async () => {
    // Bytes that do not compress.
    const big = new Uint8Array(TWIN_ANALYSIS_MAX_BYTES + 200_000);
    for (let i = 0; i < big.length; i += 65_536) crypto.getRandomValues(big.subarray(i, Math.min(big.length, i + 65_536)));
    await expect(saveTwinAnalysis(USER, TWIN, new Blob([big]))).rejects.toThrow(/over the 8 MB kept per twin/);
    expect(objects.size).toBe(0);
    failUpload = "storage blip";
    await expect(saveTwinAnalysis(USER, TWIN, json(record))).rejects.toThrow("storage blip");
  });
});

// ---- the pilot's storage rules, as real SQL -------------------------------------------------------------------
describe("the record's folder under the pilot's storage rules", () => {
  const MIGRATIONS = ["20261109120000_pilot_access.sql", "20261109130000_field_twins.sql", "20261109170000_founder_tools_only.sql"];
  const USERS = [{ id: FOUNDER, email: "YunusHalilErdogan5@gmail.com" }, { id: ALICE, email: "alice@farm.test" }, { id: BOB, email: "bob@farm.test" }, { id: STRANGER, email: "stranger@elsewhere.test" }];
  let db: Db | null = null;
  afterEach(async () => { await db?.close(); db = null; });
  const PUT = "INSERT INTO storage.objects (bucket_id, name) VALUES ('orthos', $1)";

  it("a participant keeps a record only beside their own twin; nobody else reads it, and an account outside the pilot neither", async () => {
    const d = await freshDb(MIGRATIONS, USERS);
    db = d;
    await d.query("INSERT INTO public.pilot_members (user_id, role) VALUES ($1, 'participant'), ($2, 'participant')", [ALICE, BOB]);
    const mine = `${ALICE}/field-twins/${TWIN}/${TWIN_ANALYSIS_FILE}`;
    await d.as(ALICE, PUT, [mine]);
    expect(await d.as(ALICE, "SELECT name FROM storage.objects")).toEqual([{ name: mine }]);
    expect(await d.as(BOB, "SELECT name FROM storage.objects")).toEqual([]);
    expect(await d.as(STRANGER, "SELECT name FROM storage.objects")).toEqual([]);
    expect(await d.as(null, "SELECT name FROM storage.objects", [], "anon").catch(() => [])).toEqual([]);
    // Not into another account's twin, and not outside the Field Twin folder.
    await expect(d.as(BOB, PUT, [`${ALICE}/field-twins/${TWIN}/${TWIN_ANALYSIS_FILE}`])).rejects.toThrow(/row-level security/);
    await expect(d.as(ALICE, PUT, [`${BOB}/field-twins/${TWIN}/${TWIN_ANALYSIS_FILE}`])).rejects.toThrow(/row-level security/);
    await expect(d.as(ALICE, PUT, [`${ALICE}/research/${TWIN_ANALYSIS_FILE}`])).rejects.toThrow(/row-level security/);
    // A paused participant no longer reaches it.
    await d.query("UPDATE public.pilot_members SET status = 'paused' WHERE user_id = $1", [ALICE]);
    expect(await d.as(ALICE, "SELECT name FROM storage.objects")).toEqual([]);
  });
});

// ---- the founder's twin viewer ---------------------------------------------------------------------------------
describe("pilot-admin twin-open", () => {
  let db: SupabaseMock;
  afterEach(() => { vi.unstubAllGlobals(); });

  it("never hands out the analysis record, even with the participant's troubleshooting permission", async () => {
    installDenoGlobal({ RESEND_API_KEY: "re_test" });
    const now = new Date().toISOString();
    db = makeSupabase({
      pilot_members: [{ user_id: "user-1", role: "founder", status: "active" }, { user_id: "p1", role: "participant", status: "active", display_name: "Ryan" }],
      field_twins: [{ id: TWIN, user_id: "p1", storage_key: "north-2026", name: "North", crop: "corn", status: "ready", updated_at: now, created_at: now }],
      pilot_consents: [{ user_id: "p1", troubleshooting_access: true, created_at: now }],
      admin_access_log: [],
    });
    for (const f of ["twin.json.gz", "atlas-0.jpg", TWIN_ANALYSIS_FILE]) db.storage.objects.set(`orthos/p1/field-twins/north-2026/${f}`, new Uint8Array([1]));
    __setMockClient(db.client);
    mockFetch([{ match: "/auth/v1/settings", respond: () => jsonResponse({}) }]);
    const handler = await loadFunction("../../../supabase/functions/pilot-admin/index.ts");
    const res = await handler(postJson("https://fn/pilot-admin", { action: "twin-open", twin_id: TWIN, reason: "looked wrong" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Object.keys(body.files).sort()).toEqual(["atlas-0.jpg", "twin.json.gz"]);
    expect(db.storage.calls.filter(c => c.op === "sign").some(c => /analysis/.test(c.path))).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/analysis/);
  });
});
