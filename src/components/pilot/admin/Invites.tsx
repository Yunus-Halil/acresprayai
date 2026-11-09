// Invitations: invite someone (or an applicant), see who is waiting, and the accounts that exist but are not in the
// pilot. Every action goes through pilot-admin, which checks the founder again.
import { useState } from "react";
import { Check, Copy, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type InviteResult, pilotAdmin } from "@/lib/pilot/adminClient";
import type { Snapshot } from "@/lib/pilot/adminData";
import { Badge, Section, Table, ago, day } from "./ui";

type Draft = { email: string; name: string; organisation: string; applicationId: string | null };
const EMPTY: Draft = { email: "", name: "", organisation: "", applicationId: null };

export function InvitesSection({ snap, onChanged }: { snap: Snapshot; onChanged: () => void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<(InviteResult & { email: string }) | null>(null);
  const [copied, setCopied] = useState(false);
  const memberIds = new Set(snap.members.map(m => m.user_id));
  const invitedEmails = new Set(snap.members.map(m => (m.email ?? "").toLowerCase()).concat(snap.users.filter(u => memberIds.has(u.id)).map(u => (u.email ?? "").toLowerCase())));
  const outsiders = snap.users.filter(u => !memberIds.has(u.id));
  const apps = snap.applications as { id: string; created_at: string; full_name: string; email: string; farm_name: string; location: string; crops: string; drone_status: string; drone_model: string | null; acreage_range: string; notes: string | null }[];

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true); setResult(null); setCopied(false);
    try {
      const r = await pilotAdmin<InviteResult>("invite", { email: draft.email, name: draft.name, organisation: draft.organisation, application_id: draft.applicationId, origin: window.location.origin });
      setResult({ ...r, email: draft.email });
      setDraft(EMPTY);
      onChanged();
    } catch (err) {
      toast.error("The invitation was not made", { description: (err as Error).message });
    } finally { setSending(false); }
  };

  return (
    <div className="space-y-10">
      <Section title="Invite someone" hint="Creates their account (or a sign-in link if the address already has one), makes them a participant, and emails them the link. The link is always shown here too.">
        <form onSubmit={send} className="grid gap-3 rounded-md border bg-card p-4 sm:grid-cols-[2fr_1.4fr_1.4fr_auto] sm:items-end">
          <div><Label htmlFor="inv-email">Email</Label><Input id="inv-email" type="email" required value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} /></div>
          <div><Label htmlFor="inv-name">Name</Label><Input id="inv-name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></div>
          <div><Label htmlFor="inv-org">Organisation</Label><Input id="inv-org" value={draft.organisation} onChange={e => setDraft({ ...draft, organisation: e.target.value })} /></div>
          <Button type="submit" disabled={sending}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}Invite</Button>
        </form>
        {result && (
          <div role="status" className="space-y-2 rounded-md border bg-muted/40 p-4 text-sm">
            <p className="font-medium">{result.kind === "invite" ? "Invitation made" : "Sign-in link made (this address already had an account)"} for {result.email}. {result.emailed ? "It has been emailed." : "It was NOT emailed: send the link below yourself."}</p>
            {!result.emailed && result.email_problem === "unconfigured" && <p className="text-muted-foreground">Email is not set up on the server (RESEND_API_KEY). See Health.</p>}
            {!result.emailed && result.email_problem === "rejected" && <p className="text-muted-foreground">The email service refused it. Until the sending domain is verified it only delivers to your own address. See Health.</p>}
            <div className="flex items-center gap-2">
              <Input readOnly value={result.link} className="font-mono text-xs" onFocus={e => e.currentTarget.select()} aria-label="Invitation link" />
              <Button type="button" variant="outline" onClick={() => { void navigator.clipboard?.writeText(result.link).then(() => setCopied(true)); }}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copied" : "Copy"}</Button>
            </div>
            <p className="text-xs text-muted-foreground">The link works once and expires (Supabase's email link lifetime). Make a new one from the person's page if it does.</p>
          </div>
        )}
      </Section>

      <Section title="Applications" hint="From the request-access form, newest first.">
        <Table head={["Name", "Farm", "Location", "Acreage", "Crops", "Drone", "Submitted", ""]} min={1000} empty={apps.length ? false : "No applications yet."}>
          {apps.map(a => (
            <tr key={a.id}>
              <td><div>{a.full_name}</div><a href={`mailto:${a.email}`} className="text-xs text-muted-foreground hover:underline">{a.email}</a>{a.notes && <div className="mt-1 max-w-xs text-xs text-muted-foreground">{a.notes}</div>}</td>
              <td>{a.farm_name}</td><td>{a.location}</td><td>{a.acreage_range}</td><td>{a.crops}</td>
              <td>{a.drone_status}{a.drone_model && <div className="text-xs text-muted-foreground">{a.drone_model}</div>}</td>
              <td className="whitespace-nowrap text-muted-foreground">{day(a.created_at)}</td>
              <td>{invitedEmails.has(a.email.toLowerCase()) ? <Badge tone="ok">Invited</Badge> : <Button size="sm" variant="outline" onClick={() => { setDraft({ email: a.email, name: a.full_name, organisation: a.farm_name, applicationId: a.id }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Invite</Button>}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Accounts that are not in the pilot" hint="They can sign in but see only a 'not in the pilot' screen and can read nothing. Invite them, or delete them in Supabase (Authentication, Users).">
        <Table head={["Email", "Created", "Last signed in", "Signs in with", ""]} min={640} empty={outsiders.length ? false : "None."}>
          {outsiders.map(o => (
            <tr key={o.id}>
              <td>{o.email ?? o.id}{!o.confirmed && <span className="ml-2"><Badge tone="warn">address not proven</Badge></span>}</td>
              <td>{day(o.created_at)}</td><td>{ago(o.last_sign_in_at)}</td><td>{o.provider ?? ""}</td>
              <td>{o.email && <Button size="sm" variant="ghost" onClick={() => { setDraft({ ...EMPTY, email: o.email! }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Invite</Button>}</td>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}
