// Who may call what, decided on the server.
//
// Membership lives in public.pilot_members (migration 20261109120000): one row per invited person, with a role.
//   founder      everything, including the orthomosaic workflow, tiles, ODM, the baseline detector and the
//                founder pages.
//   participant  the Field Twin pilot: their own twins, reviews, feedback. Nothing that spends paid processing.
// An account with no active row is signed in but not part of the pilot, and every function refuses it.
//
// These checks run with the service-role key, which bypasses row security, so they are the only gate those
// functions have. Row security on the tables (the "pilot members only" restrictive policies) covers the requests
// that go straight to the database.
//
// Path and id checks live here too. A service-role function that signs or fetches whatever a row holds trusts that
// row; the columns are no longer writable by users (same migration), and these checks keep a function from acting
// on a value outside the caller's own folder even if one ever were.

export type PilotRole = "founder" | "participant";

type AdminClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, value: unknown) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
    };
  };
};

/** The caller's active pilot role, or null when they are not (or no longer) in the pilot. */
export async function pilotRole(admin: unknown, userId: string): Promise<PilotRole | null> {
  const { data, error } = await (admin as AdminClient).from("pilot_members").select("role, status").eq("user_id", userId).maybeSingle();
  if (error || !data) return null;
  const row = data as { role?: unknown; status?: unknown };
  if (row.status !== "active") return null;
  return row.role === "founder" || row.role === "participant" ? row.role : null;
}

/** The refusal every founder-only function gives a participant or a non-member. Same wording, no detail. */
export const NOT_IN_PILOT = { error: "This is not available on your account." } as const;

/**
 * True when `path` lies inside `userId`'s own folder: it starts with "<userId>/", has no empty, "." or ".."
 * segment and no backslash. Every storage path a service-role function signs or reads on a caller's behalf
 * goes through this first.
 */
export function inOwnFolder(userId: string, path: unknown): path is string {
  if (typeof path !== "string" || !userId) return false;
  if (!path.startsWith(`${userId}/`)) return false;
  if (path.includes("\\") || path.includes("\0")) return false;
  const segments = path.split("/");
  return segments.length >= 2 && segments.every(s => s !== "" && s !== "." && s !== "..");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ODM task ids (NodeODM, WebODM Lightning, and the ids ortho-import mints) are UUIDs; anything else is refused before it reaches a URL. */
export function isOdmUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * A raw ODM asset name the proxy may ask the node for: one plain file name (letters, digits, dot, dash,
 * underscore), not hidden, no path. Checked on the decoded value, so "%2e%2e%2f" is refused as "../".
 */
export function isPlainAssetName(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(value) && !value.includes("..");
}
