// Outbound transactional email, via Resend.
//
// Resend rather than Supabase's built-in SMTP: that sender is reserved for auth
// mail (confirmations, password resets) and is rate-limited accordingly, so
// borrowing it for notifications risks getting sign-up mail throttled.
//
// Email is best-effort by design. A pilot application that was written down but
// whose notification failed to send is a recoverable situation - the row is in
// the table and the admin view will show it. An application lost because Resend
// returned a 500 is not. Callers must not fail a write on `sendEmail` returning
// false.
import { fetchResilient } from "./net.ts";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type Email = { to: string; subject: string; text: string };

export type SendResult =
  | { sent: true }
  | { sent: false; reason: "unconfigured" | "rejected" | "unreachable"; detail?: string };

/**
 * Send a plain-text email. Never throws.
 *
 * With no RESEND_API_KEY set this reports "unconfigured" and logs the message,
 * so a deployment without the secret still records applications and leaves a
 * trace in the function logs rather than failing silently.
 */
export async function sendEmail({ to, subject, text }: Email): Promise<SendResult> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    console.warn(`[email] RESEND_API_KEY not set; would have sent to ${to}: ${subject}`);
    return { sent: false, reason: "unconfigured" };
  }

  // Resend's shared onboarding sender works without domain verification but can
  // only deliver to the Resend account's own address, which is exactly the case
  // here. Set PILOT_NOTIFY_FROM once swathwise.com is verified.
  const from = Deno.env.get("PILOT_NOTIFY_FROM") ?? "SwathWise <onboarding@resend.dev>";

  try {
    const res = await fetchResilient(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text }),
      label: "resend",
      attempts: 3,
      timeoutMs: 10_000,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[email] Resend ${res.status}: ${detail.slice(0, 500)}`);
      return { sent: false, reason: "rejected", detail: `${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.error(`[email] unreachable: ${(e as Error)?.message ?? e}`);
    return { sent: false, reason: "unreachable" };
  }
}
