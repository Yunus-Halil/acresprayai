// Where a Field Twin lives: the account's own private folder in the `orthos` bucket,
//   orthos/<user id>/field-twins/<twin id>/{twin.json, atlas-N.jpg}
// Owner-only by the bucket's policies (supabase/migrations/20260812140000_storage_buckets_reproducible.sql): the
// first path segment is the user's id. A bundle is added once (from files, or in a development build from the twin
// built on that computer) and read back on every visit.
import { supabase } from "@/integrations/supabase/client";
import { parseTwin, type TwinBundle } from "./types";

export const TWIN_BUCKET = "orthos";

/** twin.json is stored gzipped (about five times smaller: 9 MB to 1.7 MB on the apricot twin); older twins hold it plain. */
export const TWIN_JSON_GZ = "twin.json.gz";

/** A blob's bytes (every Blob implementation, including ones without `stream` or `arrayBuffer`). */
async function bytesOf(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return new Uint8Array(await blob.arrayBuffer());
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(new Uint8Array(r.result as ArrayBuffer)); r.onerror = () => rej(r.error); r.readAsArrayBuffer(blob); });
}
export async function gzipBlob(blob: Blob): Promise<Blob> {
  if (typeof CompressionStream === "undefined") return blob;
  const stream = new Response(await bytesOf(blob)).body!.pipeThrough(new CompressionStream("gzip"));
  return new Blob([new Uint8Array(await new Response(stream).arrayBuffer())], { type: "application/gzip" });
}
export async function gunzipText(blob: Blob): Promise<string> {
  if (typeof DecompressionStream === "undefined") throw new Error("this browser cannot read a compressed twin");
  const stream = new Response(await bytesOf(blob)).body!.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

export const twinFolder = (userId: string, twinId: string) => `${userId}/field-twins/${twinId}`;
export const twinPath = (userId: string, twinId: string, file: string) => `${twinFolder(userId, twinId)}/${file}`;

/** The files a bundle consists of, by name: twin.json and its atlases. */
export function bundleFileNames(twin: TwinBundle): string[] {
  return ["twin.json", ...twin.atlases.map(a => a.file)];
}

/** Which of `available` a bundle still needs, and whether everything it needs is there. */
export function missingFiles(twin: TwinBundle, available: string[]): string[] {
  const have = new Set(available);
  return bundleFileNames(twin).filter(f => !have.has(f));
}

export type SavedTwin = { id: string; updatedAt: string | null };

export async function listTwins(userId: string): Promise<SavedTwin[]> {
  const { data, error } = await supabase.storage.from(TWIN_BUCKET).list(`${userId}/field-twins`, { limit: 100 });
  if (error) throw new Error(error.message);
  // Folders (one per twin) come back without an id.
  return (data ?? []).filter(d => d.id === null).map(d => ({ id: d.name, updatedAt: (d as { updated_at?: string | null }).updated_at ?? null }));
}

export async function loadTwin(userId: string, twinId: string): Promise<TwinBundle> {
  // The compressed file first; a twin saved before 2026-10-28 holds twin.json plain.
  const gz = await supabase.storage.from(TWIN_BUCKET).download(twinPath(userId, twinId, TWIN_JSON_GZ));
  let text: string;
  if (!gz.error && gz.data) text = await gunzipText(gz.data);
  else {
    const { data, error } = await supabase.storage.from(TWIN_BUCKET).download(twinPath(userId, twinId, "twin.json"));
    if (error || !data) throw new Error(error?.message ?? "no twin.json");
    text = await data.text();
  }
  const parsed = parseTwin(JSON.parse(text));
  if ("reason" in parsed) throw new Error(parsed.reason);
  return parsed.twin;
}

/** An atlas image as an object URL (the caller revokes it). */
export async function loadAtlas(userId: string, twinId: string, file: string): Promise<string> {
  const { data, error } = await supabase.storage.from(TWIN_BUCKET).download(twinPath(userId, twinId, file));
  if (error || !data) throw new Error(error?.message ?? `no ${file}`);
  return URL.createObjectURL(data);
}

/** Save a bundle's files to the account. `files` maps file name to its bytes. */
export async function saveTwin(userId: string, twin: TwinBundle, files: Map<string, Blob>, onProgress?: (done: number, total: number) => void): Promise<void> {
  const names = bundleFileNames(twin);
  const missing = names.filter(n => !files.has(n));
  if (missing.length) throw new Error(`missing ${missing.join(", ")}`);
  let done = 0;
  // The atlases first, twin.json last: a twin listed in the account always has its pictures. twin.json goes up
  // gzipped under its own name.
  for (const n of [...names.slice(1), names[0]]) {
    const json = n === "twin.json";
    const blob = json ? await gzipBlob(files.get(n)!) : files.get(n)!;
    const { error } = await supabase.storage.from(TWIN_BUCKET).upload(twinPath(userId, twin.id, json ? TWIN_JSON_GZ : n), blob, { upsert: true, contentType: json ? "application/gzip" : "image/jpeg" });
    if (error) throw new Error(`${n}: ${error.message}`);
    onProgress?.(++done, names.length);
  }
}
