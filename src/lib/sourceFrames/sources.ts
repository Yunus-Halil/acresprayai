// A scan's source material, as far as it exists: the reconstruction ODM left
// in the mirrored archive, and the original frames the uploader kept.
//
// The reconstruction files are small and sit near the end of a gigabyte zip.
// The first time a scan is opened they are pulled out with range requests on a
// signed URL (lib/sourceFrames/zipRange.ts) and written back next to the zip,
// so every later open reads four small files. Scans made before originals were
// kept have a reconstruction and no frames; imported orthomosaics have neither.
// `reconstruction` says which, so a reader can say "no frames were kept"
// rather than "none found".
//
// This module takes the storage client it should use. The app passes its
// browser client (lib/sourceFrames/scan.ts); the developer benchmark passes a
// service-role client it built from the environment. One reading of the
// archive, one caching rule, one manifest contract, wherever it runs.
import type { SupabaseClient } from "@supabase/supabase-js";
import { type FrameIndex, type FrameManifestEntry, framesManifestPath, indexManifest } from "./manifest";
import { type SourceFrameSet, groundAltitudeFromOdm, parseOdmOutputs } from "./odm";
import { listZip, rangeReaderFor, readZipEntry } from "./zipRange";

/** The part of a Supabase client this module uses: storage, nothing else. */
export type StorageClient = Pick<SupabaseClient, "storage">;

export const SCANS_BUCKET = "scans";
export const RECONSTRUCTION_MEMBERS = {
  cameras: "cameras.json",
  shots: "odm_report/shots.geojson",
  images: "images.json",
  stats: "odm_report/stats.json",
} as const;
type MemberKey = keyof typeof RECONSTRUCTION_MEMBERS;

export type OdmStats = { odm_processing_statistics?: { average_gsd?: number } };

export type ScanSources = {
  set: SourceFrameSet | null;
  stats: OdmStats | null;
  /** Estimated from ODM's average GSD; null when the archive did not say. */
  groundAltM: number | null;
  /** Retained originals by camera filename. Null when none were kept for this scan. */
  frames: FrameIndex | null;
  reconstruction: "stored" | "extracted" | "none";
};

