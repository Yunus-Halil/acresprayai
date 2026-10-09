// A photo read once is a photo read: the pass's result per photo, kept per scan.
//
// The photo pass downloads an original, decodes 20 megapixels and runs the
// pattern pass on them, several seconds a photo. None of that depends on the
// run: only on the photo's pixels, fixed for a scan, and on the pass's
// settings. So the result is saved (migration 20261009120000, table
// `scan_photo_reads`) under a key made of the pass version and those
// settings, and the next run of the scan, or the closer look opening a spot
// in that photo, takes the saved read instead of the photo. Pure where it
// can be: the key and the row shapes are functions; only load and save touch
// the client, and both fail soft, because a read that cannot be saved is
// still a read and a cache that cannot be loaded is an empty cache.
import { supabase } from "@/integrations/supabase/client";
import type { PhotoPattern } from "../photoScout/pattern";
import type { PhotoReadStore, SavedPhotoRead } from "./photoPass";

export type { PhotoReadStore, SavedPhotoRead };

export type PhotoReadRow = { filename: string; decoded_width: number; native_width: number; pattern: PhotoPattern };

export function readFromRow(r: PhotoReadRow): SavedPhotoRead {
  return { pattern: r.pattern, decodedWidth: r.decoded_width, nativeWidth: r.native_width };
}

/** The saved reads of a scan under one key, by filename. Empty, never an error, when nothing can be loaded. */
export async function loadPhotoReads(scanId: string, paramsKey: string): Promise<Map<string, SavedPhotoRead>> {
  const out = new Map<string, SavedPhotoRead>();
  try {
    const q = await supabase.from("scan_photo_reads").select("filename, decoded_width, native_width, pattern").eq("scan_id", scanId).eq("params_key", paramsKey);
    if (q.error || !q.data) return out;
    for (const r of q.data as unknown as PhotoReadRow[]) out.set(r.filename, readFromRow(r));
  } catch { /* an empty cache */ }
  return out;
}

/** One saved read of one photo, or null. */
export async function loadPhotoRead(scanId: string, filename: string, paramsKey: string): Promise<SavedPhotoRead | null> {
  try {
    const q = await supabase.from("scan_photo_reads").select("filename, decoded_width, native_width, pattern")
      .eq("scan_id", scanId).eq("filename", filename).eq("params_key", paramsKey).maybeSingle();
    if (q.error || !q.data) return null;
    return readFromRow(q.data as unknown as PhotoReadRow);
  } catch {
    return null;
  }
}

/** Save a read, replacing the same photo's read under the same key. Never throws: the outcome says. */
export async function savePhotoRead(input: { userId: string; scanId: string; filename: string; paramsKey: string; read: SavedPhotoRead }): Promise<{ ok: boolean; error?: string }> {
  try {
    const row = {
      user_id: input.userId, scan_id: input.scanId, filename: input.filename, params_key: input.paramsKey,
      decoded_width: input.read.decodedWidth, native_width: input.read.nativeWidth, pattern: input.read.pattern,
    };
    const up = await supabase.from("scan_photo_reads").upsert(row as never, { onConflict: "scan_id,filename,params_key" });
    return up.error ? { ok: false, error: up.error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) };
  }
}


/** A store over the saved reads of a scan: loaded once, written through as reads land. */
export async function openPhotoReadStore(opts: { userId: string; scanId: string; paramsKey: string }): Promise<PhotoReadStore> {
  const reads = await loadPhotoReads(opts.scanId, opts.paramsKey);
  return {
    get: f => reads.get(f),
    put: (filename, read) => { reads.set(filename, read); return savePhotoRead({ userId: opts.userId, scanId: opts.scanId, filename, paramsKey: opts.paramsKey, read }); },
  };
}
