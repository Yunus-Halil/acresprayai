// The admin panel's sections that read the snapshot: overview, builds, Field Twins, reviews, feedback, errors, data
// access. Each one is the founder's question answered from first-party records; none shows imagery.
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type Snapshot, buildRows, checkSummary, daily, errorGroups, nameOf, overview, personStats, reviewMatrix, stageTimes, wrongAnswers } from "@/lib/pilot/adminData";
import { type FindingKind, saysLabel } from "@/lib/fieldTwin/reviews";
import { pilotAdmin } from "@/lib/pilot/adminClient";
import { Badge, DayBars, Section, Stat, Table, ago, day, dur, when } from "./ui";

const STAGE_WORDS: Record<string, string> = { photographs: "Reading photographs", cameras: "Placing photographs", rows: "Rows and trees", corn: "Corn reading", weeds: "Weeds", vegetation: "Other green", evidence: "Field edges", boundary: "Boundary", bundle: "Putting it together" };
const VERDICT = { correct: "Correct", unsure: "Not sure", wrong: "Wrong" } as const;

export function OverviewSection({ snap, onOpenTab }: { snap: Snapshot; onOpenTab: (tab: string) => void }) {
  const o = overview(snap);
  const d = daily(snap, 30);
  const people = personStats(snap).filter(p => p.member.role === "participant");
  const attention: { text: string; tab: string }[] = [];
  if (o.feedbackNew) attention.push({ text: `${o.feedbackNew} feedback message${o.feedbackNew === 1 ? "" : "s"} not read yet`, tab: "feedback" });
  for (const p of people) {
    if (p.buildsFailed) attention.push({ text: `${p.name}: ${p.buildsFailed} build${p.buildsFailed === 1 ? "" : "s"} failed`, tab: "builds" });
    if (p.savesFailed) attention.push({ text: `${p.name}: ${p.savesFailed} save${p.savesFailed === 1 ? "" : "s"} failed`, tab: "builds" });
    if (p.stage === "new") attention.push({ text: `${p.name} has not signed in since being invited`, tab: "people" });
    if (p.stage === "quiet") attention.push({ text: `${p.name} has been quiet for two weeks`, tab: "people" });
  }
  if (o.errorsLast7) attention.push({ text: `${o.errorsLast7} app error${o.errorsLast7 === 1 ? "" : "s"} in the last 7 days`, tab: "errors" });
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Participants" value={o.participants} sub={`${o.activeLast7} active in the last 7 days${o.neverSignedIn ? `, ${o.neverSignedIn} never signed in` : ""}`} />
        <Stat label="Field Twins saved" value={o.twinsReady} sub={`${o.builds} build${o.builds === 1 ? "" : "s"} ended`} />
        <Stat label="Builds that worked" value={o.buildSuccessPct == null ? "none yet" : `${o.buildSuccessPct} %`} sub={o.medianBuildMs ? `typical build ${dur(o.medianBuildMs)}` : "no finished build yet"} tone={o.buildSuccessPct != null && o.buildSuccessPct < 80 ? "warn" : "plain"} />
        <Stat label="Findings reviewed" value={o.reviews} sub={o.wrongPct == null ? "no reviews yet" : `${o.wrongPct} % marked wrong`} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <DayBars title="Participants active per day" days={d as never} value={x => (x as { people: number }).people} unit="people" />
        <DayBars title="Field Twins built per day" days={d as never} value={x => (x as { builds: number }).builds} unit="builds" />
      </div>
      <Section title="Needs attention">
        {attention.length === 0 ? <p className="text-sm text-muted-foreground">Nothing right now.</p> : (
          <ul className="divide-y rounded-md border bg-card">
            {attention.map((a, i) => <li key={i} className="flex items-center justify-between gap-3 px-4 py-2 text-sm"><span>{a.text}</span><Button size="sm" variant="ghost" onClick={() => onOpenTab(a.tab)}>Look</Button></li>)}
          </ul>
        )}
      </Section>
    </div>
  );
}

