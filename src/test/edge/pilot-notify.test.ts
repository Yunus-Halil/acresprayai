// @vitest-environment node
//
// pilot-notify emails the founder a participant's feedback, once, and only for the caller's own message.
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH, type SupabaseMock, installDenoGlobal, jsonResponse, loadFunction, makeSupabase, mockFetch, postJson } from "./harness";
import { __setMockClient } from "./supabaseClientMock";

const FN = "../../../supabase/functions/pilot-notify/index.ts";
const ID = "f0f0f0f0-1111-4222-8333-444455556666";
let db: SupabaseMock;

async function boot(rows: Record<string, unknown>[], members = [{ user_id: "user-1", role: "participant", status: "active", display_name: "Ryan", organisation: "Crop Compass" }]) {
  installDenoGlobal({ RESEND_API_KEY: "re_test", PILOT_NOTIFY_TO: "founder@swardus.test" });
  db = makeSupabase({ pilot_feedback: rows, pilot_members: members });
  db.setUser("user-1", "ryan@cropcompass.test");
  __setMockClient(db.client);
  const resend = mockFetch([{ match: "api.resend.com", respond: () => jsonResponse({ id: "e1" }) }]);
  return { handler: await loadFunction(FN), resend };
}
const row = (over: Record<string, unknown> = {}) => ({ id: ID, user_id: "user-1", kind: "finding", message: "Those are stones.", route: "/app/twins/:id", twin_id: null, context: { app_version: "abc" }, created_at: "2026-11-09", notified_at: null, ...over });

afterEach(() => { vi.unstubAllGlobals(); });

describe("pilot-notify", () => {
  it("emails the founder the participant's message, replies going to the participant, and marks it notified", async () => {
    const { handler, resend } = await boot([row()]);
    const res = await handler(postJson("https://fn/pilot-notify", { feedback_id: ID }));
    expect(await res.json()).toEqual({ notified: true });
    const mail = JSON.parse(String(((resend.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(mail).toMatchObject({ to: "founder@swardus.test", reply_to: "ryan@cropcompass.test" });
    expect(mail.subject).toMatch(/A finding looks wrong from Ryan, Crop Compass/);
    expect(mail.text).toContain("Those are stones.");
    expect(db.tables.pilot_feedback[0].notified_at).toBeTruthy();
  });

  it("never emails someone else's message, and says nothing about it", async () => {
    const { handler, resend } = await boot([row({ user_id: "user-2" })]);
    const res = await handler(postJson("https://fn/pilot-notify", { feedback_id: ID }));
    expect(res.status).toBe(404);
    expect(resend).not.toHaveBeenCalled();
  });

  it("does not email twice", async () => {
    const { handler, resend } = await boot([row({ notified_at: "2026-11-09T10:00:00Z" })]);
    expect(await (await handler(postJson("https://fn/pilot-notify", { feedback_id: ID }))).json()).toEqual({ notified: true });
    expect(resend).not.toHaveBeenCalled();
  });

  it("refuses an account outside the pilot and a caller with no token", async () => {
    const { handler } = await boot([row()], []);
    expect((await handler(postJson("https://fn/pilot-notify", { feedback_id: ID }))).status).toBe(403);
    expect((await handler(postJson("https://fn/pilot-notify", { feedback_id: ID }, {}))).status).toBe(401);
    expect(AUTH).toBeTruthy();
  });
});
