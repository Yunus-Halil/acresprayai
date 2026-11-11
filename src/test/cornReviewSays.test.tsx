// "What is it" on a corn finding marked wrong (twin_reviews.says): the review bar offers it for corn findings only,
// keeps Swardus's label and the reviewer's word apart, and the answer can be changed or taken back; reviews saved
// before it read as they did; orchard reviews are written exactly as before; a database that has not been updated yet
// still loads and saves reviews; and the twin itself is never touched.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- the reviews table, in memory -----------------------------------------------------------------------------
type Row = Record<string, unknown>;
const table = { hasSays: true, rows: [] as Row[], selects: [] as string[], upserts: [] as Row[] };
const noColumn = (how: "select" | "upsert") => how === "select"
  ? { code: "42703", message: "column twin_reviews.says does not exist" }
  : { code: "PGRST204", message: "Could not find the 'says' column of 'twin_reviews' in the schema cache" };
const pick = (r: Row, cols: string) => Object.fromEntries(cols.split(",").map(c => c.trim()).map(c => [c, r[c] ?? null]));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: (cols: string) => ({
        eq: async (_c: string, twinId: string) => {
          table.selects.push(cols);
          if (/\bsays\b/.test(cols) && !table.hasSays) return { data: null, error: noColumn("select") };
          return { data: table.rows.filter(r => r.twin_id === twinId).map(r => pick(r, cols)), error: null };
        },
      }),
      upsert: (row: Row) => ({
        select: (cols: string) => ({
          single: async () => {
            table.upserts.push(row);
            if ("says" in row && !table.hasSays) return { data: null, error: noColumn("upsert") };
            const k = table.rows.findIndex(r => r.twin_id === row.twin_id && r.finding_kind === row.finding_kind && r.finding_id === row.finding_id);
            // What the database's trigger does: an answer only on "wrong".
            const next = { ...(k >= 0 ? table.rows[k] : {}), ...row, updated_at: "2026-11-10T00:00:00Z" } as Row;
            if (next.verdict !== "wrong") next.says = null;
            if (k >= 0) table.rows[k] = next; else table.rows.push(next);
            return { data: pick(next, cols), error: null };
          },
        }),
      }),
    }),
  },
}));
const tracked: { name: string; f: { detail?: Record<string, unknown> } }[] = [];
vi.mock("@/lib/pilot/telemetry", () => ({ track: (name: string, f: { detail?: Record<string, unknown> } = {}) => { tracked.push({ name, f }); } }));

import ReviewBar, { reviewTargetOf } from "@/components/app/fieldTwin/ReviewBar";
import { type Review, SAYS_OPTIONS, __resetSaysColumn, loadReviews, reviewKey, saveReview, saysAvailable, saysLabel } from "@/lib/fieldTwin/reviews";
import { syntheticTwin } from "@/lib/fieldTwin/synthetic";
import { CORN_TWIN } from "./fixtures/cornTwin";

const TWIN = "aaaaaaaa-1111-4000-8000-000000000001";
beforeEach(() => { table.hasSays = true; table.rows = []; table.selects = []; table.upserts = []; tracked.length = 0; __resetSaysColumn(); });

const review = (r: Partial<Review> & Pick<Review, "finding_kind" | "finding_id" | "verdict">): Map<string, Review> =>
  new Map([[reviewKey(r.finding_kind, r.finding_id), { note: null, algorithm_status: "confirmed", payload: null, updated_at: "", ...r }]]);
const weedTarget = reviewTargetOf({ kind: "cornWeed", id: 1 }, CORN_TWIN, null)!;

