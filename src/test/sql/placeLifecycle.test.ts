// @vitest-environment node
//
// A participant's place over its life, run as real SQL against the pilot's own migrations: active, paused, ended,
// restored. While a place is paused or has ended the participant reaches nothing they saved (their existing sign-in
// is still valid: it is the database that refuses, on every request), writes nothing, and nothing of theirs is
// deleted; restored, everything is there as it was. And the application tables take no rows from the browser at all.
import { afterEach, describe, expect, it } from "vitest";
import { ALICE, BOB, type Db, FOUNDER, freshDb, migration } from "./pgHarness";

const PILOT = [
  "20261109120000_pilot_access.sql", "20261109130000_field_twins.sql", "20261109140000_app_events.sql",
  "20261109150000_reviews_feedback_consent.sql", "20261109160000_admin_access_log.sql", "20261109170000_founder_tools_only.sql",
  "20261110120000_twin_review_says.sql",
];
const USERS = [{ id: FOUNDER, email: "YunusHalilErdogan5@gmail.com" }, { id: ALICE, email: "alice@farm.test" }, { id: BOB, email: "bob@farm.test" }];
const TWIN = "3f2a9c1e-0000-4000-8000-000000000001";
const FOLDER = `${ALICE}/field-twins/${TWIN}`;

let db: Db | null = null;
afterEach(async () => { await db?.close(); db = null; });
const refused = (p: Promise<unknown>) => expect(p).rejects.toThrow(/permission denied|row-level security/);

/** Alice, an active participant with a saved corn twin (three files), a review, an agreement, and one logged opening by the founder. */
async function aliceWithATwin(): Promise<Db> {
  const d = await freshDb(PILOT, USERS);
  db = d;
  await d.query("INSERT INTO public.pilot_members (user_id, role) VALUES ($1, 'participant'), ($2, 'participant')", [ALICE, BOB]);
  await d.as(ALICE, "INSERT INTO public.field_twins (id, storage_key, name, crop, status) VALUES ($1::uuid, $1::text, 'North block', 'corn', 'ready')", [TWIN]);
  for (const f of ["twin.json.gz", "atlas-0.jpg", "analysis.json.gz"]) await d.as(ALICE, "INSERT INTO storage.objects (bucket_id, name) VALUES ('orthos', $1)", [`${FOLDER}/${f}`]);
  await d.as(ALICE, "INSERT INTO public.twin_reviews (twin_id, finding_kind, finding_id, verdict) VALUES ($1, 'corn_weed', '3', 'wrong')", [TWIN]);
  await d.as(ALICE, "INSERT INTO public.pilot_consents (terms_version, troubleshooting_access, research_use) VALUES ('pilot-2026-11-v2', true, false)");
  await d.query("INSERT INTO public.admin_access_log (founder_id, participant_id, twin_id, action, reason) VALUES ($1, $2, $3, 'open_twin', 'Pilot evaluation')", [FOUNDER, ALICE, TWIN]);
  return d;
}
const sees = async (d: Db) => ({
  twins: (await d.as(ALICE, "SELECT name FROM public.field_twins")).length,
  files: (await d.as(ALICE, "SELECT name FROM storage.objects")).length,
  reviews: (await d.as(ALICE, "SELECT verdict FROM public.twin_reviews")).length,
  agreements: (await d.as(ALICE, "SELECT terms_version FROM public.pilot_consents")).length,
  openings: (await d.as(ALICE, "SELECT reason FROM public.admin_access_log")).length,
});
const kept = async (d: Db) => ({
  twins: Number((await d.query<{ n: number }>("SELECT count(*)::int n FROM public.field_twins WHERE user_id = $1", [ALICE])).rows[0].n),
  files: Number((await d.query<{ n: number }>("SELECT count(*)::int n FROM storage.objects WHERE name LIKE $1", [`${ALICE}/%`])).rows[0].n),
  reviews: Number((await d.query<{ n: number }>("SELECT count(*)::int n FROM public.twin_reviews WHERE user_id = $1", [ALICE])).rows[0].n),
  agreements: Number((await d.query<{ n: number }>("SELECT count(*)::int n FROM public.pilot_consents WHERE user_id = $1", [ALICE])).rows[0].n),
});
const EVERYTHING = { twins: 1, files: 3, reviews: 1, agreements: 1, openings: 1 };
const NOTHING = { twins: 0, files: 0, reviews: 0, agreements: 0, openings: 0 };

