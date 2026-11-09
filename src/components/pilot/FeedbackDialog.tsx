// Feedback & Support: one dialog, opened from the menu, from any error screen, and beside a finding. It records
// what the person wrote, the page and twin it came from, and the app's version and last error, then tells the
// founder by email (pilot-notify). The message is stored first, so a failed email never loses it.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { FN_BASE } from "@/components/app/workspace/constants";
import { CONTACT_EMAIL } from "@/components/landing/copy";
import { scrub, track } from "@/lib/pilot/telemetry";
import { lastClientError } from "@/lib/pilot/errorCapture";

export type FeedbackKind = "problem" | "idea" | "finding" | "other";
const KINDS: [FeedbackKind, string][] = [["problem", "Something went wrong"], ["finding", "A finding looks wrong"], ["idea", "An idea or request"], ["other", "Something else"]];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Request = { kind: FeedbackKind; twinId: string | null; context: Record<string, string | number | boolean | null> } | null;
let current: Request = null;
const listeners = new Set<() => void>();
const setRequest = (r: Request) => { current = r; for (const l of listeners) l(); };

/** Open the feedback dialog from anywhere. */
export function openFeedback(kind: FeedbackKind = "problem", twinId: string | null = null, context: Record<string, string | number | boolean | null> = {}) {
  setRequest({ kind, twinId: twinId && UUID.test(twinId) ? twinId : null, context });
}

export function FeedbackButton({ kind = "problem", twinId = null, context = {}, label = "Send feedback", variant = "outline" }: { kind?: FeedbackKind; twinId?: string | null; context?: Record<string, string | number | boolean | null>; label?: string; variant?: "outline" | "ghost" | "default" }) {
  return <Button type="button" variant={variant} onClick={() => openFeedback(kind, twinId, context)}><MessageSquare className="h-4 w-4" />{label}</Button>;
}

async function notify(id: string) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch(`${FN_BASE}/pilot-notify`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ feedback_id: id }) });
  } catch { /* the message is stored; the founder sees it on the pilot desk */ }
}

/** Rendered once, in the app shell. */
export function FeedbackHost() {
  const req = useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => current, () => current);
  const location = useLocation();
  const [kind, setKind] = useState<FeedbackKind>("problem");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => { if (req) { setKind(req.kind); setMessage(""); } }, [req]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!req || !message.trim()) return;
    setSending(true);
    const err = lastClientError();
    const context = {
      ...req.context,
      app_version: typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "dev",
      browser: navigator.userAgent.slice(0, 200),
      screen: `${window.innerWidth}x${window.innerHeight}`,
      ...(err ? { last_error: scrub(err.message, 300), last_error_at: err.at } : {}),
    };
    try {
      const { data, error } = await supabase.from("pilot_feedback").insert({
        kind, message: message.trim().slice(0, 5000), route: location.pathname.slice(0, 200), twin_id: req.twinId, context,
      } as never).select("id").single();
      if (error || !data) throw new Error(error?.message ?? "not stored");
      void notify((data as { id: string }).id);
      track("feedback_sent", { twinId: req.twinId, detail: { kind } });
      toast.success("Thank you. Your message was sent.", { description: "Yunus reads every one and will reply by email." });
      setRequest(null);
    } catch {
      toast.error("Your message was not sent", { description: `Check your connection and try again, or write to ${CONTACT_EMAIL}.` });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={!!req} onOpenChange={o => { if (!o && !sending) setRequest(null); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Feedback & support</DialogTitle>
          <DialogDescription>Tell us what happened or what you would like. It goes straight to Yunus, with the page you are on{req?.twinId ? " and this Field Twin" : ""}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={send} className="space-y-4">
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="sr-only">What is it about</legend>
            {KINDS.map(([v, label]) => (
              <label key={v} className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${kind === v ? "border-foreground bg-muted/40" : ""}`}>
                <input type="radio" name="feedback-kind" checked={kind === v} onChange={() => setKind(v)} />{label}
              </label>
            ))}
          </fieldset>
          <div>
            <Label htmlFor="feedback-message">Your message</Label>
            <Textarea id="feedback-message" rows={6} value={message} onChange={e => setMessage(e.target.value)} maxLength={5000} required
              placeholder={kind === "finding" ? "Which finding, and what is it really? (For example: the three red patches by the gate are volunteer corn, not weeds.)" : kind === "problem" ? "What were you doing, and what happened?" : ""} />
          </div>
          <p className="text-xs text-muted-foreground">Sent with it: the page, the app version{req?.twinId ? ", the Field Twin's id" : ""} and your browser. Not your photographs.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setRequest(null)} disabled={sending}>Cancel</Button>
            <Button type="submit" disabled={sending || !message.trim()}>{sending && <Loader2 className="h-4 w-4 animate-spin" />}Send</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
