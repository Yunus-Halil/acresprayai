// @vitest-environment node
//
// public.twin_plots (migration 20261124120000), run as real SQL on top of the pilot migrations: a person's plots are
// theirs alone, at the database; founder-only until the switch is dropped; a plot is never removed, only marked
// deleted; it can move from its twin to a field without being redrawn.
import { afterEach, describe, expect, it } from "vitest";
import { ALICE, BOB, type Db, FOUNDER, STRANGER, freshDb, migration } from "./pgHarness";

const BEFORE = ["20261109120000_pilot_access.sql", "20261109130000_field_twins.sql"];
const PLOTS = "20261124120000_twin_plots.sql";
const USERS = [{ id: FOUNDER, email: "YunusHalilErdogan5@gmail.com" }, { id: ALICE, email: "alice@farm.test" }, { id: BOB, email: "bob@farm.test" }, { id: STRANGER, email: "stranger@elsewhere.test" }];
const F_TWIN = "f0000000-1111-4000-8000-000000000001", A_TWIN = "aaaaaaaa-1111-4000-8000-000000000001", B_TWIN = "bbbbbbbb-1111-4000-8000-000000000002";
const F_FIELD = "f0000000-2222-4000-8000-000000000001", A_FIELD = "aaaaaaaa-2222-4000-8000-000000000001";
const RING = JSON.stringify([[31.581, -83.586], [31.581, -83.585], [31.5805, -83.585], [31.5805, -83.586]]);
const SHAPE = JSON.stringify({ tool: "polygon" });

let db: Db | null = null;
afterEach(async () => { await db?.close(); db = null; });

async function seeded(): Promise<Db> {
  const d = await freshDb([...BEFORE, PLOTS], USERS);
  db = d;
  await d.query("INSERT INTO public.pilot_members (user_id, role) VALUES ($1, 'participant'), ($2, 'participant')", [ALICE, BOB]);
  await d.query("INSERT INTO public.field_twins (id, user_id, storage_key, name, status) VALUES ($1, $2, 'f', 'Levi', 'ready'), ($3, $4, 'a', 'Alice north', 'ready'), ($5, $6, 'b', 'Bob south', 'ready')", [F_TWIN, FOUNDER, A_TWIN, ALICE, B_TWIN, BOB]);
  await d.query("INSERT INTO public.fields (id, user_id, name) VALUES ($1, $2, 'levi'), ($3, $4, 'alice north')", [F_FIELD, FOUNDER, A_FIELD, ALICE]);
  return d;
}
// What the app sends for a plot: every column it knows, on conflict (the owner's own id for the plot) update them all.
const COLS = ["uid", "twin_id", "number", "name", "colour", "ring", "shape", "drawn_at", "edited_at", "deleted_at"];
const UPSERT = `INSERT INTO public.twin_plots (${COLS.join(", ")}) VALUES (${COLS.map((_, i) => `$${i + 1}`).join(", ")}) ON CONFLICT (user_id, uid) DO UPDATE SET ${COLS.slice(1).map(c => `${c} = excluded.${c}`).join(", ")}`;
const plot = (uid: string, twin: string | null, over: Partial<Record<string, unknown>> = {}) => {
  const v: Record<string, unknown> = { uid, twin_id: twin, number: 1, name: "UMD Plot", colour: "#ba68c8", ring: RING, shape: SHAPE, drawn_at: "2026-11-24T10:00:00Z", edited_at: "2026-11-24T10:00:00Z", deleted_at: null, ...over };
  return COLS.map(c => v[c]);
};
const denied = async (p: Promise<unknown>) => { await expect(p).rejects.toThrow(/permission denied|row-level security/); };

