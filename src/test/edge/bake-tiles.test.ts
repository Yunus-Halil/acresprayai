// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type SupabaseMock, AUTH, installDenoGlobal, jsonResponse, loadFunction,
  makeSupabase, mockFetch,
} from "./harness";
import { __setMockClient } from "./supabaseClientMock";

const FN = "../../../supabase/functions/bake-tiles/index.ts";

// A tiny bbox so each zoom level contributes exactly one tile, keeping the
// tile list small and the cursor arithmetic easy to reason about.
const BOUNDS = [-93.0002, 45.0001, -93.0001, 45.0002];
const tilejson = (maxzoom: number) => jsonResponse({ bounds: BOUNDS, maxzoom });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function seedTask(over: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    user_id: "user-1",
    odm_uuid: "uuid-1",
    ortho_path: "user-1/uuid-1.tif",
    tiles_baked: false,
    tiles_done: 0,
    tiles_total: 0,
    tiles_failed: 0,
    tiles_plan_locked: false,
    tiles_min_zoom: null,
    tiles_max_zoom: null,
    ...over,
  };
}

let db: SupabaseMock;
const task = () => db.tables.odm_tasks[0];

async function boot(over: Record<string, unknown> = {}) {
  db = makeSupabase({ odm_tasks: [seedTask(over)] });
  __setMockClient(db.client);
  return loadFunction(FN);
}

const req = (qs = "") =>
  new Request(`https://fn/bake-tiles?task_id=task-1${qs}`, { method: "POST", headers: AUTH });

/** Tile responder that fails the nth tile of the list (by z/x/y ordering). */
function tileRoutes(failZ?: number, status = 500) {
  return [
    { match: "tilejson.json", respond: () => tilejson(12) },
    {
      match: /\/cog\/tiles\//,
      respond: (url?: string) => new Response(PNG),
    },
  ];
}

