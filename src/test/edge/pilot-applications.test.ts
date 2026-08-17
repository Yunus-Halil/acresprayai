// @vitest-environment node
//
// The admin read endpoint. pilot_applications has no readable SELECT policy for
// anyone, so this function holding the service-role key is the only way rows
// come back out - which makes its authorisation check the entire boundary
// protecting every applicant's name, email and phone number.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setMockClient } from "./supabaseClientMock";
import {
  AUTH, get, installDenoGlobal, loadFunction, makeSupabase,
  type EdgeHandler, type SupabaseMock,
} from "./harness";

const FN = "../../../supabase/functions/pilot-applications/index.ts";
const URL = "https://edge.test/pilot-applications";

const ROWS = [
  { id: "a1", created_at: "2026-08-16T09:00:00Z", full_name: "Dale Hutchins", email: "dale@farms.test", farm_name: "Hutchins Family Farms", location: "Story County, Iowa" },
  { id: "a2", created_at: "2026-08-17T09:00:00Z", full_name: "Ana Reyes", email: "ana@reyes.test", farm_name: "Reyes Orchards", location: "Yakima County, Washington" },
];

let mock: SupabaseMock;
let handler: EdgeHandler;

async function boot(env: Record<string, string> = {}) {
  installDenoGlobal({ PILOT_ADMIN_EMAILS: "yunus@swathwise.com", ...env });
  mock = makeSupabase({ pilot_applications: JSON.parse(JSON.stringify(ROWS)) });
  __setMockClient(mock.client);
  handler = await loadFunction(FN);
}

beforeEach(async () => { await boot(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("pilot-applications · who may read", () => {
  it("refuses a caller with no bearer token", async () => {
    const res = await handler(new Request(URL, { method: "GET" }));
    expect(res.status).toBe(401);
    expect(await res.json()).not.toHaveProperty("applications");
  });

  it("refuses a token that resolves to nobody", async () => {
    mock.setUser(null);
    const res = await handler(get(URL));
    expect(res.status).toBe(401);
  });

  it("refuses a signed-in user who is not on the admin allowlist", async () => {
    // This is the case that matters. Every customer of the product has an
    // account; none of them may read another farmer's application.
    mock.setUser("user-9", "farmer@somefarm.test");
    const res = await handler(get(URL));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).not.toHaveProperty("applications");
    expect(JSON.stringify(body)).not.toContain("dale@farms.test");
  });

  it("serves the admin", async () => {
    mock.setUser("user-1", "yunus@swathwise.com");
    const res = await handler(get(URL));
    expect(res.status).toBe(200);
    expect((await res.json()).applications).toHaveLength(2);
  });

  it("matches the allowlist case-insensitively", async () => {
    mock.setUser("user-1", "Yunus@SwathWise.com");
    expect((await handler(get(URL))).status).toBe(200);
  });

  it("honours a multi-address allowlist", async () => {
    await boot({ PILOT_ADMIN_EMAILS: "yunus@swathwise.com, ops@swathwise.com" });
    mock.setUser("user-2", "ops@swathwise.com");
    expect((await handler(get(URL))).status).toBe(200);
  });

  it("refuses a non-GET", async () => {
    mock.setUser("user-1", "yunus@swathwise.com");
    const res = await handler(new Request(URL, { method: "POST", headers: AUTH }));
    expect(res.status).toBe(405);
  });
});

describe("pilot-applications · the response", () => {
  it("never lets a response sit in a shared cache", async () => {
    // The body is a list of other people's contact details.
    mock.setUser("user-1", "yunus@swathwise.com");
    const res = await handler(get(URL));
    expect(res.headers.get("Cache-Control")).toContain("private");
  });

  it("returns the full row so the admin view can show any column", async () => {
    mock.setUser("user-1", "yunus@swathwise.com");
    const { applications } = await (await handler(get(URL))).json();
    expect(applications[0]).toHaveProperty("email");
    expect(applications[0]).toHaveProperty("farm_name");
    expect(applications[0]).toHaveProperty("location");
  });
});
