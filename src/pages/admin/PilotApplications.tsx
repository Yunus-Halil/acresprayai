import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import Seo from "@/components/Seo";

const PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const FN_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;

export type Application = {
  id: string;
  created_at: string;
  full_name: string;
  email: string;
  phone: string | null;
  farm_name: string;
  role: string;
  location: string;
  acreage_range: string;
  crops: string;
  has_boundary_survey: string | null;
  drone_status: string;
  drone_model: string | null;
  availability: string;
  referral_source: string | null;
  notes: string | null;
};

type State =
  | { status: "loading" }
  | { status: "ready"; rows: Application[] }
  | { status: "denied" }
  | { status: "error"; message: string };

/**
 * The whole pilot pipeline, newest first.
 *
 * The route is behind RequireAuth, but that only proves someone is signed in.
 * The rows themselves come from the `pilot-applications` edge function, which
 * checks the caller against an admin allowlist server-side - so a signed-up
 * farmer who guesses this URL gets a 403, not a list of other farmers.
 */
export default function PilotApplications() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        if (!cancelled) setState({ status: "denied" });
        return;
      }

      try {
        const res = await fetch(`${FN_BASE}/pilot-applications`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (res.status === 401 || res.status === 403) return setState({ status: "denied" });
        if (!res.ok) return setState({ status: "error", message: body?.error ?? `Failed (${res.status})` });
        setState({ status: "ready", rows: body.applications ?? [] });
      } catch {
        if (!cancelled) setState({ status: "error", message: "Couldn't reach the server." });
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-background p-6 sm:p-10">
      <Seo title="Pilot applications — SwathWise" noindex />
      <header className="mb-8">
        <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Pilot programme
        </div>
        <h1 className="mt-1 font-display text-2xl font-semibold">Applications</h1>
      </header>

      {state.status === "loading" && (
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}

      {state.status === "denied" && (
        <p className="text-muted-foreground">
          This page is limited to the pilot programme admins.
        </p>
      )}

      {state.status === "error" && <p className="text-destructive">{state.message}</p>}

      {state.status === "ready" && (
        state.rows.length === 0 ? (
          <p className="text-muted-foreground">No applications yet.</p>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              {state.rows.length} {state.rows.length === 1 ? "application" : "applications"}
            </p>
            <div className="overflow-x-auto rounded border">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    {["Name", "Farm", "Location", "Acreage", "Drone", "Available", "Submitted"].map((h) => (
                      <th key={h} className="whitespace-nowrap px-4 py-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.rows.map((row) => (
                    <tr key={row.id} className="border-b last:border-0 align-top">
                      <td className="px-4 py-3">
                        <div>{row.full_name}</div>
                        <a href={`mailto:${row.email}`} className="text-xs text-muted-foreground hover:underline">
                          {row.email}
                        </a>
                      </td>
                      <td className="px-4 py-3">{row.farm_name}</td>
                      <td className="px-4 py-3">{row.location}</td>
                      <td className="whitespace-nowrap px-4 py-3">{row.acreage_range}</td>
                      <td className="px-4 py-3">
                        {row.drone_status}
                        {row.drone_model && (
                          <div className="text-xs text-muted-foreground">{row.drone_model}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">{row.availability}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {new Date(row.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}
    </div>
  );
}
