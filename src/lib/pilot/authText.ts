// Plain-language sign-in messages, shared by the sign-in page and the page invitation and reset links land on.

/** An error Supabase put on the way back from Google or an email link, in plain words; null when there is none. */
export function returnedAuthError(search: string, hash: string): string | null {
  const params = new URLSearchParams(search);
  for (const [k, v] of new URLSearchParams(hash.replace(/^#/, ""))) params.set(k, v);
  const code = params.get("error_code") ?? "";
  const description = params.get("error_description") ?? params.get("error") ?? "";
  if (!code && !description) return null;
  if (/signup|not allowed|user not found/i.test(`${code} ${description}`)) {
    return "That account is not invited to the pilot. Sign in with the address your invitation was sent to.";
  }
  if (/expired|otp_expired|invalid/i.test(`${code} ${description}`)) {
    return "That link has expired or was already used. Ask for a new one below.";
  }
  return description || "Sign-in did not complete. Try again.";
}

export const MIN_PASSWORD = 8;

/** Why a chosen password cannot be used, or null. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password !== confirm) return "The two passwords are not the same.";
  return null;
}
