// The founder's pilot desk: who is in the pilot, inviting someone, pausing or ending access, and the applications.
//
// Founder only, checked here against public.pilot_members before anything is read (the service-role key below
// bypasses row security, so this check is the whole boundary).
//
// Invitations do not depend on Supabase's own mailer. The link is generated with the admin API
// (auth.admin.generateLink): an "invite" link for a new address, which creates the account, or a sign-in link for
// an address that already has one. The membership row is written in the same call. The link is then emailed
// through Resend (the same sender as the application notifications) AND returned to the founder's page, so it can
// be sent by hand when Resend is not configured or not yet allowed to deliver outside the founder's own address.
//
// POST { action: "members" }                                   -> { members: [...] }
// POST { action: "invite", email, name?, organisation?, application_id?, origin } -> { link, kind, emailed, member }
// POST { action: "set-status", user_id, status }               -> { member }
// POST { action: "applications" }                              -> { applications: [...] }
// POST { action: "activity" }                                  -> { people, builds, checks, errors, reviews, feedback } (no imagery, no paths)
// POST { action: "feedback-status", id, status }               -> { ok }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { pilotRole } from "../_shared/access.ts";
import { sendEmail } from "../_shared/email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUSES = new Set(["active", "paused", "ended"]);

/** Where an invitation may send people back to: the app's own origins. Anything else falls back to the first. */
function allowedOrigins(): string[] {
  const configured = (Deno.env.get("PILOT_SITE_ORIGINS") ?? "").split(",").map(s => s.trim().replace(/\/$/, "")).filter(Boolean);
  return configured.length ? configured : ["https://swathwise.com", "https://www.swathwise.com", "https://swardus.com", "https://www.swardus.com", "http://localhost:8080"];
}
function siteOrigin(requested: unknown): string {
  const list = allowedOrigins();
  const r = typeof requested === "string" ? requested.replace(/\/$/, "") : "";
  return list.includes(r) ? r : list[0];
}

type AuthUser = { id: string; email?: string | null; created_at?: string; last_sign_in_at?: string | null; email_confirmed_at?: string | null };
type AdminApi = {
  listUsers: (o: { page: number; perPage: number }) => Promise<{ data: { users: AuthUser[] } | null; error: { message: string } | null }>;
  generateLink: (o: { type: "invite" | "magiclink"; email: string; options?: { redirectTo?: string; data?: Record<string, unknown> } })
    => Promise<{ data: { user: AuthUser | null; properties: { action_link: string } | null } | null; error: { message: string } | null }>;
};

/** Every account, for a pilot-sized project (a handful of pages at most). */
async function allUsers(api: AdminApi): Promise<AuthUser[]> {
  const out: AuthUser[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await api.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const users = data?.users ?? [];
    out.push(...users);
    if (users.length < 1000) break;
  }
  return out;
}

