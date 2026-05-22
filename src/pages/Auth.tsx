import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Leaf, Loader2 } from "lucide-react";

export default function Auth() {
  const nav = useNavigate();
  const { session } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [farmName, setFarmName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (session) nav("/app", { replace: true }); }, [session, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: `${window.location.origin}/app`,
            data: { full_name: fullName, farm_name: farmName },
          },
        });
        if (error) throw error;
        toast.success("Check your email to confirm your account.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      toast.error(err.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const google = async () => {
    const res = await lovable.auth.signInWithOAuth("google", { redirect_uri: `${window.location.origin}/app` });
    if (res.error) toast.error("Google sign-in failed");
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="hidden lg:flex relative bg-[hsl(var(--field))] grid-bg-dark overflow-hidden">
        <div className="relative z-10 p-12 flex flex-col justify-between text-[hsl(var(--primary-foreground))]">
          <Link to="/" className="flex items-center gap-2 font-display text-xl">
            <Leaf className="h-5 w-5 text-[hsl(var(--accent))]" /> Acre Flight AI
          </Link>
          <div className="space-y-4 max-w-md">
            <h1 className="font-display text-4xl leading-tight">Precision spraying, powered by AI.</h1>
            <p className="opacity-80">Cut chemical use by 30%. Catch pests 7 days earlier. Run your fields like a quant fund runs a portfolio.</p>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md p-8 space-y-6">
          <div>
            <h2 className="font-display text-2xl">{mode === "signin" ? "Welcome back" : "Start your trial"}</h2>
            <p className="text-sm text-muted-foreground">{mode === "signin" ? "Sign in to your Acre Flight AI cockpit." : "Create an account to monitor your first field."}</p>
          </div>

          <Button type="button" variant="outline" className="w-full" onClick={google}>
            <svg className="h-4 w-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
            Continue with Google
          </Button>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === "signup" && (
              <>
                <div><Label>Full name</Label><Input value={fullName} onChange={e => setFullName(e.target.value)} required /></div>
                <div><Label>Farm name</Label><Input value={farmName} onChange={e => setFarmName(e.target.value)} required /></div>
              </>
            )}
            <div><Label>Email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
            <div><Label>Password</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} /></div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <p className="text-sm text-center text-muted-foreground">
            {mode === "signin" ? "No account? " : "Already have one? "}
            <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="text-foreground underline">
              {mode === "signin" ? "Sign up" : "Sign in"}
            </button>
          </p>
        </Card>
      </div>
    </div>
  );
}