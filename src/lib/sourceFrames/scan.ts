// A scan's source material, as far as it exists: the reconstruction ODM left
// in the mirrored archive, and the original frames the uploader kept.
//
// The reconstruction files are small and sit near the end of a gigabyte zip.
// The first time a scan is opened they are pulled out with range requests on a
// signed URL (lib/sourceFrames/zipRange.ts) and written back next to the zip,
// so every later open reads four small files. Scans made before originals were
// kept have a reconstruction and no frames; imported orthomosaics have neither.
// `origin` says which, so the UI can say "no frames were kept" rather than
// "none found".
import { supabase } from "@/integrations/supabase/client";
import type { FrameManifestEntry } from "@/lib/scanUpload";
import { framesManifestPath } from "@/lib/scanUpload";
import { type SourceFrameSet, groundAltitudeFromOdm, parseOdmOutputs } from "./odm";
import { listZip, rangeReaderFor, readZipEntry } from "./zipRange";

const BUCKET = "scans";
const MEMBERS = {
  cameras: "cameras.json",
  shots: "odm_report/shots.geojson",
  images: "images.json",
  stats: "odm_report/stats.json",
} as const;

export type OdmStats = { odm_processing_statistics?: { average_gsd?: number } };

export type ScanSources = {
  set: SourceFrameSet | null;
  stats: OdmStats | null;
  /** Estimated from ODM's average GSD; null when the archive did not say. */
  groundAltM: number | null;
  /** Retained originals by camera filename. Null when none were kept for this scan. */
  frames: Record<string, FrameManifestEntry> | null;
  reconstruction: "stored" | "extracted" | "none";
};

const reconstructionPrefix = (userId: string, odmUuid: string) => `${userId}/odm/${odmUuid}/reconstruction`;
const memberKey = (name: string) => name.replace(/\//g, "__");

async function downloadJson(path: string): Promise<unknown | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  try { return JSON.parse(await data.text()); } catch { return null; }
}

/** Size of a stored object via a one-byte range request; signed URLs do not answer HEAD reliably. */
async function sizeOf(url: string): Promise<number> {
  const res = await fetch(url, { headers: { Range: "bytes=0-0" } });
  const m = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "");
  if (m) return Number(m[1]);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (res.status === 200 && len > 1) return len;
  throw new Error("could not size the archive");
}

/** Pull the reconstruction members out of the mirrored archive and store them. */
async function extractReconstruction(userId: string, odmUuid: string, outputPath: string): Promise<Record<keyof typeof MEMBERS, unknown> | null> {
  const { data: signed, error } = await supabase.storage.from(BUCKET).createSignedUrl(outputPath, 1800);
  if (error || !signed?.signedUrl) return null;
  const read = rangeReaderFor(signed.signedUrl);
  const total = await sizeOf(signed.signedUrl);
  const entries = await listZip(read, total);
  const out: Partial<Record<keyof typeof MEMBERS, unknown>> = {};
  for (const [key, name] of Object.entries(MEMBERS) as [keyof typeof MEMBERS, string][]) {
    const entry = entries.find(e => e.name === name || e.name.endsWith(`/${name}`));
    if (!entry) continue;
    const bytes = await readZipEntry(read, entry);
    const text = new TextDecoder().decode(bytes);
    try { out[key] = JSON.parse(text); } catch { continue; }
    await supabase.storage.from(BUCKET).upload(
      `${reconstructionPrefix(userId, odmUuid)}/${memberKey(name)}`,
      new Blob([text], { type: "application/json" }),
      { contentType: "application/json", upsert: true },
    );
  }
  return out.cameras && out.shots ? (out as Record<keyof typeof MEMBERS, unknown>) : null;
}

export async function loadScanSources(input: { userId: string; odmUuid: string; outputPath: string | null }): Promise<ScanSources> {
  const { userId, odmUuid, outputPath } = input;
  const prefix = reconstructionPrefix(userId, odmUuid);
  let reconstruction: ScanSources["reconstruction"] = "none";
  let files: Partial<Record<keyof typeof MEMBERS, unknown>> = {};
  const stored = await Promise.all(
    (Object.entries(MEMBERS) as [keyof typeof MEMBERS, string][]).map(async ([k, name]) => [k, await downloadJson(`${prefix}/${memberKey(name)}`)] as const),
  );
  for (const [k, v] of stored) if (v) files[k] = v;
  if (files.cameras && files.shots) {
    reconstruction = "stored";
  } else if (outputPath) {
    try {
      const extracted = await extractReconstruction(userId, odmUuid, outputPath);
      if (extracted) { files = extracted; reconstruction = "extracted"; }
    } catch (e) {
      console.warn("[source-frames] reconstruction extraction failed:", (e as Error)?.message ?? e);
    }
  }
  let set: SourceFrameSet | null = null;
  if (reconstruction !== "none") {
    try {
      set = parseOdmOutputs({ camerasJson: files.cameras, shotsGeojson: files.shots, imagesJson: files.images ?? [] });
    } catch (e) {
      console.warn("[source-frames] reconstruction not usable:", (e as Error)?.message ?? e);
      reconstruction = "none";
    }
  }
  const stats = (files.stats as OdmStats | undefined) ?? null;
  const manifest = (await downloadJson(framesManifestPath(userId, odmUuid))) as FrameManifestEntry[] | null;
  const frames = Array.isArray(manifest) ? Object.fromEntries(manifest.map(m => [m.filename, m])) : null;
  return {
    set, stats,
    groundAltM: set ? groundAltitudeFromOdm(set, stats?.odm_processing_statistics?.average_gsd ?? null) : null,
    frames, reconstruction,
  };
}

/** The original bytes of one kept frame. */
export async function downloadFrame(entry: FrameManifestEntry): Promise<Blob | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(entry.path);
  return error ? null : data;
}
