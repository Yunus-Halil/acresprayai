// @vitest-environment node
//
// The pilot gate on the edge functions. The orthomosaic workflow's functions run with the service-role key, so
// row security does not protect them: their own role check is the whole boundary. Every one of them must refuse a
// participant, an account outside the pilot and a paused founder before it reads a row, signs a URL or calls the
// processing node; and the ones that sign or fetch from a row's values must refuse values outside the caller's own
// folder (the audit's C1) and asset names that are paths (C2).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH, type SupabaseMock, binaryResponse, installDenoGlobal, jsonResponse, loadFunction, makeSupabase, mockFetch, postJson,
} from "./harness";
import { __setMockClient } from "./supabaseClientMock";
import { inOwnFolder, isOdmUuid, isPlainAssetName } from "../../../supabase/functions/_shared/access";

const UUID = "0d0d0d0d-1111-4222-8333-444455556661";
const TASK_ID = "11111111-2222-3333-4444-555555555555";

const MINE = {
  id: TASK_ID, user_id: "user-1", field_id: "field-1", odm_uuid: UUID, status: "completed", progress: 100,
  output_path: `user-1/odm/${UUID}/all.zip`, ortho_path: `user-1/${UUID}.tif`, band_mapping: null,
  tiles_baked: false, tiles_done: 0, tiles_total: 0, tiles_failed: 0, tiles_min_zoom: null, tiles_max_zoom: null,
  tiles_plan_locked: false, mirror_started_at: null, mirror_attempts: 0,
};

type Case = { name: string; module: string; request: () => Request };

const FOUNDER_ONLY: Case[] = [
  { name: "odm-submit", module: "../../../supabase/functions/odm-submit/index.ts",
    request: () => new Request("https://fn/odm-submit", { method: "POST", headers: { ...AUTH, "x-action": "capabilities" } }) },
  { name: "odm-poll", module: "../../../supabase/functions/odm-poll/index.ts",
    request: () => postJson("https://fn/odm-poll", { task_id: TASK_ID }) },
  { name: "ortho-import", module: "../../../supabase/functions/ortho-import/index.ts",
    request: () => postJson("https://fn/ortho-import?action=init", { field_id: "field-1" }) },
  { name: "ortho-url", module: "../../../supabase/functions/ortho-url/index.ts",
    request: () => new Request(`https://fn/ortho-url?task_id=${TASK_ID}`, { headers: AUTH }) },
  { name: "bake-tiles", module: "../../../supabase/functions/bake-tiles/index.ts",
    request: () => new Request(`https://fn/bake-tiles?task_id=${TASK_ID}`, { method: "POST", headers: AUTH }) },
  { name: "odm-asset", module: "../../../supabase/functions/odm-asset/index.ts",
    request: () => new Request(`https://fn/odm-asset?uuid=${UUID}&probe=ortho`, { headers: AUTH }) },
  { name: "tile", module: "../../../supabase/functions/tile/index.ts",
    request: () => new Request(`https://fn/tile/${UUID}/12/1/2.png?token=test-jwt`) },
  { name: "ndvi-tile", module: "../../../supabase/functions/ndvi-tile/index.ts",
    request: () => new Request(`https://fn/ndvi-tile/${TASK_ID}/12/1/2.png?token=test-jwt`) },
  { name: "bench-detect", module: "../../../supabase/functions/bench-detect/index.ts",
    request: () => postJson("https://fn/bench-detect", { image: "aGVsbG8=", mime: "image/jpeg" }) },
  { name: "weather", module: "../../../supabase/functions/weather/index.ts",
    request: () => new Request("https://fn/weather?lat=45.01&lon=-93.46", { headers: AUTH }) },
];

async function run(c: Case, members: Record<string, unknown>[], rows: Record<string, unknown>[] = [MINE], env: Record<string, string> = {}) {
  installDenoGlobal({ ROBOFLOW_API_KEY: "rf_test", OPENWEATHER_API_KEY: "ow_test", ...env });
  const db: SupabaseMock = makeSupabase({ odm_tasks: JSON.parse(JSON.stringify(rows)), fields: [{ id: "field-1", user_id: "user-1" }], pilot_members: members });
  __setMockClient(db.client);
  const fetches = mockFetch([{ match: /.*/, respond: () => jsonResponse({}) }]);
  const handler = await loadFunction(c.module);
  const res = await handler(c.request());
  return { status: res.status, body: await res.text(), db, fetches };
}

