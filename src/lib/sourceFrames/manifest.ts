// The frame list: which original photograph a scan kept, under which storage
// key, and how to find it from the name ODM knows it by.
//
// The uploader stores every photograph untouched under <user>/<scan>/frames/
// and writes frames.json beside them (lib/scanUpload.ts). ODM is given a
// 2,400 px re-encode of the same frame, so ODM's own records (images.json,
// shots.geojson) name the frame as the re-encode was named. For a JPEG that
// is the camera's name. For a PNG, TIFF, HEIC or WebP large enough to be
// resized, the re-encode is a JPEG and carries a .jpg name (odmFilenameFor).
//
// This module is the one place that mapping lives. A reader goes from ODM's
// filename to the manifest entry and from the entry to the storage key; it
// never builds a key from a name, and it never reads the 2,400 px copy as if
// it were the original. The copy is not in our storage at all: ODM has it,
// and only until the node purges the task.
//
// Pure, so the browser and the developer tooling share it.

/** One kept original. `filename` is what the camera wrote. */
export type FrameManifestEntry = {
  filename: string;
  /** Storage key in the `scans` bucket. */
  path: string;
  bytes: number;
  type: string;
  lastModified: number;
};

/** Where a scan's original frames live. First segment is the owner, which the bucket policy keys on. */
export const framesPrefix = (userId: string, odmUuid: string) => `${userId}/${odmUuid}/frames`;
export const framesManifestPath = (userId: string, odmUuid: string) => `${userId}/${odmUuid}/frames.json`;
/** Storage keys are plainer than file names; the manifest maps the real name to the key. */
export const frameStorageName = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, "_");

/**
 * The name the 2,400 px copy carries when it is sent to ODM, and so the name
 * ODM's outputs use for the frame. The same rule `prepareForODM` applies: a
 * re-encoded PNG, TIFF, HEIC or WebP becomes a JPEG. A frame that was small
 * enough to go unresized keeps its own name, which is why a lookup tries the
 * exact name first.
 */
export const odmFilenameFor = (name: string) => name.replace(/\.(png|tiff?|heic|webp)$/i, ".jpg");

/** Retained originals by the camera's filename. Null when no manifest exists for the scan. */
export type FrameIndex = Record<string, FrameManifestEntry>;

/** The parsed manifest as an index, or null when the document is not a frame list. */
export function indexManifest(json: unknown): FrameIndex | null {
  if (!Array.isArray(json)) return null;
  const out: FrameIndex = {};
  for (const m of json as Partial<FrameManifestEntry>[]) {
    if (!m || typeof m.filename !== "string" || typeof m.path !== "string") continue;
    out[m.filename] = {
      filename: m.filename, path: m.path,
      bytes: typeof m.bytes === "number" ? m.bytes : 0,
      type: typeof m.type === "string" ? m.type : "image/jpeg",
      lastModified: typeof m.lastModified === "number" ? m.lastModified : 0,
    };
  }
  return out;
}

export type OriginalLookup =
  | { ok: true; entry: FrameManifestEntry; matchedBy: "filename" | "odm-rename" }
  | { ok: false; status: "NO_MANIFEST" | "NO_NATIVE_SOURCE_FRAME"; reason: string };

/**
 * The retained original for a frame ODM names `odmFilename`. Exact name
 * first; then the one entry whose ODM name is that name (a PNG kept as
 * DJI_0099.png that ODM saw as DJI_0099.jpg). Anything else is not found:
 * nothing here invents a storage key, and a scan without a manifest says so
 * rather than reading as "no frames matched".
 */
export function lookupOriginal(frames: FrameIndex | null, odmFilename: string): OriginalLookup {
  if (!frames) return { ok: false, status: "NO_MANIFEST", reason: "no frame list was kept for this scan" };
  const exact = frames[odmFilename];
  if (exact) return { ok: true, entry: exact, matchedBy: "filename" };
  const renamed = Object.values(frames).filter(e => odmFilenameFor(e.filename) === odmFilename);
  if (renamed.length === 1) return { ok: true, entry: renamed[0], matchedBy: "odm-rename" };
  if (renamed.length > 1) {
    return { ok: false, status: "NO_NATIVE_SOURCE_FRAME", reason: `${renamed.length} kept frames would be named ${odmFilename} by ODM; the mapping is ambiguous` };
  }
  return { ok: false, status: "NO_NATIVE_SOURCE_FRAME", reason: `${odmFilename} is not in the frame list (${Object.keys(frames).length} kept)` };
}