export const reconstructionPrefix = (userId: string, odmUuid: string) => `${userId}/odm/${odmUuid}/reconstruction`;
export const memberKey = (name: string) => name.replace(/\//g, "__");

async function downloadJson(client: StorageClient, path: string): Promise<unknown | null> {
  const { data, error } = await client.storage.from(SCANS_BUCKET).download(path);
  if (error || !data) return null;
  try { return JSON.parse(await data.text()); } catch { return null; }
}

/** Names and sizes of the objects under a prefix. */
async function listDir(client: StorageClient, prefix: string): Promise<Map<string, number>> {
  const { data } = await client.storage.from(SCANS_BUCKET).list(prefix, { limit: 100 });
  return new Map((data ?? []).map(o => [o.name, Number((o.metadata as { size?: number } | null)?.size ?? 0)]));
}

/**
 * Size of a stored object, from the listing. A one-byte range request would
 * also say, but the browser is not allowed to read Content-Range on a
 * cross-origin response, so the listing is the only honest source.
 */
async function sizeOf(client: StorageClient, path: string): Promise<number> {
  const i = path.lastIndexOf("/");
  const size = (await listDir(client, path.slice(0, i))).get(path.slice(i + 1));
  if (!size) throw new Error("could not size the archive");
  return size;
}

/** Pull the reconstruction members out of the mirrored archive and store them. */
async function extractReconstruction(
  client: StorageClient, userId: string, odmUuid: string, outputPath: string, fetchImpl: typeof fetch,
): Promise<Record<MemberKey, unknown> | null> {
  const total = await sizeOf(client, outputPath);
  const { data: signed, error } = await client.storage.from(SCANS_BUCKET).createSignedUrl(outputPath, 1800);
  if (error || !signed?.signedUrl) return null;
  const read = rangeReaderFor(signed.signedUrl, fetchImpl);
  const entries = await listZip(read, total);
  const out: Partial<Record<MemberKey, unknown>> = {};
  for (const [key, name] of Object.entries(RECONSTRUCTION_MEMBERS) as [MemberKey, string][]) {
    const entry = entries.find(e => e.name === name || e.name.endsWith(`/${name}`));
    if (!entry) continue;
    const bytes = await readZipEntry(read, entry);
    const text = new TextDecoder().decode(bytes);
    try { out[key] = JSON.parse(text); } catch { continue; }
    await client.storage.from(SCANS_BUCKET).upload(
      `${reconstructionPrefix(userId, odmUuid)}/${memberKey(name)}`,
      new Blob([text], { type: "application/json" }),
      { contentType: "application/json", upsert: true },
    );
  }
  return out.cameras && out.shots ? (out as Record<MemberKey, unknown>) : null;
}

/** The four reconstruction documents, from wherever a caller has them. */
export type ReconstructionFiles = Partial<Record<MemberKey, unknown>>;

/** Parse the reconstruction documents into sources; the frame list is given, not fetched. */
export function sourcesFromFiles(
  files: ReconstructionFiles,
  reconstruction: ScanSources["reconstruction"],
  frames: FrameIndex | null,
  warn: (msg: string) => void = () => {},
): ScanSources {
  let set: SourceFrameSet | null = null;
  if (reconstruction !== "none" && files.cameras && files.shots) {
    try {
      set = parseOdmOutputs({ camerasJson: files.cameras, shotsGeojson: files.shots, imagesJson: files.images ?? [] });
    } catch (e) {
      warn(`reconstruction not usable: ${(e as Error)?.message ?? e}`);
      reconstruction = "none";
    }
  } else {
    reconstruction = "none";
  }
  const stats = (files.stats as OdmStats | undefined) ?? null;
  return {
    set, stats,
    groundAltM: set ? groundAltitudeFromOdm(set, stats?.odm_processing_statistics?.average_gsd ?? null) : null,
    frames, reconstruction,
  };
}

export async function loadScanSourcesWith(
  client: StorageClient,
  input: { userId: string; odmUuid: string; outputPath: string | null },
  opts: { fetchImpl?: typeof fetch; warn?: (msg: string) => void } = {},
): Promise<ScanSources> {
  const { userId, odmUuid, outputPath } = input;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const warn = opts.warn ?? ((msg: string) => console.warn(`[source-frames] ${msg}`));
  const prefix = reconstructionPrefix(userId, odmUuid);
  let reconstruction: ScanSources["reconstruction"] = "none";
  let files: ReconstructionFiles = {};
  // One listing says what was stored before; nothing is fetched that is not there.
  const present = await listDir(client, prefix);
  const stored = await Promise.all(
    (Object.entries(RECONSTRUCTION_MEMBERS) as [MemberKey, string][])
      .filter(([, name]) => present.has(memberKey(name)))
      .map(async ([k, name]) => [k, await downloadJson(client, `${prefix}/${memberKey(name)}`)] as const),
  );
  for (const [k, v] of stored) if (v) files[k] = v;
  if (files.cameras && files.shots) {
    reconstruction = "stored";
  } else if (outputPath) {
    try {
      const extracted = await extractReconstruction(client, userId, odmUuid, outputPath, fetchImpl);
      if (extracted) { files = extracted; reconstruction = "extracted"; }
    } catch (e) {
      warn(`reconstruction extraction failed: ${(e as Error)?.message ?? e}`);
    }
  }
  const manifestPath = framesManifestPath(userId, odmUuid);
  const hasManifest = (await listDir(client, manifestPath.slice(0, manifestPath.lastIndexOf("/")))).has("frames.json");
  const frames = hasManifest ? indexManifest(await downloadJson(client, manifestPath)) : null;
  return sourcesFromFiles(files, reconstruction, frames, warn);
}

/** The original bytes of one kept frame, read from the key the manifest recorded. */
export async function downloadFrameWith(client: StorageClient, entry: FrameManifestEntry): Promise<Blob | null> {
  const { data, error } = await client.storage.from(SCANS_BUCKET).download(entry.path);
  return error ? null : data;
}
