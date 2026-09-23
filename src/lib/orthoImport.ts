// Import an already-finished GeoTIFF orthomosaic as a field's first scan,
// with no drone-image upload and no ODM reconstruction.
//
// TWO JOBS, kept separate because they fail differently:
//
//   readOrthoMetadata   reads the file's OWN header (geotiff.js, header only —
//                       never the pixel data, so this is cheap even on a
//                       multi-gigabyte COG) and refuses only what THIS
//                       pipeline could not honestly render: an unparseable
//                       file, or one with no identifiable CRS at all.
//
//                       EARLIER VERSIONS ALSO REFUSED a geographic CRS, a
//                       non-metre unit, non-square pixels and a rotated
//                       transform — borrowed from offrow/io.py, which refuses
//                       those because it does row-spacing and blob-area math
//                       directly against raw pixels in the file's own CRS.
//                       This pipeline never does that: every imported file
//                       goes through TiTiler (bake-tiles), which reprojects
//                       ANY CRS — geographic or projected, square pixels or
//                       not, rotated or not — onto standard web tiles as a
//                       matter of routine, the same way it already handles
//                       ODM's own orthophotos (commonly plain WGS84
//                       geographic to begin with). By the time Weed Scout or
//                       anything else in this app reads a pixel, it has come
//                       from that already-reprojected WebMercator tile
//                       pyramid, in lat/lng, regardless of what CRS the
//                       original GeoTIFF was in. Refusing a valid geographic
//                       file here was refusing normal photogrammetry output
//                       for a constraint that belongs to a different
//                       pipeline. GSD is still computed and shown for a
//                       geographic file, converted from degrees to metres at
//                       the raster's own latitude, for the read-out only.
//
//   runOrthoImport      uploads the file straight to Supabase Storage via a
//                       signed URL the server mints (ortho-import's `init`),
//                       then asks the server to confirm it landed and write
//                       the scan row (`commit`). The file itself never passes
//                       through an edge function's own request body — the
//                       same reason odm-poll mirrors ODM's `all.zip` by
//                       streaming it, not buffering it.
//
// BAND COUNT IS NEVER GUESSED. A 3-band file is assumed R,G,B in file order —
// the near-universal convention for a plain camera GeoTIFF, and the same
// assumption TiTiler's own default rendering makes. Anything else must carry
// an explicit operator mapping; readOrthoMetadata never invents one, and
// ortho-import's `commit` refuses a request that does not name red, green
// and blue. Reading bands 1-3 of a 5-band Phantom 4 Multispectral capture
// silently would produce a plausible-looking, wrong-coloured image — the one
// failure mode worth refusing outright rather than rendering.
import { fromBlob } from "geotiff";
import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";
import { M_PER_DEG_LAT, mPerDegLng } from "@/lib/geo";

// Mirrors supabase/functions/_shared/bands.ts's BandRole. Duplicated rather
// than imported: the edge functions are a separate Deno program (their own
// esm.sh imports, outside this app's tsconfig), and this is the one type this
// module needs from it.
type BandRole = "red" | "green" | "blue" | "nir" | "rededge";

const PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const FN_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;

async function authHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ? `Bearer ${data.session.access_token}` : "";
}

// GeoTIFF GTModelTypeGeoKey values (GeoTIFF 1.1 spec, section 6.3.1.1).
const MODEL_TYPE_PROJECTED = 1;
const MODEL_TYPE_GEOGRAPHIC = 2;
// Linear unit codes (EPSG) this module can convert to metres for the GSD
// read-out. Anything else is shown as-is with the unit named rather than
// guessed — the display is informational, never a gate.
const LINEAR_UNIT_TO_METRES: Record<number, number> = {
  9001: 1,            // metre
  9002: 0.3048006096, // US survey foot
  9003: 0.3048,       // international foot
  9005: 0.9144,       // international yard
};

export type OrthoMetadata = {
  ok: true;
  widthPx: number;
  heightPx: number;
  bandCount: number;
  /** Ground sample distance in metres per pixel, averaged over x and y. For a geographic CRS this is converted from degrees at the raster's own latitude, for display only. */
  gsdM: number;
  epsg: number | null;
  crsLabel: string;
  /** "8-bit" / "16-bit" / "32-bit float", informational only. */
  dtype: string;
};

export type OrthoRefusal = { ok: false; reason: string };

const bail = (reason: string): OrthoRefusal => ({ ok: false, reason });

