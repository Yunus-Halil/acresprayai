// Public endpoint behind the pilot application form.
//
// The form posts here rather than inserting straight into PostgREST, because
// the notification email has to happen on every submission and a client-side
// insert cannot be trusted to trigger one. Doing both here means there is a
// single path from "farmer pressed submit" to "Yunus has an email", and it is
// in the repository rather than in dashboard webhook configuration.
//
// verify_jwt = false in supabase/config.toml: applicants are not signed in.
// This function is the only way an application is written: the table takes no
// insert from the browser (migration 20261111120000), so every row was
// validated here, is dated by the database, and counts towards the limits below.
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
    `New closed-testing access request\n\n` +
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

/**
 * What the address on the form gets. The same words for everyone: nothing the form's sender typed is in it, because
 * the address is whatever they typed and may be someone else's. No name, no farm, no link beyond Swardus's own.
 */
export const CONFIRMATION_SUBJECT = "Swardus: we have your access request";
export const CONFIRMATION_TEXT =
  `Hello,\n\n` +
  `We received a request for a place in the Swardus founding pilot that gave this email address.\n\n` +
  `The pilot is with a small number of invited people and places open as they come up. ` +
  `We read every request and will be in touch when there is a place, or sooner if we have a question.\n\n` +
  `If you did not make this request, you can ignore this message: nothing else will be sent to you.\n\n` +
  `Swardus\n` +
  `https://www.swardus.com`;

/** Above this many applications in an hour, they are still stored but nothing is emailed. */
export const HOURLY_EMAIL_LIMIT = 30;
/** Above this many in a day, the form takes no more until the day has passed (a real pilot sees a handful). */
export const DAILY_APPLICATION_LIMIT = 200;

/** How many applications arrived since `sinceMs` (and not after now: a row cannot count from the future), optionally from one address. */
async function arrivedSince(sinceMs: number, email?: string): Promise<number> {
  let q = admin.from("pilot_applications").select("id").gte("created_at", new Date(sinceMs).toISOString()).lte("created_at", new Date(Date.now() + 60_000).toISOString());
  if (email) q = q.eq("email", email);
  const { data } = await q.limit(DAILY_APPLICATION_LIMIT + 50);
  return (data ?? []).length;
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

  // The form is public and writes a row for whoever fills it in, so there is a ceiling on a day's rows: a script
  // cannot bury the real applications under thousands of its own.
  const dayAgo = Date.now() - 86_400_000, hourAgo = Date.now() - 3_600_000;
  if (await arrivedSince(dayAgo) >= DAILY_APPLICATION_LIMIT) {
    console.error(`[pilot-apply] over ${DAILY_APPLICATION_LIMIT} applications in a day; refused`);
    return json({ error: "We cannot take more requests right now. Please try again tomorrow, or write to yunus@swardus.com." }, 429);
  }

  const { data, error } = await admin
    .from("pilot_applications")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    console.error(`[pilot-apply] insert failed: ${error.message}`);
    return json({ error: "Could not save your application. Please try again." }, 500);
  }

  // Limits on the mail this public form sends, counted AFTER this row is down so that requests arriving together
  // count each other: above 30 applications an hour everything is still stored and nothing is emailed, and an
  // address gets one confirmation a day. A real applicant is never refused over mail; a script cannot use Swardus
  // to send it.
  const flooded = await arrivedSince(hourAgo) > HOURLY_EMAIL_LIMIT;
  const repeat = !!row.email && await arrivedSince(dayAgo, String(row.email)) > 1;

  // Notify after the row is safely down, and never let a mail failure turn a
  // saved application into an error the applicant sees.
  if (flooded) {
    console.error(`[pilot-apply] saved ${data?.id}; over ${HOURLY_EMAIL_LIMIT} applications this hour, no email sent`);
    return json({ ok: true, id: data?.id, notified: false });
  }
  const to = Deno.env.get("PILOT_NOTIFY_TO") ?? "yunus@swardus.com";
  const result = await sendEmail({
    to,
    subject: `Access request: ${row.farm_name} (${row.location})`.replace(/[\r\n]+/g, " ").slice(0, 200),
    text: notification(row),
  });
  if (!result.sent) {
    console.error(`[pilot-apply] saved ${data?.id} but notification not sent: ${result.reason}`);
  }

  // The applicant hears back at once, so "we will be in touch" on the form is
  // backed by something in their inbox. Best-effort like the notification: a
  // failed confirmation never fails the saved application.
  if (row.email && !repeat) {
    const ack = await sendEmail({
      to: row.email,
      subject: CONFIRMATION_SUBJECT,
      text: CONFIRMATION_TEXT,
    });
    if (!ack.sent) {
      console.error(`[pilot-apply] saved ${data?.id} but confirmation not sent: ${ack.reason}`);
    }
  }

  return json({ ok: true, id: data?.id, notified: result.sent });
});
