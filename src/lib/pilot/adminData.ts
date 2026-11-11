// The admin panel's numbers, derived from one snapshot (pilot-admin "snapshot"). Pure functions, so every figure
// the founder sees is tested.

export type SnapUser = { id: string; email: string | null; created_at: string | null; last_sign_in_at: string | null; confirmed: boolean; provider: string | null };
export type SnapMember = { user_id: string; role: "founder" | "participant"; status: "active" | "paused" | "ended"; email: string | null; display_name: string | null; organisation: string | null; application_id: string | null; invited_at: string | null; created_at: string; notes: string | null };
export type SnapEvent = { id: number; user_id: string; at: string; name: string; session_id: string | null; route: string | null; twin_id: string | null; duration_ms: number | null; outcome: string | null; error: string | null; counts: Record<string, number> | null; stages: Record<string, number> | null; detail: Record<string, unknown> | null; app_version: string | null };
export type SnapTwin = { id: string; user_id: string; name: string; crop: string | null; captured_at: string | null; photographs: number | null; camera: string | null; placement: string | null; area_ha: number | null; status: string; error: string | null; build_ms: number | null; created_at: string; updated_at: string };
export type SnapReview = { user_id: string; twin_id: string; finding_kind: string; finding_id: string; verdict: "correct" | "unsure" | "wrong"; note: string | null; algorithm_status: string | null; created_at: string; updated_at: string };
export type SnapFeedback = { id: string; user_id: string; created_at: string; kind: string; message: string; route: string | null; twin_id: string | null; context: Record<string, unknown> | null; status: "new" | "seen" | "done"; notified_at: string | null };
export type SnapConsent = { user_id: string; created_at: string; terms_version: string; troubleshooting_access: boolean; research_use: boolean };
export type SnapAccess = { at: string; founder_id: string; participant_id: string; twin_id: string | null; action: string; reason: string | null };
export type Snapshot = {
  generated_at: string; users: SnapUser[]; members: SnapMember[]; events: SnapEvent[]; twins: SnapTwin[]; reviews: SnapReview[];
  feedback: SnapFeedback[]; consents: SnapConsent[]; applications: Record<string, unknown>[]; access: SnapAccess[];
  missing: Record<string, boolean>;
};

const DAY = 86_400_000;
export const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const isBuildEnd = (name: string) => name === "twin_build_finished" || name === "twin_build_failed" || name === "twin_build_cancelled";

/** A person's name as the founder knows them. */
export function nameOf(s: Pick<Snapshot, "members" | "users">, userId: string): string {
  const m = s.members.find(x => x.user_id === userId);
  return m?.display_name || m?.email || s.users.find(u => u.id === userId)?.email || "Unknown account";
}

