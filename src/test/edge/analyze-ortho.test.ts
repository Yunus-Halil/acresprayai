// @vitest-environment node
//
// analyze-ortho's persistence contract: the run's outcome — success OR
// failure — lands on the scan row, written server-side. Before this, results
// were persisted by the browser after its success toast (silently droppable)
// and failures were persisted nowhere, so "failed at 9am" and "never ran"
// were the same null forever.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type SupabaseMock, installDenoGlobal, jsonResponse, loadFunction,
  makeSupabase, mockFetch, postJson,
} from "./harness";
import { __setMockClient } from "./supabaseClientMock";

const FN = "../../../supabase/functions/analyze-ortho/index.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BOUNDS = [-93.01, 45.0, -93.0, 45.01];

let db: SupabaseMock;
const task = () => db.tables.odm_tasks[0];

async function boot(over: Record<string, unknown> = {}) {
  db = makeDb(over);
  __setMockClient(db.client);
  return loadFunction(FN);
}

function makeDb(over: Record<string, unknown>) {
  return makeSupabase({
    odm_tasks: [{
      id: "task-1",
      user_id: "user-1",
      ortho_path: "user-1/uuid-1.tif",
      ai_analysis: null,
      ai_analysis_at: null,
      ...over,
    }],
  });
}

/** TiTiler + AI routes for a plain-RGB happy path. */
function routes(ai: () => Response) {
  return [
    {
      match: "/cog/info",
      respond: () => jsonResponse({ count: 4, dtype: "uint8", colorinterp: ["red", "green", "blue", "alpha"] }),
    },
    { match: "preview.png", respond: () => new Response(PNG) },
    { match: "tilejson.json", respond: () => jsonResponse({ bounds: BOUNDS, maxzoom: 18 }) },
    { match: "chat/completions", respond: ai },
  ];
}

const aiSuccess = (body: unknown) =>
  jsonResponse({ choices: [{ message: { content: JSON.stringify(body) } }] });

const req = () => postJson("https://fn/analyze-ortho", { task_id: "task-1" });

beforeEach(() => { installDenoGlobal({ AI_API_KEY: "test-key" }); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("analyze-ortho · persistence", () => {
  it("persists a successful run server-side, zero zones included", async () => {
    const handler = await boot();
    mockFetch(routes(() => aiSuccess({ health_score: 92, summary: "Clean field", issues: [], zones: [] })));

    const res = await handler(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.persisted).toBe(true);
    expect(body.zones).toEqual([]);

    const row = task();
    const saved = row.ai_analysis as { zones: unknown[]; last_run: { status: string } };
    expect(saved.zones).toEqual([]);
    expect(saved.last_run.status).toBe("completed");
    expect(row.ai_analysis_at).toBeTruthy();
  });

  it("records a provider failure ON THE SCAN, with the reason", async () => {
    const handler = await boot();
    mockFetch(routes(() => jsonResponse({ error: "boom" }, 500)));

    const res = await handler(req());

    expect(res.status).toBe(500);
    const saved = task().ai_analysis as { last_run: { status: string; error: string } };
    expect(saved.last_run.status).toBe("failed");
    expect(saved.last_run.error).toMatch(/AI provider returned 500/);
    // A failure is never a "last successful analysis".
    expect(task().ai_analysis_at ?? null).toBeNull();
  });

  it("treats an unreadable AI response as a FAILED run, not a clean field", async () => {
    const handler = await boot();
    mockFetch(routes(() => jsonResponse({ choices: [{ message: { content: "not json {" } }] })));

    const res = await handler(req());

    // The old behaviour coerced this to zones: [] — a fabricated finding of
    // "nothing wrong" on a document farmers act on.
    expect(res.status).toBe(500);
    const saved = task().ai_analysis as { zones?: unknown; last_run: { status: string } };
    expect(saved.last_run.status).toBe("failed");
    expect(saved.zones ?? null).toBeNull();
  });

  it("a failed re-run preserves the previous good result underneath", async () => {
    const handler = await boot({
      ai_analysis: { zones: [{ id: "z1" }], health_score: 70, last_run: { status: "completed", at: "2026-08-01T00:00:00Z" } },
      ai_analysis_at: "2026-08-01T00:00:00Z",
    });
    mockFetch(routes(() => jsonResponse({ error: "boom" }, 500)));

    await handler(req());

    const saved = task().ai_analysis as { zones: unknown[]; last_run: { status: string } };
    expect(saved.zones).toHaveLength(1);
    expect(saved.last_run.status).toBe("failed");
    // The timestamp of the last GOOD analysis survives.
    expect(task().ai_analysis_at).toBe("2026-08-01T00:00:00Z");
  });

  it("missing AI configuration is recorded as a failure too", async () => {
    installDenoGlobal({}); // no AI_API_KEY
    const handler = await boot();
    mockFetch(routes(() => aiSuccess({})));

    const res = await handler(req());

    expect(res.status).toBe(500);
    const saved = task().ai_analysis as { last_run: { status: string; error: string } };
    expect(saved.last_run.error).toMatch(/AI is not configured/);
  });
});
