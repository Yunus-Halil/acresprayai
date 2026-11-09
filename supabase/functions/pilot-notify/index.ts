// Tell the founder that a participant sent feedback. The message is already stored (pilot_feedback, written by the
// participant's own session); this only emails it on, once. Called by the app right after the insert.
//
// POST { feedback_id } -> { notified: boolean }
// The caller must be an active pilot member and the row must be theirs. Nothing about other rows is revealed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { pilotRole } from "../_shared/access.ts";
import { sendEmail } from "../_shared/email.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const KIND: Record<string, string> = { problem: "Problem", idea: "Idea", finding: "A finding looks wrong", other: "Feedback" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: ud } = await caller.auth.getUser();
  if (!ud?.user) return json({ error: "Unauthorized" }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await pilotRole(admin, ud.user.id))) return json({ error: "Not available" }, 403);

  let id = "";
  try { id = String((await req.json()).feedback_id ?? ""); } catch { /* below */ }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "feedback_id required" }, 400);

  const { data: row } = await admin.from("pilot_feedback").select("id, user_id, kind, message, route, twin_id, context, created_at, notified_at").eq("id", id).maybeSingle();
  const fb = row as { id: string; user_id: string; kind: string; message: string; route: string | null; twin_id: string | null; context: Record<string, unknown> | null; created_at: string; notified_at: string | null } | null;
  if (!fb || fb.user_id !== ud.user.id) return json({ error: "Not found" }, 404);
  if (fb.notified_at) return json({ notified: true });

  const { data: member } = await admin.from("pilot_members").select("display_name, organisation, email").eq("user_id", ud.user.id).maybeSingle();
  const m = member as { display_name: string | null; organisation: string | null; email: string | null } | null;
  const who = [m?.display_name, m?.organisation].filter(Boolean).join(", ") || ud.user.email || "A participant";
  const ctx = fb.context ? Object.entries(fb.context).map(([k, v]) => `  ${k}: ${String(v).slice(0, 300)}`).join("\n") : "";

  const sent = await sendEmail({
    to: Deno.env.get("PILOT_NOTIFY_TO") ?? "yunus@swardus.com",
    subject: `Pilot feedback: ${KIND[fb.kind] ?? "Feedback"} from ${who}`,
    text: [
      `${who} (${ud.user.email ?? "no email"}) wrote:`, "", fb.message, "",
      `Page: ${fb.route ?? "unknown"}`, fb.twin_id ? `Field Twin: ${fb.twin_id}` : "", ctx ? `Context:\n${ctx}` : "", "",
      "Reply to this email to answer them. The message is also on the pilot desk.",
    ].filter(l => l !== "").join("\n"),
    replyTo: ud.user.email ?? undefined,
  });
  if (sent.sent) await admin.from("pilot_feedback").update({ notified_at: new Date().toISOString() }).eq("id", fb.id);
  return json({ notified: sent.sent });
});
