// @vitest-environment jsdom
//
// The founder's desk shows what a participant said was there on a corn finding they marked wrong (twin_reviews.says),
// beside what Swardus called it. pilot-admin may be deployed before or after the column exists, and the panel may
// meet a pilot-admin that does not send it yet: every combination shows the reviews it always showed.
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH, type SupabaseMock, installDenoGlobal, jsonResponse, loadFunction, makeSupabase, mockFetch, postJson } from "./edge/harness";
import { __setMockClient } from "./edge/supabaseClientMock";
import { type SnapReview, type Snapshot, reviewMatrix, wrongAnswers } from "@/lib/pilot/adminData";
import { ReviewsSection } from "@/components/pilot/admin/sections";

const FN = "../../../supabase/functions/pilot-admin/index.ts";
const URL = "https://fn/pilot-admin";
const T1 = "aaaaaaaa-1111-4000-8000-000000000001";
const now = new Date().toISOString();

let db: SupabaseMock;
afterEach(() => { vi.unstubAllGlobals(); });

const REVIEWS = [
  { user_id: "p1", twin_id: T1, finding_kind: "corn_weed", finding_id: "4", verdict: "wrong", note: null, algorithm_status: "confirmed", says: "corn_in_row", payload: null, created_at: now, updated_at: now },
  { user_id: "p1", twin_id: T1, finding_kind: "corn_weed", finding_id: "5", verdict: "correct", note: null, algorithm_status: "confirmed", says: null, payload: null, created_at: now, updated_at: now },
  { user_id: "p1", twin_id: T1, finding_kind: "corn_gap", finding_id: "1", verdict: "wrong", note: "the planter skipped", algorithm_status: "confirmed", says: "<b>free text</b>", payload: null, created_at: now, updated_at: now },
  { user_id: "p1", twin_id: T1, finding_kind: "boundary", finding_id: "cultivated", verdict: "wrong", note: null, algorithm_status: "high", says: null, payload: { ring: [[38.9, -76.9]] }, created_at: now, updated_at: now },
];

/** The function over a database that has the column (the mock returns whole rows) or does not (asking for it is an error, as PostgREST answers). */
async function boot(hasSays: boolean) {
  installDenoGlobal({ RESEND_API_KEY: "re_test" });
  db = makeSupabase({
    pilot_members: [{ user_id: "user-1", role: "founder", status: "active", created_at: "2026-11-01" }, { user_id: "p1", role: "participant", status: "active", display_name: "Ryan" }],
    field_twins: [{ id: T1, user_id: "p1", storage_key: "north-2026", name: "North", crop: "corn", status: "ready", updated_at: now, created_at: now }],
    twin_reviews: REVIEWS.map(r => (hasSays ? r : (({ says: _s, ...rest }) => rest)(r))),
    app_events: [], pilot_feedback: [], pilot_consents: [], pilot_applications: [], admin_access_log: [],
  });
  const selects: string[] = [];
  const client = db.client as unknown as { from: (t: string) => Record<string, unknown> };
  const from = client.from.bind(client);
  client.from = (t: string) => {
    const b = from(t);
    if (t !== "twin_reviews") return b;
    const select = (b.select as (c: string) => unknown).bind(b);
    b.select = (cols: string) => {
      selects.push(cols);
      if (hasSays || !/\bsays\b/.test(cols)) return select(cols);
      const refused: Record<string, unknown> = { order: () => refused, limit: () => refused, eq: () => refused, then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "column twin_reviews.says does not exist" } }).then(res) };
      return refused;
    };
    return b;
  };
  __setMockClient(db.client);
  mockFetch([{ match: "/auth/v1/settings", respond: () => jsonResponse({ disable_signup: true }) }]);
  return { handler: await loadFunction(FN), selects };
}

describe("pilot-admin snapshot · the reviewer's answer", () => {
  it("sends the answer with each review when the database has the column, and still no outline or path", async () => {
    const { handler } = await boot(true);
    const text = await (await handler(postJson(URL, { action: "snapshot" }, AUTH))).text();
    const body = JSON.parse(text) as Snapshot;
    expect(body.reviews.map(r => [r.finding_kind, r.verdict, r.algorithm_status, r.says])).toEqual([
      ["corn_weed", "wrong", "confirmed", "corn_in_row"], ["corn_weed", "correct", "confirmed", null],
      // Anything that is not one short word from the list is dropped, never shown.
      ["corn_gap", "wrong", "confirmed", null], ["boundary", "wrong", "high", null],
    ]);
    expect(body.missing.reviews).toBe(false);
    expect(text).not.toMatch(/ring|storage_key|north-2026|38\.9|free text/);
  });

  it("deployed before the migration: the same reviews as before, none with an answer, and the table is not reported missing", async () => {
    const { handler, selects } = await boot(false);
    const body = await (await handler(postJson(URL, { action: "snapshot" }, AUTH))).json() as Snapshot;
    expect(body.reviews).toHaveLength(4);
    expect(body.reviews.every(r => r.says === null)).toBe(true);
    expect(body.reviews[2]).toMatchObject({ finding_kind: "corn_gap", verdict: "wrong", note: "the planter skipped", algorithm_status: "confirmed" });
    expect(body.missing.reviews).toBe(false);
    expect(selects.filter(s => /\bsays\b/.test(s))).toHaveLength(1);
    // The health check and every other action are untouched by the missing column.
    const health = await (await handler(postJson(URL, { action: "health" }, AUTH))).json();
    expect(health.checks.find((c: { id: string }) => c.id === "tables")).toMatchObject({ status: "ok" });
  });

  it("stays the founder's only", async () => {
    const { handler } = await boot(true);
    db.tables.pilot_members[0].role = "participant";
    expect((await handler(postJson(URL, { action: "snapshot" }, AUTH))).status).toBe(403);
  });
});

