// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type SupabaseMock, AUTH, flushBackground, installDenoGlobal, jsonResponse,
  loadFunction, makeSupabase, mockFetch, postJson,
} from "./harness";
import { __setMockClient } from "./supabaseClientMock";

const FN = "../../../supabase/functions/odm-poll/index.ts";
const ODM_COMPLETED = { status: { code: 40 }, progress: 100 };
const ODM_RUNNING = { status: { code: 20 }, progress: 42 };
const ODM_FAILED = { status: { code: 30, errorMessage: "not enough overlap" } };

function seedTask(over: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    user_id: "user-1",
    odm_uuid: "uuid-1",
    status: "processing",
    progress: 42,
    output_path: null,
    ortho_path: null,
    error: null,
    mirror_started_at: null,
    mirror_attempts: 0,
    ...over,
  };
}

let db: SupabaseMock;

async function boot(task: Record<string, unknown> = seedTask()) {
  db = makeSupabase({ odm_tasks: [task] });
  __setMockClient(db.client);
  return loadFunction(FN);
}

const task = () => db.tables.odm_tasks[0];

beforeEach(() => { installDenoGlobal(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("odm-poll · status mapping", () => {
  it("maps a running reconstruction to processing and records progress", async () => {
    const handler = await boot();
    mockFetch([{ match: "/info", respond: () => jsonResponse(ODM_RUNNING) }]);

    const res = await handler(postJson("https://fn/odm-poll", { task_id: "task-1" }));
    const body = await res.json();

    expect(body.status).toBe("processing");
    expect(body.progress).toBe(42);
    expect(task().status).toBe("processing");
  });

  it("marks a reconstruction failure permanent and non-retryable", async () => {
    const handler = await boot();
    mockFetch([{ match: "/info", respond: () => jsonResponse(ODM_FAILED) }]);

    const body = await (await handler(postJson("https://fn/odm-poll", { task_id: "task-1" }))).json();

    expect(body.status).toBe("failed");
    expect(body.retryable).toBe(false);
    expect(task().error).toContain("overlap");
  });

  it("leaves the scan untouched when the processing node is unreachable", async () => {
    const handler = await boot();
    mockFetch([{ match: "/info", respond: () => jsonResponse({ error: "bad gateway" }, 502) }]);

    const body = await (await handler(postJson("https://fn/odm-poll", { task_id: "task-1" }))).json();

    // The scan is fine; the upstream is not. Reporting failure here would
    // permanently kill a healthy scan over a transient blip.
    expect(body.upstream).toBeTruthy();
    expect(body.status).toBe("processing");
    expect(task().status).toBe("processing");
    expect(task().error).toBeNull();
  });

  it("survives an upstream HTML error page instead of throwing on res.json()", async () => {
    const handler = await boot();
    mockFetch([{
      match: "/info",
      respond: () => new Response("<html>502 Bad Gateway</html>", {
        status: 502, headers: { "Content-Type": "text/html" },
      }),
    }]);

    const res = await handler(postJson("https://fn/odm-poll", { task_id: "task-1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).upstream).toBeTruthy();
  });
});

describe("odm-poll · mirror lease", () => {
  const mirrorRoutes = [
    { match: "/info", respond: () => jsonResponse(ODM_COMPLETED) },
    { match: "all.zip", respond: () => new Response(new Uint8Array([1, 2, 3])) },
    { match: "orthophoto", respond: () => new Response(new Uint8Array([4, 5, 6])) },
  ];

  it("claims the lease and mirrors outputs to storage", async () => {
    const handler = await boot();
    mockFetch(mirrorRoutes);

    const body = await (await handler(postJson("https://fn/odm-poll", { task_id: "task-1" }))).json();
    expect(body.status).toBe("mirroring");
    expect(task().status).toBe("mirroring");
    expect(task().mirror_started_at).toBeTruthy();

    await flushBackground();

    expect(task().status).toBe("completed");
    expect(task().output_path).toBe("user-1/odm/uuid-1/all.zip");
    expect(task().ortho_path).toBe("user-1/uuid-1.tif");
    // Lease released, counters reset.
    expect(task().mirror_started_at).toBeNull();
    expect(task().mirror_attempts).toBe(0);
  });

  it("a second concurrent poller does not claim a fresh lease", async () => {
    // The first poller is mid-transfer: lease held, started just now.
    const handler = await boot(seedTask({
      status: "mirroring",
      mirror_started_at: new Date().toISOString(),
      progress: 99,
    }));
    const fetchMock = mockFetch(mirrorRoutes);

    const body = await (await handler(postJson("https://fn/odm-poll", { task_id: "task-1" }))).json();

    expect(body.status).toBe("mirroring");
    // It must not even ask ODM, let alone start a second multi-gigabyte transfer.
    expect(fetchMock).not.toHaveBeenCalled();
    await flushBackground();
    expect(db.storage.calls.filter(c => c.op === "upload")).toHaveLength(0);
  });

  it("reclaims a lease older than the stale window", async () => {
    const stale = new Date(Date.now() - 20 * 60_000).toISOString(); // > 15 min
    const handler = await boot(seedTask({ status: "mirroring", mirror_started_at: stale }));
    mockFetch(mirrorRoutes);

    await handler(postJson("https://fn/odm-poll", { task_id: "task-1" }));
    await flushBackground();

    // A transfer whose edge instance died is picked back up rather than
    // hanging at 99% forever.
    expect(task().status).toBe("completed");
  });

  it("does not re-download an archive already mirrored", async () => {
    const handler = await boot(seedTask({ output_path: "user-1/odm/uuid-1/all.zip" }));
    const fetchMock = mockFetch(mirrorRoutes);

    await handler(postJson("https://fn/odm-poll", { task_id: "task-1" }));
    await flushBackground();

    const urls = fetchMock.mock.calls.map(c => String(c[0]));
    expect(urls.some(u => u.includes("all.zip"))).toBe(false);
    expect(task().status).toBe("completed");
  });
});

describe("odm-poll · transient retry budget", () => {
  const failingZip = [
    { match: "/info", respond: () => jsonResponse(ODM_COMPLETED) },
    { match: "all.zip", respond: () => jsonResponse({ error: "gateway" }, 502) },
  ];

  it("three consecutive transient failures do NOT fail the scan", async () => {
    let handler = await boot(seedTask({ mirror_attempts: 0 }));

    for (let i = 0; i < 3; i++) {
      mockFetch(failingZip);
      await handler(postJson("https://fn/odm-poll", { task_id: "task-1" }));
      await flushBackground();
      expect(task().status, `after attempt ${i + 1}`).toBe("processing");
      expect(task().mirror_started_at).toBeNull();
      // Reload the module but keep the same database, mimicking a new invocation.
      __setMockClient(db.client);
      handler = await loadFunction("../../../supabase/functions/odm-poll/index.ts");
    }

    expect(task().mirror_attempts).toBe(3);
    expect(task().status).toBe("processing");
  });

  it("the fourth marks the scan failed, with the attempt count in the message", async () => {
    const handler = await boot(seedTask({ mirror_attempts: 3 }));
    mockFetch(failingZip);

    await handler(postJson("https://fn/odm-poll", { task_id: "task-1" }));
    await flushBackground();

    expect(task().status).toBe("failed");
    expect(task().error).toMatch(/4 attempts/);
  });

  it("a successful mirror resets the attempt counter", async () => {
    const handler = await boot(seedTask({ mirror_attempts: 2 }));
    mockFetch([
      { match: "/info", respond: () => jsonResponse(ODM_COMPLETED) },
      { match: "all.zip", respond: () => new Response(new Uint8Array([1])) },
      { match: "orthophoto", respond: () => new Response(new Uint8Array([2])) },
    ]);

    await handler(postJson("https://fn/odm-poll", { task_id: "task-1" }));
    await flushBackground();

    expect(task().mirror_attempts).toBe(0);
  });
});

describe("odm-poll · explicit retry", () => {
  it("clears the error and resets counters", async () => {
    const handler = await boot(seedTask({
      status: "failed", error: "Storage upload failed", mirror_attempts: 4,
      mirror_started_at: new Date().toISOString(),
    }));
    mockFetch([{ match: "/info", respond: () => jsonResponse(ODM_RUNNING) }]);

    await handler(postJson("https://fn/odm-poll", { task_id: "task-1", retry: true }));

    expect(task().error).toBeNull();
    expect(task().mirror_attempts).toBe(0);
    expect(task().status).not.toBe("failed");
  });

  it("a failed scan without retry stays failed and reports itself as retryable", async () => {
    const handler = await boot(seedTask({ status: "failed", error: "boom" }));
    const body = await (await handler(postJson("https://fn/odm-poll", { task_id: "task-1" }))).json();

    expect(body.status).toBe("failed");
    expect(body.retryable).toBe(true);
    expect(task().status).toBe("failed");
  });

  it("frees a scan stuck mid-mirror", async () => {
    const handler = await boot(seedTask({
      status: "mirroring", mirror_started_at: new Date().toISOString(),
    }));
    mockFetch([{ match: "/info", respond: () => jsonResponse(ODM_RUNNING) }]);

    await handler(postJson("https://fn/odm-poll", { task_id: "task-1", retry: true }));

    expect(task().mirror_started_at).toBeNull();
    expect(task().status).toBe("processing");
  });
});

describe("odm-poll · cross-tenant isolation", () => {
  it("never falls back to another task's orthophoto", async () => {
    // The regression this guards: when a scan's own orthophoto was missing, the
    // function used to walk every completed task on the shared node and attach
    // the first one it found — another farm's imagery, under this user's scan.
    const handler = await boot();
    const fetchMock = mockFetch([
      { match: "/info", respond: () => jsonResponse(ODM_COMPLETED) },
      { match: "all.zip", respond: () => new Response(new Uint8Array([1])) },
      { match: "orthophoto", respond: () => jsonResponse({ error: "not found" }, 404) },
    ]);

    await handler(postJson("https://fn/odm-poll", { task_id: "task-1" }));
    await flushBackground();

    // Every ODM URL must name this scan's own uuid, and no task listing is fetched.
    const urls = fetchMock.mock.calls.map(c => String(c[0]));
    for (const u of urls) expect(u).toContain("uuid-1");
    expect(urls.some(u => /\/tasks\b|\/task\/list/.test(u))).toBe(false);

    // Missing orthophoto is not fatal — ortho-url back-fills later.
    expect(task().status).toBe("completed");
    expect(task().ortho_path).toBeNull();
  });
});
