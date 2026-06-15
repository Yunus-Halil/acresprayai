import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const CTA = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    const { error } = await supabase.from("pilot_signups").insert({ email });
    setLoading(false);
    if (error) {
      toast.error("Couldn't submit. Try again.");
      return;
    }
    toast.success("You're on the list. We'll be in touch.");
    setEmail("");
  };

  return (
    <section id="contact" className="py-24 md:py-32 bg-primary text-primary-foreground relative overflow-hidden">
      <div className="absolute inset-0 grid-bg-dark opacity-40" />
      <div className="container relative">
        <div className="max-w-4xl">
          <div className="font-mono text-xs uppercase tracking-widest text-accent">
            ↳ Pilot program · Spring–Fall 2026
          </div>
          <h2 className="mt-6 font-display text-5xl md:text-7xl font-semibold leading-[0.95] text-balance">
            Bring AcreSpray AI to your field.
          </h2>
          <p className="mt-8 text-xl text-primary-foreground/70 max-w-2xl">
            We’re onboarding 3 farms for a closed pilot. Free analysis on your first
            100 acres. We share the savings 50/50 — you keep all the yield.
          </p>

          <form
            onSubmit={submit}
            className="mt-12 flex flex-col sm:flex-row gap-3 max-w-xl"
          >
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourfarm.com"
              className="flex-1 bg-primary-foreground/10 border border-primary-foreground/20 rounded-full px-6 py-4 text-primary-foreground placeholder:text-primary-foreground/40 focus:outline-none focus:border-accent transition-colors"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-full bg-accent px-6 py-4 text-accent-foreground font-medium hover:shadow-glow transition-all"
            >
              {loading ? "Submitting…" : "Apply for pilot →"}
            </button>
          </form>

          <div className="mt-10 flex flex-wrap gap-x-10 gap-y-4 font-mono text-xs uppercase tracking-widest text-primary-foreground/50">
            <span>● No upfront hardware cost</span>
            <span>● 30-day cancel anytime</span>
            <span>● Data stays yours</span>
          </div>
        </div>
      </div>
    </section>
  );
};