describe("a participant's place: active, paused, ended, restored", () => {
  it("active: they reach their own twin, files, reviews, agreement and the list of openings; another participant reaches none of it", async () => {
    const d = await aliceWithATwin();
    expect(await sees(d)).toEqual(EVERYTHING);
    expect(await d.as(BOB, "SELECT name FROM public.field_twins")).toEqual([]);
    expect(await d.as(BOB, "SELECT name FROM storage.objects")).toEqual([]);
    expect(await d.as(BOB, "SELECT reason FROM public.admin_access_log")).toEqual([]);
  });

  for (const status of ["paused", "ended"] as const) {
    it(`${status}: with the same sign-in they reach nothing and can write nothing, and nothing of theirs is deleted`, async () => {
      const d = await aliceWithATwin();
      await d.query("UPDATE public.pilot_members SET status = $2 WHERE user_id = $1", [ALICE, status]);
      // Reads: the table list, a direct request to storage for a file whose name they know, their reviews and agreement.
      expect(await sees(d)).toEqual(NOTHING);
      expect(await d.as(ALICE, "SELECT name FROM storage.objects WHERE name = $1", [`${FOLDER}/twin.json.gz`])).toEqual([]);
      expect(await d.as(ALICE, "SELECT name FROM storage.objects WHERE name = $1", [`${FOLDER}/analysis.json.gz`])).toEqual([]);
      // Writes: a new twin, a file into their own folder, a review, a new agreement, an event.
      await refused(d.as(ALICE, "INSERT INTO public.field_twins (id, storage_key, name, status) VALUES (gen_random_uuid(), 'again', 'Again', 'saving')"));
      await refused(d.as(ALICE, "INSERT INTO storage.objects (bucket_id, name) VALUES ('orthos', $1)", [`${FOLDER}/atlas-1.jpg`]));
      await refused(d.as(ALICE, "INSERT INTO public.twin_reviews (twin_id, finding_kind, finding_id, verdict) VALUES ($1, 'corn_weed', '4', 'correct')", [TWIN]));
      await refused(d.as(ALICE, "INSERT INTO public.pilot_consents (terms_version, troubleshooting_access) VALUES ('pilot-2026-11-v2', false)"));
      await refused(d.as(ALICE, "INSERT INTO public.app_events (name, session_id, app_version) VALUES ('session_start', 's', 'x')"));
      // Changes and deletions reach no row.
      await d.as(ALICE, "UPDATE public.field_twins SET name = 'renamed' WHERE id = $1", [TWIN]);
      await d.as(ALICE, "DELETE FROM public.field_twins WHERE id = $1", [TWIN]);
      await d.as(ALICE, "DELETE FROM storage.objects WHERE name LIKE $1", [`${FOLDER}/%`]).catch(() => undefined);
      expect((await d.query<{ name: string }>("SELECT name FROM public.field_twins WHERE id = $1", [TWIN])).rows).toEqual([{ name: "North block" }]);
      // They cannot restore themselves.
      await d.as(ALICE, "UPDATE public.pilot_members SET status = 'active' WHERE user_id = $1", [ALICE]).catch(() => undefined);
      expect((await d.query<{ status: string }>("SELECT status FROM public.pilot_members WHERE user_id = $1", [ALICE])).rows).toEqual([{ status }]);
      // Kept: every row and file is still there.
      expect(await kept(d)).toEqual({ twins: 1, files: 3, reviews: 1, agreements: 1 });
      // The other participant is untouched by it.
      await d.as(BOB, "INSERT INTO public.field_twins (id, storage_key, name, status) VALUES (gen_random_uuid(), 'bobs', 'Bob field', 'ready')");
      expect((await d.as(BOB, "SELECT name FROM public.field_twins")).length).toBe(1);
    });
  }

  it("restored: everything is there as it was", async () => {
    const d = await aliceWithATwin();
    await d.query("UPDATE public.pilot_members SET status = 'paused' WHERE user_id = $1", [ALICE]);
    expect(await sees(d)).toEqual(NOTHING);
    await d.query("UPDATE public.pilot_members SET status = 'ended' WHERE user_id = $1", [ALICE]);
    expect(await sees(d)).toEqual(NOTHING);
    await d.query("UPDATE public.pilot_members SET status = 'active' WHERE user_id = $1", [ALICE]);
    expect(await sees(d)).toEqual(EVERYTHING);
    expect((await d.as<{ name: string }>(ALICE, "SELECT name FROM public.field_twins")).map(r => r.name)).toEqual(["North block"]);
  });
});