describe("the review bar on a corn finding", () => {
  it("asks what it is only once the finding is marked wrong, and saves the answer with the verdict and Swardus's label", async () => {
    const onSave = vi.fn(async () => ({})), onClear = vi.fn(async () => ({}));
    const { rerender } = render(<ReviewBar target={weedTarget} reviews={new Map()} onSave={onSave} onClear={onClear} canSay />);
    expect(screen.queryByRole("group", { name: "What is it?" })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Wrong" })); });
    // One press, as before: "wrong" is saved at once, the answer is an optional second press.
    expect(onSave).toHaveBeenLastCalledWith({ kind: "corn_weed", id: "1", verdict: "wrong", note: null, algorithmStatus: "confirmed", says: null });

    rerender(<ReviewBar target={weedTarget} reviews={review({ finding_kind: "corn_weed", finding_id: "1", verdict: "wrong", says: null })} onSave={onSave} onClear={onClear} canSay />);
    const group = screen.getByRole("group", { name: "What is it?" });
    expect(within(group).getAllByRole("button").map(b => b.textContent)).toEqual(["Corn, in the row", "Corn, outside the row", "Soil or residue", "Something else"]);
    await act(async () => { fireEvent.click(within(group).getByRole("button", { name: "Corn, in the row" })); });
    expect(onSave).toHaveBeenLastCalledWith({ kind: "corn_weed", id: "1", verdict: "wrong", note: null, algorithmStatus: "confirmed", says: "corn_in_row" });
  });

  it("shows what Swardus measured and what the reviewer said as two separate lines", () => {
    render(<ReviewBar target={weedTarget} reviews={review({ finding_kind: "corn_weed", finding_id: "1", verdict: "wrong", says: "corn_off_row" })} onSave={vi.fn()} onClear={vi.fn()} canSay />);
    const both = screen.getByLabelText("What Swardus measured and what you said");
    expect(within(both).getByText("Swardus").nextSibling?.textContent).toBe("Weed candidate, confirmed");
    expect(within(both).getByText("You").nextSibling?.textContent).toBe("Wrong: corn, outside the row");
    expect(screen.getByRole("button", { name: "Corn, outside the row" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Corn, in the row" })).toHaveAttribute("aria-pressed", "false");
  });

  it("changes the answer, takes it back on a second press, and drops it when the verdict changes", async () => {
    const onSave = vi.fn(async () => ({})), onClear = vi.fn(async () => ({}));
    render(<ReviewBar target={weedTarget} reviews={review({ finding_kind: "corn_weed", finding_id: "1", verdict: "wrong", says: "corn_in_row" })} onSave={onSave} onClear={onClear} canSay />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Soil or residue" })); });
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ verdict: "wrong", says: "soil_or_residue" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Corn, in the row" })); });
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ verdict: "wrong", says: null }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Not sure" })); });
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ verdict: "unsure", says: null }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Correct" })); });
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ verdict: "correct", says: null }));
    // "Wrong" pressed again still takes the whole review back, as it always did.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Wrong" })); });
    expect(onClear).toHaveBeenCalledWith("corn_weed", "1");
  });

  it("keeps the three answers distinguishable: correct and not sure show no 'what is it', wrong does", () => {
    for (const [verdict, said] of [["correct", "Correct"], ["unsure", "Not sure"], ["wrong", "Wrong"]] as const) {
      const { unmount } = render(<ReviewBar target={weedTarget} reviews={review({ finding_kind: "corn_weed", finding_id: "1", verdict })} onSave={vi.fn()} onClear={vi.fn()} canSay />);
      expect(screen.getByRole("button", { name: said })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("You").nextSibling?.textContent).toBe(said);
      expect(!!screen.queryByRole("group", { name: "What is it?" })).toBe(verdict === "wrong");
      unmount();
    }
  });

  it("asks a gap and a row their own questions", () => {
    const gap = reviewTargetOf({ kind: "cornGap", id: 1 }, CORN_TWIN, null)!, row = reviewTargetOf({ kind: "cornRow", id: 2 }, CORN_TWIN, null)!;
    const g = render(<ReviewBar target={gap} reviews={review({ finding_kind: "corn_gap", finding_id: "1", verdict: "wrong", algorithm_status: "withheld" })} onSave={vi.fn()} onClear={vi.fn()} canSay />);
    expect(within(screen.getByRole("group", { name: "What is there?" })).getAllByRole("button").map(b => b.textContent)).toEqual(["Corn plants are there", "Not planted here", "Something else"]);
    expect(screen.getByText("Swardus").nextSibling?.textContent).toBe("Stand gap, withheld");
    g.unmount();
    render(<ReviewBar target={row} reviews={review({ finding_kind: "corn_row", finding_id: "2", verdict: "wrong", algorithm_status: "unconfirmed" })} onSave={vi.fn()} onClear={vi.fn()} canSay />);
    expect(within(screen.getByRole("group", { name: "What is wrong with it?" })).getAllByRole("button").map(b => b.textContent)).toEqual(["No row here", "A row, drawn in the wrong place", "A row, but not corn", "Something else"]);
    expect(screen.getByText("Swardus").nextSibling?.textContent).toBe("Row, crop not confirmed");
  });

  it("reads a review saved before the answers existed as it always did", () => {
    // No `says` field at all: the row as the old column list returned it.
    render(<ReviewBar target={weedTarget} reviews={review({ finding_kind: "corn_weed", finding_id: "1", verdict: "wrong", note: "volunteer corn" })} onSave={vi.fn()} onClear={vi.fn()} canSay />);
    expect(screen.getByRole("button", { name: "Wrong" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Note")).toHaveValue("volunteer corn");
    expect(screen.getByText("You").nextSibling?.textContent).toBe("Wrong");
    for (const b of within(screen.getByRole("group", { name: "What is it?" })).getAllByRole("button")) expect(b).toHaveAttribute("aria-pressed", "false");
  });

  it("offers no answers while the database cannot store them, and none before the twin is saved", () => {
    const wrong = review({ finding_kind: "corn_weed", finding_id: "1", verdict: "wrong" });
    const a = render(<ReviewBar target={weedTarget} reviews={wrong} onSave={vi.fn()} onClear={vi.fn()} canSay={false} />);
    expect(screen.queryByRole("group", { name: "What is it?" })).toBeNull();
    expect(screen.getByRole("button", { name: "Wrong" })).toBeEnabled();
    a.unmount();
    render(<ReviewBar target={weedTarget} reviews={wrong} onSave={vi.fn()} onClear={vi.fn()} canSay disabledReason="Reviews open once the twin is saved to your account." />);
    expect(screen.queryByRole("group", { name: "What is it?" })).toBeNull();
  });

  it("stays usable by touch: every answer is a full-size button that wraps instead of overflowing", () => {
    render(<ReviewBar target={weedTarget} reviews={review({ finding_kind: "corn_weed", finding_id: "1", verdict: "wrong" })} onSave={vi.fn()} onClear={vi.fn()} canSay />);
    const group = screen.getByRole("group", { name: "What is it?" });
    expect(group.querySelector("div.flex")).toHaveClass("flex-wrap");
    // A full finger tall (44 CSS pixels), like the Correct / Not sure / Wrong buttons above them on a corn finding,
    // and spaced so two are not pressed at once.
    for (const b of within(group).getAllByRole("button")) expect(b.className).toContain("min-h-[44px]");
    for (const v of ["Correct", "Not sure", "Wrong"]) expect(screen.getByRole("button", { name: v }).className).toContain("min-h-[44px]");
    expect(group.querySelector("div.flex")).toHaveClass("gap-2");
  });
});

describe("orchard findings are reviewed exactly as before", () => {
  const synthetic = syntheticTwin({ weeds: 5, seed: 2 });
  it("no 'what is it', no extra lines, and the same save call", async () => {
    const onSave = vi.fn(async () => ({}));
    for (const selection of [{ kind: "weed" as const, id: synthetic.weeds[0].id }, { kind: "tree" as const, id: synthetic.trees[0].id }]) {
      const target = reviewTargetOf(selection, synthetic, null)!;
      const wrong = review({ finding_kind: target.kind, finding_id: target.id, verdict: "wrong", algorithm_status: target.status });
      const first = render(<ReviewBar target={target} reviews={new Map()} onSave={onSave} onClear={vi.fn()} canSay />);
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Wrong" })); });
      expect(Object.keys((onSave.mock.lastCall as unknown as [Record<string, unknown>])[0]).sort()).toEqual(["algorithmStatus", "id", "kind", "note", "verdict"]);
      first.unmount();
      const second = render(<ReviewBar target={target} reviews={wrong} onSave={onSave} onClear={vi.fn()} canSay />);
      expect(screen.queryByRole("group", { name: /What is/ })).toBeNull();
      expect(screen.queryByLabelText("What Swardus measured and what you said")).toBeNull();
      // The orchard buttons keep the size and spacing they had.
      for (const v of ["Correct", "Not sure", "Wrong"]) expect(screen.getByRole("button", { name: v }).className).not.toContain("min-h-");
      expect(screen.getByRole("button", { name: "Wrong" }).parentElement).toHaveClass("gap-1");
      second.unmount();
    }
    expect(Object.keys(SAYS_OPTIONS).sort()).toEqual(["corn_gap", "corn_row", "corn_weed"]);
  });

  it("an orchard review is written and read back with the columns it always had", async () => {
    await loadReviews(TWIN);
    await saveReview(TWIN, { kind: "weed", id: 12, verdict: "wrong", note: " a stone ", algorithmStatus: "verified", says: "corn_in_row" });
    expect(table.upserts[0]).toEqual({ twin_id: TWIN, finding_kind: "weed", finding_id: "12", verdict: "wrong", note: "a stone", algorithm_status: "verified", payload: null });
    await saveReview(TWIN, { kind: "boundary", id: "cultivated", verdict: "wrong", payload: { ring: [[1, 2], [3, 4], [5, 6]] } });
    expect(Object.keys(table.upserts[1])).not.toContain("says");
    expect(tracked.every(t => !("says" in (t.f.detail ?? {})))).toBe(true);
  });
});

describe("saving and reopening", () => {
  it("a correction saved on a corn finding is there when the twin is opened again, beside the algorithm's label", async () => {
    await saveReview(TWIN, { kind: "corn_weed", id: 1, verdict: "wrong", note: null, algorithmStatus: "confirmed", says: "corn_in_row" });
    await saveReview(TWIN, { kind: "corn_gap", id: 1, verdict: "unsure", algorithmStatus: "withheld" });
    const again = await loadReviews(TWIN);
    expect(again.get("corn_weed:1")).toMatchObject({ verdict: "wrong", says: "corn_in_row", algorithm_status: "confirmed" });
    expect(again.get("corn_gap:1")).toMatchObject({ verdict: "unsure", says: null, algorithm_status: "withheld" });
    expect(saysLabel("corn_weed", again.get("corn_weed:1")!.says)).toBe("Corn, in the row");
    // The event says which answer, never where or in which photograph.
    expect(tracked[0]).toEqual({ name: "finding_reviewed", f: { twinId: TWIN, detail: { kind: "corn_weed", verdict: "wrong", status: "confirmed", note: false, says: "corn_in_row" } } });
  });

  it("never sends an answer that is not on the finding's list, or one on a verdict other than wrong", async () => {
    await saveReview(TWIN, { kind: "corn_weed", id: 1, verdict: "wrong", says: "pigweed" });
    await saveReview(TWIN, { kind: "corn_weed", id: 2, verdict: "wrong", says: "no_row" });
    await saveReview(TWIN, { kind: "corn_weed", id: 3, verdict: "correct", says: "corn_in_row" });
    expect(table.upserts.map(u => u.says)).toEqual([null, null, null]);
  });

  it("works against a database without the column: old reviews load, answers are not offered, saving still works", async () => {
    table.hasSays = false;
    table.rows.push({ twin_id: TWIN, finding_kind: "corn_weed", finding_id: "1", verdict: "wrong", note: "volunteer corn", algorithm_status: "confirmed", payload: null, updated_at: "2026-11-09T00:00:00Z" });
    const loaded = await loadReviews(TWIN);
    expect(loaded.get("corn_weed:1")).toMatchObject({ verdict: "wrong", note: "volunteer corn" });
    expect(saysAvailable()).toBe(false);
    const saved = await saveReview(TWIN, { kind: "corn_weed", id: 2, verdict: "wrong", says: "corn_in_row" });
    expect(saved.verdict).toBe("wrong");
    expect(Object.keys(table.upserts.at(-1)!)).not.toContain("says");
    // Once known, the column is not asked for again.
    table.selects.length = 0;
    await loadReviews(TWIN);
    expect(table.selects).toHaveLength(1);
    expect(table.selects[0]).not.toMatch(/says/);
  });

  it("a save that meets the missing column first falls back by itself", async () => {
    table.hasSays = false;
    const saved = await saveReview(TWIN, { kind: "corn_row", id: 2, verdict: "wrong", says: "no_row", algorithmStatus: "unconfirmed" });
    expect(saved).toMatchObject({ finding_kind: "corn_row", verdict: "wrong" });
    expect(table.upserts).toHaveLength(2);
    expect(saysAvailable()).toBe(false);
  });
});

describe("the twin is never touched by a review", () => {
  it("what Swardus measured is the same object, byte for byte, after reviewing every corn finding", async () => {
    const before = JSON.stringify(CORN_TWIN);
    const selections = [...CORN_TWIN.corn!.weeds.map(w => ({ kind: "cornWeed" as const, id: w.id })), ...CORN_TWIN.corn!.gaps.map(g => ({ kind: "cornGap" as const, id: g.id })), ...CORN_TWIN.corn!.rows.map(r => ({ kind: "cornRow" as const, id: r.id }))];
    for (const s of selections) {
      const t = reviewTargetOf(s, CORN_TWIN, null)!;
      const value = SAYS_OPTIONS[t.kind]!.options[0].value;
      await saveReview(TWIN, { kind: t.kind, id: t.id, verdict: "wrong", algorithmStatus: t.status, says: value });
      const view = render(<ReviewBar target={t} reviews={await loadReviews(TWIN)} onSave={vi.fn()} onClear={vi.fn()} canSay />);
      view.unmount();
    }
    expect(table.rows).toHaveLength(5);
    expect(JSON.stringify(CORN_TWIN)).toBe(before);
    // The algorithm's label recorded with each review is the twin's own state at the time.
    expect(table.rows.map(r => r.algorithm_status)).toEqual(["confirmed", "unconfirmed", "withheld", "corn", "unconfirmed"]);
  });
});