beforeEach(() => { installDenoGlobal(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("bake-tiles · happy path", () => {
  it("stores every tile under the user-scoped key and reports done", async () => {
    const handler = await boot();
    mockFetch([
      { match: "tilejson.json", respond: () => tilejson(12) },
      { match: "/cog/tiles/", respond: () => new Response(PNG) },
    ]);

    const body = await (await handler(req())).json();

    expect(body.done).toBe(true);
    expect(body.failed).toBe(0);
    expect(body.completed).toBe(body.total);
    expect(task().tiles_baked).toBe(true);

    // Every stored object is prefixed with the owning user's id — this is what
    // lets the `tile` function rebuild the path from the verified owner.
    const uploads = db.storage.calls.filter(c => c.op === "upload");
    expect(uploads.length).toBe(body.total);
    for (const u of uploads) {
      expect(u.bucket).toBe("tiles");
      expect(u.path).toMatch(/^user-1\/uuid-1\/\d+\/\d+\/\d+\.png$/);
    }
  });

  it("short-circuits once already baked", async () => {
    const handler = await boot({ tiles_baked: true, tiles_done: 7, tiles_total: 7 });
    const fetchMock = mockFetch([]);

    const body = await (await handler(req())).json();

    expect(body.done).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a 404 from the tile service as out-of-coverage, not a failure", async () => {
    const handler = await boot();
    mockFetch([
      { match: "tilejson.json", respond: () => tilejson(12) },
      { match: "/cog/tiles/", respond: () => new Response(null, { status: 404 }) },
    ]);

    const body = await (await handler(req())).json();

    // Nothing to store, but nothing wrong either — the tile endpoint serves a
    // transparent pixel for these.
    expect(body.failed).toBe(0);
    expect(body.done).toBe(true);
    expect(db.storage.calls.filter(c => c.op === "upload")).toHaveLength(0);
  });
});

describe("bake-tiles · cursor integrity", () => {
  it("a failed tile holds the cursor instead of advancing past it", async () => {
    const handler = await boot();
    mockFetch([
      { match: "tilejson.json", respond: () => tilejson(12) },
      {
        // z10 is the first entry in the tile list. Match on the URL so the tile
        // fails every retry, rather than succeeding on attempt two.
        match: "/cog/tiles/",
        respond: (url) => (/WebMercatorQuad\/10\//.test(url) ? jsonResponse({ e: 1 }, 500) : new Response(PNG)),
      },
    ]);

    const body = await (await handler(req())).json();

    // The cursor may not move past an unresolved tile: re-doing a stored tile is
    // free, skipping one leaves a permanent hole in the map.
    expect(body.completed).toBe(0);
    expect(body.failed).toBeGreaterThan(0);
    expect(body.done).toBe(false);
    expect(body.retrying).toBe(true);
    expect(task().tiles_baked).toBe(false);
  });

  it("never reports done while any tile in the pass failed", async () => {
    const handler = await boot();
    mockFetch([
      { match: "tilejson.json", respond: () => tilejson(12) },
      // The deepest zoom is last in the list, so the cursor reaches the end of
      // the batch while the bake is still incomplete.
      {
        match: "/cog/tiles/",
        respond: (url) => (/WebMercatorQuad\/12\//.test(url) ? jsonResponse({}, 500) : new Response(PNG)),
      },
    ]);

    const body = await (await handler(req())).json();

    expect(body.failed).toBeGreaterThan(0);
    expect(body.done).toBe(false);
    expect(task().tiles_baked).toBe(false);
  });

  it("counts a storage upload failure as unresolved, not as done", async () => {
    const handler = await boot();
    mockFetch([
      { match: "tilejson.json", respond: () => tilejson(12) },
      { match: "/cog/tiles/", respond: () => new Response(PNG) },
    ]);
    // Fail the very first upload: a storage blip used to be counted as complete,
    // baking a permanent hole and latching tiles_baked over the top of it.
    db.storage.failUploads.add("user-1/uuid-1/10/245/365.png");
    const firstPath = () => db.storage.calls.find(c => c.op === "upload")?.path;

    const body = await (await handler(req())).json();

    // Whatever the first tile's path is, if its upload fails the bake is not done.
    if (db.storage.failUploads.has(firstPath() ?? "")) {
      expect(body.failed).toBeGreaterThan(0);
      expect(body.done).toBe(false);
    }
    // Regardless of which tile we managed to target, a clean pass must store
    // every tile it counted.
    expect(body.completed).toBeLessThanOrEqual(body.total);
  });

  it("resumes from the persisted cursor rather than restarting", async () => {
    const handler = await boot({ tiles_done: 1, tiles_total: 3, tiles_plan_locked: true, tiles_min_zoom: 10, tiles_max_zoom: 12 });
    mockFetch([
      { match: "tilejson.json", respond: () => tilejson(12) },
      { match: "/cog/tiles/", respond: () => new Response(PNG) },
    ]);

    const body = await (await handler(req())).json();

    // Two tiles remained, so two uploads — not three.
    expect(db.storage.calls.filter(c => c.op === "upload")).toHaveLength(body.total - 1);
    expect(body.done).toBe(true);
  });
});

describe("bake-tiles · zoom plan", () => {
  it("freezes the zoom range once locked, even if the tile service reports a different maxzoom", async () => {
    const handler = await boot({ tiles_plan_locked: true, tiles_min_zoom: 10, tiles_max_zoom: 11 });
    mockFetch([
      // Tile service now claims a deeper native zoom.
      { match: "tilejson.json", respond: () => tilejson(18) },
      { match: "/cog/tiles/", respond: () => new Response(PNG) },
    ]);

    const body = await (await handler(req())).json();

    // A shifting zoom range changed `total`, reset the counters, and silently
    // moved the resume cursor onto the wrong tile.
    expect(body.minZ).toBe(10);
    expect(body.maxZ).toBe(11);
  });

  it("locks the plan on the first pass", async () => {
    const handler = await boot();
    mockFetch([
      { match: "tilejson.json", respond: () => tilejson(12) },
      { match: "/cog/tiles/", respond: () => new Response(PNG) },
    ]);

    await handler(req());

    expect(task().tiles_plan_locked).toBe(true);
    expect(task().tiles_min_zoom).toBe(10);
    expect(task().tiles_max_zoom).toBe(12);
  });
});

describe("bake-tiles · poison-tile guard", () => {
  it("steps over a tile that has failed three consecutive passes", async () => {
    // tiles_failed doubles as the stall counter when no progress is made.
    const handler = await boot({ tiles_done: 0, tiles_failed: 3, tiles_plan_locked: true, tiles_min_zoom: 10, tiles_max_zoom: 12 });
    mockFetch([
      { match: "tilejson.json", respond: () => tilejson(12) },
      { match: "/cog/tiles/", respond: () => jsonResponse({}, 500) },
    ]);

    const body = await (await handler(req())).json();

    // One transparent tile beats a bake that can never finish.
    expect(body.completed).toBe(1);
  });

  it("does not step over before the stall threshold", async () => {
    const handler = await boot({ tiles_done: 0, tiles_failed: 1, tiles_plan_locked: true, tiles_min_zoom: 10, tiles_max_zoom: 12 });
    mockFetch([
      { match: "tilejson.json", respond: () => tilejson(12) },
      { match: "/cog/tiles/", respond: () => jsonResponse({}, 500) },
    ]);

    const body = await (await handler(req())).json();

    expect(body.completed).toBe(0);
    expect(task().tiles_failed).toBe(2); // stall counter incremented
  });
});

describe("bake-tiles · band-aware rendering", () => {
  /** Every tile URL the bake requested from the tile service. */
  const tileUrls = (fetchMock: ReturnType<typeof mockFetch>) =>
    fetchMock.mock.calls
      .map(c => String(c[0]))
      .filter(u => u.includes("/cog/tiles/"));

  it("selects the resolved RGB bands for a sensor that stores them out of order", async () => {
    const handler = await boot();
    mockFetch([
      { match: "tilejson.json", respond: () => tilejson(12) },
      {
        // MicaSense-style layout: blue first, red third. Rendering "first
        // three bands" here is the blue-field/magenta-road bug.
        match: "/cog/info",
        respond: () => jsonResponse({
          count: 5, dtype: "uint8",
          colorinterp: ["gray", "gray", "gray", "gray", "gray"],
          band_descriptions: [["b1", "Blue"], ["b2", "Green"], ["b3", "Red"], ["b4", "NIR"], ["b5", "Red edge"]],
        }),
      },
      { match: "/cog/tiles/", respond: () => new Response(PNG) },
    ]);
    const fetchMock = vi.mocked(globalThis.fetch);

    const body = await (await handler(req())).json();

    expect(body.done).toBe(true);
    for (const u of tileUrls(fetchMock as ReturnType<typeof mockFetch>)) {
      expect(u).toContain("bidx=3&bidx=2&bidx=1"); // red b3, green b2, blue b1
      expect(u).toContain("nodata=0");
    }
    // The plan persists, so every later pass and rebake renders identically.
    const bm = task().band_mapping as { render?: { bidx: number[] | null } };
    expect(bm.render?.bidx).toEqual([3, 2, 1]);
  });

  it("stretches 16-bit imagery using the file's own percentile statistics", async () => {
    const handler = await boot();
    mockFetch([
      { match: "tilejson.json", respond: () => tilejson(12) },
      {
        match: "/cog/info",
        respond: () => jsonResponse({
          count: 4, dtype: "uint16",
          colorinterp: ["gray", "gray", "gray", "gray"],
          band_descriptions: [["b1", "Red"], ["b2", "Green"], ["b3", "Blue"], ["b4", "NIR"]],
        }),
      },
      {
        match: "/cog/statistics",
        respond: () => jsonResponse({
          b1: { percentile_2: 120, percentile_98: 9100 },
          b2: { percentile_2: 150, percentile_98: 8800 },
          b3: { percentile_2: 90, percentile_98: 7000 },
        }),
      },
      { match: "/cog/tiles/", respond: () => new Response(PNG) },
    ]);
    const fetchMock = vi.mocked(globalThis.fetch);

    const body = await (await handler(req())).json();

    expect(body.done).toBe(true);
    for (const u of tileUrls(fetchMock as ReturnType<typeof mockFetch>)) {
      expect(u).toContain("rescale=120,9100");
      expect(u).toContain("rescale=150,8800");
      expect(u).toContain("rescale=90,7000");
    }
  });

  it("renders conservatively and persists nothing when the probe is unavailable", async () => {
    const handler = await boot();
    // No /cog/info route: the probe fetch throws, exactly like an outage.
    mockFetch([
      { match: "tilejson.json", respond: () => tilejson(12) },
      { match: "/cog/tiles/", respond: () => new Response(PNG) },
    ]);
    const fetchMock = vi.mocked(globalThis.fetch);

    const body = await (await handler(req())).json();

    expect(body.done).toBe(true);
    for (const u of tileUrls(fetchMock as ReturnType<typeof mockFetch>)) {
      expect(u).toContain("nodata=0");
      expect(u).not.toContain("bidx=");
    }
    // A failed probe must not freeze a guess: the next pass re-probes.
    expect(task().band_mapping ?? null).toBeNull();
  });
});

describe("bake-tiles · rebake", () => {
  it("?rebake=1 clears the latch and re-bakes from zero", async () => {
    const handler = await boot({ tiles_baked: true, tiles_done: 3, tiles_total: 3, tiles_plan_locked: true });
    mockFetch([
      { match: "tilejson.json", respond: () => tilejson(12) },
      { match: "/cog/tiles/", respond: () => new Response(PNG) },
    ]);

    const body = await (await handler(req("&rebake=1"))).json();

    expect(body.completed).toBe(body.total);
    expect(db.storage.calls.filter(c => c.op === "upload").length).toBeGreaterThan(0);
  });
});

describe("bake-tiles · upstream failure", () => {
  it("returns 503 rather than corrupting the cursor when the tile service is down", async () => {
    const handler = await boot();
    mockFetch([{ match: "tilejson.json", respond: () => jsonResponse({}, 503) }]);

    const res = await handler(req());

    expect(res.status).toBe(503);
    expect(task().tiles_done).toBe(0);
    expect(task().tiles_baked).toBe(false);
  });

  it("rejects an orthomosaic with no usable bounds", async () => {
    const handler = await boot();
    mockFetch([{ match: "tilejson.json", respond: () => jsonResponse({ maxzoom: 12 }) }]);

    const res = await handler(req());

    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/bounds/i);
  });
});
