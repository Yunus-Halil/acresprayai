// The admin panel's data: one snapshot of the pilot (people, events, twins, reviews, feedback, consent, access log),
// the system health checks, and opening a participant's twin when, and only when, they allowed it.
//
// Called only from pilot-admin/index.ts after its founder check. The snapshot holds operational records and the
// participants' own words; no imagery, no storage paths, no boundary outlines (twin_reviews.payload is left out).
// Opening a twin is the one place imagery leaves the participant's folder, and it is consented and logged.

type Q = {
  select: (c: string) => Q; eq: (k: string, v: unknown) => Q; order: (c: string, o?: unknown) => Q; limit: (n: number) => Q;
  insert: (r: unknown) => Q; maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
  then: Promise<{ data: unknown; error: { message: string } | null }>["then"];
};
type Admin = {
  from: (t: string) => Q;
  storage: { from: (b: string) => {
    list: (p: string, o?: unknown) => Promise<{ data: { name: string; id: string | null }[] | null; error: { message: string } | null }>;
    createSignedUrl: (p: string, s: number) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
  } };
};
type AuthUser = { id: string; email?: string | null; created_at?: string; last_sign_in_at?: string | null; email_confirmed_at?: string | null; app_metadata?: { provider?: string } };

const DAY = 86_400_000;
const rows = async <T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<{ rows: T[]; missing: boolean }> => {
  const { data, error } = await q;
  if (error) return { rows: [], missing: /does not exist|PGRST205|schema cache|relation/i.test(error.message) };
  return { rows: (data ?? []) as T[], missing: false };
};

/** An event made safe to show: counts and stages numbers only, detail plain values only, text cut. Whatever a
 *  participant's client sent, the founder's panel gets nothing it could choke on. */
export function cleanEvent<T extends Record<string, unknown>>(e: T): T {
  const nums = (o: unknown) => (o && typeof o === "object" && !Array.isArray(o) ? Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([, v]) => typeof v === "number" && Number.isFinite(v)).slice(0, 24)) : null);
  const plain = (o: unknown) => (o && typeof o === "object" && !Array.isArray(o) ? Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v)).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 200) : v]).slice(0, 12)) : null);
  const text = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);
  return { ...e, name: text(e.name, 40), error: text(e.error, 500), route: text(e.route, 120), counts: nums(e.counts), stages: nums(e.stages), detail: plain(e.detail) };
}

/** Only the named fields of each row: the snapshot never depends on the query's column list alone to keep data out. */
const pick = <T extends Record<string, unknown>>(list: T[], cols: string) => {
  const keys = cols.split(",").map(c => c.trim());
  return list.map(r => Object.fromEntries(keys.map(k => [k, r[k] ?? null])));
};
const COLS = {
  members: "user_id, role, status, email, display_name, organisation, application_id, invited_at, created_at, notes",
  events: "id, user_id, at, received_at, name, session_id, route, twin_id, duration_ms, outcome, error, counts, stages, detail, app_version",
  twins: "id, user_id, name, crop, captured_at, photographs, camera, placement, area_ha, status, error, build_ms, created_at, updated_at",
  reviews: "user_id, twin_id, finding_kind, finding_id, verdict, note, algorithm_status, created_at, updated_at",
  feedback: "id, user_id, created_at, kind, message, route, twin_id, context, status, notified_at",
  consents: "user_id, created_at, terms_version, troubleshooting_access, research_use",
  access: "at, founder_id, participant_id, twin_id, action, reason",
};

/**
 * The reviews, with the reviewer's answer on a corn finding marked wrong (twin_reviews.says, migration 20261110120000)
 * when the database has that column. This function may be deployed before or after the migration: without the
 * column the reviews come back exactly as before, each with no answer.
 */
