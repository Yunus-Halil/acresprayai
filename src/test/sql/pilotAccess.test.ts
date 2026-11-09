// @vitest-environment node
//
// The pilot gate, run as real SQL: membership decides access, the founder is seeded, a member cannot promote
// themselves, and the odm_tasks columns that service-role functions trust can no longer be written by users.
import { afterEach, describe, expect, it } from "vitest";
import { ALICE, BOB, type Db, FOUNDER, STRANGER, freshDb } from "./pgHarness";

const ACCESS = "20261109120000_pilot_access.sql";
const UNIQUE = "20261109120100_odm_uuid_unique.sql";

const USERS = [
  { id: FOUNDER, email: "YunusHalilErdogan5@gmail.com" },
  { id: ALICE, email: "alice@farm.test" },
  { id: BOB, email: "bob@farm.test" },
  { id: STRANGER, email: "stranger@elsewhere.test" },
];

let db: Db | null = null;
afterEach(async () => { await db?.close(); db = null; });

async function pilot(): Promise<Db> {
  db = await freshDb([ACCESS], USERS);
  await db.query("INSERT INTO public.pilot_members (user_id, role) VALUES ($1, 'participant'), ($2, 'participant')", [ALICE, BOB]);
  await db.query("INSERT INTO public.fields (user_id, name) VALUES ($1, 'alice north'), ($2, 'bob south'), ($3, 'stranger east')", [ALICE, BOB, STRANGER]);
  return db;
}

const denied = async (p: Promise<unknown>) => {
  await expect(p).rejects.toThrow(/permission denied|row-level security/);
};

