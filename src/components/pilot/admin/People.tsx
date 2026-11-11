// People in the pilot: everyone at a glance, and each person's own page (their activity, Field Twins, builds,
// reviews, feedback, what they allowed, and their access controls).
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type PersonStats, type Snapshot, personStats, timeline } from "@/lib/pilot/adminData";
import { pilotAdmin } from "@/lib/pilot/adminClient";
import { useStarredPeople } from "@/lib/pilot/starred";
import { Badge, Section, Stat, Table, ago, day, dur, when } from "./ui";
import { BuildsSection, FeedbackSection, TwinsSection } from "./sections";
import { ReviewsSection } from "./Reviews";

const STAGE: Record<PersonStats["stage"], { label: string; tone: "ok" | "warn" | "bad" | "plain" | "info" }> = {
  new: { label: "Not signed in yet", tone: "warn" },
  invited: { label: "Signed in, no build", tone: "info" },
  building: { label: "Building", tone: "ok" },
  reviewing: { label: "Reviewing findings", tone: "ok" },
  quiet: { label: "Quiet for 2 weeks", tone: "warn" },
};

/** The star beside a person: the founder's own mark, kept in this browser. Never opens the row it sits in. */
function StarButton({ name, on, onToggle }: { name: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-pressed={on} aria-label={on ? `Remove the star from ${name}` : `Star ${name}`} title={on ? "Starred" : "Star"}
      onClick={e => { e.stopPropagation(); onToggle(); }}
      className="-m-1.5 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
      <Star className={`h-4 w-4 ${on ? "fill-amber-400 text-amber-500" : ""}`} aria-hidden="true" />
    </button>
  );
}

