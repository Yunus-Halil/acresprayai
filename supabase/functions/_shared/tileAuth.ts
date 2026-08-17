// Shared auth for the tile-serving edge functions.
//
// Leaflet loads tiles as plain <img> GETs, which cannot carry an Authorization
// header, so these endpoints also accept the session JWT as `?token=`. Both
// functions run with `verify_jwt = false` (see supabase/config.toml) precisely
// so the token can arrive either way - the checks below are what actually
// gates access, and they must run on every request.
//
// Results are memoised per warm instance so a viewport full of tiles costs one
// auth round-trip and one ownership lookup rather than several hundred.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const USER_TTL_MS = 5 * 60_000;
const TASK_TTL_MS = 10 * 60_000;

const userCache = new Map<string, { userId: string | null; expires: number }>();
const taskCache = new Map<string, { userId: string; expires: number } | null>();

/** Pull the bearer token from either the Authorization header or `?token=`. */
export function readToken(req: Request, url: URL): string | null {
  const header = req.headers.get("Authorization") ?? "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim() || null;
  const q = url.searchParams.get("token");
  return q ? q.trim() : null;
}

/** Resolve a JWT to a user id, or null if it is missing/invalid/expired. */
export async function userIdFromToken(token: string | null): Promise<string | null> {
  if (!token) return null;
  const now = Date.now();
  const hit = userCache.get(token);
  if (hit && hit.expires > now) return hit.userId;

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data } = await client.auth.getUser();
  const userId = data.user?.id ?? null;
  // Cache negatives too, so a flood of tiles with a stale token doesn't hammer auth.
  userCache.set(token, { userId, expires: now + USER_TTL_MS });
  return userId;
}

type TaskOwner = {
  userId: string; odmUuid: string | null; orthoPath: string | null;
  /** Resolved band roles, cached per scan. See _shared/bands.ts. */
  bandMapping: unknown | null;
};

/** Look up a task by its primary key. Returns null when the row doesn't exist. */
export async function taskById(taskId: string): Promise<TaskOwner | null> {
  const { data } = await admin.from("odm_tasks")
    .select("user_id, odm_uuid, ortho_path, band_mapping").eq("id", taskId).maybeSingle();
  if (!data?.user_id) return null;
  return {
    userId: data.user_id as string,
    odmUuid: (data.odm_uuid as string | null) ?? null,
    orthoPath: (data.ortho_path as string | null) ?? null,
    bandMapping: (data as Record<string, unknown>).band_mapping ?? null,
  };
}

/** Owner of an ODM uuid, memoised. Returns null when no such task exists. */
export async function ownerOfOdmUuid(odmUuid: string): Promise<string | null> {
  const now = Date.now();
  const hit = taskCache.get(odmUuid);
  if (hit !== undefined && (hit === null || hit.expires > now)) {
    return hit?.userId ?? null;
  }
  const { data } = await admin.from("odm_tasks")
    .select("user_id").eq("odm_uuid", odmUuid).maybeSingle();
  const userId = (data?.user_id as string | undefined) ?? null;
  taskCache.set(odmUuid, userId ? { userId, expires: now + TASK_TTL_MS } : null);
  return userId;
}

export { admin };
