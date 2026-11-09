// The signed-in person's place in the pilot, as the database states it (public.pilot_members, migration
// 20261109120000). The database and the edge functions enforce it; this module only decides what the app shows.
//
//   founder      the whole application, as before the pilot, plus the founder pages
//   participant  the Field Twin pilot only
//   outside      signed in, but not (or no longer) in the pilot: the account can read nothing, so the app says so
//
// The founder can preview the participant experience ("preview as participant"). That changes what this browser
// shows and nothing else: the founder's server permissions are untouched.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { storageKey } from "@/lib/storage";

export type PilotRole = "founder" | "participant";

export type PilotAccess =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "outside" }
  | { status: "member"; serverRole: PilotRole; role: PilotRole; displayName: string | null };

type Ctx = {
  access: PilotAccess;
  /** The founder is looking at the participant experience. */
  preview: boolean;
  setPreview: (on: boolean) => void;
  reload: () => void;
};

const PREVIEW_KEY = storageKey("pilot-preview");
const readPreview = () => { try { return localStorage.getItem(PREVIEW_KEY) === "1"; } catch { return false; } };

const PilotCtx = createContext<Ctx>({ access: { status: "loading" }, preview: false, setPreview: () => {}, reload: () => {} });

/** Load the membership of `userId`. Exported for tests. */
export async function loadMembership(userId: string): Promise<PilotAccess> {
  const { data, error } = await supabase.from("pilot_members").select("role, status, display_name").eq("user_id", userId).maybeSingle();
  if (error) {
    // The table not existing yet means the database has not been updated for the pilot.
    if (/does not exist|PGRST205|42P01|schema cache/i.test(`${error.code ?? ""} ${error.message ?? ""}`)) {
      return { status: "error", message: "Swardus is being updated. Try again in a few minutes." };
    }
    return { status: "error", message: "We could not check your access. Check your connection and try again." };
  }
  if (!data || data.status !== "active" || (data.role !== "founder" && data.role !== "participant")) return { status: "outside" };
  const role = data.role as PilotRole;
  return { status: "member", serverRole: role, role, displayName: data.display_name ?? null };
}

export function PilotAccessProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [loaded, setLoaded] = useState<PilotAccess>({ status: "loading" });
  const [preview, setPreviewState] = useState(readPreview);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setLoaded({ status: "loading" });
    loadMembership(userId)
      .then(a => { if (live) setLoaded(a); })
      .catch(() => { if (live) setLoaded({ status: "error", message: "We could not check your access. Check your connection and try again." }); });
    return () => { live = false; };
  }, [userId, nonce]);

  const setPreview = useCallback((on: boolean) => {
    setPreviewState(on);
    try { if (on) localStorage.setItem(PREVIEW_KEY, "1"); else localStorage.removeItem(PREVIEW_KEY); } catch { /* private mode */ }
  }, []);

  const access = useMemo<PilotAccess>(() => {
    if (loaded.status !== "member") return loaded;
    return { ...loaded, role: loaded.serverRole === "founder" && preview ? "participant" : loaded.serverRole };
  }, [loaded, preview]);

  const value = useMemo(() => ({ access, preview: preview && loaded.status === "member" && loaded.serverRole === "founder", setPreview, reload: () => setNonce(n => n + 1) }), [access, preview, loaded, setPreview]);
  return <PilotCtx.Provider value={value}>{children}</PilotCtx.Provider>;
}

export const usePilot = () => useContext(PilotCtx);

/** The role the app should show right now (the founder's preview turns the founder into a participant here). */
export function usePilotRole(): PilotRole | null {
  const { access } = usePilot();
  return access.status === "member" ? access.role : null;
}

/** True only for the founder, and only when not previewing the participant experience. */
export function useIsFounder(): boolean {
  return usePilotRole() === "founder";
}