/** The newest consent row of a person, or null if they never answered. */
export function latestConsent(s: Pick<Snapshot, "consents">, userId: string): SnapConsent | null {
  return s.consents.filter(c => c.user_id === userId).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

export type PersonStats = {
  member: SnapMember; name: string; email: string | null; lastSignIn: string | null; lastActive: string | null; daysActive: number;
  twinsReady: number; twinsIncomplete: number; buildsOk: number; buildsFailed: number; buildsCancelled: number; savesFailed: number;
  medianBuildMs: number | null; reviews: number; wrong: number; feedback: number; errors: number; consent: SnapConsent | null;
  /** "new" (never signed in), "invited" (signed in, no build yet), "building" (has builds), "reviewing" (has reviews), "quiet" (nothing for 14 days). */
  stage: "new" | "invited" | "building" | "reviewing" | "quiet";
};

export function personStats(s: Snapshot, now = Date.now()): PersonStats[] {
  return s.members.map(member => {
    const id = member.user_id;
    const ev = s.events.filter(e => e.user_id === id);
    const user = s.users.find(u => u.id === id);
    const builds = ev.filter(e => isBuildEnd(e.name));
    const finished = builds.filter(e => e.name === "twin_build_finished");
    const reviews = s.reviews.filter(r => r.user_id === id);
    const lastActive = ev.reduce<string | null>((a, e) => (!a || e.at > a ? e.at : a), null);
    const lastSignIn = user?.last_sign_in_at ?? null;
    const latest = [lastActive, lastSignIn].filter(Boolean).sort().pop() ?? null;
    let stage: PersonStats["stage"] = !lastSignIn ? "new" : reviews.length ? "reviewing" : builds.length ? "building" : "invited";
    if (lastSignIn && latest && now - Date.parse(latest) > 14 * DAY) stage = "quiet";
    return {
      member, name: nameOf(s, id), email: user?.email ?? member.email, lastSignIn, lastActive,
      daysActive: new Set(ev.map(e => e.at.slice(0, 10))).size,
      twinsReady: s.twins.filter(t => t.user_id === id && t.status === "ready").length,
      twinsIncomplete: s.twins.filter(t => t.user_id === id && t.status !== "ready").length,
      buildsOk: finished.length,
      buildsFailed: builds.filter(e => e.name === "twin_build_failed").length,
      buildsCancelled: builds.filter(e => e.name === "twin_build_cancelled").length,
      savesFailed: ev.filter(e => e.name === "twin_save_failed").length,
      medianBuildMs: median(finished.map(e => e.duration_ms ?? 0).filter(x => x > 0)),
      reviews: reviews.length, wrong: reviews.filter(r => r.verdict === "wrong").length,
      feedback: s.feedback.filter(f => f.user_id === id).length,
      errors: ev.filter(e => e.name === "client_error").length,
      consent: latestConsent(s, id),
      stage,
    };
  });
}

export type Day = { day: string; people: number; builds: number; failed: number; reviews: number; feedback: number };

/** One row per day for the last `days` days (oldest first), participants only. */
export function daily(s: Snapshot, days = 30, now = Date.now()): Day[] {
  const participants = new Set(s.members.filter(m => m.role === "participant").map(m => m.user_id));
  const out: Day[] = [];
  for (let k = days - 1; k >= 0; k--) {
    const day = new Date(now - k * DAY).toISOString().slice(0, 10);
    const ev = s.events.filter(e => e.at.startsWith(day) && participants.has(e.user_id));
    out.push({
      day,
      people: new Set(ev.map(e => e.user_id)).size,
      builds: ev.filter(e => e.name === "twin_build_finished").length,
      failed: ev.filter(e => e.name === "twin_build_failed").length,
      reviews: s.reviews.filter(r => r.updated_at.startsWith(day) && participants.has(r.user_id)).length,
      feedback: s.feedback.filter(f => f.created_at.startsWith(day) && participants.has(f.user_id)).length,
    });
  }
  return out;
}

export type Overview = {
  participants: number; activeLast7: number; neverSignedIn: number; twinsReady: number; builds: number; buildSuccessPct: number | null;
  medianBuildMs: number | null; reviews: number; wrongPct: number | null; feedbackNew: number; errorsLast7: number;
};

export function overview(s: Snapshot, now = Date.now()): Overview {
  const people = personStats(s, now).filter(p => p.member.role === "participant");
  const ids = new Set(people.map(p => p.member.user_id));
  const ev = s.events.filter(e => ids.has(e.user_id));
  const ends = ev.filter(e => isBuildEnd(e.name) && e.name !== "twin_build_cancelled");
  const ok = ends.filter(e => e.name === "twin_build_finished");
  const reviews = s.reviews.filter(r => ids.has(r.user_id));
  return {
    participants: people.length,
    activeLast7: people.filter(p => p.lastActive && now - Date.parse(p.lastActive) <= 7 * DAY).length,
    neverSignedIn: people.filter(p => !p.lastSignIn).length,
    twinsReady: s.twins.filter(t => ids.has(t.user_id) && t.status === "ready").length,
    builds: ends.length,
    buildSuccessPct: ends.length ? Math.round((100 * ok.length) / ends.length) : null,
    medianBuildMs: median(ok.map(e => e.duration_ms ?? 0).filter(x => x > 0)),
    reviews: reviews.length,
    wrongPct: reviews.length ? Math.round((100 * reviews.filter(r => r.verdict === "wrong").length) / reviews.length) : null,
    feedbackNew: s.feedback.filter(f => f.status === "new").length,
    errorsLast7: ev.filter(e => e.name === "client_error" && now - Date.parse(e.at) <= 7 * DAY).length,
  };
}

export type BuildRow = { at: string; userId: string; who: string; outcome: "finished" | "failed" | "cancelled"; durationMs: number | null; photographs: number | null; used: number | null; refused: number | null; crop: string | null; camera: string | null; stage: string | null; error: string | null; stages: Record<string, number> | null };

/** A plain string or null: whatever a record holds, the panel renders text. */
const str = (v: unknown): string | null => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function buildRows(s: Snapshot): BuildRow[] {
  return s.events.filter(e => isBuildEnd(e.name)).sort((a, b) => b.at.localeCompare(a.at)).map(e => ({
    at: e.at, userId: e.user_id, who: nameOf(s, e.user_id), outcome: e.name.replace("twin_build_", "") as BuildRow["outcome"], durationMs: e.duration_ms,
    photographs: num(e.counts?.photographs), used: num(e.counts?.used), refused: num(e.counts?.refused),
    crop: str(e.detail?.crop), camera: str(e.detail?.camera),
    stage: str(e.detail?.stage), error: e.error, stages: e.stages,
  }));
}

/** Median time of each build stage over finished builds, slowest first. */
export function stageTimes(s: Snapshot): { stage: string; medianMs: number; builds: number }[] {
  const by = new Map<string, number[]>();
  for (const e of s.events) if (e.name === "twin_build_finished" && e.stages) for (const [k, v] of Object.entries(e.stages)) by.set(k, [...(by.get(k) ?? []), v]);
  return [...by.entries()].map(([stage, xs]) => ({ stage, medianMs: median(xs) ?? 0, builds: xs.length })).sort((a, b) => b.medianMs - a.medianMs);
}

/** Verdicts by finding kind and what Swardus said, most reviewed first. */
export function reviewMatrix(s: Snapshot, userId?: string): { kind: string; status: string; correct: number; unsure: number; wrong: number; total: number }[] {
  const m = new Map<string, { kind: string; status: string; correct: number; unsure: number; wrong: number; total: number }>();
  for (const r of s.reviews) {
    if (userId && r.user_id !== userId) continue;
    const key = `${r.finding_kind}|${r.algorithm_status ?? ""}`;
    const row = m.get(key) ?? { kind: r.finding_kind, status: r.algorithm_status ?? "", correct: 0, unsure: 0, wrong: 0, total: 0 };
    row[r.verdict]++; row.total++;
    m.set(key, row);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

/** Errors grouped by message (numbers and ids folded), most frequent first. */
export function errorGroups(s: Snapshot): { message: string; kind: string; count: number; people: number; last: string }[] {
  const g = new Map<string, { message: string; kind: string; count: number; users: Set<string>; last: string }>();
  for (const e of s.events) {
    if (!(e.name === "client_error" || e.name === "twin_build_failed" || e.name === "twin_save_failed" || e.name === "twin_open_failed")) continue;
    const message = (e.error ?? "(no message)").replace(/\b[0-9a-f]{8,}\b/gi, "#").replace(/\d+/g, "n").slice(0, 200);
    const key = `${e.name}|${message}`;
    const row = g.get(key) ?? { message, kind: e.name, count: 0, users: new Set<string>(), last: e.at };
    row.count++; row.users.add(e.user_id); if (e.at > row.last) row.last = e.at;
    g.set(key, row);
  }
  return [...g.values()].map(r => ({ message: r.message, kind: r.kind, count: r.count, people: r.users.size, last: r.last })).sort((a, b) => b.count - a.count);
}

/** The photograph checks: how many sets were checked, how many stopped, photographs offered and usable. */
export function checkSummary(s: Snapshot): { checks: number; stopped: number; files: number; usable: number } {
  const c = s.events.filter(e => e.name === "twin_check_done");
  return { checks: c.length, stopped: c.filter(e => (e.counts?.stops ?? 0) > 0).length, files: c.reduce((a, e) => a + (e.counts?.files ?? 0), 0), usable: c.reduce((a, e) => a + (e.counts?.usable ?? 0), 0) };
}

/** Everything one person did, newest first, in plain words. */
export function timeline(s: Snapshot, userId: string): { at: string; text: string; tone: "ok" | "bad" | "plain" }[] {
  const words: Record<string, string> = {
    session_start: "Opened Swardus", twin_check_done: "Checked photographs", twin_build_started: "Started a build", twin_build_finished: "Build finished",
    twin_build_failed: "Build failed", twin_build_cancelled: "Build cancelled", twin_saved: "Field Twin saved", twin_save_failed: "Save failed", twin_analysis_saved: "Analysis record saved", twin_analysis_failed: "Analysis record not saved",
    twin_opened: "Opened a Field Twin", twin_open_failed: "Could not open a Field Twin", twin_deleted: "Deleted a Field Twin",
    finding_reviewed: "Reviewed a finding", feedback_sent: "Sent feedback", client_error: "Error in the app",
  };
  const twinName = (id: string | null) => (id ? s.twins.find(t => t.id === id)?.name : undefined);
  return s.events.filter(e => e.user_id === userId).sort((a, b) => b.at.localeCompare(a.at)).map(e => {
    const bits: string[] = [];
    if (twinName(e.twin_id)) bits.push(`"${twinName(e.twin_id)}"`);
    if (e.duration_ms && (e.name === "twin_build_finished" || e.name === "twin_build_failed")) bits.push(`${Math.round(e.duration_ms / 1000)} s`);
    if (e.counts?.photographs != null && e.name.startsWith("twin_build")) bits.push(`${e.counts.photographs} photographs`);
    if (e.name === "twin_check_done" && e.counts) bits.push(`${e.counts.usable ?? 0} of ${e.counts.files ?? 0} usable`);
    if (e.name === "finding_reviewed" && e.detail) bits.push(`${String(e.detail.kind ?? "")} ${String(e.detail.verdict ?? "")}`.trim());
    if (e.error) bits.push(e.error);
    const bad = e.outcome === "error" || e.name === "client_error";
    return { at: e.at, text: `${words[e.name] ?? e.name}${bits.length ? `: ${bits.join(", ")}` : ""}`, tone: bad ? "bad" : e.name === "twin_build_finished" || e.name === "twin_saved" ? "ok" : "plain" };
  });
}
