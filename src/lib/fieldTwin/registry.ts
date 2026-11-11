// The account's Field Twins as records (public.field_twins, migration 20261109130000). The files stay in the
// account's folder (store.ts); this is the list, each twin's name, crop, flight and status, and the one place a
// twin is created, finished, marked incomplete or deleted.
//
// Saving is ordered so a listed twin never pretends to be whole: the record is written first as 'saving', the
// atlases go up, twin.json goes up last, and only then is the record 'ready'. A save that fails, or a tab closed
// half way, leaves 'saving' or 'incomplete', which the list shows as such (with Delete), never as a twin to open.
import { supabase } from "@/integrations/supabase/client";
import { forgetPendingAnalysis } from "./analysisOutbox";
import type { TwinBundle } from "./types";
import { TWIN_BUCKET, TWIN_JSON_GZ, listTwins, saveTwin, twinFolder } from "./store";

export type TwinRecord = {
  id: string;
  storage_key: string;
  name: string;
  crop: "corn" | "orchard" | null;
  captured_at: string | null;
  photographs: number | null;
  camera: string | null;
  placement: "rtk" | "gnss" | "local" | null;
  area_ha: number | null;
  status: "saving" | "ready" | "incomplete";
  error: string | null;
  build_ms: number | null;
  created_at: string;
  updated_at: string;
};

const COLUMNS = "id, storage_key, name, crop, captured_at, photographs, camera, placement, area_ha, status, error, build_ms, created_at, updated_at";

/** A save left 'saving' this long ago was cut off (the tab closed): shown as incomplete. */
export const STALE_SAVE_MS = 30 * 60_000;

/** What the list should call a record's state right now. */
export function effectiveStatus(r: Pick<TwinRecord, "status" | "updated_at">, now = Date.now()): TwinRecord["status"] {
  if (r.status === "saving" && now - Date.parse(r.updated_at) > STALE_SAVE_MS) return "incomplete";
  return r.status;
}

/** The record's facts from a twin bundle (name, crop, flight, camera, placement, area). */
export type TwinFacts = Pick<TwinRecord, "name" | "crop" | "captured_at" | "photographs" | "camera" | "placement" | "area_ha"> & { format: string };
export function factsFromTwin(t: TwinBundle): TwinFacts {
  const rtkNote = t.source.placement?.note ?? "";
  const placement: TwinRecord["placement"] = t.source.placement?.kind === "local" ? "local" : /RTK fixed/i.test(rtkNote) && !/without RTK/i.test(rtkNote) ? "rtk" : "gnss";
  return {
    name: t.name || "Field",
    crop: t.corn ? "corn" : "orchard",
    captured_at: t.source.capturedAt ? isoOrNull(t.source.capturedAt) : null,
    photographs: t.source.photographs ?? null,
    camera: t.source.camera ?? null,
    placement,
    area_ha: t.boundary ? Math.round(t.boundary.cultivated.areaM2 / 100) / 100 : null,
    format: t.format,
  };
}

