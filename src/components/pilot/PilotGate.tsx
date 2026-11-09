// What a signed-in person sees before the app, decided by their pilot membership (lib/pilot/access).
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { usePilot, usePilotRole } from "@/lib/pilot/access";
import { CONTACT_EMAIL } from "@/components/landing/copy";

function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm">
        <h1 className="font-display text-2xl">{title}</h1>
        <div className="mt-3 space-y-3 text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

/** Renders the app only for an active pilot member; otherwise the screen that explains why not. */
export function PilotGate({ children }: { children: ReactNode }) {
  const { access, reload } = usePilot();
  const { user, signOut } = useAuth();

  if (access.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center" aria-busy="true">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }
  if (access.status === "error") {
    return (
      <Screen title="We could not open Swardus">
        <p>{access.message}</p>
        <div className="flex gap-2 pt-2">
          <Button onClick={reload}>Try again</Button>
          <Button variant="outline" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </Screen>
    );
  }
  if (access.status === "outside") {
    return (
      <Screen title="This account is not in the pilot">
        <p>You are signed in as <span className="font-medium text-foreground">{user?.email}</span>, but this account is not part of the Swardus founding pilot.</p>
        <p>If you were invited, sign out and sign in with the address the invitation was sent to. Otherwise you can request a place, or write to <a className="text-foreground underline underline-offset-4" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="outline" onClick={() => void signOut()}>Sign out</Button>
          <Button asChild variant="ghost"><a href="/apply">Request a place</a></Button>
        </div>
      </Screen>
    );
  }
  return <>{children}</>;
}

/** A route only the founder sees. Everyone else (including the founder previewing as a participant) goes home. */
export function FounderOnly({ children }: { children: ReactNode }) {
  const role = usePilotRole();
  if (role !== "founder") return <Navigate to="/app" replace />;
  return <>{children}</>;
}
