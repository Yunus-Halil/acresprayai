// Scheduled missions — persistence over the `jobs` table.
//
// WHY `jobs` AND NOT A NEW TABLE. `jobs` has existed since the first migration
// and nothing has ever read or written it. It already carries user_id,
// field_id, scan_id, drone_id, type, status, scheduled_at, chemical, dose_l_ha,
// area_ha and notes, plus an RLS policy scoping every row to its owner. A new
// `scheduled_missions` table would have duplicated all of that to add three
// columns.
//
// THE STATS ARE A SNAPSHOT. `stats` is the frozen output of
// computeMissionStats() at the moment Save was pressed. It is never recomputed
// on read. A calendar entry answers "what did we commit to?" and that answer
// must not drift because someone later redrew the boundary or swapped a
// battery.
import { supabase } from "@/integrations/supabase/client";
import type { MissionStats } from "./missionStats";

export type ScheduleLocation = { lat: number; lng: number; label?: string };

/** The persisted subset of MissionStats — the diagnostic breakdown is not kept. */
export type ScheduledStats = Pick<
  MissionStats,
  "batteriesNeeded" | "flightTimeMinutes" | "pesticideAmountLiters" | "flightConditions" | "treatedAreaHa"
>;

export type ScheduledMission = {
  id: string;
  fieldId: string | null;
  scanId: string | null;
  flightPlanId: string | null;
  scheduledAt: string;
  location: ScheduleLocation | null;
  droneId: string | null;
  status: string;
  chemical: string | null;
  notes: string | null;
  stats: ScheduledStats | null;
  createdAt: string;
};

export type NewScheduledMission = {
  fieldId: string | null;
  /**
   * A `scans` row id, or null.
   *
   * Almost always null: `jobs.scan_id` is a foreign key onto `scans`, the older
   * single-image table, while the orthomosaic workspace runs on `odm_tasks`.
   * The two are independent — both keyed to a field, neither referencing the
   * other — so an odm_task id put here fails jobs_scan_id_fkey. The odm_task id
   * belongs in `flightPlanId`, which carries no constraint.
   */
  scanId: string | null;
  flightPlanId: string | null;
  scheduledAt: string;
  location: ScheduleLocation | null;
  droneId: string | null;
  chemical: string | null;
  notes: string | null;
  stats: ScheduledStats;
};

/**
 * Postgres "column does not exist".
 *
 * The three snapshot columns arrive in a migration that has to be pushed
 * separately. Until it is, scheduling still works on the columns that have been
 * there since day one — date, field, drone, chemical, dose and area — and the
 * caller is told the snapshot could not be stored. Degrading to a real, if
 * thinner, calendar entry beats refusing to schedule at all.
 */
const UNDEFINED_COLUMN = "42703";

export type SaveResult = { mission: ScheduledMission; snapshotStored: boolean };

const rowToMission = (r: Record<string, unknown>): ScheduledMission => ({
  id: String(r.id),
  fieldId: (r.field_id as string) ?? null,
  scanId: (r.scan_id as string) ?? null,
  flightPlanId: (r.flight_plan_id as string) ?? null,
  scheduledAt: String(r.scheduled_at),
  location: (r.location as ScheduleLocation) ?? null,
  droneId: (r.drone_id as string) ?? null,
  status: (r.status as string) ?? "scheduled",
  chemical: (r.chemical as string) ?? null,
  notes: (r.notes as string) ?? null,
  stats: (r.stats as ScheduledStats) ?? null,
  createdAt: String(r.created_at ?? ""),
});

/**
 * Missions overlapping a window, oldest first.
 *
 * `select("*")` rather than a column list on purpose: it returns whatever the
 * table actually has, so this same code reads correctly before and after the
 * snapshot columns land.
 */
export async function listMissions(fromISO: string, toISO: string): Promise<ScheduledMission[]> {
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .gte("scheduled_at", fromISO)
    .lt("scheduled_at", toISO)
    .order("scheduled_at", { ascending: true });
  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? []).map(rowToMission);
}

export async function saveMission(input: NewScheduledMission): Promise<SaveResult> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) throw new Error("Not signed in");

  // Columns that have existed since the first migration. `area_ha` and
  // `dose_l_ha` are denormalised out of the snapshot so the row remains
  // queryable — and readable by anything that never learns about `stats`.
  const core = {
    user_id: userId,
    field_id: input.fieldId,
    scan_id: input.scanId,
    drone_id: input.droneId,
    type: "spray",
    status: "scheduled",
    scheduled_at: input.scheduledAt,
    chemical: input.chemical,
    area_ha: input.stats.treatedAreaHa,
    dose_l_ha: input.stats.treatedAreaHa > 0
      ? input.stats.pesticideAmountLiters / input.stats.treatedAreaHa
      : null,
    notes: input.notes,
  };
  const extended = {
    ...core,
    flight_plan_id: input.flightPlanId,
    location: input.location,
    stats: input.stats,
  };

  const first = await supabase.from("jobs").insert(extended as never).select("*").single();
  if (!first.error) {
    return { mission: rowToMission(first.data as Record<string, unknown>), snapshotStored: true };
  }
  if (first.error.code !== UNDEFINED_COLUMN) throw first.error;

  const retry = await supabase.from("jobs").insert(core as never).select("*").single();
  if (retry.error) throw retry.error;
  return { mission: rowToMission(retry.data as Record<string, unknown>), snapshotStored: false };
}

export async function deleteMission(id: string): Promise<void> {
  const { error } = await supabase.from("jobs").delete().eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Calendar shaping — pure, so the month grid can be tested without a database
// ---------------------------------------------------------------------------

/** Local-time YYYY-MM-DD. Grouping must use the viewer's day, not UTC's. */
export function dayKey(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Missions bucketed by local day.
 *
 * A day with several missions keeps all of them, in time order — the calendar
 * stacks them in the cell rather than letting the last one win.
 */
export function groupByDay(missions: ScheduledMission[]): Map<string, ScheduledMission[]> {
  const out = new Map<string, ScheduledMission[]>();
  for (const m of missions) {
    const k = dayKey(m.scheduledAt);
    const list = out.get(k);
    if (list) list.push(m); else out.set(k, [m]);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  }
  return out;
}

/**
 * The 6×7 grid a month view draws, including the leading and trailing days
 * borrowed from the neighbouring months.
 *
 * Always six rows so the grid does not change height as the user pages through
 * months — a calendar that resizes under the cursor is a calendar that gets
 * mis-clicked.
 */
export function monthGrid(year: number, month: number, weekStartsOn: 0 | 1 = 0): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() - weekStartsOn + 7) % 7;
  const start = new Date(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, i) =>
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/** Half-open [from, to) covering everything the month grid can show. */
export function monthRangeISO(year: number, month: number, weekStartsOn: 0 | 1 = 0) {
  const grid = monthGrid(year, month, weekStartsOn);
  const from = grid[0];
  const last = grid[grid.length - 1];
  const to = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
  return { fromISO: from.toISOString(), toISO: to.toISOString() };
}