describe("pilot membership", () => {
  it("seeds the founder by email, case-insensitively, and nobody else", async () => {
    const d = await freshDb([ACCESS], USERS);
    db = d;
    const rows = (await d.query<{ user_id: string; role: string }>("SELECT user_id, role FROM public.pilot_members")).rows;
    expect(rows).toEqual([{ user_id: FOUNDER, role: "founder" }]);
  });

  it("a member reads only their own rows; an account outside the pilot reads nothing, not even its own", async () => {
    const d = await pilot();
    expect((await d.as<{ name: string }>(ALICE, "SELECT name FROM public.fields")).map(r => r.name)).toEqual(["alice north"]);
    expect(await d.as(STRANGER, "SELECT name FROM public.fields")).toEqual([]);
    expect(await d.as(null, "SELECT name FROM public.fields")).toEqual([]);
  });

  it("an account outside the pilot cannot write, even to rows it would own", async () => {
    const d = await pilot();
    await denied(d.as(STRANGER, "INSERT INTO public.fields (user_id, name) VALUES ($1, 'sneak')", [STRANGER]));
    await d.as(ALICE, "INSERT INTO public.fields (user_id, name) VALUES ($1, 'alice west')", [ALICE]);
    expect((await d.query("SELECT 1 FROM public.fields WHERE name = 'alice west'")).rows).toHaveLength(1);
  });

  it("the owner rule still holds between members: Alice cannot write Bob's rows or rows in Bob's name", async () => {
    const d = await pilot();
    await denied(d.as(ALICE, "INSERT INTO public.fields (user_id, name) VALUES ($1, 'forged')", [BOB]));
    await d.as(ALICE, "UPDATE public.fields SET name = 'hijacked' WHERE user_id = $1", [BOB]);
    expect((await d.query("SELECT name FROM public.fields WHERE user_id = $1", [BOB])).rows).toEqual([{ name: "bob south" }]);
  });

  it("a paused or ended membership closes access at once", async () => {
    const d = await pilot();
    await d.query("UPDATE public.pilot_members SET status = 'paused' WHERE user_id = $1", [ALICE]);
    expect(await d.as(ALICE, "SELECT name FROM public.fields")).toEqual([]);
    await d.query("UPDATE public.pilot_members SET status = 'ended' WHERE user_id = $1", [ALICE]);
    expect(await d.as(ALICE, "SELECT name FROM public.fields")).toEqual([]);
  });

  it("a member sees their own membership row only and cannot add, change or promote one", async () => {
    const d = await pilot();
    expect(await d.as(ALICE, "SELECT user_id, role FROM public.pilot_members")).toEqual([{ user_id: ALICE, role: "participant" }]);
    await denied(d.as(ALICE, "UPDATE public.pilot_members SET role = 'founder' WHERE user_id = $1", [ALICE]));
    await denied(d.as(STRANGER, "INSERT INTO public.pilot_members (user_id, role) VALUES ($1, 'founder')", [STRANGER]));
    await denied(d.as(ALICE, "DELETE FROM public.pilot_members WHERE user_id = $1", [BOB]));
  });

  it("the role helpers answer for the caller", async () => {
    const d = await pilot();
    expect(await d.as(FOUNDER, "SELECT public.pilot_role() AS r, public.is_pilot_founder() AS f")).toEqual([{ r: "founder", f: true }]);
    expect(await d.as(ALICE, "SELECT public.pilot_role() AS r, public.is_pilot_founder() AS f")).toEqual([{ r: "participant", f: false }]);
    expect(await d.as(STRANGER, "SELECT public.pilot_role() AS r, public.is_pilot_member() AS m")).toEqual([{ r: null, m: false }]);
  });

  it("storage: members keep their own folder, outsiders lose theirs", async () => {
    const d = await pilot();
    await d.query("INSERT INTO storage.objects (bucket_id, name) VALUES ('orthos', $1), ('orthos', $2)", [`${ALICE}/field-twins/a/twin.json.gz`, `${STRANGER}/x.tif`]);
    expect(await d.as(ALICE, "SELECT name FROM storage.objects")).toEqual([{ name: `${ALICE}/field-twins/a/twin.json.gz` }]);
    expect(await d.as(STRANGER, "SELECT name FROM storage.objects")).toEqual([]);
    await denied(d.as(STRANGER, "INSERT INTO storage.objects (bucket_id, name) VALUES ('orthos', $1)", [`${STRANGER}/y.tif`]));
    await d.as(ALICE, "INSERT INTO storage.objects (bucket_id, name) VALUES ('orthos', $1)", [`${ALICE}/field-twins/b/atlas-0.jpg`]);
  });

  it("applicants still apply without an account; the application tables are not gated", async () => {
    const d = await pilot();
    await d.as(null, "INSERT INTO public.pilot_applications (email) VALUES ('new@farm.test')", [], "anon");
    await d.as(STRANGER, "INSERT INTO public.pilot_applications (email) VALUES ('s@farm.test')");
    expect((await d.query("SELECT count(*)::int AS n FROM public.pilot_applications")).rows).toEqual([{ n: 2 }]);
  });
});