export function PeopleSection({ snap }: { snap: Snapshot }) {
  const everyone = personStats(snap).sort((a, b) => (a.member.role === b.member.role ? (b.lastActive ?? "").localeCompare(a.lastActive ?? "") : a.member.role === "founder" ? 1 : -1));
  const { starred, toggle, view, setView } = useStarredPeople();
  // Stars of people who are no longer listed are not counted.
  const starredHere = everyone.filter(p => starred.has(p.member.user_id));
  const people = view === "starred" ? starredHere : everyone;
  const nav = useNavigate();
  const chip = (v: "everyone" | "starred", label: string, n: number) => (
    <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
      className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${view === v ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
      {v === "starred" && <Star className="h-3 w-3" aria-hidden="true" />}{label} <span className="tabular-nums opacity-70">{n}</span>
    </button>
  );
  return (
    <Section title="People" hint="Everyone with access, participants first. Click a row for their page. Star the people you want to keep an eye on."
      actions={<div className="flex gap-1.5" role="group" aria-label="Which people to show">{chip("everyone", "Everyone", everyone.length)}{chip("starred", "Starred", starredHere.length)}</div>}>
      <Table head={[<span key="star" className="sr-only">Starred</span>, "Who", "Where they are", "Access", "Last signed in", "Last active", "Days used", "Field Twins", "Builds ok / failed", "Reviews (wrong)", "Feedback", "Allowed"]} min={1140}
        empty={people.length ? false : !everyone.length ? "Nobody yet. Invite someone under Invites." : "Nobody is starred yet. Show everyone, and press the star beside a name."}>
        {people.map(p => (
          <tr key={p.member.user_id} className="cursor-pointer hover:bg-muted/40" onClick={() => nav(`/admin/pilot/people/${p.member.user_id}`)}>
            <td className="w-8"><StarButton name={p.name} on={starred.has(p.member.user_id)} onToggle={() => toggle(p.member.user_id)} /></td>
            <td><Link to={`/admin/pilot/people/${p.member.user_id}`} className="font-medium hover:underline" onClick={e => e.stopPropagation()}>{p.name}</Link><div className="text-xs text-muted-foreground">{p.member.organisation ?? ""}{p.member.role === "founder" ? " · founder" : ""}</div></td>
            <td>{p.member.role === "participant" ? <Badge tone={STAGE[p.stage].tone}>{STAGE[p.stage].label}</Badge> : null}</td>
            <td><Badge tone={p.member.status === "active" ? "ok" : "bad"}>{p.member.status === "active" ? "Active" : p.member.status === "paused" ? "Paused" : "Ended"}</Badge></td>
            <td>{ago(p.lastSignIn)}</td><td>{ago(p.lastActive)}</td><td className="tabular-nums">{p.daysActive}</td>
            <td className="tabular-nums">{p.twinsReady}{p.twinsIncomplete ? <span className="text-amber-700"> +{p.twinsIncomplete}</span> : null}</td>
            <td className="tabular-nums">{p.buildsOk} / <span className={p.buildsFailed ? "text-destructive" : ""}>{p.buildsFailed}</span></td>
            <td className="tabular-nums">{p.reviews}{p.wrong ? ` (${p.wrong})` : ""}</td>
            <td className="tabular-nums">{p.feedback}</td>
            <td className="text-xs">{p.member.role === "founder" ? "" : !p.consent ? "terms not accepted" : [p.consent.troubleshooting_access && "twins can be opened", p.consent.research_use && "research"].filter(Boolean).join(", ") || "neither"}</td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

export function PersonDetail({ snap, userId, onChanged }: { snap: Snapshot; userId: string; onChanged: () => void }) {
  const { starred, toggle } = useStarredPeople();
  const p = personStats(snap).find(x => x.member.user_id === userId);
  if (!p) return <div className="space-y-3"><Link to="/admin/pilot?tab=people" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="h-4 w-4" />People</Link><p>This person is not in the pilot.</p></div>;
  const user = snap.users.find(u => u.id === userId);
  const events = timeline(snap, userId);
  const access = snap.access.filter(a => a.participant_id === userId);
  const setStatus = async (status: "active" | "paused" | "ended") => {
    try { await pilotAdmin("set-status", { user_id: userId, status }); toast.success(status === "active" ? "Access restored" : status === "paused" ? "Access paused" : "Access ended"); onChanged(); }
    catch (e) { toast.error("Not changed", { description: (e as Error).message }); }
  };
  const resend = async () => {
    const email = user?.email ?? p.member.email;
    if (!email) return;
    try {
      const r = await pilotAdmin<{ link: string; emailed: boolean }>("invite", { email, name: p.member.display_name, organisation: p.member.organisation, origin: window.location.origin });
      await navigator.clipboard?.writeText(r.link).catch(() => undefined);
      toast.success(r.emailed ? "A new link was emailed (and copied)" : "A new link was made and copied: send it yourself", { description: r.link });
    } catch (e) { toast.error("No link made", { description: (e as Error).message }); }
  };
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link to="/admin/pilot?tab=people" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="h-4 w-4" />People</Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-2xl">{p.name}<StarButton name={p.name} on={starred.has(userId)} onToggle={() => toggle(userId)} /></h2>
            <p className="text-sm text-muted-foreground">{[user?.email ?? p.member.email, p.member.organisation, p.member.role === "founder" ? "founder" : "participant", user?.provider ? `signs in with ${user.provider}` : null, user && !user.confirmed ? "address not proven yet" : null].filter(Boolean).join(" · ")}</p>
            <p className="text-sm text-muted-foreground">Invited {day(p.member.invited_at ?? p.member.created_at)} · last signed in {ago(p.lastSignIn)} · last active {ago(p.lastActive)}</p>
          </div>
          {p.member.role === "participant" && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void resend()}>New sign-in link</Button>
              {p.member.status === "active"
                ? <><Button variant="outline" size="sm" onClick={() => void setStatus("paused")}>Pause access</Button><Button variant="outline" size="sm" onClick={() => void setStatus("ended")}>End access</Button></>
                : <Button size="sm" onClick={() => void setStatus("active")}>Restore access</Button>}
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Days used" value={p.daysActive} />
        <Stat label="Field Twins" value={p.twinsReady} sub={p.twinsIncomplete ? `${p.twinsIncomplete} not saved completely` : undefined} />
        <Stat label="Builds" value={`${p.buildsOk} / ${p.buildsOk + p.buildsFailed + p.buildsCancelled}`} sub={p.medianBuildMs ? `typical ${dur(p.medianBuildMs)}` : "finished / all"} tone={p.buildsFailed ? "warn" : "plain"} />
        <Stat label="Reviews" value={p.reviews} sub={p.reviews ? `${p.wrong} marked wrong` : undefined} />
        <Stat label="Allowed" value={p.consent ? (p.consent.troubleshooting_access ? "Twins can be opened" : "Twins cannot be opened") : "No answer"} sub={p.consent ? `${p.consent.research_use ? "research use allowed · " : ""}${day(p.consent.created_at)}` : "terms not accepted yet"} />
      </div>
      <TwinsSection snap={snap} userId={userId} />
      <BuildsSection snap={snap} userId={userId} />
      <ReviewsSection snap={snap} userId={userId} />
      <FeedbackSection snap={snap} userId={userId} onChanged={onChanged} />
      <Section title="Everything they did" hint="Newest first, the last 90 days.">
        {events.length === 0 ? <p className="text-sm text-muted-foreground">Nothing recorded yet.</p> : (
          <ol className="max-h-[480px] divide-y overflow-y-auto rounded-md border bg-card text-sm">
            {events.map((e, i) => <li key={i} className="flex gap-3 px-3 py-1.5"><span className="w-36 shrink-0 text-xs text-muted-foreground tabular-nums">{when(e.at)}</span><span className={e.tone === "bad" ? "text-destructive" : e.tone === "ok" ? "text-emerald-700" : ""}>{e.text}</span></li>)}
          </ol>
        )}
      </Section>
      {access.length > 0 && (
        <Section title="Times you opened their Field Twins">
          <ul className="text-sm">{access.map((a, i) => <li key={i}>{when(a.at)}: {snap.twins.find(t => t.id === a.twin_id)?.name ?? "deleted"}{a.reason ? `, ${a.reason}` : ""}</li>)}</ul>
        </Section>
      )}
    </div>
  );
}
