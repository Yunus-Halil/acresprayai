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
    // localhost is no longer a default return address: the first allowed origin is used instead.
    expect(db.links).toEqual([{ type: "invite", email: "ryan@cropcompass.test", redirectTo: "https://swathwise.com/auth/welcome" }]);
    const row = db.tables.pilot_members.find(m => m.email === "ryan@cropcompass.test")!;
    expect(row).toMatchObject({ role: "participant", status: "active", display_name: "Ryan", organisation: "Crop Compass", invited_by: "user-1" });
    const mail = JSON.parse(String(((resend.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(mail.to).toBe("ryan@cropcompass.test");
    expect(mail.text).toContain(body.link);
    // The formatted version hides the link behind a button with words; the address is never shown as text.
    const href = body.link.replace(/&/g, "&amp;");
    expect(mail.html).toContain(`href="${href}"`);
    expect(mail.html).toContain(">Set up my account</a>");
    expect(mail.html.replace(`href="${href}"`, "")).not.toContain("/auth/v1/verify");
  });

  it("escapes the name in the formatted invitation", async () => {
    const { handler, resend } = await boot(FOUNDER, { RESEND_API_KEY: "re_test" });
    await handler(postJson(URL, { action: "invite", email: "x@umd.test", name: "<b>Ryan</b>" }));
    const mail = JSON.parse(String(((resend.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(mail.html).toContain("Hello &lt;b&gt;Ryan&lt;/b&gt;,");
    expect(mail.html).not.toContain("<b>Ryan");
  });

  it("H1: an existing account that was never in the pilot is not adopted (it may have been registered by someone else)", async () => {
    const { handler } = await boot(FOUNDER);
    db.authUsers.push({ id: "existing-9", email: "alex@umd.test" });
    const res = await handler(postJson(URL, { action: "invite", email: "alex@umd.test" }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("existing_outsider");
    expect(db.links).toHaveLength(0);
    expect(db.tables.pilot_members.find(m => m.user_id === "existing-9")).toBeUndefined();
  });

  it("someone already in the pilot gets a fresh sign-in link, not a second account", async () => {
    const { handler } = await boot([...FOUNDER, { user_id: "existing-9", role: "participant", status: "active" }]);
    db.authUsers.push({ id: "existing-9", email: "alex@umd.test" });
    const body = await (await handler(postJson(URL, { action: "invite", email: "alex@umd.test" }))).json();
    expect(body.kind).toBe("sign-in");
    expect(db.links[0].type).toBe("magiclink");
    expect(db.authUsers.filter(u => u.email === "alex@umd.test")).toHaveLength(1);
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

describe("pilot-admin · activity", () => {
  async function seeded(members: Record<string, unknown>[] = [...FOUNDER, { user_id: "p1", role: "participant", status: "active", display_name: "Ryan", organisation: "Crop Compass" }]) {
    installDenoGlobal();
    const now = new Date().toISOString();
    db = makeSupabase({
      pilot_members: members,
      app_events: [
        { user_id: "p1", name: "twin_build_finished", at: now, duration_ms: 64000, outcome: "ok", error: null, counts: { photographs: 40, used: 38, refused: 2 }, detail: { crop: "corn", camera: "DJI FC6310R" }, twin_id: null },
        { user_id: "p1", name: "twin_build_failed", at: now, duration_ms: 9000, outcome: "error", error: "RangeError: allocation failed", counts: { photographs: 600 }, detail: { crop: "corn", stage: "corn" }, twin_id: null },
        { user_id: "p1", name: "session_start", at: now, duration_ms: null, outcome: null, error: null, counts: null, detail: null, twin_id: null },
      ],
      field_twins: [{ id: "t1", user_id: "p1", name: "North", crop: "corn", status: "ready", photographs: 38, created_at: now }],
      twin_reviews: [
        { user_id: "p1", twin_id: "t1", finding_kind: "corn_weed", verdict: "wrong", algorithm_status: "confirmed", note: "volunteer corn", updated_at: now, payload: { ring: [[1, 2]] } },
        { user_id: "p1", twin_id: "t1", finding_kind: "corn_weed", verdict: "correct", algorithm_status: "confirmed", note: null, updated_at: now },
      ],
      pilot_feedback: [{ id: "f0f0f0f0-1111-4222-8333-444455556666", user_id: "p1", created_at: now, kind: "problem", message: "It froze", route: "/app/twins/new", twin_id: null, context: null, status: "new" }],
    });
    db.authUsers.push({ id: "p1", email: "ryan@cropcompass.test", last_sign_in_at: now });
    __setMockClient(db.client);
    return loadFunction(FN);
  }

  it("summarises each participant, the builds, the reviews against what Swardus said, and the feedback", async () => {
    const handler = await seeded();
    const body = await (await handler(postJson(URL, { action: "activity" }))).json();
    const ryan = body.people.find((p: { user_id: string }) => p.user_id === "p1");
    expect(ryan).toMatchObject({ name: "Ryan", builds_ok: 1, builds_failed: 1, median_build_ms: 64000, twins: 1, reviews: 2, sessions: 1 });
    expect(body.builds.map((b: { outcome: string }) => b.outcome).sort()).toEqual(["failed", "finished"]);
    expect(body.builds.find((b: { outcome: string }) => b.outcome === "failed")).toMatchObject({ error: "RangeError: allocation failed", stage: "corn", photographs: 600 });
    expect(body.reviews.byKind["corn_weed (confirmed)"]).toEqual({ correct: 1, unsure: 0, wrong: 1 });
    expect(body.reviews.notes[0]).toMatchObject({ who: "Ryan", twin: "North", note: "volunteer corn" });
    expect(body.feedback[0]).toMatchObject({ who: "Ryan", message: "It froze" });
  });

  it("returns no imagery, no storage paths and no boundary outlines", async () => {
    const handler = await seeded();
    const text = await (await handler(postJson(URL, { action: "activity" }))).text();
    expect(db.storage.calls).toHaveLength(0);
    expect(text).not.toMatch(/ring|signed|storage_key|orthos/);
  });

  it("is the founder's only, and the founder marks feedback seen", async () => {
    const participantOnly = await seeded([{ user_id: "user-1", role: "participant", status: "active" }]);
    expect((await participantOnly(postJson(URL, { action: "activity" }))).status).toBe(403);
    const handler = await seeded();
    expect((await handler(postJson(URL, { action: "feedback-status", id: "f0f0f0f0-1111-4222-8333-444455556666", status: "seen" }))).status).toBe(200);
    expect(db.tables.pilot_feedback[0].status).toBe("seen");
  });
});

describe("pilot-admin · the admin panel's data", () => {
  const T1 = "aaaaaaaa-1111-4000-8000-000000000001";
  async function boot2(over: { consents?: Record<string, unknown>[]; members?: Record<string, unknown>[]; env?: Record<string, string>; settings?: Record<string, unknown> } = {}) {
    installDenoGlobal({ RESEND_API_KEY: "re_test", ...over.env });
    const now = new Date().toISOString();
    db = makeSupabase({
      pilot_members: over.members ?? [...FOUNDER, { user_id: "p1", role: "participant", status: "active", display_name: "Ryan" }],
      field_twins: [
        { id: T1, user_id: "p1", storage_key: "north-2026", name: "North", crop: "corn", status: "ready", updated_at: now, created_at: now },
        { id: "bbbbbbbb-1111-4000-8000-000000000002", user_id: "p1", storage_key: "south", name: "South", status: "saving", updated_at: "2026-01-01T00:00:00Z", created_at: now },
      ],
      twin_reviews: [{ user_id: "p1", twin_id: T1, finding_kind: "boundary", finding_id: "cultivated", verdict: "wrong", payload: { ring: [[38.9, -76.9]] }, updated_at: now }],
      app_events: [{ id: 1, user_id: "p1", at: now, name: "session_start" }, { id: 2, user_id: "p1", at: "2025-01-01T00:00:00Z", name: "session_start" }],
      pilot_feedback: [{ id: "f1", user_id: "p1", status: "new", notified_at: null, created_at: now }],
      pilot_consents: over.consents ?? [],
      pilot_applications: [], admin_access_log: [],
    });
    db.authUsers.push({ id: "p1", email: "ryan@cc.test", last_sign_in_at: now }, { id: "stray", email: "stray@gmail.test" });
    db.storage.objects.set(`orthos/p1/field-twins/north-2026/twin.json.gz`, new Uint8Array([1]));
    db.storage.objects.set(`orthos/p1/field-twins/north-2026/atlas-0.jpg`, new Uint8Array([1]));
    db.storage.objects.set(`orthos/p1/field-twins/north-2026/notes.txt`, new Uint8Array([1]));
    __setMockClient(db.client);
    mockFetch([
      { match: "/auth/v1/settings", respond: () => jsonResponse(over.settings ?? { disable_signup: false, mailer_autoconfirm: true, external: { google: true } }) },
      { match: "api.resend.com", respond: () => jsonResponse({ id: "e" }) },
    ]);
    return loadFunction(FN);
  }

  it("snapshot: everything the panel needs, the last 90 days of events, and never a boundary outline or a storage path", async () => {
    const handler = await boot2();
    const res = await handler(postJson(URL, { action: "snapshot" }));
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.members).toHaveLength(2);
    expect(body.twins.map((t: { name: string }) => t.name)).toEqual(["North", "South"]);
    expect(body.events).toHaveLength(1);
    expect(body.users.find((u: { id: string }) => u.id === "stray")).toBeTruthy();
    expect(text).not.toMatch(/ring|storage_key|north-2026|38\.9/);
    expect(db.storage.calls).toHaveLength(0);
  });

  it("health: says what to fix, from what can be read here", async () => {
    const handler = await boot2();
    const { checks } = await (await handler(postJson(URL, { action: "health" }))).json();
    const by = Object.fromEntries(checks.map((c: { id: string; status: string }) => [c.id, c.status]));
    expect(by).toMatchObject({ signups: "fail", confirm: "warn", resend: "ok", from: "warn", tables: "ok", outsiders: "warn", saves: "warn", feedback: "warn" });
    const ok = await boot2({ settings: { disable_signup: true, mailer_autoconfirm: false }, env: { PILOT_NOTIFY_FROM: "pilot@swardus.com", PILOT_NOTIFY_TO: "yunus@swardus.com" } });
    const good = Object.fromEntries((await (await ok(postJson(URL, { action: "health" }))).json()).checks.map((c: { id: string; status: string }) => [c.id, c.status]));
    expect(good).toMatchObject({ signups: "ok", confirm: "ok", from: "ok", to: "ok" });
  });

  it("twin-open: refused without the participant's troubleshooting consent, and nothing is signed", async () => {
    const handler = await boot2({ consents: [{ user_id: "p1", troubleshooting_access: false, created_at: "2026-11-09" }] });
    const res = await handler(postJson(URL, { action: "twin-open", twin_id: T1 }));
    expect(res.status).toBe(403);
    expect(db.storage.calls.filter(c => c.op === "sign")).toHaveLength(0);
    expect(db.tables.admin_access_log).toHaveLength(0);
  });

  it("twin-open: with consent, logged first, then only the twin's own files are signed", async () => {
    const handler = await boot2({ consents: [{ user_id: "p1", troubleshooting_access: true, created_at: "2026-11-09" }] });
    const body = await (await handler(postJson(URL, { action: "twin-open", twin_id: T1, reason: "build looked wrong" }))).json();
    expect(Object.keys(body.files).sort()).toEqual(["atlas-0.jpg", "twin.json.gz"]);
    expect(db.tables.admin_access_log).toEqual([expect.objectContaining({ founder_id: "user-1", participant_id: "p1", twin_id: T1, action: "open_twin", reason: "build looked wrong" })]);
    expect(db.storage.calls.filter(c => c.op === "sign").every(c => c.path.startsWith("p1/field-twins/north-2026/"))).toBe(true);
  });

  it("twin-open under the current terms: agreeing to them is what allows it, and each participant stands on their own newest agreement", async () => {
    // p1 agreed to the current terms (which state the founder's access). Their twin opens, and the opening is logged.
    let handler = await boot2({ consents: [{ user_id: "p1", terms_version: "pilot-2026-11-v1", troubleshooting_access: false, created_at: "2026-11-09" }, { user_id: "p1", terms_version: "pilot-2026-11-v2", troubleshooting_access: true, created_at: "2026-11-11" }] });
    expect((await handler(postJson(URL, { action: "twin-open", twin_id: T1, reason: "Pilot evaluation" }))).status).toBe(200);
    expect(db.tables.admin_access_log).toEqual([expect.objectContaining({ participant_id: "p1", twin_id: T1, reason: "Pilot evaluation" })]);
    // A participant who has only ever agreed to the earlier terms, and did not tick access there, is NOT moved to the
    // new access by the app having new terms: refused, nothing logged, nothing signed, and the refusal says why.
    handler = await boot2({ consents: [{ user_id: "p1", terms_version: "pilot-2026-11-v1", troubleshooting_access: false, created_at: "2026-11-09" }] });
    const refused = await handler(postJson(URL, { action: "twin-open", twin_id: T1, reason: "Pilot evaluation" }));
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toMatch(/has not agreed to pilot terms that let Swardus open their Field Twins/);
    expect(db.tables.admin_access_log).toHaveLength(0);
    expect(db.storage.calls.filter(c => c.op === "sign")).toHaveLength(0);
    // Nor is a participant who has agreed to nothing at all.
    handler = await boot2({ consents: [] });
    expect((await handler(postJson(URL, { action: "twin-open", twin_id: T1 }))).status).toBe(403);
    expect(db.storage.calls.filter(c => c.op === "sign")).toHaveLength(0);
  });

  it("twin-open and snapshot are the founder's only", async () => {
    const handler = await boot2({ members: [{ user_id: "user-1", role: "participant", status: "active" }], consents: [{ user_id: "p1", troubleshooting_access: true }] });
    expect((await handler(postJson(URL, { action: "twin-open", twin_id: T1 }))).status).toBe(403);
    expect((await handler(postJson(URL, { action: "snapshot" }))).status).toBe(403);
    expect((await handler(postJson(URL, { action: "health" }))).status).toBe(403);
    expect(db.storage.calls).toHaveLength(0);
  });
});
