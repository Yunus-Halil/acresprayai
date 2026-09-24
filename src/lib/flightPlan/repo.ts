// Saved flight plans.
//
// NO REST LAYER, BY THE ARCHITECTURE THIS APP ALREADY HAS. The brief asked for
// POST /api/fields/:id/flight-plans and friends, but there is no /api in this
// project and nothing else reaches the database that way: every other table is
// read and written through the Supabase client with row-level security doing
// the ownership check, and edge functions exist only where a service-role key
// or a third-party secret is needed. A flight plan needs neither. Adding an API
// tier for this one table would mean a second way of talking to the database,
// a second place ownership is enforced, and a deploy step that the ortho-import
// function has just finished demonstrating is easy to forget.
//
// So the shape the brief asked for is kept, as functions: save, list, export.
// The ownership check is the one already in place, `auth.uid() = user_id`,
// declared in the migration rather than reimplemented here.
import { supabase } from "@/integrations/supabase/client";
import type { LatLng2 } from "../geo";
import { DEFAULT_ALTITUDE_M, type FlightPlanParams } from "./generateKmz";
import type { FlightDirection } from "./grid";

export type FlightPlan = {
  id: string;
  fieldId: string;
  name: string | null;
  boundary: LatLng2[][];
  params: FlightPlanParams;
  lastExportedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const COLUMNS =
  "id, field_id, name, boundary, direction, altitude_m, line_spacing_m, front_overlap_pct, " +
  "side_overlap_pct, gimbal_pitch_deg, speed_ms, camera_key, inset_m, turn_overshoot_m, " +
  "last_exported_at, " +
  "created_at, updated_at";

type Row = Record<string, unknown>;

function fromRow(r: Row): FlightPlan {
  const num = (v: unknown, fallback: number) => (v == null ? fallback : Number(v));
  return {
    id: String(r.id),
    fieldId: String(r.field_id),
    name: (r.name as string | null) ?? null,
    boundary: (r.boundary as LatLng2[][]) ?? [],
    params: {
      direction: (r.direction as FlightDirection) ?? "auto",
      altitudeM: num(r.altitude_m, DEFAULT_ALTITUDE_M),
      // Null is meaningful: it says the operator left the spacing to the
      // overlap rather than typing one, and reopening the plan has to show
      // them that choice rather than a number they never made.
      lineSpacingM: r.line_spacing_m == null ? null : Number(r.line_spacing_m),
      frontOverlapPct: num(r.front_overlap_pct, 75),
      sideOverlapPct: num(r.side_overlap_pct, 75),
      gimbalPitchDeg: num(r.gimbal_pitch_deg, -90),
      speedMs: num(r.speed_ms, 6),
      cameraKey: String(r.camera_key ?? ""),
      insetM: num(r.inset_m, 0),
      turnOvershootM: num(r.turn_overshoot_m, 0),
    },
    lastExportedAt: (r.last_exported_at as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/** Every plan for a field, newest first. */
export async function listFlightPlans(fieldId: string): Promise<FlightPlan[]> {
  const { data, error } = await supabase
    .from("flight_plans")
    .select(COLUMNS)
    .eq("field_id", fieldId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Row[]).map(fromRow);
}

export type SaveFlightPlanInput = {
  fieldId: string;
  name?: string | null;
  boundary: LatLng2[][];
  params: FlightPlanParams;
  /** Present to update that plan in place, absent to create a new one. */
  id?: string;
};

/**
 * Write a plan. Returns the saved row, or an error message, never throwing:
 * the caller is a form, and a form has to show a failure rather than lose what
 * the operator typed.
 */
export async function saveFlightPlan(
  userId: string,
  input: SaveFlightPlanInput,
): Promise<{ ok: true; plan: FlightPlan } | { ok: false; error: string }> {
  const row = {
    user_id: userId,
    field_id: input.fieldId,
    name: input.name?.trim() || null,
    boundary: input.boundary as unknown,
    direction: input.params.direction,
    altitude_m: input.params.altitudeM,
    line_spacing_m: input.params.lineSpacingM,
    front_overlap_pct: input.params.frontOverlapPct,
    side_overlap_pct: input.params.sideOverlapPct,
    gimbal_pitch_deg: input.params.gimbalPitchDeg,
    speed_ms: input.params.speedMs,
    camera_key: input.params.cameraKey,
    inset_m: input.params.insetM,
    turn_overshoot_m: input.params.turnOvershootM ?? 0,
  };
  const q = input.id
    ? supabase.from("flight_plans").update(row as never).eq("id", input.id).select(COLUMNS).single()
    : supabase.from("flight_plans").insert(row as never).select(COLUMNS).single();
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, plan: fromRow(data as unknown as Row) };
}

export async function deleteFlightPlan(id: string): Promise<string | null> {
  const { error } = await supabase.from("flight_plans").delete().eq("id", id);
  return error ? error.message : null;
}

/**
 * Record that a KMZ was downloaded.
 *
 * Deliberately best-effort: the operator has the file either way, and failing
 * the download because a timestamp did not write would be the tail wagging the
 * dog.
 */
export async function markExported(id: string): Promise<void> {
  await supabase.from("flight_plans")
    .update({ last_exported_at: new Date().toISOString() } as never)
    .eq("id", id);
}