// ---- the panel ---------------------------------------------------------------------------------------------------
const review = (r: Partial<SnapReview> & Pick<SnapReview, "finding_kind" | "finding_id" | "verdict">): SnapReview =>
  ({ user_id: "ryan", twin_id: "t1", note: null, algorithm_status: "confirmed", created_at: now, updated_at: now, ...r });
const snap = (reviews: SnapReview[]): Snapshot => ({
  generated_at: now, users: [], events: [], feedback: [], consents: [], applications: [], access: [], missing: {},
  members: [{ user_id: "ryan", role: "participant", status: "active", email: "ryan@cc.test", display_name: "Ryan", organisation: null, application_id: null, invited_at: null, created_at: now, notes: null }],
  twins: [{ id: "t1", user_id: "ryan", name: "North block", crop: "corn", captured_at: null, photographs: 38, camera: null, placement: "gnss", area_ha: null, status: "ready", error: null, build_ms: null, created_at: now, updated_at: now }],
  reviews,
});
const WITH_ANSWERS = snap([
  review({ finding_kind: "corn_weed", finding_id: "4", verdict: "wrong", says: "corn_in_row" }),
  review({ finding_kind: "corn_weed", finding_id: "6", verdict: "wrong", says: "corn_in_row", user_id: "alex" }),
  review({ finding_kind: "corn_weed", finding_id: "7", verdict: "wrong", says: "soil_or_residue", note: "a clod" }),
  review({ finding_kind: "corn_weed", finding_id: "8", verdict: "wrong", algorithm_status: "unconfirmed" }),
  review({ finding_kind: "corn_weed", finding_id: "5", verdict: "correct" }),
  review({ finding_kind: "corn_gap", finding_id: "1", verdict: "wrong", says: "plants_present" }),
  review({ finding_kind: "weed", finding_id: "12", verdict: "wrong", algorithm_status: "verified", note: "a stone" }),
]);

describe("the panel's numbers", () => {
  it("counts corn findings marked wrong by what Swardus said and what the participant said, and nothing else", () => {
    expect(wrongAnswers(WITH_ANSWERS)).toEqual([
      { kind: "corn_weed", status: "confirmed", says: "corn_in_row", count: 2, people: 2 },
      { kind: "corn_gap", status: "confirmed", says: "plants_present", count: 1, people: 1 },
      { kind: "corn_weed", status: "confirmed", says: "soil_or_residue", count: 1, people: 1 },
      { kind: "corn_weed", status: "unconfirmed", says: "", count: 1, people: 1 },
    ]);
    expect(wrongAnswers(WITH_ANSWERS, "alex")).toEqual([{ kind: "corn_weed", status: "confirmed", says: "corn_in_row", count: 1, people: 1 }]);
    // The verdict table is what it was: the answer does not split or change its rows.
    expect(reviewMatrix(WITH_ANSWERS).find(m => m.kind === "corn_weed" && m.status === "confirmed")).toMatchObject({ correct: 1, wrong: 3, total: 4 });
  });
});

describe("the reviews tab", () => {
  it("shows the participant's answer beside what Swardus said, and in the list with their notes", () => {
    render(<ReviewsSection snap={WITH_ANSWERS} />);
    const table = screen.getByRole("heading", { name: /Corn findings marked wrong/ }).closest("section")!;
    const rows = within(table).getAllByRole("row").slice(1).map(r => within(r).getAllByRole("cell").map(c => c.textContent));
    expect(rows).toEqual([
      ["corn weed", "confirmed", "Corn, in the row", "2", "2"],
      ["corn gap", "confirmed", "Corn plants are there", "1", "1"],
      ["corn weed", "confirmed", "Soil or residue", "1", "1"],
      ["corn weed", "unconfirmed", "No answer given", "1", "1"],
    ]);
    expect(within(table).getByText(/not a verified label/)).toBeInTheDocument();
    const list = screen.getByRole("heading", { name: "Their notes and answers" }).closest("section")!;
    // A review with an answer and no note is listed too; one with neither is not.
    expect(within(list).getAllByRole("row")).toHaveLength(1 + 5);
    const clod = within(list).getByText("a clod").closest("tr")!;
    expect(clod).toHaveTextContent("corn weed 7 (confirmed)");
    expect(clod).toHaveTextContent("WrongSoil or residue");
    expect(within(list).getByText("a stone").closest("tr")).toHaveTextContent(/weed 12 \(verified\)Wronga stone/);
  });

  it("from a pilot-admin that does not send answers yet: the tab is as it was, the corn table only says none were given", () => {
    const old = snap(WITH_ANSWERS.reviews.map(({ says: _s, ...r }) => r));
    render(<ReviewsSection snap={old} />);
    expect(screen.getByText("a clod")).toBeInTheDocument();
    expect(screen.getByText("a stone")).toBeInTheDocument();
    const list = screen.getByRole("heading", { name: "Their notes and answers" }).closest("section")!;
    expect(within(list).getAllByRole("row")).toHaveLength(1 + 2);
    expect(screen.getAllByText("No answer given").length).toBeGreaterThan(0);
    expect(screen.queryByText("Corn, in the row")).toBeNull();
  });

  it("with no corn finding marked wrong, nothing new is on the tab", () => {
    render(<ReviewsSection snap={snap([review({ finding_kind: "weed", finding_id: "12", verdict: "wrong", algorithm_status: "verified", note: "a stone" }), review({ finding_kind: "corn_weed", finding_id: "5", verdict: "correct" })])} />);
    expect(screen.queryByRole("heading", { name: /Corn findings marked wrong/ })).toBeNull();
    expect(screen.getByText("a stone")).toBeInTheDocument();
  });
});
