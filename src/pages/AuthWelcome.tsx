// Where an invitation link and a password-reset link land. Supabase signs the person in from the link itself
// (the tokens in the URL), so by the time this page has a session the only thing left is a password for next time.
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase, urlSessionRefused } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Wordmark } from "@/components/landing/Wordmark";
import Seo from "@/components/Seo";
import { MIN_PASSWORD, passwordProblem, returnedAuthError } from "@/lib/pilot/authText";

// Read once, as early as possible: the Supabase client clears the link's tokens from the address bar once it has
// used them, and what kind of link it was ("invite" or "recovery") travels with them.
const ARRIVAL = typeof window !== "undefined" ? { search: window.location.search, hash: window.location.hash } : { search: "", hash: "" };
const linkType = new URLSearchParams(ARRIVAL.hash.replace(/^#/, "")).get("type") ?? new URLSearchParams(ARRIVAL.search).get("type");

export default function AuthWelcome() {
  const nav = useNavigate();
  const { session, loading } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const linkError = returnedAuthError(ARRIVAL.search, ARRIVAL.hash);
  const recovery = linkType === "recovery";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = passwordProblem(password, confirm);
    setProblem(p);
    if (p) return;
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setProblem(/same.*password|different from the old/i.test(error.message) ? "Choose a password you have not used here before." : /weak|pwned|leaked/i.test(error.message) ? "That password is too easy to guess. Choose another." : "We could not save the password. Try again.");
        return;
      }
      toast.success(recovery ? "Password changed" : "You are all set");
      nav("/app", { replace: true });
    } finally {
      setSaving(false);
    }
  };

  let body: React.ReactNode;
  if (urlSessionRefused() && session) {
    // The link carried a sign-in, but this browser was already signed in: it was not used (a link must never swap
    // the account someone is working in).
    body = (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p role="alert">You are already signed in as <span className="font-medium text-foreground">{session.user.email}</span>, so this link was not used.</p>
        <p>If the link is for another account, sign out, then open the link again.</p>
        <div className="flex gap-2"><Button onClick={() => void supabase.auth.signOut()}>Sign out</Button><Button asChild variant="outline"><Link to="/app">Continue as {session.user.email}</Link></Button></div>
      </div>
    );
  } else if (loading) {
    body = <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
  } else if (!session) {
    body = (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p role="alert">{linkError ?? "This link has expired or was already used."}</p>
        <p>Ask for a new invitation by replying to the email it came in, or reset your password from the sign-in page.</p>
        <Button asChild variant="outline"><Link to="/auth">Go to sign in</Link></Button>
      </div>
    );
  } else {
    body = (
      <form onSubmit={save} className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{session.user.email}</span>. {recovery ? "Choose a new password." : "Choose a password, so you can sign in again from any computer."}
        </p>
        <div><Label htmlFor="welcome-password">Password</Label><Input id="welcome-password" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={MIN_PASSWORD} /></div>
        <div><Label htmlFor="welcome-confirm">The same password again</Label><Input id="welcome-confirm" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={MIN_PASSWORD} /></div>
        {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
        <Button type="submit" className="w-full" disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Save and continue</Button>
        {!recovery && <p className="text-xs text-muted-foreground">Prefer not to? <Link to="/app" className="underline underline-offset-4">Continue without a password</Link>: next time, sign in with an emailed link or with Google if this is a Google address.</p>}
      </form>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Seo title="Welcome, Swardus" noindex />
      <Card className="w-full max-w-md space-y-5 p-8">
        <Link to="/" className="inline-flex" aria-label="Swardus, home"><Wordmark tone="ink" /></Link>
        <h1 className="font-display text-2xl">{recovery ? "Choose a new password" : "Welcome to the Swardus pilot"}</h1>
        {body}
      </Card>
    </div>
  );
}
