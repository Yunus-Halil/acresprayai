// Client side of the pilot application form.
//
// Submissions go through the `pilot-apply` edge function rather than straight
// into the table, because that function is what sends the notification email.
// A direct PostgREST insert would be accepted by RLS and then sit in the table
// unseen until someone thought to look.
const PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const FN_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;

export type SubmitResult = {
  ok: boolean;
  /** Set on success. */
  id?: string;
  /** Set on failure: what to tell the applicant. */
  message?: string;
  /** Set on failure: per-field complaints from the server-side validator. */
  errors?: Record<string, string>;
};

/** Post an application. Never throws; failures come back as `ok: false`. */
export async function submitApplication(values: Record<string, string>): Promise<SubmitResult> {
  try {
    const res = await fetch(`${FN_BASE}/pilot-apply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The function runs with verify_jwt = false, but the gateway still
        // wants a key and applicants have no session of their own.
        Authorization: `Bearer ${ANON_KEY}`,
        apikey: ANON_KEY,
      },
      body: JSON.stringify(values),
    });

    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, id: body?.id };

    // 422 carries per-field messages from the same validator the form runs, so
    // a field the client thought was fine can still be pointed at.
    if (res.status === 422 && body?.errors) {
      return { ok: false, message: "Please check the highlighted fields.", errors: body.errors };
    }
    return { ok: false, message: body?.error ?? `Something went wrong (${res.status}).` };
  } catch {
    return { ok: false, message: "Couldn't reach the server. Check your connection and try again." };
  }
}