describe("twin_plots", () => {
  it("keeps the founder's plot exactly, colour and corners, and sending it twice is one plot", async () => {
    const d = await seeded();
    await d.as(FOUNDER, UPSERT, plot("p1", F_TWIN));
    await d.as(FOUNDER, UPSERT, plot("p1", F_TWIN, { colour: "#4fc3f7", edited_at: "2026-11-24T11:00:00Z" }));
    const rows = await d.as<{ uid: string; colour: string; ring: unknown; shape: unknown; user_id: string }>(FOUNDER, "SELECT uid, colour, ring, shape, user_id FROM public.twin_plots");
    expect(rows).toEqual([{ uid: "p1", colour: "#4fc3f7", ring: JSON.parse(RING), shape: { tool: "polygon" }, user_id: FOUNDER }]);
  });

  it("is founder-only for now: a pilot participant can neither read nor write plots, not even on their own twin", async () => {
    const d = await seeded();
    await d.as(FOUNDER, UPSERT, plot("p1", F_TWIN));
    await denied(d.as(ALICE, UPSERT, plot("a1", A_TWIN)));
    expect(await d.as(ALICE, "SELECT uid FROM public.twin_plots")).toEqual([]);
  });

  it("is the owner's alone: nobody reads another's plots, and nobody attaches a plot to another's twin or field", async () => {
    const d = await seeded();
    await d.as(FOUNDER, UPSERT, plot("p1", F_TWIN));
    // The switch dropped, as it will be once he has checked his devices: each pilot member to their own.
    await d.exec(`DROP POLICY "founder only, for now" ON public.twin_plots`);
    await d.as(ALICE, UPSERT, plot("a1", A_TWIN));
    expect((await d.as<{ uid: string }>(ALICE, "SELECT uid FROM public.twin_plots")).map(r => r.uid)).toEqual(["a1"]);
    expect((await d.as<{ uid: string }>(BOB, "SELECT uid FROM public.twin_plots")).map(r => r.uid)).toEqual([]);
    await denied(d.as(BOB, UPSERT, plot("b1", A_TWIN)));
    await denied(d.as(ALICE, UPSERT, plot("a2", F_TWIN)));
    await denied(d.as(ALICE, "UPDATE public.twin_plots SET field_id = $1 WHERE uid = 'a1'", [F_FIELD]));
    // Bob's update of Alice's plot touches nothing.
    await d.as(BOB, "UPDATE public.twin_plots SET name = 'hijacked'");
    expect((await d.query("SELECT name FROM public.twin_plots WHERE uid = 'a1'")).rows).toEqual([{ name: "UMD Plot" }]);
    // Outside the pilot, or signed out: nothing.
    expect(await d.as(STRANGER, "SELECT uid FROM public.twin_plots")).toEqual([]);
    expect(await d.as(null, "SELECT uid FROM public.twin_plots", [], "anon").catch(() => [])).toEqual([]);
  });

  it("cannot be written in another's name, renumbered to another owner, or given another plot's id", async () => {
    const d = await seeded();
    await denied(d.as(FOUNDER, "INSERT INTO public.twin_plots (user_id, uid, twin_id, number, name, colour, ring, shape) VALUES ($1, 'x', $2, 1, 'x', '#ffffff', $3, $4)", [ALICE, F_TWIN, RING, SHAPE]));
    await d.as(FOUNDER, UPSERT, plot("p1", F_TWIN));
    await denied(d.as(FOUNDER, "UPDATE public.twin_plots SET user_id = $1", [ALICE]));
    await denied(d.as(FOUNDER, "UPDATE public.twin_plots SET uid = 'other'"));
  });

  it("is never removed: delete is refused, and a plot marked deleted can be brought back", async () => {
    const d = await seeded();
    await d.as(FOUNDER, UPSERT, plot("p1", F_TWIN));
    await denied(d.as(FOUNDER, "DELETE FROM public.twin_plots"));
    await d.as(FOUNDER, "UPDATE public.twin_plots SET deleted_at = now() WHERE uid = 'p1'");
    await d.as(FOUNDER, "UPDATE public.twin_plots SET deleted_at = NULL WHERE uid = 'p1'");
    expect(await d.as(FOUNDER, "SELECT uid, deleted_at FROM public.twin_plots")).toEqual([{ uid: "p1", deleted_at: null }]);
  });

  it("moves from its twin to a field without being redrawn, and outlives its twin", async () => {
    const d = await seeded();
    await d.as(FOUNDER, UPSERT, plot("p1", F_TWIN));
    await d.as(FOUNDER, "UPDATE public.twin_plots SET field_id = $1 WHERE uid = 'p1'", [F_FIELD]);
    await d.query("DELETE FROM public.field_twins WHERE id = $1", [F_TWIN]);
    expect(await d.as(FOUNDER, "SELECT uid, twin_id, field_id, ring FROM public.twin_plots")).toEqual([{ uid: "p1", twin_id: null, field_id: F_FIELD, ring: JSON.parse(RING) }]);
  });

  it("refuses what is not a plot: too few corners, a colour that is not a colour, an unknown tool", async () => {
    const d = await seeded();
    await expect(d.as(FOUNDER, UPSERT, plot("p1", F_TWIN, { ring: JSON.stringify([[1, 2], [3, 4]]) }))).rejects.toThrow(/check/);
    await expect(d.as(FOUNDER, UPSERT, plot("p2", F_TWIN, { colour: "red" }))).rejects.toThrow(/check/);
    await expect(d.as(FOUNDER, UPSERT, plot("p3", F_TWIN, { shape: JSON.stringify({ tool: "lasso" }) }))).rejects.toThrow(/check/);
    await expect(d.as(FOUNDER, UPSERT, plot("bad id!", F_TWIN))).rejects.toThrow(/check/);
  });

  it("can be run twice, and leaves every other table as it was", async () => {
    const d = await seeded();
    await d.as(FOUNDER, UPSERT, plot("p1", F_TWIN));
    const twins = (await d.query("SELECT * FROM public.field_twins ORDER BY id")).rows;
    await d.exec(migration(PLOTS));
    expect((await d.query("SELECT uid FROM public.twin_plots")).rows).toEqual([{ uid: "p1" }]);
    expect((await d.query("SELECT * FROM public.field_twins ORDER BY id")).rows).toEqual(twins);
  });
});