function isoOrNull(s: string): string | null {
  const v = Date.parse(s.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3"));
  return Number.isFinite(v) ? new Date(v).toISOString() : null;
}

/** Whether a folder holds its twin.json (the file written last, so a folder with it is complete). */
async function folderComplete(userId: string, key: string): Promise<boolean> {
  const { data } = await supabase.storage.from(TWIN_BUCKET).list(twinFolder(userId, key), { limit: 1000 });
  return (data ?? []).some(o => o.name === TWIN_JSON_GZ || o.name === "twin.json");
}

/**
 * The account's twins, newest first. Folders saved before the registry existed are registered here, the first
 * time they are seen, under their folder name (their real name, crop and flight are filled in when first opened).
 */
export async function listTwinRecords(userId: string): Promise<TwinRecord[]> {
  const { data, error } = await supabase.from("field_twins").select(COLUMNS).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const records = (data ?? []) as TwinRecord[];
  let folders: { id: string; updatedAt: string | null }[] = [];
  try { folders = await listTwins(userId); } catch { /* storage unreachable: the records are still the list */ }
  const known = new Set(records.map(r => r.storage_key));
  const orphans = folders.filter(f => !known.has(f.id) && /^[a-z0-9][a-z0-9-]{0,63}$/.test(f.id));
  if (!orphans.length) return records;
  const rows = await Promise.all(orphans.map(async f => ({
    storage_key: f.id,
    name: f.id,
    status: (await folderComplete(userId, f.id)) ? "ready" : "incomplete",
    error: null,
  })));
  const { data: added } = await supabase.from("field_twins").insert(rows).select(COLUMNS);
  return [...records, ...((added ?? []) as TwinRecord[])].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getTwinRecord(id: string): Promise<TwinRecord | null> {
  const { data, error } = await supabase.from("field_twins").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as TwinRecord | null) ?? null;
}

/** Fill in what an older record lacks from its twin, once it has been opened. */
export async function completeRecordFacts(record: TwinRecord, twin: TwinBundle): Promise<void> {
  if (record.crop && record.photographs != null && record.name !== record.storage_key) return;
  const facts = factsFromTwin(twin);
  await supabase.from("field_twins").update({ ...facts, name: record.name === record.storage_key ? facts.name : record.name }).eq("id", record.id);
}

/** A new record for a build about to be saved. Its id is the twin's id and its folder name. */
export async function beginSave(twin: TwinBundle, buildMs: number | null): Promise<TwinRecord> {
  const { data, error } = await supabase.from("field_twins")
    .insert({ id: twin.id, storage_key: twin.id, status: "saving", build_ms: buildMs != null ? Math.round(buildMs) : null, ...factsFromTwin(twin) })
    .select(COLUMNS).single();
  if (error || !data) throw new Error(error?.message ?? "the twin could not be registered");
  return data as TwinRecord;
}

/**
 * Save a built twin: record first, files (twin.json last), then 'ready'. On failure the record is marked
 * 'incomplete' with the reason, and the error is rethrown for the page to show with its Retry.
 */
export async function saveBuiltTwin(userId: string, twin: TwinBundle, files: Map<string, Blob>, buildMs: number | null, onProgress?: (done: number, total: number) => void, existing?: TwinRecord): Promise<TwinRecord> {
  const record = existing ?? await beginSave(twin, buildMs);
  try {
    if (existing) await supabase.from("field_twins").update({ status: "saving", error: null }).eq("id", record.id);
    await saveTwin(userId, twin, files, onProgress);
  } catch (e) {
    const message = (e as Error).message || "the upload failed";
    await supabase.from("field_twins").update({ status: "incomplete", error: message.slice(0, 500) }).eq("id", record.id);
    throw e;
  }
  const { data, error } = await supabase.from("field_twins").update({ status: "ready", error: null }).eq("id", record.id).select(COLUMNS).single();
  if (error || !data) throw new Error(error?.message ?? "the twin was saved but could not be marked ready");
  return data as TwinRecord;
}

export async function renameTwin(id: string, name: string): Promise<void> {
  const clean = name.trim().slice(0, 200);
  if (!clean) throw new Error("A Field Twin needs a name.");
  const { error } = await supabase.from("field_twins").update({ name: clean }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Delete a twin: every file in its folder, then the record (and with it its reviews). */
export async function deleteTwin(userId: string, record: Pick<TwinRecord, "id" | "storage_key">): Promise<void> {
  const folder = twinFolder(userId, record.storage_key);
  const { data: listed, error: listErr } = await supabase.storage.from(TWIN_BUCKET).list(folder, { limit: 1000 });
  if (listErr) throw new Error(listErr.message);
  const paths = (listed ?? []).filter(o => o.id !== null).map(o => `${folder}/${o.name}`);
  for (let k = 0; k < paths.length; k += 100) {
    const { error } = await supabase.storage.from(TWIN_BUCKET).remove(paths.slice(k, k + 100));
    if (error) throw new Error(error.message);
  }
  const { error } = await supabase.from("field_twins").delete().eq("id", record.id);
  if (error) throw new Error(error.message);
  // A corn twin's analysis record still waiting on this device (analysisOutbox.ts) goes with it.
  await forgetPendingAnalysis(userId, record.storage_key);
}
