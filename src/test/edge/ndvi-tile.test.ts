// @vitest-environment node
//
// Contract tests for the tile endpoint's band handling. The ownership check
// must stay in front of every memoised or persisted lookup: a cached band
// mapping is per-scan, and serving one to a caller who does not own the scan
// would leak the fact that it exists.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type SupabaseMock, AUTH, installDenoGlobal, jsonResponse, loadFunction,
  makeSupabase, mockFetch,
} from "./harness";
import { __setMockClient } from "./supabaseClientMock";

const FN = "../../../supabase/functions/ndvi-tile/index.ts";
const TASK = "11111111-2222-3333-4444-555555555555";

const M3M_INFO = {
  count: 3,
  colorinterp: ["red", "gray", "alpha"],
  band_descriptions: [["b1", "Red"], ["b2", "NIR"], ["b3", "b3"]],
};

let db: SupabaseMock;
const row = () => db.tables.odm_tasks[0];

async function boot(over: Record<string, unknown> = {}) {
  db = makeSupabase({
    odm_tasks: [{
      id: TASK, user_id: "user-1", odm_uuid: "uuid-1",
      ortho_path: "user-1/ortho.tif", band_mapping: null, ...over,
    }],
  });
  __setMockClient(db.client);
  return loadFunction(FN);
}

const infoReq = () => new Request(`https://fn/ndvi-tile/info?task_id=${TASK}`, { headers: AUTH });

beforeEach(() => { installDenoGlobal(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("ndvi-tile · band resolution", () => {
  it("resolves the real M3M arrangement and reports how", async () => {
    const handler = await boot();
    mockFetch([{ match: "/cog/info", respond: () => jsonResponse(M3M_INFO) }]);

    const body = await (await handler(infoReq())).json();

    expect(body.index).toBe("ndvi");
    expect(body.expression).toBe("(b2-b1)/(b2+b1)");
    expect(body.roles).toMatchObject({ red: 1, nir: 2 });
    expect(body.method).toBe("descriptions");
    expect(body.fingerprint).toBe("ndvi:2-1");
  });

  it("persists the mapping so it is resolved once per scan", async () => {
    const handler = await boot();
    const fetchMock = mockFetch([{ match: "/cog/info", respond: () => jsonResponse(M3M_INFO) }]);

    await handler(infoReq());

    expect(row().band_mapping).toMatchObject({ fingerprint: "ndvi:2-1" });
    expect(fetchMock.mock.calls.filter(c => String(c[0]).includes("/cog/info"))).toHaveLength(1);
  });

  it("reuses a stored mapping instead of re-probing", async () => {
    const handler = await boot({
      band_mapping: {
        total: 3, spectral: 2, hasAlpha: true, roles: { red: 1, nir: 2 },
        method: "descriptions", available: ["ndvi"], hasNDVI: true,
        ambiguousMultispectral: false, fingerprint: "ndvi:2-1", reason: "stored",
      },
    });
    const fetchMock = mockFetch([{ match: "/cog/info", respond: () => jsonResponse(M3M_INFO) }]);

    const body = await (await handler(infoReq())).json();

    expect(body.expression).toBe("(b2-b1)/(b2+b1)");
    expect(fetchMock.mock.calls.filter(c => String(c[0]).includes("/cog/info"))).toHaveLength(0);
  });

  it("falls back to VARI and labels it when bands cannot be resolved", async () => {
    const handler = await boot();
    mockFetch([{ match: "/cog/info", respond: () => jsonResponse({ count: 4 }) }]);

    const body = await (await handler(infoReq())).json();

    expect(body.index).toBe("vari");
    expect(body.label).toMatch(/not NDVI/i);
    expect(body.ambiguousMultispectral).toBe(true);
  });
});

describe("ndvi-tile · ownership precedes any cached lookup", () => {
  it("does not serve a stored mapping to a caller who does not own the scan", async () => {
    const handler = await boot({
      user_id: "user-2",
      band_mapping: { fingerprint: "ndvi:2-1", roles: { red: 1, nir: 2 }, hasNDVI: true, available: ["ndvi"] },
    });
    const fetchMock = mockFetch([{ match: /.*/, respond: () => jsonResponse({}) }]);

    const res = await handler(infoReq());

    expect(res.status).toBe(404);
    expect(await res.json()).not.toHaveProperty("roles");
    // Nothing was signed, probed, or read on behalf of a foreign row.
    expect(db.storage.calls).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller before touching the row", async () => {
    const handler = await boot();
    db.setUser(null);
    mockFetch([{ match: /.*/, respond: () => jsonResponse({}) }]);

    const res = await handler(infoReq());

    expect(res.status).toBe(401);
    expect(db.storage.calls).toHaveLength(0);
  });
});
