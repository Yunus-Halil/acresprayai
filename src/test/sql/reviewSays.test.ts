// @vitest-environment node
//
// twin_reviews.says (migration 20261110120000), run as real SQL on top of the pilot migrations: reviews written before
// it stay as they were, an answer is taken only from its finding kind's own list and only on a corn finding, it goes
// when the review stops being "wrong", and the owner-only rule covers it like the rest of the row.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALICE, BOB, type Db, FOUNDER, freshDb, migration } from "./pgHarness";
// Only the app's list of answers is wanted from the reviews module, not its database client.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { SAYS_OPTIONS } from "@/lib/fieldTwin/reviews";

const BEFORE = ["20261109120000_pilot_access.sql", "20261109130000_field_twins.sql", "20261109140000_app_events.sql", "20261109150000_reviews_feedback_consent.sql"];
const SAYS = "20261110120000_twin_review_says.sql";
const USERS = [{ id: FOUNDER, email: "YunusHalilErdogan5@gmail.com" }, { id: ALICE, email: "alice@farm.test" }, { id: BOB, email: "bob@farm.test" }];
const A_TWIN = "aaaaaaaa-1111-4000-8000-000000000001", B_TWIN = "bbbbbbbb-1111-4000-8000-000000000002";

let db: Db | null = null;
afterEach(async () => { await db?.close(); db = null; });

async function seeded(migrations: string[]): Promise<Db> {
  const d = await freshDb(migrations, USERS);
  db = d;
  await d.query("INSERT INTO public.pilot_members (user_id, role) VALUES ($1, 'participant'), ($2, 'participant')", [ALICE, BOB]);
  await d.query("INSERT INTO public.field_twins (id, user_id, storage_key, name, status) VALUES ($1, $2, 'a', 'Alice north', 'ready'), ($3, $4, 'b', 'Bob south', 'ready')", [A_TWIN, ALICE, B_TWIN, BOB]);
  return d;
}
const INSERT = "INSERT INTO public.twin_reviews (twin_id, finding_kind, finding_id, verdict, says) VALUES ($1, $2, $3, $4, $5)";
// What the app sends: every column it knows, on conflict update them all.
const UPSERT = (cols: string[]) => `INSERT INTO public.twin_reviews (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) ON CONFLICT (user_id, twin_id, finding_kind, finding_id) DO UPDATE SET ${cols.map(c => `${c} = excluded.${c}`).join(", ")}`;
const OLD_COLS = ["twin_id", "finding_kind", "finding_id", "verdict", "note", "algorithm_status", "payload"];

