// @vitest-environment node
//
// The founder's pilot desk. It holds the service-role key and the admin auth API, so its founder check is the
// entire boundary in front of every participant's email address and every invitation.
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH, type SupabaseMock, installDenoGlobal, jsonResponse, loadFunction, makeSupabase, mockFetch, postJson } from "./harness";
import { __setMockClient } from "./supabaseClientMock";

const FN = "../../../supabase/functions/pilot-admin/index.ts";
const URL = "https://fn/pilot-admin";

let db: SupabaseMock;

async function boot(members: Record<string, unknown>[], env: Record<string, string> = {}) {
  installDenoGlobal(env);
  db = makeSupabase({ pilot_members: members, pilot_applications: [{ id: "a1", email: "dale@farm.test" }] });
  db.authUsers.push({ id: "user-1", email: "founder@swardus.test", last_sign_in_at: "2026-11-09T10:00:00Z" });
  __setMockClient(db.client);
  const resend = mockFetch([{ match: "api.resend.com", respond: () => jsonResponse({ id: "email-1" }) }]);
  return { handler: await loadFunction(FN), resend };
}

const FOUNDER = [{ user_id: "user-1", role: "founder", status: "active", created_at: "2026-11-01" }];

afterEach(() => { vi.unstubAllGlobals(); });

describe("pilot-admin · who may use it", () => {
  it.each([
    ["no token", undefined, FOUNDER],
    ["a participant", AUTH, [{ user_id: "user-1", role: "participant", status: "active" }]],
    ["an account outside the pilot", AUTH, []],
    ["a paused founder", AUTH, [{ user_id: "user-1", role: "founder", status: "paused" }]],
  ] as const)("refuses %s, and creates no link", async (_who, headers, members) => {
    const { handler } = await boot([...members]);
    const res = await handler(postJson(URL, { action: "invite", email: "new@farm.test" }, headers ?? {}));
    expect([401, 403]).toContain(res.status);
    expect(db.links).toHaveLength(0);
    expect(db.tables.pilot_members.filter(m => m.email === "new@farm.test")).toHaveLength(0);
  });
});

describe("pilot-admin · invite", () => {
  it("creates the account by invitation, writes an active participant, emails the link and returns it", async () => {
    const { handler, resend } = await boot(FOUNDER, { RESEND_API_KEY: "re_test" });
    const res = await handler(postJson(URL, { action: "invite", email: " Ryan@CropCompass.test ", name: "Ryan", organisation: "Crop Compass", origin: "http://localhost:8080" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.kind).toBe("invite");
    expect(body.link).toMatch(/^https:\/\/test\.supabase\.co\/auth\/v1\/verify/);
    expect(body.emailed).toBe(true);
    expect(db.links).toEqual([{ type: "invite", email: "ryan@cropcompass.test", redirectTo: "http://localhost:8080/auth/welcome" }]);
    const row = db.tables.pilot_members.find(m => m.email === "ryan@cropcompass.test")!;
    expect(row).toMatchObject({ role: "participant", status: "active", display_name: "Ryan", organisation: "Crop Compass", invited_by: "user-1" });
    const mail = JSON.parse(String(((resend.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(mail.to).toBe("ryan@cropcompass.test");
    expect(mail.text).toContain(body.link);
  });

  it("an address that already has an account gets a sign-in link, not a second account", async () => {
    const { handler } = await boot(FOUNDER);
    db.authUsers.push({ id: "existing-9", email: "alex@umd.test" });
    const body = await (await handler(postJson(URL, { action: "invite", email: "alex@umd.test" }))).json();
    expect(body.kind).toBe("sign-in");
    expect(db.links[0].type).toBe("magiclink");
    expect(db.authUsers.filter(u => u.email === "alex@umd.test")).toHaveLength(1);
    expect(db.tables.pilot_members.find(m => m.user_id === "existing-9")).toMatchObject({ role: "participant", status: "active" });
  });

  it("re-inviting someone reactivates them and never demotes a founder", async () => {
    const { handler } = await boot([...FOUNDER, { user_id: "existing-9", role: "participant", status: "ended" }]);
    db.authUsers.push({ id: "existing-9", email: "alex@umd.test" });
    await handler(postJson(URL, { action: "invite", email: "alex@umd.test" }));
    expect(db.tables.pilot_members.find(m => m.user_id === "existing-9")).toMatchObject({ status: "active" });
    await handler(postJson(URL, { action: "invite", email: "founder@swardus.test" }));
    expect(db.tables.pilot_members.find(m => m.user_id === "user-1")).toMatchObject({ role: "founder" });
  });

  it("still returns the link when email is not configured, and says so", async () => {
    const { handler } = await boot(FOUNDER);
    const body = await (await handler(postJson(URL, { action: "invite", email: "new@farm.test" }))).json();
    expect(body.link).toBeTruthy();
    expect(body.emailed).toBe(false);
    expect(body.email_problem).toBe("unconfigured");
  });

  it("sends people back only to the app's own origins", async () => {
    const { handler } = await boot(FOUNDER);
    await handler(postJson(URL, { action: "invite", email: "new@farm.test", origin: "https://evil.test" }));
    expect(db.links[0].redirectTo).toBe("https://swathwise.com/auth/welcome");
  });

  it("refuses a malformed address", async () => {
    const { handler } = await boot(FOUNDER);
    expect((await handler(postJson(URL, { action: "invite", email: "not-an-email" }))).status).toBe(400);
    expect(db.links).toHaveLength(0);
  });
});

describe("pilot-admin · members and status", () => {
  it("lists members with their last sign-in, and accounts that are not in the pilot", async () => {
    const { handler } = await boot(FOUNDER);
    db.authUsers.push({ id: "stray-1", email: "stray@gmail.test" });
    const body = await (await handler(postJson(URL, { action: "members" }))).json();
    expect(body.members[0]).toMatchObject({ user_id: "user-1", account_email: "founder@swardus.test", last_sign_in_at: "2026-11-09T10:00:00Z" });
    expect(body.outsiders).toEqual([expect.objectContaining({ user_id: "stray-1", email: "stray@gmail.test" })]);
  });

  it("pauses a participant, and refuses to let the founder change their own access", async () => {
    const { handler } = await boot([...FOUNDER, { user_id: "p1", role: "participant", status: "active" }]);
    expect((await handler(postJson(URL, { action: "set-status", user_id: "p1", status: "paused" }))).status).toBe(200);
    expect(db.tables.pilot_members.find(m => m.user_id === "p1")!.status).toBe("paused");
    expect((await handler(postJson(URL, { action: "set-status", user_id: "user-1", status: "ended" }))).status).toBe(400);
    expect((await handler(postJson(URL, { action: "set-status", user_id: "p1", status: "deleted" }))).status).toBe(400);
  });

  it("serves the applications to the founder", async () => {
    const { handler } = await boot(FOUNDER);
    const body = await (await handler(postJson(URL, { action: "applications" }))).json();
    expect(body.applications).toEqual([{ id: "a1", email: "dale@farm.test" }]);
  });
});