describe("the application tables take nothing from the browser (20261111120000)", () => {
  const FORM_ONLY = "20261111120000_applications_through_the_form_only.sql";
  /** The tables as the live project has them: the real applications table and its policies, the older sign-up table, and the platform's default grants. */
  async function asLive(): Promise<Db> {
    const d = await freshDb([], USERS);
    db = d;
    await d.exec("DROP TABLE public.pilot_applications");
    await d.exec(migration("20260817160000_pilot_applications.sql"));
    await d.exec(`
      CREATE TABLE public.pilot_signups (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), email text);
      ALTER TABLE public.pilot_signups ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "anyone can signup" ON public.pilot_signups FOR INSERT TO anon, authenticated WITH CHECK (email IS NOT NULL);
      GRANT ALL ON public.pilot_applications, public.pilot_signups TO anon, authenticated, service_role;
    `);
    return d;
  }
  it("before it, anyone could write a row straight in, with a date of their choosing", async () => {
    const d = await asLive();
    // The values the form offers are whatever the table's own checks say; read from them so this test follows the form.
    const insert = `INSERT INTO public.pilot_applications (created_at, full_name, email, farm_name, role, location, acreage_range, crops, drone_status, availability) SELECT '2099-01-01', 'x', 'x@x.test', 'x', role, 'x', acreage_range, 'x', drone_status, availability FROM (SELECT ${await firstOptions(d)}) o`;
    await d.as(null, insert, [], "anon");
    expect((await d.query<{ y: number }>("SELECT extract(year FROM created_at)::int y FROM public.pilot_applications")).rows).toEqual([{ y: 2099 }]);
  });

  it("after it, neither a visitor nor a signed-in account can write, change, delete or read either table; the form's function still writes, dated by the database", async () => {
    const d = await asLive();
    await d.exec(migration(FORM_ONLY));
    const values = await firstOptions(d);
    const insert = `INSERT INTO public.pilot_applications (full_name, email, farm_name, role, location, acreage_range, crops, drone_status, availability) SELECT 'x', 'x@x.test', 'x', role, 'x', acreage_range, 'x', drone_status, availability FROM (SELECT ${values}) o`;
    for (const [uid, role] of [[null, "anon"], [ALICE, "authenticated"]] as const) {
      await refused(d.as(uid, insert, [], role));
      await refused(d.as(uid, "INSERT INTO public.pilot_signups (email) VALUES ('x@x.test')", [], role));
      await refused(d.as(uid, "UPDATE public.pilot_applications SET created_at = '2099-01-01'", [], role));
      await refused(d.as(uid, "DELETE FROM public.pilot_applications", [], role));
      expect(await d.as(uid, "SELECT * FROM public.pilot_applications", [], role).catch(() => [])).toEqual([]);
    }
    await d.as(null, insert, [], "service_role");
    const rows = (await d.query<{ age: number }>("SELECT abs(extract(epoch FROM now() - created_at))::int age FROM public.pilot_applications")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].age).toBeLessThan(60);
  });

  it("changes no row, and can be run twice", async () => {
    const d = await asLive();
    const values = await firstOptions(d);
    await d.as(null, `INSERT INTO public.pilot_applications (full_name, email, farm_name, role, location, acreage_range, crops, drone_status, availability) SELECT 'Dale', 'dale@farm.test', 'Hutchins', role, 'Story County', acreage_range, 'corn', drone_status, availability FROM (SELECT ${values}) o`, [], "anon");
    const before = (await d.query("SELECT * FROM public.pilot_applications")).rows;
    await d.exec(migration(FORM_ONLY));
    await d.exec(migration(FORM_ONLY));
    expect((await d.query("SELECT * FROM public.pilot_applications")).rows).toEqual(before);
    expect((await d.query<{ n: number }>("SELECT count(*)::int n FROM pg_policies WHERE tablename IN ('pilot_applications', 'pilot_signups') AND cmd = 'INSERT'")).rows[0].n).toBe(0);
  });
});

