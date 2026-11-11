// The pilot desk's Reviews: every review once, as participant, then Field Twin, then the reviews themselves.
//
// Each review keeps both readings side by side: what Swardus called the finding when it was reviewed, and what the
// participant answered (their verdict, what they said was there, their note). The participant's answer is their
// word, not a verified label; nothing here changes a Field Twin.
//
// "View Field Twin" and "Open finding" lead to the founder's read-only viewer by the twin's own record id. They only
// navigate: the viewer still asks why, and pilot-admin still checks the participant's troubleshooting permission and
// writes the access log before anything is opened. Where the participant has not allowed it, no link is offered;
// the row says so and offers an email to ask them.
import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type PersonReviews, type SnapReview, type Snapshot, type TwinReviews, type VerdictCounts, answersLoaded, reviewGroups, reviewMatrix, wrongAnswers } from "@/lib/pilot/adminData";
import { type FindingKind, KIND_LABEL, findingLabel, isFindingKind, machineSaid, saysLabel } from "@/lib/fieldTwin/reviews";
import { focusParam } from "@/components/app/fieldTwin/reviewFocus";
import type { ReviewContext, ViewerState } from "@/pages/admin/AdminTwinViewer";
import { Badge, Section, Stat, Table, when } from "./ui";

const VERDICT = { correct: "Correct", unsure: "Not sure", wrong: "Wrong" } as const;
type Verdict = keyof typeof VERDICT;
const TONE: Record<Verdict, "ok" | "plain" | "bad"> = { correct: "ok", unsure: "plain", wrong: "bad" };
/** Reviews shown at first in one Field Twin; the rest come a page at a time. */
const PAGE = 100;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Correct / Not sure / Wrong as three counted badges (a word and a number each, never colour alone). */
function Verdicts({ counts }: { counts: VerdictCounts }) {
  return (
    <span className="flex flex-wrap gap-1">
      {(Object.keys(VERDICT) as Verdict[]).map(v => <Badge key={v} tone={counts[v] ? TONE[v] : "plain"}>{VERDICT[v]} {counts[v]}</Badge>)}
    </span>
  );
}

/** The participant's own answer on a finding they marked wrong, or why there is none to show. */
function Correction({ r, loaded }: { r: SnapReview; loaded: boolean }) {
  if (r.verdict !== "wrong" || !isFindingKind(r.finding_kind)) return null;
  const label = saysLabel(r.finding_kind, r.says);
  if (label) return <>{label}</>;
  if (r.says) return <>{r.says}</>;
  // Only corn findings are asked "what is it". Not sent by the server is not the same as not answered.
  if (!r.finding_kind.startsWith("corn_")) return null;
  return <span className="text-muted-foreground">{loaded ? "No answer given" : "Not loaded"}</span>;
}

function askForPermission(person: PersonReviews, twinName: string): string | null {
  if (!person.email) return null;
  const hello = person.displayName ? `Hello ${person.displayName},` : "Hello,";
  const body = `${hello}\n\nI would like to look at your Field Twin "${twinName}" to check the findings you reviewed. I can only open it if you allow it.\n\nTo allow it: in Swardus, open Help, choose "Change your data choices", and tick "Let Swardus open my Field Twins to troubleshoot". You can untick it again at any time, and every time I open one is listed there for you.\n\nThank you,\nYunus`;
  return `mailto:${person.email}?subject=${encodeURIComponent("Swardus: may I open your Field Twin?")}&body=${encodeURIComponent(body)}`;
}

/** Why a twin is not offered for opening, in words. */
function Unavailable({ person, group }: { person: PersonReviews; group: TwinReviews }) {
  if (group.access.open) return null;
  const why = group.access.why;
  const mail = why === "not-allowed" || why === "no-answer" ? askForPermission(person, group.twin?.name ?? "your field") : null;
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>
        {why === "gone" ? "This Field Twin is no longer in their list."
          : why === "unsaved" ? "Not saved completely, so it cannot be opened."
          : why === "no-answer" ? `Cannot be opened: ${person.name} has not answered the data choices yet.`
          : `Cannot be opened: ${person.name} has not allowed troubleshooting access.`}
      </span>
      {mail && <Button size="sm" variant="outline" asChild><a href={mail}>Ask for permission</a></Button>}
    </span>
  );
}

