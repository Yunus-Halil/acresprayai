// @vitest-environment node
//
// The public submission endpoint. This is the only path from "a farmer pressed
// submit" to "a row exists and Yunus has an email", so the things worth
// asserting are that exactly one row lands, that every answer reaches the
// column it belongs in, and that a mail failure never costs us the application.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setMockClient } from "./supabaseClientMock";
import {
  flushBackground, installDenoGlobal, loadFunction, makeSupabase, mockFetch,
  jsonResponse, type EdgeHandler, type SupabaseMock,
} from "./harness";

const FN = "../../../supabase/functions/pilot-apply/index.ts";

const COMPLETE = {
  full_name: "  Dale Hutchins ",
  email: "Dale@Hutchins-Farms.COM",
  phone: "555 0142",
  farm_name: "Hutchins Family Farms",
  role: "Farm owner",
  location: "Story County, Iowa",
  acreage_range: "100–500",
  crops: "corn, soybeans",
  has_boundary_survey: "Not sure",
  drone_status: "Have a spray drone",
  drone_model: "DJI Agras T40",
  availability: "This fall (Aug–Oct)",
  referral_source: "Extension office",
  notes: "Two parcels, split by a county road.",
};

let mock: SupabaseMock;
let handler: EdgeHandler;

async function boot(env: Record<string, string> = { RESEND_API_KEY: "re_test" }) {
  installDenoGlobal(env);
  mock = makeSupabase({ pilot_applications: [] });
  __setMockClient(mock.client);
  handler = await loadFunction(FN);
}

const post = (body: unknown) =>
  new Request("https://edge.test/pilot-apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  mockFetch([{ match: "api.resend.com", respond: () => jsonResponse({ id: "email-1" }) }]);
  await boot();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("pilot-apply · a complete application", () => {
  it("stores exactly one row", async () => {
    const res = await handler(post(COMPLETE));
    expect(res.status).toBe(200);
    expect(mock.tables.pilot_applications).toHaveLength(1);
  });

  it("maps every answer onto its own column", async () => {
    await handler(post(COMPLETE));
    const row = mock.tables.pilot_applications[0];

    expect(row).toMatchObject({
      full_name: "Dale Hutchins",          // trimmed
      email: "dale@hutchins-farms.com",    // lowercased, so it dedupes later
      phone: "555 0142",
      farm_name: "Hutchins Family Farms",
      role: "Farm owner",
      location: "Story County, Iowa",
      acreage_range: "100–500",
      crops: "corn, soybeans",
      has_boundary_survey: "Not sure",
      drone_status: "Have a spray drone",
      drone_model: "DJI Agras T40",
      availability: "This fall (Aug–Oct)",
      referral_source: "Extension office",
      notes: "Two parcels, split by a county road.",
    });
  });

  it("stores empty optional answers as null rather than empty strings", async () => {
    await handler(post({ ...COMPLETE, phone: "", referral_source: "  ", notes: "" }));
    const row = mock.tables.pilot_applications[0];
    expect(row.phone).toBeNull();
    expect(row.referral_source).toBeNull();
    expect(row.notes).toBeNull();
  });
});

describe("pilot-apply · rejection", () => {
  it.each([
    ["full_name", "Your name is required"],
    ["email", "Email is required"],
    ["farm_name", "Farm or operation name is required"],
    ["role", "Your role is required"],
    ["location", "Location is required"],
    ["acreage_range", "Approximate acreage is required"],
    ["crops", "Primary crops is required"],
    ["drone_status", "Drone ownership is required"],
    ["availability", "Availability is required"],
  ])("refuses a submission missing %s, and writes nothing", async (field, message) => {
    const res = await handler(post({ ...COMPLETE, [field]: "" }));
    expect(res.status).toBe(422);
    expect((await res.json()).errors[field]).toBe(message);
    expect(mock.tables.pilot_applications).toHaveLength(0);
  });

  it("refuses a value that is not one of the offered options", async () => {
    // The client can only ever send a listed option; anything else came from
    // somewhere that is not our form, and the table has a CHECK to match.
    const res = await handler(post({ ...COMPLETE, acreage_range: "10000 hectares" }));
    expect(res.status).toBe(422);
    expect(mock.tables.pilot_applications).toHaveLength(0);
  });

  it("refuses a malformed email", async () => {
    const res = await handler(post({ ...COMPLETE, email: "dale at hutchins" }));
    expect(res.status).toBe(422);
    expect((await res.json()).errors.email).toMatch(/doesn't look like an email/i);
  });

  it("refuses a non-POST", async () => {
    const res = await handler(new Request("https://edge.test/pilot-apply", { method: "GET" }));
    expect(res.status).toBe(405);
  });
});

describe("pilot-apply · the conditional drone model", () => {
  it("is stored when the applicant said they have a spray drone", async () => {
    await handler(post({ ...COMPLETE, drone_status: "Have a spray drone", drone_model: "Agras T40" }));
    expect(mock.tables.pilot_applications[0].drone_model).toBe("Agras T40");
  });

  it.each(["No drone yet", "RGB drone (regular camera)", "Multispectral drone"])(
    "is dropped when the answer is %s",
    async (status) => {
      // The form hides the input, but a value can survive in state if someone
      // fills it in and then changes their mind. It must not reach the row -
      // the table has a CHECK that would reject it anyway.
      await handler(post({ ...COMPLETE, drone_status: status, drone_model: "Agras T40" }));
      expect(mock.tables.pilot_applications[0].drone_model).toBeNull();
    },
  );
});

describe("pilot-apply · notification", () => {
  it("emails the pilot address with the applicant's key details", async () => {
    const fetchMock = mockFetch([
      { match: "api.resend.com", respond: () => jsonResponse({ id: "email-1" }) },
    ]);
    await boot({ RESEND_API_KEY: "re_test", PILOT_NOTIFY_TO: "yunus@swathwise.com" });

    const res = await handler(post(COMPLETE));
    await flushBackground();

    expect(await res.json()).toMatchObject({ ok: true, notified: true });
    expect(fetchMock).toHaveBeenCalled();

    const [, init] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.to).toBe("yunus@swathwise.com");
    expect(body.subject).toContain("Hutchins Family Farms");
    expect(body.text).toContain("dale@hutchins-farms.com");
    expect(body.text).toContain("Story County, Iowa");
    expect(body.text).toContain("DJI Agras T40");
  });

  it("keeps the application when the mail provider fails", async () => {
    // Losing a farmer's application because Resend had a bad minute would be
    // strictly worse than a notification we can recover from the admin view.
    mockFetch([{ match: "api.resend.com", respond: () => jsonResponse({ error: "boom" }, 500) }]);
    await boot({ RESEND_API_KEY: "re_test" });

    const res = await handler(post(COMPLETE));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, notified: false });
    expect(mock.tables.pilot_applications).toHaveLength(1);
  });

  it("keeps the application when no mail provider is configured at all", async () => {
    await boot({});
    const res = await handler(post(COMPLETE));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, notified: false });
    expect(mock.tables.pilot_applications).toHaveLength(1);
  });
});
