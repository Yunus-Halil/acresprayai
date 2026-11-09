// The founder's pilot desk: invite someone, see who is in the pilot and when they last signed in, pause or end
// access, and the applications waiting. Founder only; the pilot-admin function checks that again on every call.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import Seo from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type InviteResult, type Outsider, type PilotMember, pilotAdmin } from "@/lib/pilot/adminClient";
import type { Application } from "./PilotApplications";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "never");

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-xl">{title}</h2>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

type Draft = { email: string; name: string; organisation: string; applicationId: string | null };
const EMPTY: Draft = { email: "", name: "", organisation: "", applicationId: null };

function InviteForm({ draft, setDraft, onInvited }: { draft: Draft; setDraft: (d: Draft) => void; onInvited: () => void }) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<(InviteResult & { email: string }) | null>(null);
  const [copied, setCopied] = useState(false);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true); setResult(null); setCopied(false);
    try {
      const r = await pilotAdmin<InviteResult>("invite", {
        email: draft.email, name: draft.name, organisation: draft.organisation, application_id: draft.applicationId, origin: window.location.origin,
      });
      setResult({ ...r, email: draft.email });
      setDraft(EMPTY);
      onInvited();
    } catch (err) {
      toast.error("The invitation was not made", { description: (err as Error).message });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3">
      <form onSubmit={send} className="grid gap-3 rounded-md border p-4 sm:grid-cols-[2fr_1.4fr_1.4fr_auto] sm:items-end">
        <div><Label htmlFor="inv-email">Email</Label><Input id="inv-email" type="email" required value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} /></div>
        <div><Label htmlFor="inv-name">Name</Label><Input id="inv-name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></div>
        <div><Label htmlFor="inv-org">Organisation</Label><Input id="inv-org" value={draft.organisation} onChange={e => setDraft({ ...draft, organisation: e.target.value })} /></div>
        <Button type="submit" disabled={sending}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}Invite</Button>
      </form>
      {result && (
        <div role="status" className="space-y-2 rounded-md border bg-muted/40 p-4 text-sm">
          <p className="font-medium">
            {result.kind === "invite" ? "Invitation made" : "Sign-in link made (this address already had an account)"} for {result.email}.{" "}
            {result.emailed ? "It has been emailed." : "It was NOT emailed: send the link below yourself."}
          </p>
          {!result.emailed && result.email_problem === "unconfigured" && <p className="text-muted-foreground">Email is not set up on the server (RESEND_API_KEY).</p>}
          {!result.emailed && result.email_problem === "rejected" && <p className="text-muted-foreground">The email service refused it. Until the sending domain is verified it only delivers to your own address.</p>}
          <div className="flex items-center gap-2">
            <Input readOnly value={result.link} className="font-mono text-xs" onFocus={e => e.currentTarget.select()} aria-label="Invitation link" />
            <Button type="button" variant="outline" onClick={() => { void navigator.clipboard?.writeText(result.link).then(() => setCopied(true)); }}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">The link works once and expires (Supabase's email link lifetime). Make a new one here if it does.</p>
        </div>
      )}
    </div>
  );
}

