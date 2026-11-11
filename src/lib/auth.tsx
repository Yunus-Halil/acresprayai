import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * What this browser kept of one account must not be there for the next: the offline copies of database answers
 * (the service worker's cache, vite.config.ts) are dropped whenever the signed-in account changes or signs out.
 */
export async function dropAccountCaches(): Promise<void> {
  try { if (typeof caches !== "undefined") await caches.delete("supabase-rest"); } catch { /* no cache storage: nothing kept */ }
}

type Ctx = { user: User | null; session: Session | null; loading: boolean; signOut: () => Promise<void> };
const AuthCtx = createContext<Ctx>({ user: null, session: null, loading: true, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // undefined until the first session is known (a page load as the same account keeps its offline copies).
  const account = useRef<string | null | undefined>(undefined);
  const seen = (s: Session | null) => {
    const id = s?.user?.id ?? null;
    if (account.current !== undefined && account.current !== id) void dropAccountCaches();
    account.current = id;
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      seen(s);
      setSession(s);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      seen(data.session);
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <AuthCtx.Provider value={{
      user: session?.user ?? null,
      session,
      loading,
      signOut: async () => { await supabase.auth.signOut(); },
    }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);