const REVIEWS_WITH_SAYS = `${COLS.reviews}, says`;
async function reviewRows(admin: Admin): Promise<{ rows: Record<string, unknown>[]; missing: boolean }> {
  const q = (cols: string) => admin.from("twin_reviews").select(cols).order("updated_at", { ascending: false }).limit(20000);
  const first = await q(REVIEWS_WITH_SAYS);
  if (first.error && /\bsays\b/.test(first.error.message)) return rows<Record<string, unknown>>(q(COLS.reviews));
  const got = await rows<Record<string, unknown>>(Promise.resolve(first));
  // A short word from the migration's own list, or nothing: never free text.
  return { ...got, rows: got.rows.map(r => ({ ...r, says: typeof r.says === "string" && /^[a-z_]{1,40}$/.test(r.says) ? r.says : null })) };
}

export async function snapshot(admin: Admin, users: AuthUser[]) {
  const since = Date.now() - 90 * DAY;
  const [members, events, twins, reviews, feedback, consents, applications, access, stars] = await Promise.all([
    rows<Record<string, unknown>>(admin.from("pilot_members").select(COLS.members)),
    rows<Record<string, unknown>>(admin.from("app_events").select(COLS.events).order("received_at", { ascending: false }).limit(20000)),
    rows<Record<string, unknown>>(admin.from("field_twins").select(COLS.twins).order("created_at", { ascending: false }).limit(5000)),
    reviewRows(admin),
    rows<Record<string, unknown>>(admin.from("pilot_feedback").select(COLS.feedback).order("created_at", { ascending: false }).limit(2000)),
    rows<Record<string, unknown>>(admin.from("pilot_consents").select(COLS.consents).order("created_at", { ascending: false }).limit(5000)),
    rows<Record<string, unknown>>(admin.from("pilot_applications").select("*").order("created_at", { ascending: false }).limit(1000)),
    rows<Record<string, unknown>>(admin.from("admin_access_log").select(COLS.access).order("at", { ascending: false }).limit(1000)),
    rows<Record<string, unknown>>(admin.from("pilot_desk_stars").select("user_id").limit(2000)),
  ]);
  return {
    generated_at: new Date().toISOString(),
    users: users.map(u => ({ id: u.id, email: u.email ?? null, created_at: u.created_at ?? null, last_sign_in_at: u.last_sign_in_at ?? null, confirmed: !!u.email_confirmed_at, provider: u.app_metadata?.provider ?? null })),
    members: pick(members.rows, COLS.members),
    events: pick(events.rows, COLS.events).map(cleanEvent).filter(e => Date.parse(String(e.at)) >= since && Date.parse(String(e.at)) <= Date.now() + 60_000),
    twins: pick(twins.rows, COLS.twins), reviews: pick(reviews.rows, REVIEWS_WITH_SAYS), feedback: pick(feedback.rows, COLS.feedback),
    consents: pick(consents.rows, COLS.consents), applications: applications.rows, access: pick(access.rows, COLS.access),
    // The founder's starred people (migration 20261111140000). null when the database has no such table yet: the
    // desk then keeps stars in the browser, as it did before.
    stars: stars.missing ? null : stars.rows.map(r => String(r.user_id)),
    missing: { members: members.missing, events: events.missing, twins: twins.missing, reviews: reviews.missing, feedback: feedback.missing, consents: consents.missing, access: access.missing },
  };
}

export type Check = { id: string; label: string; status: "ok" | "warn" | "fail" | "unknown"; detail: string };

