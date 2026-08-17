// Public endpoint behind the pilot application form.
//
// The form posts here rather than inserting straight into PostgREST, because
// the notification email has to happen on every submission and a client-side
// insert cannot be trusted to trigger one. Doing both here means there is a
// single path from "farmer pressed submit" to "Yunus has an email", and it is
// in the repository rather than in dashboard webhook configuration.
//
// verify_jwt = false in supabase/config.toml: applicants are not signed in.
// The RLS insert policy on pilot_applications still constrains what can land in
// the table, so a direct PostgREST insert is a valid but unnotified path.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/email.ts";
import { normalise, validate } from "../_shared/pilotApplication.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Plain text, because this is read on a phone and never needs to be pretty. */
function notification(row: Record<string, string | null>): string {
  const line = (label: string, value: string | null) => (value ? `${label}: ${value}\n` : "");
  return (
    `New pilot application\n\n` +
    line("Name", row.full_name) +
    line("Email", row.email) +
    line("Phone", row.phone) +
    line("Farm", row.farm_name) +
    line("Role", row.role) +
    `\n` +
    line("Location", row.location) +
    line("Acreage", row.acreage_range) +
    line("Crops", row.crops) +
    line("Boundary or GPS survey", row.has_boundary_survey) +
    `\n` +
    line("Drone", row.drone_status) +
    line("Spray drone model", row.drone_model) +
    line("Available", row.availability) +
    `\n` +
    line("Heard about us via", row.referral_source) +
    line("Notes", row.notes)
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: Record<string, string>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Expected a JSON body" }, 400);
  }

  // The same validator the form runs. The client's copy is for responsiveness;
  // this one is the authority.
  const errors = validate(payload ?? {});
  if (Object.keys(errors).length) return json({ error: "Validation failed", errors }, 422);

  const row = normalise(payload);

  const { data, error } = await admin
    .from("pilot_applications")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    console.error(`[pilot-apply] insert failed: ${error.message}`);
    return json({ error: "Could not save your application. Please try again." }, 500);
  }

  // Notify after the row is safely down, and never let a mail failure turn a
  // saved application into an error the applicant sees.
  const to = Deno.env.get("PILOT_NOTIFY_TO") ?? "yunus@swathwise.com";
  const result = await sendEmail({
    to,
    subject: `Pilot application: ${row.farm_name} (${row.location})`,
    text: notification(row),
  });
  if (!result.sent) {
    console.error(`[pilot-apply] saved ${data?.id} but notification not sent: ${result.reason}`);
  }

  return json({ ok: true, id: data?.id, notified: result.sent });
});