/**
 * Read a GeoTIFF's header. Never reads pixel data.
 *
 * Refuses only what would make the file unplaceable on a map at all: not a
 * TIFF, or no identifiable CRS. Everything else — geographic or projected,
 * any linear unit, non-square pixels, a rotated transform — TiTiler
 * reprojects onto web tiles the same way it already does for ODM's own
 * output, so none of it is this module's business to gate on.
 */
export async function readOrthoMetadata(file: File): Promise<OrthoMetadata | OrthoRefusal> {
  let image;
  try {
    const tiff = await fromBlob(file);
    image = await tiff.getImage();
  } catch (e) {
    return bail(`This file could not be read as a TIFF: ${(e as Error)?.message ?? e}`);
  }

  let boundingBox: number[];
  let resolution: number[];
  try {
    boundingBox = image.getBoundingBox();
    resolution = image.getResolution();
  } catch {
    return bail(
      "This file has no georeferencing (no affine transform). Export a GeoTIFF with the spatial " +
      "reference written in, not a plain image saved with a .tif extension.",
    );
  }
  if (!boundingBox || boundingBox.some(v => !Number.isFinite(v))) {
    return bail("This file's georeferencing is not usable (the bounding box is not finite).");
  }

  const keys = image.getGeoKeys();
  const modelType = keys?.GTModelTypeGeoKey as number | undefined;
  if (!keys || modelType === undefined) {
    return bail(
      "This file has no coordinate reference system embedded. Export it with the CRS written into the GeoTIFF, " +
      "not just a pixel scale and an origin.",
    );
  }
  // Anything other than projected or geographic (geocentric, or a model type
  // this spec version does not define) has no meaningful 2D ground footprint
  // to place on a map at all.
  if (modelType !== MODEL_TYPE_PROJECTED && modelType !== MODEL_TYPE_GEOGRAPHIC) {
    return bail(
      "This file's CRS model type is not one this app can place on a map (neither projected nor geographic). " +
      "Re-export it with a standard projected or geographic CRS.",
    );
  }

  const [xRes, yRes] = resolution;
  const rx = Math.abs(xRes), ry = Math.abs(yRes);
  if (!(rx > 0) || !(ry > 0)) {
    return bail("This file's pixel size could not be determined.");
  }

  const bandCount = image.getSamplesPerPixel();
  if (!(bandCount >= 1)) {
    return bail("This file has no readable bands.");
  }
  const bits = image.getBitsPerSample(0);
  const sampleFormat = image.getSampleFormat(0);
  const dtype = sampleFormat === 3 ? `${bits}-bit float` : `${bits}-bit`;

  let gsdM: number;
  let epsg: number | null;
  let crsLabel: string;
  if (modelType === MODEL_TYPE_GEOGRAPHIC) {
    // Resolution is in degrees here; boundingBox is [west, south, east, north]
    // in the same degrees, so its own centre latitude converts them to an
    // approximate ground metre figure for the read-out. Assumes a WGS84-like
    // datum, same as every other place this app treats geographic coordinates
    // as plain lat/lng (ortho-url's own sanity check does the same).
    const [, south, , north] = boundingBox;
    const centreLat = (south + north) / 2;
    const xM = rx * mPerDegLng(centreLat);
    const yM = ry * M_PER_DEG_LAT;
    gsdM = (xM + yM) / 2;
    const geoEpsg = keys.GeographicTypeGeoKey as number | undefined;
    epsg = geoEpsg && geoEpsg !== 32767 ? geoEpsg : null;
    crsLabel = epsg ? `EPSG:${epsg} (geographic)` : "Geographic CRS (code not embedded)";
  } else {
    const linearUnit = keys.ProjLinearUnitsGeoKey as number | undefined;
    const toMetres = linearUnit === undefined ? 1 : LINEAR_UNIT_TO_METRES[linearUnit] ?? null;
    gsdM = toMetres !== null ? ((rx + ry) / 2) * toMetres : (rx + ry) / 2;
    const projEpsg = keys.ProjectedCSTypeGeoKey as number | undefined;
    epsg = projEpsg && projEpsg !== 32767 ? projEpsg : null;
    const unitNote = toMetres !== null ? "" : ` (linear unit code ${linearUnit}, not converted for display)`;
    crsLabel = (epsg ? `EPSG:${epsg}` : "Projected CRS (code not embedded)") + unitNote;
  }

  return {
    ok: true,
    widthPx: image.getWidth(),
    heightPx: image.getHeight(),
    bandCount,
    gsdM,
    epsg,
    crsLabel,
    dtype,
  };
}

