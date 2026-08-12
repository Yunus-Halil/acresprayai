// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type SupabaseMock, AUTH, installDenoGlobal, loadFunction, makeSupabase,
} from "./harness";
import { __setMockClient } from "./supabaseClientMock";

const FN = "../../../supabase/functions/tile/index.ts";
const UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

let db: SupabaseMock;

async function boot(tasks = [{ id: "task-1", user_id: "user-1", odm_uuid: UUID, ortho_path: "user-1/x.tif" }]) {
  db = makeSupabase({ odm_tasks: tasks });
  __setMockClient(db.client);
  return loadFunction(FN);
}

const tileReq = (uuid = UUID, z = 12, x = 1, y = 2, token = "test-jwt") =>
  new Request(`https://fn/tile/${uuid}/${z}/${x}/${y}.png${token ? `?token=${token}` : ""}`);

const seedTile = (path: string) => db.storage.objects.set(`tiles/${path}`, new Uint8Array([1, 2, 3]));

beforeEach(() => { installDenoGlobal(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("tile · authentication", () => {
  it("rejects a request with no token", async () => {
    const handler = await boot();
    const res = await handler(new Request(`https://fn/tile/${UUID}/12/1/2.png`));
    expect(res.status).toBe(401);
  });

  it("rejects an invalid token", async () => {
    const handler = await boot();
    db.setUser(null);
    const res = await handler(tileReq());
    expect(res.status).toBe(401);
  });

  it("accepts the token from the Authorization header too", async () => {
    const handler = await boot();
    seedTile(`user-1/${UUID}/12/1/2.png`);
    const res = await handler(new Request(`https://fn/tile/${UUID}/12/1/2.png`, { headers: AUTH }));
    expect(res.status).toBe(200);
  });
});

describe("tile · ownership and path rebuilding", () => {
  it("serves a tile to its owner from the user-scoped key", async () => {
    const handler = await boot();
    seedTile(`user-1/${UUID}/12/1/2.png`);

    const res = await handler(tileReq());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    // The key is rebuilt from the verified owner, never from caller input.
    const downloads = db.storage.calls.filter(c => c.op === "download");
    expect(downloads[0].path).toBe(`user-1/${UUID}/12/1/2.png`);
  });

  it("derives the owner prefix from the database, not from the caller", async () => {
    // The scan belongs to user-2 while the caller is user-1.
    const handler = await boot([{ id: "t", user_id: "user-2", odm_uuid: UUID, ortho_path: null }]);
    seedTile(`user-2/${UUID}/12/1/2.png`);

    const res = await handler(tileReq());

    // Even though the object exists, the caller does not own the scan.
    expect(res.status).toBe(404);
    expect(db.storage.calls.filter(c => c.op === "download")).toHaveLength(0);
  });

  it("returns the same 404 for someone else's scan and a nonexistent one", async () => {
    const notMine = await boot([{ id: "t", user_id: "user-2", odm_uuid: UUID, ortho_path: null }]);
    const a = await notMine(tileReq());

    const missing = await boot([]);
    const b = await missing(tileReq());

    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(await a.clone().json()).toEqual(await b.clone().json());
  });

  it("falls back to the legacy un-prefixed key, but only after verifying ownership", async () => {
    const handler = await boot();
    // Tile baked before user-scoping existed.
    seedTile(`${UUID}/12/1/2.png`);

    const res = await handler(tileReq());

    expect(res.status).toBe(200);
    const paths = db.storage.calls.filter(c => c.op === "download").map(c => c.path);
    // Scoped key tried first, legacy second.
    expect(paths).toEqual([`user-1/${UUID}/12/1/2.png`, `${UUID}/12/1/2.png`]);
  });

  it("does not reach the legacy key for a scan the caller does not own", async () => {
    const handler = await boot([{ id: "t", user_id: "user-2", odm_uuid: UUID, ortho_path: null }]);
    seedTile(`${UUID}/12/1/2.png`);

    const res = await handler(tileReq());

    expect(res.status).toBe(404);
    expect(db.storage.calls.filter(c => c.op === "download")).toHaveLength(0);
  });
});

describe("tile · path parsing", () => {
  it("rejects anything that is not a uuid and three integers", async () => {
    const handler = await boot();
    for (const bad of [
      "https://fn/tile/not-a-uuid/12/1/2.png?token=test-jwt",
      `https://fn/tile/${UUID}/12/1/2.txt?token=test-jwt`,
      `https://fn/tile/../../secret.png?token=test-jwt`,
    ]) {
      const res = await handler(new Request(bad));
      expect(res.status, bad).toBe(400);
    }
  });

  it("never lets caller input reach the storage key", async () => {
    const handler = await boot();
    // A traversal attempt in the uuid slot fails the regex outright, so no
    // storage call is ever made with attacker-controlled text.
    await handler(new Request(`https://fn/tile/${UUID}%2F..%2Fother/12/1/2.png?token=test-jwt`));
    expect(db.storage.calls).toHaveLength(0);
  });
});

describe("tile · misses and caching", () => {
  it("returns a transparent PNG rather than an error for an unbaked tile", async () => {
    const handler = await boot();
    const res = await handler(tileReq());

    // Leaflet would otherwise paint broken-tile icons across out-of-coverage areas.
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });

  it("marks tile responses private so they cannot land in a shared cache", async () => {
    const handler = await boot();
    seedTile(`user-1/${UUID}/12/1/2.png`);
    const res = await handler(tileReq());

    expect(res.headers.get("Cache-Control")).toMatch(/private/);
  });
});
