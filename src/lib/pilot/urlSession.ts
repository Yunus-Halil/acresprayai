// Whether a sign-in carried in the address bar (#access_token=...) may be taken. Without a guard, any page load with
// a session in the address replaces the current sign-in, so a link someone sends can silently sign the reader into
// the sender's account (and whatever they then build is saved there). A session is taken only on the pages sign-in
// links return to, and never over an existing sign-in. Used by integrations/supabase/client.ts.

/** Pages a sign-in link or the Google sign-in return to. */
export const SIGN_IN_RETURN_PATHS = new Set(["/auth", "/auth/welcome", "/app"]);

/** Set when a link carried a session but this browser was already signed in: the link was ignored. */
export const urlSession = { refused: false };

export function acceptSessionFromUrl(url: URL, hasSession: boolean): boolean {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (!SIGN_IN_RETURN_PATHS.has(path)) return false;
  if (hasSession) { urlSession.refused = true; return false; }
  return true;
}

/** Whether this browser already holds a Supabase session. */
export function storedSession(storage: Pick<Storage, "length" | "key" | "getItem"> = localStorage): boolean {
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i) ?? "";
      if (/^sb-.*-auth-token$/.test(k) && storage.getItem(k)) return true;
    }
  } catch { /* storage blocked: no stored session */ }
  return false;
}