/** What the founder must fix before (or while) participants use the pilot. Only what can be read from here. */
export async function health(admin: Admin, users: AuthUser[], env: (k: string) => string | undefined, fetcher: typeof fetch = fetch): Promise<Check[]> {
  const checks: Check[] = [];
  const url = env("SUPABASE_URL"), anon = env("SUPABASE_ANON_KEY");
  try {
    const r = await fetcher(`${url}/auth/v1/settings`, { headers: { apikey: anon ?? "" } });
    const s = await r.json() as { disable_signup?: boolean; mailer_autoconfirm?: boolean; external?: Record<string, boolean> };
    checks.push(s.disable_signup
      ? { id: "signups", label: "New sign-ups", status: "ok", detail: "Switched off: only invited people get accounts." }
      : { id: "signups", label: "New sign-ups", status: "fail", detail: "Open: anyone can create an account (it can read nothing, but switch sign-ups off in Supabase Auth settings)." });
    checks.push(s.mailer_autoconfirm
      ? { id: "confirm", label: "Email confirmation", status: "warn", detail: "Off: an account's email address is not proven. Turn confirmation on in Supabase Auth settings." }
      : { id: "confirm", label: "Email confirmation", status: "ok", detail: "On." });
    if (s.external) checks.push({ id: "google", label: "Google sign-in", status: "ok", detail: s.external.google ? "Enabled (invited addresses only, with sign-ups off)." : "Disabled." });
  } catch {
    checks.push({ id: "signups", label: "New sign-ups", status: "unknown", detail: "Could not read the Auth settings." });
  }
  checks.push(env("RESEND_API_KEY")
    ? { id: "resend", label: "Email sending", status: "ok", detail: "RESEND_API_KEY is set." }
    : { id: "resend", label: "Email sending", status: "fail", detail: "RESEND_API_KEY is not set: invitations and feedback alerts are not emailed (invite links are still shown to copy)." });
  checks.push(env("PILOT_NOTIFY_FROM")
    ? { id: "from", label: "Sender address", status: "ok", detail: `Mail is sent as ${env("PILOT_NOTIFY_FROM")}.` }
    : { id: "from", label: "Sender address", status: "warn", detail: "PILOT_NOTIFY_FROM is not set: Resend's shared sender only delivers to its own account owner, so participants do not receive invitations. Verify a domain in Resend and set it." });
  checks.push(env("PILOT_NOTIFY_TO")
    ? { id: "to", label: "Where alerts go", status: "ok", detail: env("PILOT_NOTIFY_TO")! }
    : { id: "to", label: "Where alerts go", status: "warn", detail: "PILOT_NOTIFY_TO is not set: alerts go to yunus@swardus.com." });
  if (env("PILOT_ADMIN_EMAILS")) checks.push({ id: "legacy-admin", label: "Old admin allowlist", status: "warn", detail: "PILOT_ADMIN_EMAILS is still set. The founder role decides now; unset it." });

  const tables = ["pilot_members", "field_twins", "app_events", "twin_reviews", "pilot_feedback", "pilot_consents", "admin_access_log"];
  const missing: string[] = [];
  for (const t of tables) { const r = await rows(admin.from(t).select("*").limit(1)); if (r.missing) missing.push(t); }
  checks.push(missing.length
    ? { id: "tables", label: "Database updated for the pilot", status: "fail", detail: `Missing: ${missing.join(", ")}. Apply the pilot migrations.` }
    : { id: "tables", label: "Database updated for the pilot", status: "ok", detail: "Every pilot table is there." });

  const members = (await rows<{ user_id: string; role: string; status: string }>(admin.from("pilot_members").select("user_id, role, status"))).rows;
  const ids = new Set(members.map(m => m.user_id));
  const outsiders = users.filter(u => !ids.has(u.id));
  checks.push(outsiders.length
    ? { id: "outsiders", label: "Accounts outside the pilot", status: "warn", detail: `${outsiders.length} account(s) can sign in but see nothing: ${outsiders.slice(0, 5).map(u => u.email ?? u.id).join(", ")}${outsiders.length > 5 ? "…" : ""}. Delete them in Supabase or invite them.` }
    : { id: "outsiders", label: "Accounts outside the pilot", status: "ok", detail: "None." });
  const unconfirmed = users.filter(u => ids.has(u.id) && !u.email_confirmed_at);
  if (unconfirmed.length) checks.push({ id: "unconfirmed", label: "Members with an unproven address", status: "warn", detail: `${unconfirmed.map(u => u.email ?? u.id).join(", ")}: they have not opened an invitation or confirmation link yet.` });

  const twins = (await rows<{ status: string; updated_at: string }>(admin.from("field_twins").select("status, updated_at"))).rows;
  const stuck = twins.filter(t => t.status === "saving" && Date.now() - Date.parse(t.updated_at) > 30 * 60_000).length;
  const incomplete = twins.filter(t => t.status === "incomplete").length;
  checks.push(stuck + incomplete
    ? { id: "saves", label: "Field Twins not saved completely", status: "warn", detail: `${stuck} cut off while saving, ${incomplete} marked incomplete. Their owners see them as "not saved completely" and can delete them.` }
    : { id: "saves", label: "Field Twins not saved completely", status: "ok", detail: "None." });
  const fb = (await rows<{ status: string; notified_at: string | null }>(admin.from("pilot_feedback").select("status, notified_at"))).rows;
  const unread = fb.filter(f => f.status === "new").length;
  checks.push({ id: "feedback", label: "Unread feedback", status: unread ? "warn" : "ok", detail: unread ? `${unread} message(s) not marked seen.` : "None." });
  const unsent = fb.filter(f => !f.notified_at).length;
  if (unsent) checks.push({ id: "alerts", label: "Feedback not emailed", status: "warn", detail: `${unsent} message(s) were stored but the email alert did not go out (check Email sending).` });
  return checks;
}

