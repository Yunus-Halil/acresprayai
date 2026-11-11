// The pilot desk's Reviews tab: participant, then Field Twin, then each review, every review once. And the way from
// a review to its finding in the founder's read-only viewer: by the twin's own id, to that finding and no other,
// through the same permission check and access log as any other opening.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { type SnapReview, type Snapshot, answersLoaded, reviewGroups, twinAccess } from "@/lib/pilot/adminData";
import { ReviewsSection } from "@/components/pilot/admin/Reviews";
import { CORN_TWIN } from "./fixtures/cornTwin";

const at = (minutesAgo: number) => new Date(Date.parse("2026-11-10T18:00:00Z") - minutesAgo * 60_000).toISOString();
const T = { north: "aaaaaaaa-1111-4000-8000-000000000001", south: "aaaaaaaa-1111-4000-8000-000000000002", orchard: "bbbbbbbb-2222-4000-8000-000000000003", closed: "cccccccc-3333-4000-8000-000000000004", half: "cccccccc-3333-4000-8000-000000000005", gone: "dddddddd-4444-4000-8000-000000000006", mine: "eeeeeeee-5555-4000-8000-000000000007" };
const member = (user_id: string, display_name: string | null, email: string, role: "founder" | "participant" = "participant") => ({ user_id, role, status: "active" as const, email, display_name, organisation: null, application_id: null, invited_at: null, created_at: at(9000), notes: null });
const twin = (id: string, user_id: string, name: string, over: Partial<Snapshot["twins"][number]> = {}) => ({ id, user_id, name, crop: "corn", captured_at: null, photographs: 38, camera: null, placement: "gnss", area_ha: null, status: "ready", error: null, build_ms: null, created_at: at(5000), updated_at: at(5000), ...over });
const review = (user_id: string, twin_id: string, finding_kind: string, finding_id: string, verdict: SnapReview["verdict"], minutesAgo: number, over: Partial<SnapReview> = {}): SnapReview =>
  ({ user_id, twin_id, finding_kind, finding_id, verdict, note: null, algorithm_status: "confirmed", created_at: at(minutesAgo), updated_at: at(minutesAgo), says: null, ...over });
const consent = (user_id: string, troubleshooting_access: boolean, minutesAgo: number) => ({ user_id, created_at: at(minutesAgo), terms_version: "pilot-2026-11-v1", troubleshooting_access, research_use: false });

/** Ryan allowed troubleshooting access (after first declining); Dana declined; Lee never answered; Yunus is the founder. */
function desk(): Snapshot {
  return {
    generated_at: at(0), events: [], feedback: [], applications: [], access: [], missing: {},
    users: [{ id: "ryan", email: "ryan@cropcompass.test", created_at: null, last_sign_in_at: null, confirmed: true, provider: "email" }],
    members: [member("f", "Yunus", "yunus@swardus.test", "founder"), member("ryan", "Ryan Miller", "ryan@cc.test"), member("dana", "Dana Ortiz", "dana@farm.test"), member("lee", null, "lee@fields.test")],
    twins: [
      twin(T.north, "ryan", "North block"), twin(T.south, "ryan", "South forty", { photographs: 112 }),
      twin(T.orchard, "ryan", "Home orchard", { crop: "orchard", photographs: null }),
      twin(T.closed, "dana", "Creek field"), twin(T.half, "lee", "Hill", { status: "incomplete" }), twin(T.mine, "f", "Test flight"),
    ],
    consents: [consent("ryan", false, 4000), consent("ryan", true, 3000), consent("dana", true, 4000), consent("dana", false, 3000)],
    reviews: [
      review("ryan", T.north, "corn_weed", "1", "wrong", 10, { says: "soil_or_residue", note: "a clod, not a plant" }),
      review("ryan", T.north, "corn_weed", "2", "correct", 30, { algorithm_status: "unconfirmed" }),
      review("ryan", T.north, "corn_gap", "1", "unsure", 20, { algorithm_status: "withheld" }),
      review("ryan", T.north, "corn_row", "2", "wrong", 40, { algorithm_status: "unconfirmed", says: "row_misplaced" }),
      review("ryan", T.south, "corn_weed", "1", "wrong", 300),
      review("ryan", T.orchard, "weed", "12", "wrong", 500, { algorithm_status: "verified", note: "a stone" }),
      review("ryan", T.orchard, "region", "2", "correct", 510, { algorithm_status: "region" }),
      review("ryan", T.orchard, "boundary", "cultivated", "wrong", 520, { algorithm_status: "high" }),
      review("dana", T.closed, "corn_weed", "3", "wrong", 5, { says: "corn_in_row" }),
      review("lee", T.half, "corn_weed", "1", "correct", 700),
      review("lee", T.gone, "corn_weed", "9", "correct", 800),
      review("f", T.mine, "corn_weed", "1", "correct", 900),
    ],
  };
}

