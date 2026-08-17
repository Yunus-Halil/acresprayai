// Admin read of the pilot application pipeline.
//
// pilot_applications has no readable SELECT policy for anyone, so this is the
// only way to get rows back out. That is deliberate: the table holds farmers'
// names, emails and phone numbers, and "any signed-in user" is the wrong
// audience for that - a farmer who signs up for the product would otherwise be
// able to enumerate every other applicant.
//
// So the service-role key is used, and per the rule in docs/architecture/auth.md
// every service-role read is preceded by an explicit authorisation check. Here
// that check is an allowlist of admin email addresses rather than a row-level
// ownership test, because these rows have no owner.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });

/** Comma-separated allowlist. Defaults to the one address the site publishes. */
function adminEmails(): string[] {
  const raw = Deno.env.get("PILOT_ADMIN_EMAILS") ?? "yunus@swathwise.com";
  return raw.split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  // Scoped to the caller, so this resolves who is asking and nothing more.
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: ud } = await caller.auth.getUser();
  const email = ud?.user?.email?.toLowerCase();
  if (!email) return json({ error: "Unauthorized" }, 401);

  // 403 rather than the uniform 404 used elsewhere: that 404 exists to stop a
  // caller probing which scan ids exist. There is no id here to probe, and a
  // signed-in user who is not an admin is better told so than left guessing.
  if (!adminEmails().includes(email)) return json({ error: "Not authorized" }, 403);

  const { data, error } = await admin
    .from("pilot_applications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error(`[pilot-applications] select failed: ${error.message}`);
    return json({ error: "Could not load applications" }, 500);
  }

  return json({ applications: data ?? [] });
});