/**
 * The files of one participant's twin, as short-lived signed links, for the founder's read-only viewer. Allowed for
 * the founder's own twins, and for a participant's only while their newest consent allows troubleshooting access.
 * Every opening of someone else's twin is written to admin_access_log first; if that write fails, nothing is opened.
 */
export async function openTwin(admin: Admin, founderId: string, twinId: string, reason: string | null): Promise<{ status: number; body: unknown }> {
  const { data: rec } = await admin.from("field_twins").select("id, user_id, storage_key, name, status").eq("id", twinId).maybeSingle();
  const twin = rec as { id: string; user_id: string; storage_key: string; name: string; status: string } | null;
  if (!twin) return { status: 404, body: { error: "No such Field Twin" } };
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(twin.storage_key)) return { status: 404, body: { error: "No such Field Twin" } };
  if (twin.user_id !== founderId) {
    // A place that is paused or has ended: what the participant saved is kept, and is not opened while it is.
    const { data: m } = await admin.from("pilot_members").select("status").eq("user_id", twin.user_id).maybeSingle();
    if ((m as { status?: string } | null)?.status !== "active") {
      return { status: 403, body: { error: "This participant's place in the pilot is paused or has ended. Their Field Twins are kept, and are not opened while it is. Restore the place to open them." } };
    }
    const { data: c } = await admin.from("pilot_consents").select("troubleshooting_access, created_at").eq("user_id", twin.user_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!(c as { troubleshooting_access?: boolean } | null)?.troubleshooting_access) {
      return { status: 403, body: { error: "This participant has not agreed to pilot terms that let Swardus open their Field Twins, so it cannot be opened here. It opens once they have agreed to the current terms, which they are asked to do the next time they sign in." } };
    }
    const { error: logErr } = await admin.from("admin_access_log").insert({ founder_id: founderId, participant_id: twin.user_id, twin_id: twin.id, action: "open_twin", reason: reason?.slice(0, 500) ?? null }) as unknown as { error: { message: string } | null };
    if (logErr) return { status: 500, body: { error: "The access could not be logged, so the twin was not opened." } };
  }
  const folder = `${twin.user_id}/field-twins/${twin.storage_key}`;
  const { data: listed, error } = await admin.storage.from("orthos").list(folder, { limit: 1000 });
  if (error) return { status: 500, body: { error: "The twin's files could not be listed." } };
  const files: Record<string, string> = {};
  for (const o of listed ?? []) {
    if (!/^(twin\.json(\.gz)?|atlas-\d+\.jpg)$/.test(o.name)) continue;
    const { data: s } = await admin.storage.from("orthos").createSignedUrl(`${folder}/${o.name}`, 600);
    if (s?.signedUrl) files[o.name] = s.signedUrl;
  }
  if (!files["twin.json.gz"] && !files["twin.json"]) return { status: 409, body: { error: "This twin did not finish saving." } };
  return { status: 200, body: { twin: { id: twin.id, name: twin.name, user_id: twin.user_id }, files } };
}