describe("twin_reviews.says", () => {
  it("is additive: reviews written before the migration are untouched, and the migration can be run twice", async () => {
    const d = await seeded(BEFORE);
    await d.as(ALICE, "INSERT INTO public.twin_reviews (twin_id, finding_kind, finding_id, verdict, note, algorithm_status) VALUES ($1, 'corn_weed', '3', 'wrong', 'volunteer corn', 'confirmed'), ($1, 'weed', '12', 'correct', null, 'verified')", [A_TWIN]);
    await d.as(ALICE, "INSERT INTO public.twin_reviews (twin_id, finding_kind, finding_id, verdict, payload) VALUES ($1, 'boundary', 'cultivated', 'wrong', '{\"ring\":[[1,2],[3,4],[5,6]]}')", [A_TWIN]);
    const before = (await d.query("SELECT id, finding_kind, finding_id, verdict, note, algorithm_status, payload, created_at, updated_at FROM public.twin_reviews ORDER BY finding_kind")).rows;
    await d.exec(migration(SAYS));
    await d.exec(migration(SAYS));
    expect((await d.query("SELECT id, finding_kind, finding_id, verdict, note, algorithm_status, payload, created_at, updated_at FROM public.twin_reviews ORDER BY finding_kind")).rows).toEqual(before);
    expect(await d.as(ALICE, "SELECT says FROM public.twin_reviews")).toEqual([{ says: null }, { says: null }, { says: null }]);
  });

  it("takes every answer the app offers, for its own kind of finding", async () => {
    const d = await seeded([...BEFORE, SAYS]);
    let n = 0;
    for (const [kind, { options }] of Object.entries(SAYS_OPTIONS)) for (const o of options) await d.as(ALICE, INSERT, [A_TWIN, kind, String(++n), "wrong", o.value]);
    expect(n).toBe(11);
    expect((await d.as(ALICE, "SELECT count(*)::int AS n FROM public.twin_reviews WHERE says IS NOT NULL"))[0]).toEqual({ n: 11 });
  });

  it("refuses an answer from outside the list, from another kind's list, or on an orchard finding or the boundary", async () => {
    const d = await seeded([...BEFORE, SAYS]);
    for (const [kind, says] of [["corn_weed", "pigweed"], ["corn_weed", "no_row"], ["corn_gap", "corn_in_row"], ["corn_row", "plants_present"], ["weed", "other"], ["tree", "other"], ["vegetation", "soil_or_residue"], ["boundary", "other"]]) {
      await expect(d.as(ALICE, INSERT, [A_TWIN, kind, "1", "wrong", says])).rejects.toThrow(/check constraint/);
    }
    // The same findings without an answer are reviewed as they always were.
    await d.as(ALICE, "INSERT INTO public.twin_reviews (twin_id, finding_kind, finding_id, verdict) VALUES ($1, 'weed', '1', 'wrong'), ($1, 'tree', '1', 'correct')", [A_TWIN]);
  });

  it("keeps an answer only while the review is 'wrong': changed, taken back, or dropped with the verdict", async () => {
    const d = await seeded([...BEFORE, SAYS]);
    const cols = [...OLD_COLS, "says"];
    const one = async () => (await d.as(ALICE, "SELECT verdict, says, algorithm_status FROM public.twin_reviews WHERE finding_id = '3'"))[0];
    await d.as(ALICE, UPSERT(cols), [A_TWIN, "corn_weed", "3", "wrong", null, "confirmed", null, "corn_in_row"]);
    expect(await one()).toEqual({ verdict: "wrong", says: "corn_in_row", algorithm_status: "confirmed" });
    await d.as(ALICE, UPSERT(cols), [A_TWIN, "corn_weed", "3", "wrong", null, "confirmed", null, "corn_off_row"]);
    expect((await one()).says).toBe("corn_off_row");
    await d.as(ALICE, UPSERT(cols), [A_TWIN, "corn_weed", "3", "wrong", null, "confirmed", null, null]);
    expect(await one()).toEqual({ verdict: "wrong", says: null, algorithm_status: "confirmed" });
    // "Not sure" or "correct" sent with an answer by mistake: the verdict stands, the answer does not.
    await d.as(ALICE, UPSERT(cols), [A_TWIN, "corn_weed", "3", "unsure", null, "confirmed", null, "corn_in_row"]);
    expect(await one()).toEqual({ verdict: "unsure", says: null, algorithm_status: "confirmed" });
    await d.as(ALICE, INSERT, [A_TWIN, "corn_gap", "9", "correct", "plants_present"]);
    expect(await d.as(ALICE, "SELECT says FROM public.twin_reviews WHERE finding_id = '9'")).toEqual([{ says: null }]);
  });

  it("a page loaded before the migration still saves, and cannot leave a 'correct' review with an answer", async () => {
    const d = await seeded([...BEFORE, SAYS]);
    await d.as(ALICE, UPSERT([...OLD_COLS, "says"]), [A_TWIN, "corn_weed", "3", "wrong", null, "confirmed", null, "soil_or_residue"]);
    // The old page: the columns it knows, no `says`.
    await d.as(ALICE, UPSERT(OLD_COLS), [A_TWIN, "corn_weed", "3", "wrong", "a clod", "confirmed", null]);
    expect(await d.as(ALICE, "SELECT verdict, says, note FROM public.twin_reviews")).toEqual([{ verdict: "wrong", says: "soil_or_residue", note: "a clod" }]);
    await d.as(ALICE, UPSERT(OLD_COLS), [A_TWIN, "corn_weed", "3", "correct", null, "confirmed", null]);
    expect(await d.as(ALICE, "SELECT verdict, says FROM public.twin_reviews")).toEqual([{ verdict: "correct", says: null }]);
  });

  it("stays the reviewer's own: nobody reads, writes or changes another account's answer, and outsiders nothing", async () => {
    const d = await seeded([...BEFORE, SAYS]);
    await d.as(BOB, INSERT, [B_TWIN, "corn_weed", "1", "wrong", "corn_in_row"]);
    expect(await d.as(ALICE, "SELECT says FROM public.twin_reviews")).toEqual([]);
    await expect(d.as(ALICE, INSERT, [B_TWIN, "corn_weed", "2", "wrong", "corn_in_row"])).rejects.toThrow(/row-level security/);
    await d.as(ALICE, "UPDATE public.twin_reviews SET says = 'other'");
    expect((await d.query("SELECT says FROM public.twin_reviews")).rows).toEqual([{ says: "corn_in_row" }]);
    // An account that is not in the pilot.
    await d.query("UPDATE public.pilot_members SET status = 'ended' WHERE user_id = $1", [BOB]);
    expect(await d.as(BOB, "SELECT says FROM public.twin_reviews")).toEqual([]);
    await expect(d.as(BOB, INSERT, [B_TWIN, "corn_weed", "5", "wrong", "other"])).rejects.toThrow(/row-level security/);
    // Still the server's columns.
    await expect(d.as(ALICE, "INSERT INTO public.twin_reviews (twin_id, finding_kind, finding_id, verdict, says, user_id) VALUES ($1, 'corn_weed', '7', 'wrong', 'other', $2)", [A_TWIN, BOB])).rejects.toThrow(/permission denied/);
  });

  it("the review rate limit still applies", async () => {
    const d = await seeded([...BEFORE, SAYS]);
    await d.query("INSERT INTO public.twin_reviews (user_id, twin_id, finding_kind, finding_id, verdict) SELECT $1, $2, 'corn_weed', g::text, 'wrong' FROM generate_series(1, 300) g", [ALICE, A_TWIN]);
    await expect(d.as(ALICE, INSERT, [A_TWIN, "corn_weed", "9999", "wrong", "other"])).rejects.toThrow(/too many reviews/);
  });
});