function TwinGroup({ person, group, open, onToggle, from, loaded }: { person: PersonReviews; group: TwinReviews; open: boolean; onToggle: () => void; from: string; loaded: boolean }) {
  const [shown, setShown] = useState(PAGE);
  const t = group.twin;
  const panel = `reviews-twin-${group.twinId}`;
  const context = (r: SnapReview): ReviewContext => ({ kind: r.finding_kind, id: r.finding_id, verdict: r.verdict, says: r.says ?? null, note: r.note, status: r.algorithm_status, at: r.updated_at, who: person.name });
  const state = (r?: SnapReview): ViewerState => ({ from, ...(r ? { review: context(r) } : {}) });
  return (
    <li className="rounded-md border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2">
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panel} className="flex min-w-0 flex-1 items-start gap-2 text-left">
          <ChevronRight className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{t?.name ?? "A Field Twin no longer listed"}</span>
            <span className="block text-xs text-muted-foreground">
              {[t?.crop, t?.photographs != null ? plural(t.photographs, "photograph") : null, plural(group.counts.total, "review"), `latest ${when(group.latest)}`].filter(Boolean).join(" · ")}
            </span>
          </span>
        </button>
        <span className="flex flex-wrap items-center gap-3">
          <Verdicts counts={group.counts} />
          {group.access.open && t
            ? <Button size="sm" variant="outline" asChild><Link to={`/admin/pilot/twins/${t.id}`} state={state()}>View Field Twin</Link></Button>
            : <Unavailable person={person} group={group} />}
        </span>
      </div>
      {open && (
        <div id={panel} className="border-t p-3">
          <Table head={["Finding", "What Swardus detected", "Their verdict", "Their correction", "Their note", "Reviewed", ""]} min={920}>
            {group.reviews.slice(0, shown).map(r => {
              const finding = group.access.open && t ? focusParam(r.finding_kind, r.finding_id) : null;
              return (
                <tr key={`${r.finding_kind}:${r.finding_id}`}>
                  <td className="whitespace-nowrap font-medium">{findingLabel(r.finding_kind, r.finding_id)}</td>
                  <td>{machineSaid(r.finding_kind, r.algorithm_status)}</td>
                  <td><Badge tone={TONE[r.verdict]}>{VERDICT[r.verdict]}</Badge></td>
                  <td><Correction r={r} loaded={loaded} /></td>
                  <td className="max-w-[28rem] whitespace-pre-wrap">{r.note}</td>
                  <td className="whitespace-nowrap text-muted-foreground">{when(r.updated_at)}</td>
                  <td className="whitespace-nowrap text-right">
                    {finding && t ? <Link to={`/admin/pilot/twins/${t.id}?finding=${finding}`} state={state(r)} className="text-sm underline underline-offset-4" aria-label={`Open ${findingLabel(r.finding_kind, r.finding_id)} in ${t.name}`}>Open finding</Link>
                      : group.access.open && t ? <Link to={`/admin/pilot/twins/${t.id}`} state={state(r)} className="text-sm text-muted-foreground underline underline-offset-4" aria-label={`Open ${t.name} for ${findingLabel(r.finding_kind, r.finding_id)}`}>Open the twin</Link>
                      : null}
                  </td>
                </tr>
              );
            })}
          </Table>
          {group.reviews.length > shown && (
            <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
              <span>Showing {shown.toLocaleString()} of {group.reviews.length.toLocaleString()}.</span>
              <Button size="sm" variant="outline" onClick={() => setShown(n => n + PAGE)}>Show {Math.min(PAGE, group.reviews.length - shown)} more</Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function PersonGroup({ person, open, onToggle, openTwins, onToggleTwin, from, loaded }: { person: PersonReviews; open: boolean; onToggle: () => void; openTwins: Set<string>; onToggleTwin: (id: string) => void; from: (twinId: string) => string; loaded: boolean }) {
  const panel = `reviews-person-${person.userId}`;
  return (
    <li className="rounded-lg border bg-card">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panel} className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-left">
        <span className="flex min-w-0 items-start gap-2">
          <ChevronRight className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block truncate font-medium">{person.displayName ?? person.email ?? "Unknown account"}{person.role === "founder" ? <span className="font-normal text-muted-foreground"> · founder</span> : null}</span>
            {person.displayName && person.email && <span className="block truncate text-xs text-muted-foreground">{person.email}</span>}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>{plural(person.twins.length, "Field Twin")} · {plural(person.counts.total, "review")}</span>
          <Verdicts counts={person.counts} />
        </span>
      </button>
      {open && (
        <ul id={panel} className="space-y-2 border-t p-3">
          {person.twins.map(g => <TwinGroup key={g.twinId} person={person} group={g} open={openTwins.has(g.twinId)} onToggle={() => onToggleTwin(g.twinId)} from={from(g.twinId)} loaded={loaded} />)}
        </ul>
      )}
    </li>
  );
}

/** Counts by kind of finding and what Swardus called it: a summary, kept closed; the reviews themselves are below, once. */
function ByKind({ snap, userId }: { snap: Snapshot; userId?: string }) {
  const [open, setOpen] = useState(false);
  const matrix = reviewMatrix(snap, userId);
  const answers = wrongAnswers(snap, userId);
  if (!matrix.length) return null;
  return (
    <div>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls="reviews-by-kind" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />Counts by kind of finding
      </button>
      {open && (
        <div id="reviews-by-kind" className="mt-2">
          <Table head={["Finding", "What Swardus detected", "Correct", "Not sure", "Wrong", "Wrong share", "Said instead (their word, not a verified label)"]} min={860}>
            {matrix.map(m => {
              const said = answers.filter(a => a.kind === m.kind && a.status === m.status && a.says);
              return (
                <tr key={`${m.kind}|${m.status}`}>
                  <td>{isFindingKind(m.kind) ? KIND_LABEL[m.kind] : m.kind.replace(/_/g, " ")}</td><td>{machineSaid(m.kind, m.status || null)}</td>
                  <td className="tabular-nums">{m.correct}</td><td className="tabular-nums">{m.unsure}</td><td className="tabular-nums">{m.wrong}</td>
                  <td className="tabular-nums">{Math.round((100 * m.wrong) / m.total)} %</td>
                  <td>{said.map(a => `${saysLabel(a.kind as FindingKind, a.says) ?? a.says} ${a.count}`).join(", ")}</td>
                </tr>
              );
            })}
          </Table>
        </div>
      )}
    </div>
  );
}

export function ReviewsSection({ snap, userId }: { snap: Snapshot; userId?: string }) {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const [verdict, setVerdict] = useState<Verdict | null>(() => { const v = params.get("verdict"); return v === "correct" || v === "unsure" || v === "wrong" ? v : null; });
  const all = reviewGroups(snap, { userId });
  const people = verdict ? reviewGroups(snap, { userId, verdict }) : all;
  const totals = all.reduce<VerdictCounts>((c, p) => ({ total: c.total + p.counts.total, correct: c.correct + p.counts.correct, unsure: c.unsure + p.counts.unsure, wrong: c.wrong + p.counts.wrong }), { total: 0, correct: 0, unsure: 0, wrong: 0 });
  const loaded = answersLoaded(snap);

  // What is open: what the address names (coming back from a twin), else the only person and the only twin there is.
  const [openPeople, setOpenPeople] = useState<Set<string>>(() => new Set([params.get("person") ?? (all.length === 1 ? all[0].userId : "")].filter(Boolean)));
  const [openTwins, setOpenTwins] = useState<Set<string>>(() => new Set([params.get("twin") ?? "", ...all.filter(p => p.twins.length === 1).map(p => p.twins[0].twinId)].filter(Boolean)));
  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };
  const personOpen = (id: string) => !!userId || openPeople.has(id);
  /** Where "back" from the viewer returns to, with this person and twin open again. */
  const from = (personId: string) => (twinId: string) => (userId ? pathname : `/admin/pilot?tab=reviews&person=${encodeURIComponent(personId)}&twin=${encodeURIComponent(twinId)}${verdict ? `&verdict=${verdict}` : ""}`);
  const pct = (n: number) => (totals.total ? `${Math.round((100 * n) / totals.total)} % of reviews` : undefined);

  return (
    <Section title="Reviews" hint="Participant, then Field Twin, then each review. A review is the participant's word beside what Swardus measured: neither replaces the other, and nothing here changes a Field Twin.">
      {totals.total === 0 ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No reviews yet.</p> : (
        <div className="space-y-4">
          {!userId && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Reviews" value={totals.total.toLocaleString()} sub={`${plural(all.length, "participant")}, ${plural(all.reduce((n, p) => n + p.twins.length, 0), "Field Twin")}`} />
              <Stat label="Correct" value={totals.correct.toLocaleString()} sub={pct(totals.correct)} />
              <Stat label="Not sure" value={totals.unsure.toLocaleString()} sub={pct(totals.unsure)} />
              <Stat label="Wrong" value={totals.wrong.toLocaleString()} sub={pct(totals.wrong)} />
            </div>
          )}
          {!loaded && <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">The participants' corrections ("what is it") are not shown: the pilot-admin function running on the server predates them and does not send them. They are saved in the database; deploy pilot-admin to see them here.</p>}
          <div>
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Show reviews by verdict">
              {([null, "wrong", "unsure", "correct"] as (Verdict | null)[]).map(v => {
                const n = v ? totals[v] : totals.total, on = verdict === v;
                return <button key={v ?? "all"} type="button" onClick={() => setVerdict(v)} aria-pressed={on} className={`rounded-full border px-3 py-1 text-xs ${on ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>{v ? VERDICT[v] : "All"} {n.toLocaleString()}</button>;
              })}
            </div>
          </div>
          <ByKind snap={snap} userId={userId} />
          {people.length === 0 ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No reviews marked {verdict ? VERDICT[verdict].toLowerCase() : ""}.</p>
            : userId ? (
              <ul className="space-y-2">
                {people[0].twins.map(g => <TwinGroup key={g.twinId} person={people[0]} group={g} open={openTwins.has(g.twinId)} onToggle={() => setOpenTwins(s => toggle(s, g.twinId))} from={from(people[0].userId)(g.twinId)} loaded={loaded} />)}
              </ul>
            ) : (
              <ul className="space-y-3">
                {people.map(p => <PersonGroup key={p.userId} person={p} open={personOpen(p.userId)} onToggle={() => setOpenPeople(s => toggle(s, p.userId))} openTwins={openTwins} onToggleTwin={id => setOpenTwins(s => toggle(s, id))} from={from(p.userId)} loaded={loaded} />)}
              </ul>
            )}
        </div>
      )}
    </Section>
  );
}