function invitationText(name: string | null, link: string, kind: "invite" | "sign-in"): string {
  return [
    `Hello${name ? ` ${name}` : ""},`,
    "",
    kind === "invite"
      ? "You are invited to the Swardus founding pilot. Open this link to set up your account:"
      : "Your Swardus account is ready for the founding pilot. Open this link to sign in:",
    "",
    link,
    "",
    "The link works once. If it has expired, reply to this email and I will send a new one.",
    "",
    "What to have ready: the original photographs from one drone flight, straight from the drone's memory card (a DJI drone, camera pointing straight down), over a corn field or an orchard.",
    "",
    "Swardus",
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: ud } = await caller.auth.getUser();
  const me = ud?.user;
  if (!me) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  if ((await pilotRole(admin, me.id)) !== "founder") return json({ error: "Not authorized" }, 403);
  const api = (admin as unknown as { auth: { admin: AdminApi } }).auth.admin;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Body must be JSON" }, 400); }

  try {
    switch (body.action) {
      case "members": {
        const { data: rows, error } = await admin.from("pilot_members").select("*").order("created_at", { ascending: false });
        if (error) return json({ error: "Could not load members" }, 500);
        const users = new Map((await allUsers(api)).map(u => [u.id, u]));
        const members = ((rows ?? []) as Record<string, unknown>[]).map(m => {
          const u = users.get(String(m.user_id));
          return { ...m, account_email: u?.email ?? null, last_sign_in_at: u?.last_sign_in_at ?? null, account_created_at: u?.created_at ?? null };
        });
        // Accounts that exist but are not in the pilot: worth seeing, because they can sign in and see nothing.
        const memberIds = new Set(members.map(m => String(m.user_id)));
        const outsiders = [...users.values()].filter(u => !memberIds.has(u.id)).map(u => ({ user_id: u.id, email: u.email ?? null, created_at: u.created_at ?? null, last_sign_in_at: u.last_sign_in_at ?? null }));
        return json({ members, outsiders });
      }

      case "invite": {
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        if (!EMAIL.test(email) || email.length > 254) return json({ error: "Enter a valid email address." }, 400);
        const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : null;
        const organisation = typeof body.organisation === "string" && body.organisation.trim() ? body.organisation.trim().slice(0, 160) : null;
        const applicationId = typeof body.application_id === "string" && /^[0-9a-f-]{36}$/i.test(body.application_id) ? body.application_id : null;
        const redirectTo = `${siteOrigin(body.origin)}/auth/welcome`;

        const existing = (await allUsers(api)).find(u => (u.email ?? "").toLowerCase() === email) ?? null;
        const kind: "invite" | "sign-in" = existing ? "sign-in" : "invite";
        const { data: link, error: linkErr } = await api.generateLink(existing
          ? { type: "magiclink", email, options: { redirectTo } }
          : { type: "invite", email, options: { redirectTo, data: name ? { full_name: name } : {} } });
        const userId = existing?.id ?? link?.user?.id ?? null;
        const actionLink = link?.properties?.action_link ?? null;
        if (linkErr || !userId || !actionLink) {
          console.error(`[pilot-admin] generateLink failed: ${linkErr?.message ?? "no link"}`);
          return json({ error: "Could not create the invitation link." }, 502);
        }

        // Never demote: inviting an existing founder again keeps them founder.
        const { data: prior } = await admin.from("pilot_members").select("role").eq("user_id", userId).maybeSingle();
        const role = (prior as { role?: string } | null)?.role === "founder" ? "founder" : "participant";
        const row = {
          user_id: userId, role, status: "active", email, display_name: name, organisation,
          application_id: applicationId, invited_at: new Date().toISOString(), invited_by: me.id,
        };
        const write = prior
          ? await admin.from("pilot_members").update(row).eq("user_id", userId).select().maybeSingle()
          : await admin.from("pilot_members").insert(row).select().maybeSingle();
        if (write.error) return json({ error: "The link was made but the membership could not be saved. Try again." }, 500);

        const sent = await sendEmail({
          to: email,
          subject: kind === "invite" ? "Your invitation to the Swardus founding pilot" : "Your Swardus pilot sign-in link",
          text: invitationText(name, actionLink, kind),
          replyTo: Deno.env.get("PILOT_NOTIFY_TO") ?? undefined,
        });
        return json({ link: actionLink, kind, emailed: sent.sent, email_problem: sent.sent ? null : sent.reason, member: write.data });
      }

      case "set-status": {
        const userId = typeof body.user_id === "string" ? body.user_id : "";
        const status = typeof body.status === "string" ? body.status : "";
        if (!userId || !STATUSES.has(status)) return json({ error: "user_id and a status (active, paused, ended) are required" }, 400);
        // The founder cannot lock themselves out from this page.
        if (userId === me.id) return json({ error: "You cannot change your own access here." }, 400);
        const { data, error } = await admin.from("pilot_members").update({ status }).eq("user_id", userId).select().maybeSingle();
        if (error || !data) return json({ error: "No such member" }, 404);
        return json({ member: data });
      }

      case "activity": {
        // The founder's view of how the pilot goes. Operational facts only: names, counts, durations, outcomes, error
        // text, review verdicts and notes, feedback. No storage paths, no signed URLs, no boundaries or coordinates.
        const since = Date.now() - 90 * 86_400_000;
        const [ev, tw, rv, fb, mem] = await Promise.all([
          admin.from("app_events").select("user_id, name, at, duration_ms, outcome, error, counts, detail, twin_id").order("at", { ascending: false }).limit(5000),
          admin.from("field_twins").select("id, user_id, name, crop, status, photographs, created_at").order("created_at", { ascending: false }).limit(2000),
          admin.from("twin_reviews").select("user_id, twin_id, finding_kind, verdict, algorithm_status, note, updated_at").order("updated_at", { ascending: false }).limit(5000),
          admin.from("pilot_feedback").select("id, user_id, created_at, kind, message, route, twin_id, context, status").order("created_at", { ascending: false }).limit(200),
          admin.from("pilot_members").select("user_id, role, status, display_name, organisation, email"),
        ]);
        type Ev = { user_id: string; name: string; at: string; duration_ms: number | null; outcome: string | null; error: string | null; counts: Record<string, number> | null; detail: Record<string, unknown> | null; twin_id: string | null };
        const events = ((ev.data ?? []) as Ev[]).filter(e => Date.parse(e.at) >= since);
        const twins = (tw.data ?? []) as { id: string; user_id: string; name: string; crop: string | null; status: string; photographs: number | null; created_at: string }[];
        const reviews = (rv.data ?? []) as { user_id: string; twin_id: string; finding_kind: string; verdict: string; algorithm_status: string | null; note: string | null; updated_at: string }[];
        const members = (mem.data ?? []) as { user_id: string; role: string; status: string; display_name: string | null; organisation: string | null; email: string | null }[];
        const users = new Map((await allUsers(api)).map(u => [u.id, u]));
        const twinName = new Map(twins.map(t => [t.id, t.name]));
        const nameOf = (id: string) => { const m = members.find(x => x.user_id === id); return m?.display_name || m?.email || users.get(id)?.email || id; };
        const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };

        const people = members.map(m => {
          const mine = events.filter(e => e.user_id === m.user_id);
          const finished = mine.filter(e => e.name === "twin_build_finished");
          return {
            user_id: m.user_id, name: nameOf(m.user_id), organisation: m.organisation, role: m.role, status: m.status,
            last_sign_in_at: users.get(m.user_id)?.last_sign_in_at ?? null,
            last_active_at: mine[0]?.at ?? null,
            sessions: new Set(mine.filter(e => e.name === "session_start").map(e => e.at.slice(0, 10))).size,
            twins: twins.filter(t => t.user_id === m.user_id && t.status === "ready").length,
            twins_incomplete: twins.filter(t => t.user_id === m.user_id && t.status !== "ready").length,
            builds_ok: finished.length,
            builds_failed: mine.filter(e => e.name === "twin_build_failed").length,
            builds_cancelled: mine.filter(e => e.name === "twin_build_cancelled").length,
            saves_failed: mine.filter(e => e.name === "twin_save_failed").length,
            median_build_ms: median(finished.map(e => e.duration_ms ?? 0).filter(x => x > 0)),
            reviews: reviews.filter(r => r.user_id === m.user_id).length,
            errors: mine.filter(e => e.name === "client_error").length,
          };
        });

        const builds = events.filter(e => e.name.startsWith("twin_build_") && e.name !== "twin_build_started").slice(0, 100).map(e => ({
          at: e.at, who: nameOf(e.user_id), outcome: e.name.replace("twin_build_", ""), duration_ms: e.duration_ms,
          photographs: e.counts?.photographs ?? null, used: e.counts?.used ?? null, refused: e.counts?.refused ?? null,
          crop: (e.detail?.crop as string | undefined) ?? null, camera: (e.detail?.camera as string | undefined) ?? null,
          stage: (e.detail?.stage as string | undefined) ?? null, error: e.error,
        }));
        const checks = events.filter(e => e.name === "twin_check_done").slice(0, 100).map(e => ({ at: e.at, who: nameOf(e.user_id), ...e.counts, camera: (e.detail?.camera as string | undefined) ?? null }));
        const errors = events.filter(e => e.name === "client_error" || e.name === "twin_open_failed" || e.name === "twin_save_failed").slice(0, 50).map(e => ({ at: e.at, who: nameOf(e.user_id), name: e.name, error: e.error }));

        // Reviews: by kind, verdict against what Swardus said.
        const byKind: Record<string, Record<string, number>> = {};
        for (const r of reviews) {
          const k = `${r.finding_kind}${r.algorithm_status ? ` (${r.algorithm_status})` : ""}`;
          byKind[k] ??= { correct: 0, unsure: 0, wrong: 0 };
          byKind[k][r.verdict] = (byKind[k][r.verdict] ?? 0) + 1;
        }
        const notes = reviews.filter(r => r.note).slice(0, 100).map(r => ({ at: r.updated_at, who: nameOf(r.user_id), twin: twinName.get(r.twin_id) ?? r.twin_id, kind: r.finding_kind, status: r.algorithm_status, verdict: r.verdict, note: r.note }));

        const feedback = ((fb.data ?? []) as Record<string, unknown>[]).map(f => ({ ...f, who: nameOf(String(f.user_id)), twin: f.twin_id ? twinName.get(String(f.twin_id)) ?? null : null }));
        return json({ people, builds, checks, errors, reviews: { byKind, notes, total: reviews.length }, feedback });
      }

      case "feedback-status": {
        const id = typeof body.id === "string" ? body.id : "";
        const status = typeof body.status === "string" ? body.status : "";
        if (!/^[0-9a-f-]{36}$/i.test(id) || !["new", "seen", "done"].includes(status)) return json({ error: "id and a status (new, seen, done) are required" }, 400);
        const { error } = await admin.from("pilot_feedback").update({ status }).eq("id", id);
        if (error) return json({ error: "Not changed" }, 500);
        return json({ ok: true });
      }

      case "applications": {
        const { data, error } = await admin.from("pilot_applications").select("*").order("created_at", { ascending: false }).limit(500);
        if (error) return json({ error: "Could not load applications" }, 500);
        return json({ applications: data ?? [] });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    console.error(`[pilot-admin] ${(e as Error)?.message ?? e}`);
    return json({ error: "Something went wrong on the server." }, 500);
  }
});
