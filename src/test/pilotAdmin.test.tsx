// The founder's admin panel: every number derived from one snapshot, and every tab rendering it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { type Snapshot, buildRows, daily, errorGroups, overview, personStats, reviewMatrix, stageTimes, timeline } from "@/lib/pilot/adminData";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const iso = (daysAgo: number, h = 10) => new Date(NOW - daysAgo * 86_400_000 + (h - 12) * 3_600_000).toISOString();
const ev = (id: number, user: string, name: string, daysAgo: number, extra: Record<string, unknown> = {}) => ({ id, user_id: user, at: iso(daysAgo), name, session_id: null, route: null, twin_id: null, duration_ms: null, outcome: null, error: null, counts: null, stages: null, detail: null, app_version: "x", ...extra });

function snapshot(): Snapshot {
  return {
    generated_at: new Date(NOW).toISOString(),
    users: [
      { id: "f", email: "yunus@swardus.test", created_at: iso(60), last_sign_in_at: iso(0), confirmed: true, provider: "google" },
      { id: "ryan", email: "ryan@cc.test", created_at: iso(10), last_sign_in_at: iso(1), confirmed: true, provider: "email" },
      { id: "alex", email: "alex@umd.test", created_at: iso(3), last_sign_in_at: null, confirmed: false, provider: "email" },
      { id: "stray", email: "stray@gmail.test", created_at: iso(5), last_sign_in_at: iso(5), confirmed: true, provider: "google" },
    ],
    members: [
      { user_id: "f", role: "founder", status: "active", email: "yunus@swardus.test", display_name: "Yunus", organisation: null, application_id: null, invited_at: null, created_at: iso(60), notes: null },
      { user_id: "ryan", role: "participant", status: "active", email: "ryan@cc.test", display_name: "Ryan", organisation: "Crop Compass", application_id: null, invited_at: iso(10), created_at: iso(10), notes: null },
      { user_id: "alex", role: "participant", status: "active", email: "alex@umd.test", display_name: "Alex", organisation: "UMD Extension", application_id: null, invited_at: iso(3), created_at: iso(3), notes: null },
    ],
    events: [
      ev(1, "ryan", "session_start", 1),
      ev(2, "ryan", "twin_check_done", 1, { counts: { files: 42, usable: 40, stops: 0, warnings: 1 } }),
      ev(3, "ryan", "twin_build_finished", 1, { duration_ms: 64_000, outcome: "ok", twin_id: "t1", counts: { photographs: 40, used: 38, refused: 2 }, stages: { corn: 40_000, cameras: 10_000 }, detail: { crop: "corn", camera: "DJI FC6310R" } }),
      ev(4, "ryan", "twin_build_failed", 2, { duration_ms: 9_000, outcome: "error", error: "RangeError: allocation of 123456 bytes failed", counts: { photographs: 600 }, detail: { crop: "corn", stage: "corn" } }),
      ev(5, "ryan", "client_error", 2, { outcome: "error", error: "TypeError: x is undefined at 12" }),
      ev(6, "ryan", "client_error", 3, { outcome: "error", error: "TypeError: x is undefined at 99" }),
      ev(7, "ryan", "finding_reviewed", 1, { twin_id: "t1", detail: { kind: "corn_weed", verdict: "wrong" } }),
    ],
    twins: [
      { id: "t1", user_id: "ryan", name: "North block", crop: "corn", captured_at: iso(12), photographs: 38, camera: "DJI FC6310R", placement: "gnss", area_ha: 1.2, status: "ready", error: null, build_ms: 64_000, created_at: iso(1), updated_at: iso(1) },
      { id: "t2", user_id: "ryan", name: "South", crop: "corn", captured_at: null, photographs: null, camera: null, placement: null, area_ha: null, status: "incomplete", error: "storage blip", build_ms: null, created_at: iso(2), updated_at: iso(2) },
    ],
    reviews: [
      { user_id: "ryan", twin_id: "t1", finding_kind: "corn_weed", finding_id: "4", verdict: "wrong", note: "volunteer corn", algorithm_status: "confirmed", created_at: iso(1), updated_at: iso(1) },
      { user_id: "ryan", twin_id: "t1", finding_kind: "corn_weed", finding_id: "5", verdict: "correct", note: null, algorithm_status: "confirmed", created_at: iso(1), updated_at: iso(1) },
      { user_id: "ryan", twin_id: "t1", finding_kind: "corn_gap", finding_id: "1", verdict: "unsure", note: null, algorithm_status: "confirmed", created_at: iso(1), updated_at: iso(1) },
    ],
    feedback: [{ id: "fb1", user_id: "ryan", created_at: iso(1), kind: "finding", message: "The red ones by the gate are stones.", route: "/app/twins/:id", twin_id: "t1", context: { app_version: "x" }, status: "new", notified_at: null }],
    consents: [
      { user_id: "ryan", created_at: iso(9), terms_version: "pilot-2026-11-v1", troubleshooting_access: false, research_use: false },
      { user_id: "ryan", created_at: iso(2), terms_version: "pilot-2026-11-v1", troubleshooting_access: true, research_use: false },
    ],
    applications: [{ id: "a1", created_at: iso(20), full_name: "Dale Hutchins", email: "dale@farm.test", farm_name: "Hutchins Farms", location: "Iowa", crops: "Corn", drone_status: "RGB drone", drone_model: "Mavic 3", acreage_range: "500+", notes: null }],
    access: [{ at: iso(1), founder_id: "f", participant_id: "ryan", twin_id: "t1", action: "open_twin", reason: "weeds by the gate" }],
    missing: {},
  };
}