/** The role each band plays. Red, green and blue are required; the rest are optional. */
export type OrthoBandMapping = Partial<Record<BandRole, number>> & { red: number; green: number; blue: number };

/** The default mapping when the file's band order can be assumed: R, G, B in file order. */
export const defaultThreeBandMapping = (): OrthoBandMapping => ({ red: 1, green: 2, blue: 3 });

/**
 * Whether the operator has to say which band is which.
 *
 * THE RULE, AND WHY IT IS NOT "ANYTHING BUT THREE". An ordinary camera
 * orthomosaic is three bands in R, G, B order, and a FOUR-band one is that
 * plus an alpha mask, which is what OpenDroneMap itself writes and what most
 * drone software exports. Demanding a manual mapping for four bands therefore
 * stopped the most common file anyone would bring, to ask a question with only
 * one sensible answer.
 *
 * Five or more bands is a different thing: a multispectral capture, where the
 * first three are not R, G and B and reading them as though they were produces
 * a plausible-looking, wrong picture. That case still has to be answered by a
 * person. Fewer than three cannot make a colour image at all.
 *
 * Either way the assumption is stated on screen, and the operator can override
 * it, so a file whose order is unusual is never silently misread.
 */
export const bandsNeedMapping = (bandCount: number): boolean => bandCount !== 3 && bandCount !== 4;

// ---------------------------------------------------------------------------
// How big a file this path can actually carry
// ---------------------------------------------------------------------------

/**
 * The largest orthomosaic this app will take.
 *
 * Two ceilings sit under this number and both have to hold for it to mean
 * anything. Supabase's STANDARD upload (one request, `uploadToSignedUrl`) stops
 * at 5 GB, so anything past that must go through the RESUMABLE path, which is
 * why `resumableUpload` exists. And the project's own storage limit, set in the
 * dashboard and invisible from here, caps everything: if it is lower than this,
 * the storage service refuses and this number is a promise the server will not
 * keep.
 *
 * Set to 10 GB against a project configured for 20 GB. Raising it means
 * checking the project limit first; the resumable path itself goes to 50 GB.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 ** 3;

/**
 * Above this, upload in resumable chunks rather than one request.
 *
 * Not only about the 5 GB hard ceiling. A multi-gigabyte single PUT over farm
 * broadband is one dropped packet away from starting from zero, and the
 * operator has no way to tell a stall from slow progress. Chunks survive that,
 * and they are what makes a byte-level progress figure honest.
 *
 * Small files stay on the standard path: three round trips to negotiate a
 * resumable session is the wrong trade for a file that uploads in one.
 */
export const RESUMABLE_ABOVE_BYTES = 200 * 1024 ** 2;

/** Supabase's resumable endpoint requires exactly this chunk size. */
export const RESUMABLE_CHUNK_BYTES = 6 * 1024 * 1024;

/** Whether a file of this size should take the resumable path. */
export const shouldResume = (bytes: number): boolean => bytes > RESUMABLE_ABOVE_BYTES;

export const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
};

/** The one line to show a person about this file's size, or null when it is unremarkable. */
export function sizeVerdict(bytes: number): { kind: "refuse" | "warn"; message: string } | null {
  if (bytes > MAX_UPLOAD_BYTES) {
    return {
      kind: "refuse",
      message:
        `This file is ${formatBytes(bytes)}, past the ${formatBytes(MAX_UPLOAD_BYTES)} limit. Converting it ` +
        `to a compressed cloud-optimised GeoTIFF usually shrinks an orthomosaic severalfold and makes the ` +
        `map build much faster too, because the tile server can then read a window of the image instead of ` +
        `pulling all of it: gdal_translate -of COG -co COMPRESS=DEFLATE in.tif out.tif`,
    };
  }
  if (shouldResume(bytes)) {
    return {
      kind: "warn",
      message:
        `This file is ${formatBytes(bytes)}, so it uploads in chunks and survives a dropped connection. ` +
        `Expect it to take a while. A compressed cloud-optimised GeoTIFF would upload and render faster: ` +
        `gdal_translate -of COG -co COMPRESS=DEFLATE in.tif out.tif`,
    };
  }
  return null;
}

/** True when the file carries a fourth band, which is assumed to be alpha. */
export const hasAlphaBand = (bandCount: number): boolean => bandCount === 4;

export type ImportPhase = "uploading" | "finishing" | "done";