export default function PilotDesk() {
  const [members, setMembers] = useState<PilotMember[] | null>(null);
  const [outsiders, setOutsiders] = useState<Outsider[]>([]);
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [m, a] = await Promise.all([
        pilotAdmin<{ members: PilotMember[]; outsiders: Outsider[] }>("members"),
        pilotAdmin<{ applications: Application[] }>("applications"),
      ]);
      setMembers(m.members); setOutsiders(m.outsiders); setApplications(a.applications);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const setStatus = async (m: PilotMember, status: PilotMember["status"]) => {
    try {
      await pilotAdmin("set-status", { user_id: m.user_id, status });
      toast.success(status === "active" ? "Access restored" : status === "paused" ? "Access paused" : "Access ended");
      void load();
    } catch (e) {
      toast.error("Not changed", { description: (e as Error).message });
    }
  };

  const invited = new Set((members ?? []).map(m => (m.email ?? m.account_email ?? "").toLowerCase()));

  return (
    <div className="min-h-screen bg-background p-6 sm:p-10">
      <Seo title="Pilot desk, Swardus" noindex />
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Founding pilot</div>
          <h1 className="font-display text-3xl">Pilot desk</h1>
        </div>
        <Button asChild variant="outline"><Link to="/app">Back to Swardus</Link></Button>
      </header>
      {error && <p role="alert" className="mb-6 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

      <div className="max-w-6xl space-y-12">
        <Section title="Invite someone" hint="Creates their account (or a sign-in link if the address already has one), makes them a participant, and emails them the link.">
          <InviteForm draft={draft} setDraft={setDraft} onInvited={() => void load()} />
        </Section>

        <Section title="People in the pilot">
          {members == null ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
            <div className="overflow-x-auto rounded border">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead><tr className="border-b bg-muted/50 text-left">{["Person", "Organisation", "Role", "Access", "Invited", "Last signed in", ""].map(h => <th key={h} className="whitespace-nowrap px-4 py-3 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {members.map(m => (
                    <tr key={m.user_id} className="border-b align-top last:border-0">
                      <td className="px-4 py-3"><div>{m.display_name ?? "No name given"}</div><div className="text-xs text-muted-foreground">{m.account_email ?? m.email}</div></td>
                      <td className="px-4 py-3">{m.organisation ?? ""}</td>
                      <td className="px-4 py-3">{m.role === "founder" ? "Founder" : "Participant"}</td>
                      <td className="px-4 py-3">{m.status === "active" ? "Active" : m.status === "paused" ? "Paused" : "Ended"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{fmtDate(m.invited_at ?? m.created_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{fmtDate(m.last_sign_in_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {m.role !== "founder" && (m.status === "active"
                          ? <><Button size="sm" variant="ghost" onClick={() => void setStatus(m, "paused")}>Pause</Button><Button size="sm" variant="ghost" onClick={() => void setStatus(m, "ended")}>End</Button></>
                          : <Button size="sm" variant="ghost" onClick={() => void setStatus(m, "active")}>Restore</Button>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {outsiders.length > 0 && (
            <div className="rounded-md border p-4 text-sm">
              <p className="font-medium">Accounts that are not in the pilot ({outsiders.length})</p>
              <p className="text-muted-foreground">They can sign in but see only a "not in the pilot" screen and can read nothing.</p>
              <ul className="mt-2 space-y-1">
                {outsiders.map(o => (
                  <li key={o.user_id} className="flex flex-wrap items-center gap-2">
                    <span>{o.email ?? o.user_id}</span>
                    <span className="text-xs text-muted-foreground">created {fmtDate(o.created_at)}, last signed in {fmtDate(o.last_sign_in_at)}</span>
                    {o.email && <Button size="sm" variant="ghost" onClick={() => setDraft({ ...EMPTY, email: o.email! })}>Invite</Button>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        <Section title="Applications" hint="From the request-access form, newest first.">
          {applications == null ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : applications.length === 0 ? <p className="text-sm text-muted-foreground">No applications yet.</p> : (
            <div className="overflow-x-auto rounded border">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead><tr className="border-b bg-muted/50 text-left">{["Name", "Farm", "Location", "Crops", "Drone", "Submitted", ""].map(h => <th key={h} className="whitespace-nowrap px-4 py-3 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {applications.map(a => (
                    <tr key={a.id} className="border-b align-top last:border-0">
                      <td className="px-4 py-3"><div>{a.full_name}</div><a href={`mailto:${a.email}`} className="text-xs text-muted-foreground hover:underline">{a.email}</a></td>
                      <td className="px-4 py-3">{a.farm_name}</td>
                      <td className="px-4 py-3">{a.location}</td>
                      <td className="px-4 py-3">{a.crops}</td>
                      <td className="px-4 py-3">{a.drone_status}{a.drone_model && <div className="text-xs text-muted-foreground">{a.drone_model}</div>}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{fmtDate(a.created_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {invited.has(a.email.toLowerCase())
                          ? <span className="text-xs text-muted-foreground">Invited</span>
                          : <Button size="sm" variant="outline" onClick={() => { setDraft({ email: a.email, name: a.full_name, organisation: a.farm_name, applicationId: a.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Invite</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
