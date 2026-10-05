// @vitest-environment node
//
// bench-detect: the baseline detector behind the operator's sign-in. The key
// never leaves the function; an unsigned call never reaches the service; the
// browser gets the normalised result and nothing else.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDenoGlobal, jsonResponse, loadFunction, makeSupabase, mockFetch } from "./harness";
import { __setMockClient } from "./supabaseClientMock";

const FN = "../../../supabase/functions/bench-detect/index.ts";
const KEY = "rf-secret-key-0123456789";
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const post = (body: unknown, auth: string | null = "Bearer jwt") =>
  new Request("https://fn/bench-detect", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(body),
  });

describe("bench-detect", () => {
  let db: ReturnType<typeof makeSupabase>;
  beforeEach(() => {
    db = makeSupabase();
    __setMockClient(db.client);
  });
  afterEach(() => vi.restoreAllMocks());

  it("forwards a signed-in operator's crop with the server's key and returns the normalised result", async () => {
    installDenoGlobal({ ROBOFLOW_API_KEY: KEY });
    const calls: string[] = [];
    const fetch = mockFetch([{
      match: "detect.roboflow.com",
      respond: (url: string) => {
        calls.push(url);
        return jsonResponse({ image: { width: 400, height: 400 }, predictions: [{ x: 10, y: 10, width: 4, height: 4, confidence: 0.9, class: "weed" }] });
      },
    }]);
    vi.stubGlobal("fetch", fetch);
    const handler = await loadFunction(FN);
    const res = await handler(post({ image: PNG_B64, mime: "image/png" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "SUCCESS", modelId: "weeds-nxe1w/1", count: 1, maxConfidence: 0.9, imageWidth: 400 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`api_key=${KEY}`);
    expect(calls[0]).toContain("/weeds-nxe1w/1?");
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it("accepts a data URL and a confidence, and ignores a model id that is not project/version", async () => {
    installDenoGlobal({ ROBOFLOW_API_KEY: KEY });
    const calls: string[] = [];
    vi.stubGlobal("fetch", mockFetch([{ match: "roboflow", respond: (url: string) => { calls.push(url); return jsonResponse({ predictions: [] }); } }]));
    const handler = await loadFunction(FN);
    const res = await handler(post({ image: `data:image/jpeg;base64,${PNG_B64}`, mime: "image/jpeg", confidence: 25, model: "../evil" }));
    expect((await res.json()).status).toBe("SUCCESS_NO_DETECTIONS");
    expect(calls[0]).toContain("confidence=25");
    expect(calls[0]).toContain("/weeds-nxe1w/1?");
  });

  it("refuses without a session, and never calls the service", async () => {
    installDenoGlobal({ ROBOFLOW_API_KEY: KEY });
    const fetch = mockFetch([]);
    vi.stubGlobal("fetch", fetch);
    const handler = await loadFunction(FN);
    expect((await handler(post({ image: PNG_B64, mime: "image/png" }, null))).status).toBe(401);
    db.setUser(null);
    const res = await handler(post({ image: PNG_B64, mime: "image/png" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ status: "API_ERROR", error: "Unauthorized" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("says plainly when the key is not set, as a result the page can show", async () => {
    installDenoGlobal({});
    vi.stubGlobal("fetch", mockFetch([]));
    const handler = await loadFunction(FN);
    const res = await handler(post({ image: PNG_B64, mime: "image/png" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "API_ERROR", error: expect.stringContaining("ROBOFLOW_API_KEY is not set") });
  });

  it("rejects a bad body, a bad mime and an oversized image before touching the service", async () => {
    installDenoGlobal({ ROBOFLOW_API_KEY: KEY });
    const fetch = mockFetch([]);
    vi.stubGlobal("fetch", fetch);
    const handler = await loadFunction(FN);
    expect((await handler(post({ image: PNG_B64, mime: "image/gif" }))).status).toBe(400);
    expect((await handler(post({ mime: "image/png" }))).status).toBe(400);
    expect((await handler(post({ image: "A".repeat(8_000_001), mime: "image/png" }))).status).toBe(413);
    expect((await handler(new Request("https://fn/bench-detect", { method: "POST", headers: { Authorization: "Bearer jwt" }, body: "nope" }))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a failing service is an API_ERROR with the key scrubbed, with status 200 so the result shape still arrives", async () => {
    installDenoGlobal({ ROBOFLOW_API_KEY: KEY });
    vi.stubGlobal("fetch", mockFetch([{ match: "roboflow", respond: () => new Response(`denied for ${KEY}`, { status: 403 }) }]));
    const handler = await loadFunction(FN);
    const res = await handler(post({ image: PNG_B64, mime: "image/png" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("API_ERROR");
    expect(body.error).toMatch(/^HTTP 403: denied for \*\*\* /);
    expect(body.error).not.toContain(KEY);
  });
});

describe("bench-detect: a refused call is explained", () => {
  let db: ReturnType<typeof makeSupabase>;
  beforeEach(() => { db = makeSupabase(); __setMockClient(db.client); });
  afterEach(() => vi.restoreAllMocks());

  it("a 401 with a valid key names the workspace and blames the model; with a bad key blames the key", async () => {
    installDenoGlobal({ ROBOFLOW_API_KEY: KEY });
    vi.stubGlobal("fetch", mockFetch([
      { match: "detect.roboflow.com", respond: () => new Response(JSON.stringify({ status: 401, message: `Unauthorized api_key ${KEY}` }), { status: 401 }) },
      { match: "api.roboflow.com/?api_key", respond: () => jsonResponse({ workspace: "yunus-farm" }) },
    ]));
    let handler = await loadFunction(FN);
    let body = await (await handler(post({ image: PNG_B64, mime: "image/png" }))).json();
    expect(body.status).toBe("API_ERROR");
    expect(body.error).toMatch(/HTTP 401.*valid for workspace "yunus-farm".*model "weeds-nxe1w\/1" is not one that workspace can run.*ROBOFLOW_MODEL/);
    expect(body.error).not.toContain(KEY);

    vi.stubGlobal("fetch", mockFetch([
      { match: "detect.roboflow.com", respond: () => new Response("Unauthorized", { status: 401 }) },
      { match: "api.roboflow.com/?api_key", respond: () => new Response("nope", { status: 401 }) },
    ]));
    handler = await loadFunction(FN);
    body = await (await handler(post({ image: PNG_B64, mime: "image/png" }))).json();
    expect(body.error).toMatch(/The key itself was refused.*private API key/);
  });

  it("ROBOFLOW_MODEL on the server sets the model; a request's model still wins", async () => {
    installDenoGlobal({ ROBOFLOW_API_KEY: KEY, ROBOFLOW_MODEL: "my-weeds/3" });
    const calls: string[] = [];
    vi.stubGlobal("fetch", mockFetch([{ match: "roboflow", respond: (url: string) => { calls.push(url); return jsonResponse({ predictions: [] }); } }]));
    const handler = await loadFunction(FN);
    expect((await (await handler(post({ image: PNG_B64, mime: "image/png" }))).json()).modelId).toBe("my-weeds/3");
    expect(calls[0]).toContain("/my-weeds/3?");
    expect((await (await handler(post({ image: PNG_B64, mime: "image/png", model: "other/7" }))).json()).modelId).toBe("other/7");
  });
});