export function BuildsSection({ snap, userId }: { snap: Snapshot; userId?: string }) {
  const rows = buildRows(snap).filter(b => !userId || b.userId === userId);
  const stages = stageTimes(snap);
  const checks = checkSummary(snap);
  return (
    <div className="space-y-8">
      {!userId && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Photograph checks" value={checks.checks} sub={`${checks.stopped} stopped before building`} />
          <Stat label="Photographs offered" value={checks.files.toLocaleString()} sub={`${checks.usable.toLocaleString()} usable`} />
          <Stat label="Builds finished" value={rows.filter(r => r.outcome === "finished").length} />
          <Stat label="Builds failed" value={rows.filter(r => r.outcome === "failed").length} tone={rows.some(r => r.outcome === "failed") ? "bad" : "plain"} />
        </div>
      )}
      <Section title="Builds" hint="Newest first. A failure shows the stage it stopped in and its error.">
        <Table head={["When", ...(userId ? [] : ["Who"]), "Result", "Time", "Photographs (used / left out)", "Crop", "Camera", "Where it stopped"]} min={900} empty={rows.length ? false : "No builds yet."}>
          {rows.map((b, i) => (
            <tr key={i}>
              <td>{when(b.at)}</td>{!userId && <td><Link to={`/admin/pilot/people/${b.userId}`} className="hover:underline">{b.who}</Link></td>}
              <td><Badge tone={b.outcome === "finished" ? "ok" : b.outcome === "failed" ? "bad" : "plain"}>{b.outcome === "finished" ? "Finished" : b.outcome === "failed" ? "Failed" : "Cancelled"}</Badge></td>
              <td className="tabular-nums">{dur(b.durationMs)}</td>
              <td className="tabular-nums">{b.photographs ?? ""}{b.used != null ? ` (${b.used} / ${b.refused ?? 0})` : ""}</td>
              <td>{b.crop ?? ""}</td><td>{b.camera ?? ""}</td>
              <td>{b.outcome === "failed" ? <><div>{STAGE_WORDS[b.stage ?? ""] ?? b.stage ?? ""}</div><div className="text-xs text-muted-foreground">{b.error}</div></> : ""}</td>
            </tr>
          ))}
        </Table>
      </Section>
      {!userId && stages.length > 0 && (
        <Section title="Where the time goes" hint="Median time per stage over finished builds.">
          <Table head={["Stage", "Median", "Builds"]} min={360}>
            {stages.map(s => <tr key={s.stage}><td>{STAGE_WORDS[s.stage] ?? s.stage}</td><td className="tabular-nums">{dur(s.medianMs)}</td><td className="tabular-nums">{s.builds}</td></tr>)}
          </Table>
        </Section>
      )}
    </div>
  );
}

export function TwinsSection({ snap, userId }: { snap: Snapshot; userId?: string }) {
  const twins = snap.twins.filter(t => !userId || t.user_id === userId);
  const reviewed = (id: string) => snap.reviews.filter(r => r.twin_id === id && r.finding_kind !== "boundary").length;
  return (
    <Section title="Field Twins" hint="Their records only. Opening one shows the participant's field and photograph crops, so it needs their troubleshooting permission and is logged.">
      <Table head={["Name", ...(userId ? [] : ["Owner"]), "State", "Crop", "Flown", "Photographs", "Camera", "Position", "Build", "Reviewed", ""]} min={1000} empty={twins.length ? false : "No Field Twins yet."}>
        {twins.map(t => {
          const stuck = t.status === "saving" && Date.now() - Date.parse(t.updated_at) > 30 * 60_000;
          return (
            <tr key={t.id}>
              <td className="font-medium">{t.name}<div className="text-xs font-normal text-muted-foreground">saved {day(t.created_at)}</div></td>
              {!userId && <td><Link to={`/admin/pilot/people/${t.user_id}`} className="hover:underline">{nameOf(snap, t.user_id)}</Link></td>}
              <td>{t.status === "ready" ? <Badge tone="ok">Saved</Badge> : stuck || t.status === "incomplete" ? <Badge tone="bad">Not saved completely</Badge> : <Badge tone="warn">Saving</Badge>}{t.error && <div className="text-xs text-muted-foreground">{t.error}</div>}</td>
              <td>{t.crop ?? ""}</td><td>{day(t.captured_at)}</td><td className="tabular-nums">{t.photographs ?? ""}</td><td>{t.camera ?? ""}</td>
              <td>{t.placement === "rtk" ? "RTK" : t.placement === "gnss" ? "GPS" : t.placement === "local" ? "test frame" : ""}</td>
              <td className="tabular-nums">{dur(t.build_ms)}</td><td className="tabular-nums">{reviewed(t.id)}</td>
              <td>{t.status === "ready" && <Button size="sm" variant="outline" asChild><Link to={`/admin/pilot/twins/${t.id}`}>Open</Link></Button>}</td>
            </tr>
          );
        })}
      </Table>
    </Section>
  );
}

