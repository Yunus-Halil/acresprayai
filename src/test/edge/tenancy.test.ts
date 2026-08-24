// @vitest-environment node
//
// One property, checked across every edge function that touches a user-owned
// row: a caller who does not own the target gets exactly the same response as
// one asking about a row that does not exist.
//
// Any divergence turns the endpoint into an existence oracle — a caller can
// enumerate which scan ids are real by watching status codes. `odm-poll` had
// exactly that bug (404 for missing, 403 for someone else's) and it is what
// these tests exist to prevent recurring.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type SupabaseMock, AUTH, installDenoGlobal,
  jsonResponse, loadFunction, makeSupabase, mockFetch, postJson,
} from "./harness";
import { __setMockClient } from "./supabaseClientMock";

const UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
// ndvi-tile addresses scans by id in the URL path and only accepts uuid shapes,
// so the fixture id has to be a real uuid rather than a friendly label.
const TASK_ID = "11111111-2222-3333-4444-555555555555";

const OWNED_BY_SOMEONE_ELSE = {
  id: TASK_ID, user_id: "user-2", odm_uuid: UUID,
  status: "completed", progress: 100,
  output_path: "user-2/odm/x/all.zip", ortho_path: "user-2/x.tif",
  tiles_baked: false, tiles_done: 0, tiles_total: 0, tiles_failed: 0,
  tiles_plan_locked: false, mirror_started_at: null, mirror_attempts: 0,
};

type Case = {
  name: string;
  module: string;
  request: () => Request;
  /** Routes needed so the function reaches its ownership check. */
  routes?: Parameters<typeof mockFetch>[0];
};

const CASES: Case[] = [
  {
    name: "odm-poll",
    module: "../../../supabase/functions/odm-poll/index.ts",
    request: () => postJson("https://fn/odm-poll", { task_id: TASK_ID }),
  },
  {
    name: "ortho-url",
    module: "../../../supabase/functions/ortho-url/index.ts",
    request: () => new Request(`https://fn/ortho-url?task_id=${TASK_ID}`, { headers: AUTH }),
  },
  {
    name: "bake-tiles",
    module: "../../../supabase/functions/bake-tiles/index.ts",
    request: () => new Request(`https://fn/bake-tiles?task_id=${TASK_ID}`, { method: "POST", headers: AUTH }),
  },
  {
    name: "odm-asset",
    module: "../../../supabase/functions/odm-asset/index.ts",
    request: () => new Request(`https://fn/odm-asset?uuid=${UUID}&probe=ortho`, { headers: AUTH }),
  },
  {
    name: "tile",
    module: "../../../supabase/functions/tile/index.ts",
    request: () => new Request(`https://fn/tile/${UUID}/12/1/2.png?token=test-jwt`),
  },
  {
    name: "ndvi-tile",
    module: "../../../supabase/functions/ndvi-tile/index.ts",
    request: () => new Request(`https://fn/ndvi-tile/${TASK_ID}/12/1/2.png?token=test-jwt`),
  },
];

async function call(c: Case, rows: Record<string, unknown>[]) {
  installDenoGlobal();
  const db: SupabaseMock = makeSupabase({ odm_tasks: rows, fields: [] });
  __setMockClient(db.client);
  mockFetch(c.routes ?? [{ match: /.*/, respond: () => jsonResponse({}) }]);
  const handler = await loadFunction(c.module);
  const res = await handler(c.request());
  const text = await res.text();
  return { status: res.status, text, db };
}

beforeEach(() => { installDenoGlobal(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe.each(CASES)("$name · tenancy", (c) => {
  it("responds identically for someone else's row and a nonexistent one", async () => {
    const notMine = await call(c, [OWNED_BY_SOMEONE_ELSE]);
    const missing = await call(c, []);

    expect(notMine.status).toBe(missing.status);
    expect(notMine.text).toBe(missing.text);
  });

  it("does not act on a row it does not own", async () => {
    const { db, status } = await call(c, [OWNED_BY_SOMEONE_ELSE]);

    // Nothing may be written, and no bytes may be read out of another
    // tenant's storage prefix.
    const writes = db.storage.calls.filter(s => s.op === "upload" || s.op === "sign" || s.op === "signUpload");
    expect(writes, `${c.name} touched storage for a foreign row`).toHaveLength(0);
    expect(status).toBeGreaterThanOrEqual(400);
  });

  it("rejects an unauthenticated caller", async () => {
    installDenoGlobal();
    const db = makeSupabase({ odm_tasks: [OWNED_BY_SOMEONE_ELSE] });
    db.setUser(null);
    __setMockClient(db.client);
    mockFetch([{ match: /.*/, respond: () => jsonResponse({}) }]);
    const handler = await loadFunction(c.module);

    const res = await handler(c.request());

    expect(res.status).toBe(401);
    expect(db.storage.calls).toHaveLength(0);
  });
});

describe("tenancy · ownership failures are 404, never 403", () => {
  // 403 says "this exists but is not yours"; 404 says nothing. The whole point
  // is that the two cases are indistinguishable.
  it.each(CASES)("$name", async (c) => {
    const { status } = await call(c, [OWNED_BY_SOMEONE_ELSE]);
    expect(status).not.toBe(403);
    expect(status).toBe(404);
  });
});