/** Where the import has got to. `sent`/`total` are bytes, and only while uploading. */
export type ImportProgress = {
  phase: ImportPhase;
  sent?: number;
  total?: number;
};

/**
 * Send the file in resumable chunks.
 *
 * Supabase's standard upload is a single request and stops at 5 GB; this is the
 * path that goes past it, and the one that survives a dropped connection. It
 * does NOT use the signed upload token the init step mints, because the
 * resumable endpoint authenticates the user directly: the object path is
 * `<user id>/<uuid>.tif`, and the `orthos` bucket policy already grants a user
 * write access to their own first path segment, so the same upload is
 * permitted by the same rule either way.
 *
 * `chunkSize` is not tunable. Supabase's resumable endpoint requires exactly
 * 6 MB parts and rejects anything else.
 */
async function resumableUpload(
  path: string,
  file: File,
  onProgress?: (p: ImportProgress) => void,
): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in.");

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `https://${PROJECT_REF}.supabase.co/storage/v1/upload/resumable`,
      // Backs off rather than giving up the moment a farm connection hiccups.
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${token}`, "x-upsert": "true" },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: RESUMABLE_CHUNK_BYTES,
      metadata: {
        bucketName: "orthos",
        objectName: path,
        contentType: "image/tiff",
        cacheControl: "3600",
      },
      onError: err => reject(new Error(`Upload failed: ${err.message}`)),
      onProgress: (sent, total) => onProgress?.({ phase: "uploading", sent, total }),
      onSuccess: () => resolve(),
    });
    // An interrupted upload of the same file can pick up where it stopped
    // rather than starting from zero, which on a multi-gigabyte orthomosaic is
    // the difference between a retry and an afternoon.
    upload.findPreviousUploads()
      .then(prior => {
        if (prior.length) upload.resumeFromPreviousUpload(prior[0]);
        upload.start();
      })
      .catch(() => upload.start());
  });
}

/**
 * Call an ortho-import action, turning a network-level failure into something
 * that names itself.
 *
 * A `fetch` that never reaches the server throws a bare `TypeError: Failed to
 * fetch`, and the browser console calls it a CORS error. Both are true and
 * neither is useful: the same message appears when the function is not
 * deployed, when the project is unreachable, and when the operator's
 * connection dropped. The undeployed case is not hypothetical, it is how this
 * import failed for its entire life before 2026-09-23 - the preflight hit a
 * URL with nothing behind it, got a 404, and the browser reported a CORS
 * policy failure, which sent the investigation after file sizes instead.
 */
async function importAction<T>(action: "init" | "commit", body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${FN_BASE}/ortho-import?action=${action}`, {
      method: "POST",
      headers: { Authorization: await authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "Could not reach the import service. It may not be deployed yet, or this device is offline. " +
      "If this persists, deploy it with: npx supabase functions deploy ortho-import",
    );
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const stated = (json as { error?: string })?.error;
    throw new Error(stated ?? `The import service answered ${res.status}.`);
  }
  return json as T;
}

/**
 * Upload the file and write the scan row. `fieldId` must already exist —
 * this does not create the field; the caller does that first, exactly as
 * the existing drone-image path creates the field before uploading to it.
 */
export async function runOrthoImport(opts: {
  fieldId: string;
  file: File;
  metadata: OrthoMetadata;
  mapping: OrthoBandMapping;
  onProgress?: (p: ImportProgress) => void;
}): Promise<{ taskId: string; odmUuid: string }> {
  const { fieldId, file, metadata, mapping, onProgress } = opts;

  const { task_id: taskId, path, token } = await importAction<{
    task_id: string; odm_uuid: string; path: string; token: string;
  }>("init", { field_id: fieldId });

  onProgress?.({ phase: "uploading", sent: 0, total: file.size });
  if (shouldResume(file.size)) {
    // Chunked, resumable, and the only path that reaches past 5 GB.
    await resumableUpload(path, file, onProgress);
  } else {
    // A small file uploads in one request; negotiating a resumable session for
    // it would cost more round trips than the upload itself.
    const { error: upErr } = await supabase.storage.from("orthos")
      .uploadToSignedUrl(path, token, file, { contentType: "image/tiff" });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
  }

  onProgress?.({ phase: "finishing" });
  const commitJson = await importAction<{ odm_uuid: string }>("commit", {
    task_id: taskId,
    band_count: metadata.bandCount,
    band_mapping: mapping,
  });

  onProgress?.({ phase: "done" });
  return { taskId, odmUuid: commitJson.odm_uuid as string };
}