export function ReviewsSection({ snap, userId }: { snap: Snapshot; userId?: string }) {
  const matrix = reviewMatrix(snap, userId);
  const said = (r: { finding_kind: string; verdict: string; says?: string | null }) => (r.verdict === "wrong" ? saysLabel(r.finding_kind as FindingKind, r.says) : null);
  const answers = wrongAnswers(snap, userId);
  const notes = snap.reviews.filter(r => (r.note || said(r)) && (!userId || r.user_id === userId)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const twinName = (id: string) => snap.twins.find(t => t.id === id)?.name ?? "a deleted twin";
  return (
    <div className="space-y-8">
      <Section title="What participants said about the findings" hint="Each row is a kind of finding and what Swardus called it; the columns are the participants' answers.">
        <Table head={["Finding", "What Swardus said", "Correct", "Not sure", "Wrong", "Wrong share"]} min={640} empty={matrix.length ? false : "No reviews yet."}>
          {matrix.map(m => (
            <tr key={`${m.kind}|${m.status}`}>
              <td>{m.kind.replace("_", " ")}</td><td>{m.status || ""}</td>
              <td className="tabular-nums">{m.correct}</td><td className="tabular-nums">{m.unsure}</td><td className="tabular-nums">{m.wrong}</td>
              <td className="tabular-nums">{Math.round((100 * m.wrong) / m.total)} %</td>
            </tr>
          ))}
        </Table>
      </Section>
      {answers.length > 0 && (
        <Section title="Corn findings marked wrong: what they said was there" hint="The participant's own answer beside what Swardus called the finding. Their word, counted; not a verified label, and nothing here changes a Field Twin.">
          <Table head={["Finding", "What Swardus said", "What the participant said", "Reviews", "People"]} min={640}>
            {answers.map(a => (
              <tr key={`${a.kind}|${a.status}|${a.says}`}>
                <td>{a.kind.replace("_", " ")}</td><td>{a.status || ""}</td>
                <td>{a.says ? saysLabel(a.kind as FindingKind, a.says) ?? a.says : <span className="text-muted-foreground">No answer given</span>}</td>
                <td className="tabular-nums">{a.count}</td><td className="tabular-nums">{a.people}</td>
              </tr>
            ))}
          </Table>
        </Section>
      )}
      <Section title="Their notes and answers">
        <Table head={["When", ...(userId ? [] : ["Who"]), "Field Twin", "Finding", "Answer", "Note"]} min={800} empty={notes.length ? false : "No notes yet."}>
          {notes.map((r, i) => (
            <tr key={i}>
              <td>{when(r.updated_at)}</td>{!userId && <td>{nameOf(snap, r.user_id)}</td>}<td>{twinName(r.twin_id)}</td>
              <td>{r.finding_kind.replace("_", " ")} {r.finding_id}{r.algorithm_status ? <span className="text-muted-foreground"> ({r.algorithm_status})</span> : null}</td>
              <td><Badge tone={r.verdict === "correct" ? "ok" : r.verdict === "wrong" ? "bad" : "plain"}>{VERDICT[r.verdict]}</Badge>{said(r) ? <div className="mt-0.5 text-xs">{said(r)}</div> : null}</td>
              <td className="whitespace-pre-wrap">{r.note}</td>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}

export function FeedbackSection({ snap, userId, onChanged }: { snap: Snapshot; userId?: string; onChanged: () => void }) {
  const items = snap.feedback.filter(f => !userId || f.user_id === userId);
  const mark = async (id: string, status: "new" | "seen" | "done") => {
    try { await pilotAdmin("feedback-status", { id, status }); onChanged(); } catch (e) { toast.error("Not changed", { description: (e as Error).message }); }
  };
  const KIND: Record<string, string> = { problem: "Problem", idea: "Idea", finding: "A finding looks wrong", other: "Other" };
  return (
    <Section title="Feedback" hint="Newest first. Reply by email; mark it seen or done here.">
      {items.length === 0 ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No feedback yet.</p> : (
        <ul className="space-y-2">
          {items.map(f => {
            const email = snap.users.find(u => u.id === f.user_id)?.email;
            const twin = f.twin_id ? snap.twins.find(t => t.id === f.twin_id)?.name : null;
            return (
              <li key={f.id} className={`rounded-md border bg-card p-3 text-sm ${f.status === "new" ? "border-amber-300" : ""}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={f.status === "new" ? "warn" : f.status === "done" ? "ok" : "plain"}>{f.status === "new" ? "New" : f.status === "seen" ? "Seen" : "Done"}</Badge>
                    <span className="font-medium">{KIND[f.kind] ?? f.kind}</span>
                    <span className="text-xs text-muted-foreground">{nameOf(snap, f.user_id)} · {when(f.created_at)}{twin ? ` · ${twin}` : ""}{f.route ? ` · ${f.route}` : ""}{f.notified_at ? "" : " · email alert not sent"}</span>
                  </span>
                  <span className="flex gap-1">
                    {email && <Button size="sm" variant="outline" asChild><a href={`mailto:${email}?subject=${encodeURIComponent("Your Swardus feedback")}`}>Reply</a></Button>}
                    {f.status !== "seen" && <Button size="sm" variant="ghost" onClick={() => void mark(f.id, "seen")}>Seen</Button>}
                    {f.status !== "done" && <Button size="sm" variant="ghost" onClick={() => void mark(f.id, "done")}>Done</Button>}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap">{f.message}</p>
                {f.context && Object.keys(f.context).length > 0 && (
                  <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Details sent with it</summary>
                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3">{Object.entries(f.context).map(([k, v]) => <div key={k} className="contents"><dt>{k}</dt><dd className="break-all">{String(v)}</dd></div>)}</dl>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

export function ErrorsSection({ snap }: { snap: Snapshot }) {
  const groups = errorGroups(snap);
  const KIND: Record<string, string> = { client_error: "App error", twin_build_failed: "Build failed", twin_save_failed: "Save failed", twin_open_failed: "Could not open" };
  return (
    <Section title="Errors" hint="Grouped by message (numbers folded together), most frequent first. Messages are scrubbed of file names and coordinates before they are recorded.">
      <Table head={["What", "Message", "Times", "People", "Last"]} min={760} empty={groups.length ? false : "No errors recorded."}>
        {groups.map((g, i) => <tr key={i}><td><Badge tone="bad">{KIND[g.kind] ?? g.kind}</Badge></td><td className="text-xs">{g.message}</td><td className="tabular-nums">{g.count}</td><td className="tabular-nums">{g.people}</td><td>{ago(g.last)}</td></tr>)}
      </Table>
    </Section>
  );
}

export function AccessSection({ snap }: { snap: Snapshot }) {
  const consentRows = snap.members.filter(m => m.role === "participant").map(m => {
    const c = snap.consents.filter(x => x.user_id === m.user_id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return { m, c };
  });
  return (
    <div className="space-y-8">
      <Section title="What each participant allowed" hint="Their newest answer. Troubleshooting access is what lets you open their Field Twins here.">
        <Table head={["Who", "Terms", "Troubleshooting access", "Research use", "Answered"]} min={640} empty={consentRows.length ? false : "No participants yet."}>
          {consentRows.map(({ m, c }) => (
            <tr key={m.user_id}>
              <td>{nameOf(snap, m.user_id)}</td>
              <td>{c ? c.terms_version : <Badge tone="warn">Not accepted yet</Badge>}</td>
              <td>{c ? <Badge tone={c.troubleshooting_access ? "ok" : "plain"}>{c.troubleshooting_access ? "Allowed" : "Not allowed"}</Badge> : ""}</td>
              <td>{c ? <Badge tone={c.research_use ? "ok" : "plain"}>{c.research_use ? "Allowed" : "Not allowed"}</Badge> : ""}</td>
              <td>{c ? when(c.created_at) : ""}</td>
            </tr>
          ))}
        </Table>
      </Section>
      <Section title="Every time a participant's Field Twin was opened here" hint="Participants can see these entries about themselves.">
        <Table head={["When", "Whose", "Field Twin", "Why"]} min={600} empty={snap.access.length ? false : "Nobody's Field Twin has been opened from the admin panel."}>
          {snap.access.map((a, i) => <tr key={i}><td>{when(a.at)}</td><td>{nameOf(snap, a.participant_id)}</td><td>{snap.twins.find(t => t.id === a.twin_id)?.name ?? "deleted"}</td><td>{a.reason ?? ""}</td></tr>)}
        </Table>
      </Section>
    </div>
  );
}