describe("the panel's numbers", () => {
  it("each person: where they are, builds, reviews, newest consent", () => {
    const p = personStats(snapshot(), NOW);
    const ryan = p.find(x => x.member.user_id === "ryan")!, alex = p.find(x => x.member.user_id === "alex")!;
    expect(ryan).toMatchObject({ stage: "reviewing", buildsOk: 1, buildsFailed: 1, medianBuildMs: 64_000, twinsReady: 1, twinsIncomplete: 1, reviews: 3, wrong: 1, feedback: 1, errors: 2, daysActive: 3 });
    expect(ryan.consent?.troubleshooting_access).toBe(true);
    expect(alex).toMatchObject({ stage: "new", lastSignIn: null, consent: null });
  });

  it("overview counts participants only", () => {
    expect(overview(snapshot(), NOW)).toMatchObject({ participants: 2, activeLast7: 1, neverSignedIn: 1, twinsReady: 1, builds: 2, buildSuccessPct: 50, medianBuildMs: 64_000, reviews: 3, wrongPct: 33, feedbackNew: 1, errorsLast7: 2 });
  });

  it("days, builds, stages, reviews, errors and the timeline", () => {
    const d = daily(snapshot(), 7, NOW);
    expect(d).toHaveLength(7);
    expect(d.find(x => x.day === iso(1).slice(0, 10))).toMatchObject({ people: 1, builds: 1, reviews: 3, feedback: 1 });
    expect(buildRows(snapshot()).map(b => b.outcome)).toEqual(["finished", "failed"]);
    expect(stageTimes(snapshot())[0]).toEqual({ stage: "corn", medianMs: 40_000, builds: 1 });
    expect(reviewMatrix(snapshot())[0]).toMatchObject({ kind: "corn_weed", status: "confirmed", correct: 1, wrong: 1, total: 2 });
    const g = errorGroups(snapshot());
    expect(g.find(x => x.kind === "client_error")).toMatchObject({ count: 2, people: 1, message: "TypeError: x is undefined at n" });
    expect(timeline(snapshot(), "ryan").map(t => t.text)).toContain("Build finished: \"North block\", 64 s, 40 photographs");
  });
});

// ---- the page ----------------------------------------------------------------------------------------------------
const calls: { action: string; body: Record<string, unknown> }[] = [];
let snap: Snapshot;
vi.mock("@/lib/pilot/adminClient", () => ({
  pilotAdmin: async (action: string, body: Record<string, unknown> = {}) => {
    calls.push({ action, body });
    if (action === "snapshot") return snap;
    if (action === "health") return { checks: [{ id: "signups", label: "New sign-ups", status: "fail", detail: "Open: anyone can create an account." }, { id: "resend", label: "Email sending", status: "ok", detail: "RESEND_API_KEY is set." }] };
    if (action === "twin-open") throw new Error("This participant has not allowed troubleshooting access, so their Field Twin cannot be opened here.");
    return { ok: true };
  },
}));
import PilotAdmin from "@/pages/admin/PilotAdmin";
import AdminTwinViewer from "@/pages/admin/AdminTwinViewer";