describe("reviews as participant, Field Twin, review", () => {
  it("groups every review once: people by their latest review, twins likewise, reviews newest first, with the counts of each level", () => {
    const g = reviewGroups(desk());
    expect(g.map(p => [p.name, p.twins.length, p.counts])).toEqual([
      ["Dana Ortiz", 1, { total: 1, correct: 0, unsure: 0, wrong: 1 }],
      ["Ryan Miller", 3, { total: 8, correct: 2, unsure: 1, wrong: 5 }],
      ["lee@fields.test", 2, { total: 2, correct: 2, unsure: 0, wrong: 0 }],
      ["Yunus", 1, { total: 1, correct: 1, unsure: 0, wrong: 0 }],
    ]);
    const ryan = g[1];
    expect(ryan).toMatchObject({ displayName: "Ryan Miller", email: "ryan@cropcompass.test", latest: at(10) });
    expect(ryan.twins.map(t => [t.twin?.name, t.counts.total, t.latest])).toEqual([["North block", 4, at(10)], ["South forty", 1, at(300)], ["Home orchard", 3, at(500)]]);
    expect(ryan.twins[0].reviews.map(r => `${r.finding_kind}:${r.finding_id}`)).toEqual(["corn_weed:1", "corn_gap:1", "corn_weed:2", "corn_row:2"]);
    // Every review is in exactly one place.
    const placed = g.flatMap(p => p.twins.flatMap(t => t.reviews));
    expect(placed).toHaveLength(desk().reviews.length);
    expect(new Set(placed.map(r => `${r.user_id}|${r.twin_id}|${r.finding_kind}|${r.finding_id}`)).size).toBe(placed.length);
    // One person's page, and one verdict: the same shape, fewer reviews, counts of what is kept.
    expect(reviewGroups(desk(), { userId: "ryan" }).map(p => p.userId)).toEqual(["ryan"]);
    const wrong = reviewGroups(desk(), { verdict: "wrong" });
    expect(wrong.map(p => [p.name, p.counts.total, p.twins.map(t => t.counts.wrong)])).toEqual([["Dana Ortiz", 1, [1]], ["Ryan Miller", 5, [2, 1, 2]]]);
  });

  it("what the panel offers to open follows the participant's newest answer; a twin not saved or no longer listed is never offered", () => {
    const s = desk();
    const access = (id: string) => twinAccess(s, s.twins.find(t => t.id === id) ?? null);
    expect(access(T.north)).toEqual({ open: true, why: null });          // allowed, after first declining
    expect(access(T.closed)).toEqual({ open: false, why: "not-allowed" }); // declined, after first allowing
    expect(access(T.half)).toEqual({ open: false, why: "unsaved" });
    expect(access(T.gone)).toEqual({ open: false, why: "gone" });
    expect(access(T.mine)).toEqual({ open: true, why: null });
    expect(twinAccess(s, { ...s.twins[4], status: "ready" })).toEqual({ open: false, why: "no-answer" });
  });

  it("knows a server that sends no answers from reviews that have none", () => {
    expect(answersLoaded(desk())).toBe(true);
    expect(answersLoaded({ reviews: desk().reviews.map(({ says: _s, ...r }) => r) })).toBe(false);
    expect(answersLoaded({ reviews: [] })).toBe(true);
  });
});