describe("the founder's stars are the desk's alone (20261111140000)", () => {
  const STARS = "20261111140000_pilot_desk_stars.sql";
  it("no participant, signed-in account or visitor can read, write or remove a star, their own included; the desk's function can", async () => {
    const d = await freshDb(PILOT, USERS);
    db = d;
    await d.exec(migration(STARS));
    await d.exec(migration(STARS)); // twice is harmless
    await d.query("INSERT INTO public.pilot_members (user_id, role) VALUES ($1, 'participant'), ($2, 'participant')", [ALICE, BOB]);
    await d.as(null, "INSERT INTO public.pilot_desk_stars (user_id, starred_by) VALUES ($1, $2)", [ALICE, FOUNDER], "service_role");
    for (const [uid, role] of [[ALICE, "authenticated"], [BOB, "authenticated"], [FOUNDER, "authenticated"], [null, "anon"]] as const) {
      await refused(d.as(uid, "SELECT user_id FROM public.pilot_desk_stars", [], role));
      await refused(d.as(uid, "INSERT INTO public.pilot_desk_stars (user_id) VALUES ($1)", [BOB], role));
      await refused(d.as(uid, "DELETE FROM public.pilot_desk_stars", [], role));
      await refused(d.as(uid, "UPDATE public.pilot_desk_stars SET starred_by = NULL", [], role));
    }
    expect((await d.as<{ user_id: string }>(null, "SELECT user_id FROM public.pilot_desk_stars", [], "service_role")).map(r => r.user_id)).toEqual([ALICE]);
    // A person removed from the pilot altogether takes their star with them.
    await d.query("DELETE FROM auth.users WHERE id = $1", [ALICE]);
    expect((await d.query("SELECT 1 FROM public.pilot_desk_stars")).rows).toEqual([]);
  });
});

/** One allowed value for each column the table restricts to a list, as `'v' AS column, ...` (read from the table's own checks). */
async function firstOptions(d: Db): Promise<string> {
  const defs = (await d.query<{ def: string }>("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'public.pilot_applications'::regclass AND contype = 'c'")).rows.map(r => r.def);
  const pick = (column: string) => {
    const def = defs.find(x => new RegExp(`\\(?${column}\\)? = ANY`).test(x) || new RegExp(`${column} IN`).test(x) || x.includes(`(${column} = ANY`));
    const m = def && /'((?:[^']|'')*)'/.exec(def.slice(def.indexOf("ARRAY") >= 0 ? def.indexOf("ARRAY") : 0));
    if (!m) throw new Error(`no option list found for ${column} in: ${defs.join(" | ")}`);
    return `'${m[1]}' AS ${column}`;
  };
  return ["role", "acreage_range", "drone_status", "availability"].map(pick).join(", ");
}
