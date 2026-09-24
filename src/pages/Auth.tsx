import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Leaf, Loader2 } from "lucide-react";
import Seo from "@/components/Seo";

/**
 * Sign in only.
 *
 * SwathWise is in closed testing. The sign-up mode this page used to carry
 * created an account for anyone with an email address, which is the opposite
 * of closed. Testers already have accounts and need this door; everyone else
 * is sent to the access request, which a person reads.
 *
 * WHAT THIS PAGE CANNOT DO ON ITS OWN: the Google button and the auth API still
 * create a user the first time an unknown address signs in, because Supabase
 * does that unless "Allow new users to sign up" is switched off in the
 * project's Auth settings. That switch lives in the dashboard, not in this
 * repository. Until it is off, removing the form here closes the front door
 * and leaves the side one on the latch.
 */
export default function Auth() {
  const nav = useNavigate();
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (session) nav("/app", { replace: true }); }, [session, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err) {
      // Map the raw Supabase strings an operator actually meets to plain
      // language; anything unmapped keeps its detail as the description.
      const raw = String((err as { message?: string } | null)?.message ?? "");
      if (/invalid login credentials/i.test(raw)) {
        toast.error("That email and password didn't match", {
          description: "Check both and try again. If you don't have an account yet, request access below.",
        });
      } else if (/email not confirmed/i.test(raw)) {
        toast.error("Confirm your email first", {
          description: "Open the confirmation link we sent you, then sign in here.",
        });
      } else if (/failed to fetch|network/i.test(raw)) {
        toast.error("You appear to be offline", {
          description: "Nothing was sent. Check your connection and try again.",
        });
      } else {
        toast.error("Couldn't sign you in", { description: raw || "Something went wrong. Try again." });
      }
    } finally {
      setLoading(false);
    }
  };

  // Native Supabase OAuth. This redirects the browser, so `error` only fires if
  // the redirect could not be started at all.
  const google = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/app` },
    });
    if (error) toast.error(error.message ?? "Google sign-in failed");
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <Seo title="Sign in, SwathWise" noindex />
      <div className="hidden lg:flex relative bg-[hsl(var(--field))] grid-bg-dark overflow-hidden">
        <div className="relative z-10 p-12 flex flex-col justify-between text-[hsl(var(--primary-foreground))]">
          <Link to="/" className="flex items-center gap-2 font-display text-xl">
            <Leaf className="h-5 w-5 text-[hsl(var(--accent))]" /> SwathWise
          </Link>
          <div className="space-y-4 max-w-md">
            <h1 className="font-display text-4xl leading-tight">Every weed on your farm. Found from the air.</h1>
            {/* Keep in step with the landing page: it finds what departs from
                the field and plans the flight that treats it. No savings
                figure, no species from pixels. */}
            <p className="opacity-80">Fly any drone over any field. See every plant that does not match your crop, then spray only those.</p>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md p-8 space-y-6">
          <div>
            <h2 className="font-display text-2xl">Welcome back</h2>
            <p className="text-sm text-muted-foreground">Sign in to your SwathWise cockpit.</p>
          </div>

          <Button type="button" variant="outline" className="w-full" onClick={google}>
            <svg className="h-4 w-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
            Continue with Google
          </Button>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div><Label>Email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
            <div><Label>Password</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} /></div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Sign in
            </Button>
          </form>

          <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            <div className="font-medium text-foreground">SwathWise is in closed testing.</div>
            <p className="mt-1">
              New accounts are by invitation. If you farm, spray, or scout and want in,{" "}
              <Link to="/apply" className="text-foreground underline underline-offset-4">request access</Link>{" "}
              and we will be in touch when a place opens.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
