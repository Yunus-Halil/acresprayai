// The founder pages' one door to the server: the pilot-admin edge function (founder-only, checked there).
import { supabase } from "@/integrations/supabase/client";
import { FN_BASE } from "@/components/app/workspace/constants";

export type PilotMember = {
  user_id: string;
  role: "founder" | "participant";
  status: "active" | "paused" | "ended";
  email: string | null;
  display_name: string | null;
  organisation: string | null;
  application_id: string | null;
  invited_at: string | null;
  created_at: string;
  account_email: string | null;
  last_sign_in_at: string | null;
};

export type Outsider = { user_id: string; email: string | null; created_at: string | null; last_sign_in_at: string | null };

export type InviteResult = { link: string; kind: "invite" | "sign-in"; emailed: boolean; email_problem: string | null };

export class AdminError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function pilotAdmin<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AdminError("Signed out", 401);
  let res: Response;
  try {
    res = await fetch(`${FN_BASE}/pilot-admin`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    throw new AdminError("Could not reach the server.", 0);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new AdminError((json as { error?: string }).error ?? `Failed (${res.status})`, res.status);
  return json as T;
}