const renderAt = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/admin/pilot" element={<PilotAdmin />} />
      <Route path="/admin/pilot/people/:id" element={<PilotAdmin />} />
      <Route path="/admin/pilot/twins/:id" element={<AdminTwinViewer />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => { calls.length = 0; snap = { ...snapshot(), generated_at: new Date().toISOString() }; });

describe("the admin panel", () => {
  it("overview: the headline numbers, the daily charts and what needs attention", async () => {
    renderAt("/admin/pilot");
    expect(await screen.findByText("Participants")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Participants active per day/ })).toBeInTheDocument();
    const attention = screen.getByRole("heading", { name: "Needs attention" }).closest("section")!;
    expect(attention).toHaveTextContent("1 feedback message not read yet");
    expect(attention).toHaveTextContent("Ryan: 1 build failed");
    expect(attention).toHaveTextContent("Alex has not signed in since being invited");
    expect(screen.getByRole("button", { name: /Feedback\s*1/ })).toBeInTheDocument();
  });

  it.each([
    ["people", ["Ryan", "Reviewing findings", "Not signed in yet", "troubleshooting"]],
    ["builds", ["Finished", "Failed", "RangeError", "Corn reading"]],
    ["twins", ["North block", "Not saved completely", "GPS"]],
    ["reviews", ["Ryan", "North block", "volunteer corn", "View Field Twin"]],
    ["feedback", ["The red ones by the gate are stones.", "email alert not sent", "Reply"]],
    ["errors", ["TypeError: x is undefined at n", "Build failed"]],
    ["access", ["Allowed", "weeds by the gate", "Not accepted yet"]],
    ["invites", ["Dale Hutchins", "stray@gmail.test", "Invite someone"]],
  ])("the %s tab shows its records", async (tab, texts) => {
    renderAt(`/admin/pilot?tab=${tab}`);
    for (const t of texts) expect((await screen.findAllByText(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).length).toBeGreaterThan(0);
  });

  it("a person's page: their numbers, Field Twins, timeline, and access controls that call the server", async () => {
    renderAt("/admin/pilot/people/ryan");
    expect(await screen.findByRole("heading", { name: "Ryan" })).toBeInTheDocument();
    expect(screen.getByText("Everything they did")).toBeInTheDocument();
    expect(screen.getAllByText("North block").length).toBeGreaterThan(0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Pause access" })); });
    expect(calls.find(c => c.action === "set-status")?.body).toEqual({ user_id: "ryan", status: "paused" });
  });

  it("marking feedback seen calls the server and reloads", async () => {
    renderAt("/admin/pilot?tab=feedback");
    const item = (await screen.findByText("The red ones by the gate are stones.")).closest("li")!;
    await act(async () => { fireEvent.click(within(item).getByRole("button", { name: "Seen" })); });
    expect(calls.find(c => c.action === "feedback-status")?.body).toEqual({ id: "fb1", status: "seen" });
    await waitFor(() => expect(calls.filter(c => c.action === "snapshot").length).toBeGreaterThan(1));
  });

  it("health lists what to fix first", async () => {
    renderAt("/admin/pilot?tab=health");
    const items = await screen.findAllByRole("listitem");
    expect(items[0]).toHaveTextContent("New sign-ups");
    expect(items[0]).toHaveTextContent("Fix");
  });

  it("opening a participant's twin asks why, and shows the server's refusal when they did not allow it", async () => {
    renderAt("/admin/pilot/twins/t1");
    const open = screen.getByRole("button", { name: "Open read-only" });
    expect(open).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Why are you opening it/), { target: { value: "checking the gate weeds" } });
    await act(async () => { fireEvent.click(open); });
    expect(await screen.findByRole("alert")).toHaveTextContent(/not allowed troubleshooting access/);
    expect(calls.find(c => c.action === "twin-open")?.body).toEqual({ twin_id: "t1", reason: "checking the gate weeds" });
  });
});
