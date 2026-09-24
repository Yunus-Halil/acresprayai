// The four numbers on the dashboard.
//
// Pure, because a headline figure is exactly the kind of number nobody checks.
// It sits at the top of the first screen an operator sees, it looks
// authoritative, and if it is wrong it is wrong quietly. Everything here is
// arithmetic over rows the app already stores, in one place, with tests.
//
// Nothing in this file decides what a weed is or what a zone is worth. Those
// decisions belong to `treatment/groups.ts` and `treatment/plannedArea.ts` and
// are imported, not repeated: a dashboard that disagrees with the screen it
// links to is worse than a dashboard with no number on it.
import { type GroupablePoly, isWeedPoly } from "../treatment/groups";

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export type FieldRow = { id: string; boundary: unknown | null };

export type FieldTally = {
  total: number;
  /** Fields whose outline has been drawn, so their acreage is measured. */
  mapped: number;
  /** Fields still waiting for one. Nothing downstream can plan against these. */
  awaiting: number;
};

export function tallyFields(fields: readonly FieldRow[]): FieldTally {
  const mapped = fields.reduce((n, f) => n + (f.boundary ? 1 : 0), 0);
  return { total: fields.length, mapped, awaiting: fields.length - mapped };
}

// ---------------------------------------------------------------------------
// Weed-affected area
// ---------------------------------------------------------------------------

/**
 * A saved annotation, as `user_annotations` stores it.
 *
 * `area_hectares` is the area of the shape as drawn or as the scout measured
 * it. It is NOT the treated area: the planner clips zones to the boundary and
 * insets a headland before it prices anything, and it recomputes rather than
 * trusting this column. Both numbers are correct for their own question. This
 * card asks how much ground is affected, which is the unclipped one; anything
 * about spraying has to come from `plannedArea.ts`.
 */
export type AnnotationRow = GroupablePoly & {
  field_id: string | null;
  task_id: string | null;
  area_hectares: number | string | null;
  created_at: string;
};

/** A scan, for deciding which one is a field's most recent. */
export type ScanRow = { id: string; field_id: string; created_at: string };

export type WeedArea = {
  /**
   * Hectares of weed-affected ground, counted once per field.
   *
   * Null, never zero, when nothing has been reviewed. Zero is a finding: it
   * says the operator looked and found nothing. Null says nobody has looked,
   * and the card has to be able to tell those apart.
   */
  hectares: number | null;
  /** Fields contributing to the total. */
  fields: number;
  /** Weed zones behind it. */
  zones: number;
};

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Weed-affected hectares across every field, counted once each.
 *
 * ONE SCAN PER FIELD, OR THE SAME GROUND IS COUNTED TWICE. A field flown in
 * June and again in August has two sets of annotations over one piece of
 * ground. Summing both would roughly double the headline, and it would grow
 * every time somebody re-flew a field they had already fixed, which is the
 * opposite of what the number is for.
 *
 * The scan chosen is the field's most recent one THAT HAS WEED ANNOTATIONS, not
 * simply its most recent. A scan uploaded this morning and not yet reviewed
 * would otherwise erase a finding from last week that is still in the ground.
 *
 * Scans are ordered by `scans`.created_at where a row is available, and by the
 * annotations' own created_at where it is not, so a missing scan row degrades
 * to a reasonable answer rather than to nothing.
 */
export function weedArea(
  annotations: readonly AnnotationRow[],
  scans: readonly ScanRow[] = [],
): WeedArea {
  const scanTime = new Map(scans.map(s => [s.id, Date.parse(s.created_at) || 0]));

  // field -> task -> { hectares, zones, when }
  const byField = new Map<string, Map<string, { hectares: number; zones: number; when: number }>>();

  for (const a of annotations) {
    if (!a.field_id) continue;
    if (!isWeedPoly(a)) continue;
    const task = a.task_id ?? "";
    const tasks = byField.get(a.field_id) ?? new Map();
    const entry = tasks.get(task) ?? { hectares: 0, zones: 0, when: 0 };
    entry.hectares += num(a.area_hectares);
    entry.zones += 1;
    entry.when = Math.max(entry.when, scanTime.get(task) ?? Date.parse(a.created_at) ?? 0);
    tasks.set(task, entry);
    byField.set(a.field_id, tasks);
  }

  if (byField.size === 0) return { hectares: null, fields: 0, zones: 0 };

  let hectares = 0;
  let fields = 0;
  let zones = 0;
  for (const tasks of byField.values()) {
    let best: { hectares: number; zones: number; when: number } | null = null;
    for (const entry of tasks.values()) if (!best || entry.when > best.when) best = entry;
    if (!best) continue;
    hectares += best.hectares;
    zones += best.zones;
    fields += 1;
  }
  return { hectares, fields, zones };
}

// ---------------------------------------------------------------------------
// Missions ready
// ---------------------------------------------------------------------------

/**
 * A scheduled mission, as `lib/schedule.ts` reads it back.
 *
 * Only the two fields this needs, so the dashboard does not become a second
 * definition of what a mission is.
 */
export type MissionRow = { status: string; scheduledAt: string };

/**
 * Missions that have been planned and not yet flown.
 *
 * WHY THIS AND NOT A READINESS COLUMN. There is no readiness column. A mission
 * row exists only once the planner has produced its stats and the operator has
 * pressed Save in the schedule modal, so the row's existence IS the evidence
 * that planning finished: an unfinished plan never becomes a row. What the app
 * does not have is a completed state, because nothing ever writes `status` to
 * anything but "scheduled" and completion is recorded separately as a
 * `flight_logs` entry. So a mission whose slot has passed is treated as done.
 *
 * That last part is a judgement and it can be wrong in one direction: a mission
 * booked for Tuesday and rained off is no longer counted, though it still needs
 * flying. The alternative, counting it forever, would grow a number that only
 * ever goes up, which is worse for a figure whose whole job is to say what is
 * outstanding.
 */
export function missionsReady(missions: readonly MissionRow[], now: Date = new Date()): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const from = start.getTime();
  return missions.reduce((n, m) => {
    if (m.status !== "scheduled") return n;
    const at = Date.parse(m.scheduledAt);
    if (!Number.isFinite(at) || at < from) return n;
    return n + 1;
  }, 0);
}
