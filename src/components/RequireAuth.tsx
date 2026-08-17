import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";

/**
 * Route guard: renders its children only for a signed-in user, and sends
 * everyone else to /auth.
 *
 * Extracted from AppLayout so the admin route is gated by the same code rather
 * than a second copy of the same three lines. Note what this does and does not
 * do - it proves someone is signed in, not that they are allowed to see any
 * particular data. Anything sensitive still has to authorise on the server;
 * `pilot-applications` checks an admin allowlist before it reads a row.
 */
export default function RequireAuth({ children }: { children?: React.ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate("/auth", { replace: true });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <>{children ?? <Outlet />}</>;
}