// ---- the tab -----------------------------------------------------------------------------------------------------
const calls: { action: string; body: Record<string, unknown> }[] = [];
let refuse: string | null = null;
vi.mock("@/lib/pilot/adminClient", () => ({
  pilotAdmin: async (action: string, body: Record<string, unknown> = {}) => {
    calls.push({ action, body });
    if (action === "twin-open") {
      if (refuse) throw new Error(refuse);
      return { twin: { id: body.twin_id, name: "North block", user_id: "ryan" }, files: { "twin.json": "https://signed.test/twin.json", "atlas-0.jpg": "https://signed.test/atlas-0.jpg" } };
    }
    return { ok: true };
  },
}));
// The viewer itself (a map) is not under test here: what it is asked to open on is.
const viewerProps: Record<string, unknown>[] = [];
vi.mock("@/components/app/fieldTwin/FieldTwinView", () => ({
  default: (props: Record<string, unknown>) => { viewerProps.push(props); return <div data-testid="twin-viewer">{(props.twin as { name: string }).name}</div>; },
}));
import AdminTwinViewer from "@/pages/admin/AdminTwinViewer";

function Where() { const l = useLocation(); return <span data-testid="where">{l.pathname}{l.search}</span>; }
const renderDesk = (s: Snapshot, path = "/admin/pilot?tab=reviews") => render(
  <MemoryRouter initialEntries={[path]}>
    <Where />
    <Routes>
      <Route path="/admin/pilot" element={<ReviewsSection snap={s} />} />
      <Route path="/admin/pilot/people/:id" element={<ReviewsSection snap={s} userId="ryan" />} />
      <Route path="/admin/pilot/twins/:id" element={<AdminTwinViewer />} />
    </Routes>
  </MemoryRouter>,
);
const person = (name: RegExp) => screen.getByRole("button", { name });
const twinRow = (name: string) => screen.getByText(name).closest("li")!;
const cells = (tr: HTMLElement) => within(tr).getAllByRole("cell").map(c => c.textContent);

beforeEach(() => {
  calls.length = 0; viewerProps.length = 0; refuse = null;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(CORN_TWIN), { status: 200 })));
});

