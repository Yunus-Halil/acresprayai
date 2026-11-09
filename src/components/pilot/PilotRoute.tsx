// Signed in AND in the pilot: the wrapper every page of the app sits behind. RequireAuth sends a signed-out visitor
// to /auth; the access provider reads the membership; the gate explains anything that is not an active member.
import type { ReactNode } from "react";
import RequireAuth from "@/components/RequireAuth";
import { useAuth } from "@/lib/auth";
import { PilotAccessProvider, usePilot } from "@/lib/pilot/access";
import { PilotGate } from "./PilotGate";
import { ConsentGate } from "./ConsentScreen";

/** A participant agrees to the pilot terms (once per version) before the app; the founder is not asked. */
function Consent({ children }: { children: ReactNode }) {
  const { access } = usePilot();
  return <ConsentGate required={access.status === "member" && access.serverRole === "participant"}>{children}</ConsentGate>;
}

function WithAccess({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // RequireAuth renders this only once there is a user; keyed by it so a different sign-in starts fresh.
  return (
    <PilotAccessProvider key={user!.id} userId={user!.id}>
      <PilotGate><Consent>{children}</Consent></PilotGate>
    </PilotAccessProvider>
  );
}

export default function PilotRoute({ children }: { children: ReactNode }) {
  return <RequireAuth><WithAccess>{children}</WithAccess></RequireAuth>;
}