beforeEach(() => { installDenoGlobal(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe.each(FOUNDER_ONLY)("$name · founder only", (c) => {
  const refusals: [string, Record<string, unknown>[]][] = [
    ["a pilot participant", [{ user_id: "user-1", role: "participant", status: "active" }]],
    ["an account outside the pilot", []],
    ["a paused founder", [{ user_id: "user-1", role: "founder", status: "paused" }]],
    ["an ended founder", [{ user_id: "user-1", role: "founder", status: "ended" }]],
  ];

  it.each(refusals)("refuses %s with 403, before touching storage or any outside service", async (_who, members) => {
    const { status, body, db, fetches } = await run(c, members);
    expect(status).toBe(403);
    expect(body).toContain("not available on your account");
    expect(db.storage.calls, `${c.name} touched storage`).toHaveLength(0);
    expect(fetches, `${c.name} called out`).not.toHaveBeenCalled();
  });

  it("serves the founder (the gate is not what refuses them)", async () => {
    const { status } = await run(c, [{ user_id: "user-1", role: "founder", status: "active" }]);
    expect(status).not.toBe(403);
  });
});

describe("C1 · paths from the row must be the caller's own", () => {
  const FOREIGN = "victim-user/field-twins/north/twin.json.gz";
  const tampered = [
    { ...MINE, ortho_path: FOREIGN },
    { ...MINE, ortho_path: "user-1/../victim-user/x.tif" },
    { ...MINE, ortho_path: "user-1x/x.tif" },
    { ...MINE, output_path: "victim-user/odm/x/all.zip", ortho_path: null },
    { ...MINE, odm_uuid: "../../task/list" },
  ];
  const founder = [{ user_id: "user-1", role: "founder", status: "active" }];

  it.each(tampered)("ortho-url signs nothing for a row holding %o", async (row) => {
    const c = FOUNDER_ONLY.find(x => x.name === "ortho-url")!;
    const { status, db, fetches } = await run(c, founder, [row]);
    expect(status).toBe(404);
    expect(db.storage.calls.filter(s => s.op === "sign" || s.op === "download")).toHaveLength(0);
    expect(fetches).not.toHaveBeenCalled();
  });

  it.each(tampered.filter(r => r.ortho_path !== null))("bake-tiles signs nothing for a row holding %o", async (row) => {
    const c = FOUNDER_ONLY.find(x => x.name === "bake-tiles")!;
    const { status, db } = await run(c, founder, [row]);
    expect(status).toBe(404);
    expect(db.storage.calls.filter(s => s.op === "sign")).toHaveLength(0);
  });

  it("ndvi-tile signs nothing for a foreign ortho_path", async () => {
    const c = FOUNDER_ONLY.find(x => x.name === "ndvi-tile")!;
    const { status, db } = await run(c, founder, [{ ...MINE, ortho_path: FOREIGN }]);
    expect(status).toBe(404);
    expect(db.storage.calls.filter(s => s.op === "sign")).toHaveLength(0);
  });

  it("odm-poll never addresses the node with a value that is not an ODM uuid", async () => {
    const c = FOUNDER_ONLY.find(x => x.name === "odm-poll")!;
    const { status, fetches } = await run(c, founder, [{ ...MINE, status: "processing", odm_uuid: "../../task/list" }]);
    expect(status).toBe(404);
    expect(fetches).not.toHaveBeenCalled();
  });

  it("ortho-url still signs the caller's own orthophoto", async () => {
    const c = FOUNDER_ONLY.find(x => x.name === "ortho-url")!;
    const { db } = await run(c, founder, [MINE]);
    expect(db.storage.calls.filter(s => s.op === "sign").map(s => s.path)).toContain(MINE.ortho_path);
  });
});

describe("C2 · the asset proxy never walks out of a task", () => {
  const founder = [{ user_id: "user-1", role: "founder", status: "active" }];
  const assetReq = (asset: string, uuid = UUID) => ({
    name: "odm-asset", module: "../../../supabase/functions/odm-asset/index.ts",
    request: () => new Request(`https://fn/odm-asset?uuid=${encodeURIComponent(uuid)}&asset=${asset}`, { headers: AUTH }),
  });

  it.each([
    "../../list", "..%2F..%2Flist", "%2e%2e%2f%2e%2e%2flist", "..", "sub/report.txt", "%2Fetc%2Fpasswd", ".hidden", "a%5Cb",
  ])("refuses asset=%s with 400 and no call to the node", async (asset) => {
    const { status, fetches } = await run(assetReq(asset), founder);
    expect(status).toBe(400);
    expect(fetches).not.toHaveBeenCalled();
  });

  it("refuses a uuid that is not an ODM uuid", async () => {
    const { status, fetches } = await run(assetReq("report.txt", "../task/list"), founder, [{ ...MINE, odm_uuid: "../task/list" }]);
    expect(status).toBe(400);
    expect(fetches).not.toHaveBeenCalled();
  });

  it("treats a response with no Content-Length as too large", async () => {
    installDenoGlobal();
    const db = makeSupabase({ odm_tasks: [MINE], pilot_members: founder });
    __setMockClient(db.client);
    mockFetch([{ match: /\/assets\/report\.txt/, respond: () => { const r = binaryResponse(new Uint8Array([1, 2, 3])); r.headers.delete("Content-Length"); return r; } }]);
    const handler = await loadFunction("../../../supabase/functions/odm-asset/index.ts");
    const res = await handler(assetReq("report.txt").request());
    expect(res.status).toBe(413);
  });

  it("still proxies a plain, small, named asset", async () => {
    installDenoGlobal();
    const db = makeSupabase({ odm_tasks: [MINE], pilot_members: founder });
    __setMockClient(db.client);
    const fetches = mockFetch([{ match: /\/assets\/report\.txt/, respond: () => new Response("ok", { headers: { "Content-Length": "2" } }) }]);
    const handler = await loadFunction("../../../supabase/functions/odm-asset/index.ts");
    const res = await handler(assetReq("report.txt").request());
    expect(res.status).toBe(200);
    expect(String((fetches.mock.calls[0] as unknown[])[0])).toContain(`/task/${UUID}/assets/report.txt`);
  });
});

describe("access helpers", () => {
  it("inOwnFolder", () => {
    expect(inOwnFolder("u1", "u1/a.tif")).toBe(true);
    expect(inOwnFolder("u1", "u1/field-twins/x/twin.json.gz")).toBe(true);
    for (const bad of ["u2/a.tif", "u1", "u1/", "u1//a", "u1/../u2/a", "u1/./a", "u1x/a", "/u1/a", "u1\\a", null, 3]) {
      expect(inOwnFolder("u1", bad), String(bad)).toBe(false);
    }
    expect(inOwnFolder("", "/a")).toBe(false);
  });
  it("isOdmUuid", () => {
    expect(isOdmUuid(UUID)).toBe(true);
    for (const bad of ["uuid-1", "../x", "", null, `${UUID}/x`]) expect(isOdmUuid(bad)).toBe(false);
  });
  it("isPlainAssetName", () => {
    for (const ok of ["report.txt", "odm_report.pdf", "cameras.json", "a-b_c.1"]) expect(isPlainAssetName(ok)).toBe(true);
    for (const bad of ["..", "../a", "a/b", ".env", "a\\b", "", "a..b", "x".repeat(200)]) expect(isPlainAssetName(bad)).toBe(false);
  });
});

describe("pilot-applications · the founder role replaces the old default address", () => {
  const FN = "../../../supabase/functions/pilot-applications/index.ts";
  async function call(members: Record<string, unknown>[], email: string, env: Record<string, string> = {}) {
    installDenoGlobal(env);
    const db = makeSupabase({ pilot_applications: [{ id: "a1", email: "x@y.test" }], pilot_members: members });
    db.setUser("user-1", email);
    __setMockClient(db.client);
    const handler = await loadFunction(FN);
    return handler(new Request("https://fn/pilot-applications", { headers: AUTH }));
  }
  it("serves the founder whatever their email", async () => {
    expect((await call([{ user_id: "user-1", role: "founder", status: "active" }], "someone@gmail.test")).status).toBe(200);
  });
  it("refuses a participant", async () => {
    expect((await call([{ user_id: "user-1", role: "participant", status: "active" }], "p@farm.test")).status).toBe(403);
  });
  it("no longer lets whoever owns yunus@swathwise.com in by default", async () => {
    expect((await call([], "yunus@swathwise.com")).status).toBe(403);
  });
  it("still honours an explicitly configured allowlist during the changeover", async () => {
    expect((await call([], "ops@swardus.test", { PILOT_ADMIN_EMAILS: "ops@swardus.test" })).status).toBe(200);
  });
});
