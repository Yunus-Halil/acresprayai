// A real Postgres (PGlite, in process) with the slice of a Supabase project that the pilot migrations touch:
// the anon / authenticated / service_role roles, auth.users and auth.uid(), storage.objects with an owner-folder
// policy, and the user tables as the earlier migrations created them. The migration files themselves are then run
// verbatim, so what is tested is the SQL that ships, not a re-statement of it.
//
// auth.uid() reads the `request.jwt.claim.sub` setting, which is what PostgREST sets per request in Supabase.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

export const FOUNDER = "00000000-0000-0000-0000-00000000f00d";
export const ALICE = "aaaaaaaa-0000-0000-0000-000000000001";
export const BOB = "bbbbbbbb-0000-0000-0000-000000000002";
export const STRANGER = "cccccccc-0000-0000-0000-000000000003";

const BASE = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE storage.objects (id serial PRIMARY KEY, bucket_id text NOT NULL, name text NOT NULL);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT ALL ON storage.objects TO authenticated, service_role;
GRANT USAGE ON SEQUENCE storage.objects_id_seq TO authenticated, service_role;
CREATE POLICY "Users read own orthos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'orthos' AND split_part(name, '/', 1) = auth.uid()::text);
CREATE POLICY "Users insert own orthos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'orthos' AND split_part(name, '/', 1) = auth.uid()::text);

CREATE TABLE public.pilot_applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
ALTER TABLE public.pilot_applications ENABLE ROW LEVEL SECURITY;
GRANT INSERT ON public.pilot_applications TO anon, authenticated;
CREATE POLICY "anyone can apply" ON public.pilot_applications FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE TABLE public.fields (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text);
ALTER TABLE public.fields ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fields TO authenticated;
CREATE POLICY "own fields" ON public.fields FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- As 20260617142810 and later migrations left it: FOR ALL by owner, full table grants to authenticated.
CREATE TABLE public.odm_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, field_id uuid,
  odm_uuid text, status text NOT NULL DEFAULT 'queued', ortho_path text, output_path text,
  ai_analysis jsonb, ai_analysis_at timestamptz, tiles_plan_locked boolean DEFAULT false
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.odm_tasks TO authenticated;
GRANT ALL ON public.odm_tasks TO service_role;
GRANT SELECT ON public.odm_tasks TO anon;
ALTER TABLE public.odm_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own odm_tasks all" ON public.odm_tasks FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
`;

export function migration(name: string): string {
  return readFileSync(path.resolve(__dirname, "../../../supabase/migrations", name), "utf8");
}

export type Db = PGlite & {
  /** Run `sql` as `role` with auth.uid() = `uid` (null: no user), then return to the superuser. */
  as: <T = Record<string, unknown>>(uid: string | null, sql: string, params?: unknown[], role?: string) => Promise<T[]>;
};

/** A fresh database with the Supabase slice, the given users, and the named migrations applied in order. */
export async function freshDb(migrations: string[], users: { id: string; email: string }[] = []): Promise<Db> {
  const db = new PGlite() as Db;
  await db.exec(BASE);
  for (const u of users) await db.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [u.id, u.email]);
  for (const m of migrations) await db.exec(migration(m));
  db.as = async <T,>(uid: string | null, sql: string, params: unknown[] = [], role = "authenticated") => {
    await db.exec(`SET ROLE ${role}`);
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [uid ?? ""]);
    try {
      return (await db.query<T>(sql, params)).rows;
    } finally {
      await db.exec("RESET ROLE");
      await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
    }
  };
  return db;
}