describe("the Reviews tab", () => {
  it("opens closed: one row per participant with their name, email, Field Twins, reviews and verdict counts; no review is on the page yet", () => {
    renderDesk(desk());
    const ryan = person(/Ryan Miller/);
    expect(ryan).toHaveAttribute("aria-expanded", "false");
    expect(ryan).toHaveTextContent("ryan@cropcompass.test");
    expect(ryan).toHaveTextContent("3 Field Twins · 8 reviews");
    expect(ryan).toHaveTextContent("Correct 2");
    expect(ryan).toHaveTextContent("Not sure 1");
    expect(ryan).toHaveTextContent("Wrong 5");
    // No name on record: the email stands in for it, once.
    expect(person(/lee@fields\.test/).textContent!.match(/lee@fields\.test/g)).toHaveLength(1);
    expect(screen.getAllByRole("button", { expanded: false }).length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("a clod, not a plant")).toBeNull();
    // The summary: totals and the split, once.
    expect(screen.getByText("Reviews", { selector: "div" }).parentElement).toHaveTextContent("12");
    expect(screen.getByText("Wrong", { selector: "div" }).parentElement).toHaveTextContent("650 % of reviews");
  });

  it("a participant opens to their Field Twins, a Field Twin to its reviews; each review shows both readings, and is on the page once", () => {
    renderDesk(desk());
    fireEvent.click(person(/Ryan Miller/));
    const north = twinRow("North block");
    expect(north).toHaveTextContent("corn · 38 photographs · 4 reviews · latest");
    expect(within(north).getByText("Wrong 2")).toBeInTheDocument();
    expect(twinRow("Home orchard")).toHaveTextContent("orchard · 3 reviews"); // no photograph count on record: none shown
    expect(screen.queryByRole("table")).toBeNull();

    fireEvent.click(within(north).getByRole("button", { name: /North block/ }));
    const rows = within(north).getAllByRole("row").slice(1);
    expect(rows.map(r => cells(r).slice(0, 5))).toEqual([
      ["Weed candidate 1", "Weed candidate, confirmed", "Wrong", "Soil or residue", "a clod, not a plant"],
      ["Stand gap 1", "Stand gap, withheld", "Not sure", "", ""],
      ["Weed candidate 2", "Weed candidate, not confirmed", "Correct", "", ""],
      ["Corn row 2", "Row, crop not confirmed", "Wrong", "A row, drawn in the wrong place", ""],
    ]);
    expect(cells(rows[0])[5]).not.toBe("");
    expect(screen.getAllByText("a clod, not a plant")).toHaveLength(1);
    expect(screen.getAllByRole("table")).toHaveLength(1);
    // Closing it takes its reviews off the page again.
    fireEvent.click(within(north).getByRole("button", { name: /North block/ }));
    expect(screen.queryByText("a clod, not a plant")).toBeNull();
  });

  it("the verdict filter keeps only those reviews, at every level", () => {
    renderDesk(desk());
    fireEvent.click(screen.getByRole("button", { name: "Wrong 6" }));
    expect(screen.queryByRole("button", { name: /lee@fields\.test/ })).toBeNull();
    expect(person(/Ryan Miller/)).toHaveTextContent("3 Field Twins · 5 reviews");
    fireEvent.click(person(/Ryan Miller/));
    fireEvent.click(within(twinRow("North block")).getByRole("button", { name: /North block/ }));
    expect(within(twinRow("North block")).getAllByRole("row").slice(1).map(r => cells(r)[0])).toEqual(["Weed candidate 1", "Corn row 2"]);
    fireEvent.click(screen.getByRole("button", { name: "Not sure 1" }));
    expect(screen.getAllByRole("button", { name: /Field Twin · 1 review/ })).toHaveLength(1);
  });

  it("with a single review the way down is already open", () => {
    const s = desk();
    renderDesk({ ...s, reviews: [s.reviews[0]] });
    expect(person(/Ryan Miller/)).toHaveAttribute("aria-expanded", "true");
    expect(person(/Ryan Miller/)).toHaveTextContent("1 Field Twin · 1 review");
    expect(screen.getByText("a clod, not a plant")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  it("hundreds of reviews in one Field Twin come a page at a time", () => {
    const s = desk();
    const many = Array.from({ length: 250 }, (_, i) => review("ryan", T.south, "corn_weed", String(i + 1), i % 5 ? "correct" : "wrong", 1000 + i));
    renderDesk({ ...s, reviews: many });
    expect(person(/Ryan Miller/)).toHaveTextContent("1 Field Twin · 250 reviews");
    const south = twinRow("South forty");
    expect(within(south).getAllByRole("row")).toHaveLength(1 + 100);
    expect(south).toHaveTextContent("Showing 100 of 250.");
    fireEvent.click(within(south).getByRole("button", { name: "Show 100 more" }));
    fireEvent.click(within(south).getByRole("button", { name: "Show 50 more" }));
    expect(within(south).getAllByRole("row")).toHaveLength(1 + 250);
    expect(within(south).queryByRole("button", { name: /more/ })).toBeNull();
  });

  it("a person's own page lists their Field Twins directly", () => {
    renderDesk(desk(), "/admin/pilot/people/ryan");
    expect(screen.queryByRole("button", { name: /Ryan Miller/ })).toBeNull();
    expect(screen.getByText("North block")).toBeInTheDocument();
    expect(screen.queryByText("Creek field")).toBeNull();
  });
});

describe("from a review to the Field Twin", () => {
  it("View Field Twin and Open finding lead to the twin by its own id, and to that finding by its own kind and number", () => {
    renderDesk(desk());
    fireEvent.click(person(/Ryan Miller/));
    const north = twinRow("North block");
    expect(within(north).getByRole("link", { name: "View Field Twin" })).toHaveAttribute("href", `/admin/pilot/twins/${T.north}`);
    fireEvent.click(within(north).getByRole("button", { name: /North block/ }));
    expect(within(north).getByRole("link", { name: "Open Weed candidate 1 in North block" })).toHaveAttribute("href", `/admin/pilot/twins/${T.north}?finding=corn_weed:1`);
    expect(within(north).getByRole("link", { name: "Open Corn row 2 in North block" })).toHaveAttribute("href", `/admin/pilot/twins/${T.north}?finding=corn_row:2`);
    expect(within(north).getByRole("link", { name: "Open Stand gap 1 in North block" })).toHaveAttribute("href", `/admin/pilot/twins/${T.north}?finding=corn_gap:1`);
    // Same finding number in another twin: its own twin's address.
    const south = twinRow("South forty");
    expect(within(south).getByRole("link", { name: "View Field Twin" })).toHaveAttribute("href", `/admin/pilot/twins/${T.south}`);
    // A pressure region's number is not an identity, and the boundary is not one finding: the twin, no finding named.
    const orchard = twinRow("Home orchard");
    fireEvent.click(within(orchard).getByRole("button", { name: /Home orchard/ }));
    expect(within(orchard).getByRole("link", { name: "Open Weed candidate 12 in Home orchard" })).toHaveAttribute("href", `/admin/pilot/twins/${T.orchard}?finding=weed:12`);
    expect(within(orchard).getByRole("link", { name: "Open Home orchard for Weed pressure region 2" })).toHaveAttribute("href", `/admin/pilot/twins/${T.orchard}`);
    expect(within(orchard).getByRole("link", { name: "Open Home orchard for Field boundary" })).toHaveAttribute("href", `/admin/pilot/twins/${T.orchard}`);
  });

  it("without the participant's agreement there is nothing to click: the row says why and offers an email to them", () => {
    renderDesk(desk());
    fireEvent.click(person(/Dana Ortiz/));
    const creek = twinRow("Creek field");
    expect(creek).toHaveTextContent("Cannot be opened: Dana Ortiz has not agreed to terms that allow it.");
    expect(within(creek).queryByRole("link", { name: "View Field Twin" })).toBeNull();
    const ask = within(creek).getByRole("link", { name: "Write to them" });
    expect(ask.getAttribute("href")).toMatch(/^mailto:dana@farm\.test\?subject=/);
    expect(decodeURIComponent(ask.getAttribute("href")!)).toMatch(/Creek field[\s\S]*once you have agreed to the current pilot terms[\s\S]*every opening is recorded for you to see/);
    // Her review is still readable (the founder reads reviews either way); it only cannot be opened on the map.
    expect(cells(within(creek).getAllByRole("row")[1]).slice(0, 4)).toEqual(["Weed candidate 3", "Weed candidate, confirmed", "Wrong", "Corn, in the row"]);
    expect(within(creek).queryByRole("link", { name: /Open/ })).toBeNull();

    fireEvent.click(person(/lee@fields\.test/));
    expect(twinRow("Hill")).toHaveTextContent("Not saved completely, so it cannot be opened.");
    expect(within(twinRow("Hill")).queryByRole("link")).toBeNull();
    const gone = twinRow("A Field Twin no longer listed");
    expect(gone).toHaveTextContent("This Field Twin is no longer in their list.");
    expect(within(gone).queryByRole("link")).toBeNull();
    // Nothing was asked of the server by looking.
    expect(calls).toEqual([]);
  });

  it("Open finding: the viewer shows the review, asks why, opens only when told to, and is asked for that finding; back returns to the same place", async () => {
    renderDesk(desk());
    fireEvent.click(person(/Ryan Miller/));
    const north = twinRow("North block");
    fireEvent.click(within(north).getByRole("button", { name: /North block/ }));
    fireEvent.click(within(north).getByRole("link", { name: "Open Weed candidate 1 in North block" }));

    expect(screen.getByTestId("where")).toHaveTextContent(`/admin/pilot/twins/${T.north}?finding=corn_weed:1`);
    const context = screen.getByLabelText("The review this was opened from");
    expect(context).toHaveTextContent("FindingWeed candidate 1");
    expect(context).toHaveTextContent("SwardusWeed candidate, confirmed");
    expect(context).toHaveTextContent("Ryan MillerWrong: soil or residue");
    expect(context).toHaveTextContent("Their notea clod, not a plant");
    // Arriving opened nothing and logged nothing.
    expect(calls).toEqual([]);
    expect(screen.queryByTestId("twin-viewer")).toBeNull();
    const reason = screen.getByLabelText(/Why are you opening it/) as HTMLInputElement;
    expect(reason.value).toBe("Looking at your review of weed candidate 1 (marked wrong)");

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open read-only" })); });
    expect(calls).toEqual([{ action: "twin-open", body: { twin_id: T.north, reason: "Looking at your review of weed candidate 1 (marked wrong)" } }]);
    expect(await screen.findByTestId("twin-viewer")).toBeInTheDocument();
    expect(viewerProps.at(-1)).toMatchObject({ focus: { kind: "corn_weed", id: "1" }, audience: "founder" });
    expect(viewerProps.at(-1)!.review).toBeUndefined(); // read-only: the founder's answers are never added to theirs
    expect(screen.getByRole("status")).toHaveTextContent("Ryan MillerWrong: soil or residue");

    // The viewer reports the finding was not in the saved twin: said plainly, nothing else selected.
    act(() => { (viewerProps.at(-1)!.onFocus as (f: null) => void)(null); });
    expect(screen.getByRole("status")).toHaveTextContent("Weed candidate 1 is not in this saved Field Twin, so nothing was selected.");
    // Or it is there but under another label than the review recorded: said too.
    act(() => { (viewerProps.at(-1)!.onFocus as (f: { status: string }) => void)({ status: "contested" }); });
    expect(screen.getByRole("status")).toHaveTextContent('The saved twin calls this finding "contested"; the review recorded "confirmed".');

    fireEvent.click(screen.getByRole("link", { name: "Reviews" }));
    expect(screen.getByTestId("where")).toHaveTextContent(`/admin/pilot?tab=reviews&person=ryan&twin=${T.north}`);
    expect(person(/Ryan Miller/)).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("a clod, not a plant")).toBeInTheDocument();
  });

  it("the server's refusal is the last word: a typed address to a twin whose owner did not allow it opens nothing", async () => {
    refuse = "This participant has not agreed to pilot terms that let Swardus open their Field Twins, so it cannot be opened here.";
    renderDesk(desk(), `/admin/pilot/twins/${T.closed}?finding=corn_weed:3`);
    expect(calls).toEqual([]);
    fireEvent.change(screen.getByLabelText(/Why are you opening it/), { target: { value: "checking" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open read-only" })); });
    expect(await screen.findByRole("alert")).toHaveTextContent(/has not agreed to pilot terms that let Swardus open their Field Twins/);
    expect(screen.queryByTestId("twin-viewer")).toBeNull();
    expect(viewerProps).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("the address decides only what is selected, and only for a kind and number it can be sure of", async () => {
    const open = async (query: string) => {
      viewerProps.length = 0;
      const view = renderDesk(desk(), `/admin/pilot/twins/${T.north}${query}`);
      fireEvent.change(screen.getByLabelText(/Why are you opening it/), { target: { value: "checking" } });
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open read-only" })); });
      await screen.findByTestId("twin-viewer");
      const focus = viewerProps.at(-1)!.focus;
      view.unmount();
      return focus;
    };
    expect(await open("?finding=corn_gap:1")).toEqual({ kind: "corn_gap", id: "1" });
    expect(await open("")).toBeNull();
    for (const bad of ["region:2", "zone:1", "patch:3", "boundary:cultivated", "corn_weed:1;2", "corn_weed:-1", "corn_weed:1.5", "corn_weed:", "nonsense:1", "corn_weed:1%20OR%201"]) expect(await open(`?finding=${bad}`)).toBeNull();
    await waitFor(() => expect(calls.every(c => c.action === "twin-open" && c.body.twin_id === T.north)).toBe(true));
  });
});