describe("odm_tasks: the columns service-role functions trust", () => {
  async function withScan(): Promise<Db> {
    const d = await freshDb([ACCESS], USERS);
    db = d;
    await d.query("INSERT INTO public.pilot_members (user_id, role) VALUES ($1, 'participant')", [ALICE]);
    await d.query(
      "INSERT INTO public.odm_tasks (id, user_id, odm_uuid, status, ortho_path) VALUES ('11111111-1111-1111-1111-111111111111', $1, 'aaaa', 'completed', $2)",
      [FOUNDER, `${FOUNDER}/aaaa.tif`],
    );
    return d;
  }
  const TASK = "11111111-1111-1111-1111-111111111111";

  it.each(["ortho_path = 'victim/x.tif'", "output_path = 'victim/odm/x/all.zip'", "odm_uuid = 'victim-uuid'", "status = 'processing'", "tiles_plan_locked = true"])(
    "the owner (even the founder) cannot rewrite %s through the API",
    async (set) => {
      const d = await withScan();
      await denied(d.as(FOUNDER, `UPDATE public.odm_tasks SET ${set} WHERE id = $1`, [TASK]));
      expect((await d.query("SELECT ortho_path, odm_uuid, status FROM public.odm_tasks")).rows)
        .toEqual([{ ortho_path: `${FOUNDER}/aaaa.tif`, odm_uuid: "aaaa", status: "completed" }]);
    },
  );

  it("the two analysis columns the app writes stay writable by the owner", async () => {
    const d = await withScan();
    await d.as(FOUNDER, "UPDATE public.odm_tasks SET ai_analysis = '{\"grid\":1}', ai_analysis_at = now() WHERE id = $1", [TASK]);
    expect((await d.query<{ ai_analysis: unknown }>("SELECT ai_analysis FROM public.odm_tasks")).rows[0].ai_analysis).toEqual({ grid: 1 });
  });

  it("users cannot create scan rows (odm-submit and ortho-import do, with the service role)", async () => {
    const d = await withScan();
    await denied(d.as(FOUNDER, "INSERT INTO public.odm_tasks (user_id, odm_uuid) VALUES ($1, 'mine')", [FOUNDER]));
    await denied(d.as(ALICE, "INSERT INTO public.odm_tasks (user_id, odm_uuid) VALUES ($1, 'aaaa')", [ALICE]));
  });

  it("the owner can still read and delete their scan", async () => {
    const d = await withScan();
    expect(await d.as(FOUNDER, "SELECT odm_uuid FROM public.odm_tasks")).toEqual([{ odm_uuid: "aaaa" }]);
    expect(await d.as(ALICE, "SELECT odm_uuid FROM public.odm_tasks")).toEqual([]);
    await d.as(FOUNDER, "DELETE FROM public.odm_tasks WHERE id = $1", [TASK]);
    expect((await d.query("SELECT count(*)::int AS n FROM public.odm_tasks")).rows).toEqual([{ n: 0 }]);
  });

  it("the anon key reads no scan at all", async () => {
    const d = await withScan();
    await denied(d.as(null, "SELECT odm_uuid FROM public.odm_tasks", [], "anon"));
  });

  it("the service role is untouched: it still creates and updates scans", async () => {
    const d = await withScan();
    await d.as(null, "INSERT INTO public.odm_tasks (user_id, odm_uuid) VALUES ($1, 'bbbb')", [ALICE], "service_role");
    await d.as(null, "UPDATE public.odm_tasks SET status = 'processing' WHERE odm_uuid = 'bbbb'", [], "service_role");
    expect((await d.query("SELECT status FROM public.odm_tasks WHERE odm_uuid = 'bbbb'")).rows).toEqual([{ status: "processing" }]);
  });
});

describe("one scan per ODM task id", () => {
  it("creates the unique index when the data allows it", async () => {
    db = await freshDb([ACCESS], USERS);
    await db.exec((await import("./pgHarness")).migration(UNIQUE));
    await db.query("INSERT INTO public.odm_tasks (user_id, odm_uuid) VALUES ($1, 'u1')", [ALICE]);
    await expect(db.query("INSERT INTO public.odm_tasks (user_id, odm_uuid) VALUES ($1, 'u1')", [BOB])).rejects.toThrow(/duplicate key/);
    await db.query("INSERT INTO public.odm_tasks (user_id, odm_uuid) VALUES ($1, NULL), ($1, NULL)", [BOB]);
  });

  it("leaves existing duplicates alone and creates no index rather than failing the deploy", async () => {
    db = await freshDb([ACCESS], USERS);
    await db.query("INSERT INTO public.odm_tasks (user_id, odm_uuid) VALUES ($1, 'dup'), ($2, 'dup')", [ALICE, BOB]);
    await db.exec((await import("./pgHarness")).migration(UNIQUE));
    const idx = (await db.query("SELECT 1 FROM pg_indexes WHERE indexname = 'odm_tasks_odm_uuid_unique'")).rows;
    expect(idx).toHaveLength(0);
    expect((await db.query("SELECT count(*)::int AS n FROM public.odm_tasks")).rows).toEqual([{ n: 2 }]);
  });
});
