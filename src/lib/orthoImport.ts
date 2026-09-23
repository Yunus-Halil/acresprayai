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

/** True when the file carries a fourth band, which is assumed to be alpha. */
export const hasAlphaBand = (bandCount: number): boolean => bandCount === 4;

export type ImportPhase = "uploading" | "finishing" | "done";

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
  onProgress?: (phase: ImportPhase) => void;
}): Promise<{ taskId: string; odmUuid: string }> {
  const { fieldId, file, metadata, mapping, onProgress } = opts;

  const initRes = await fetch(`${FN_BASE}/ortho-import?action=init`, {
    method: "POST",
    headers: { Authorization: await authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ field_id: fieldId }),
  });
  const initJson = await initRes.json().catch(() => ({}));
  if (!initRes.ok) throw new Error(initJson?.error ?? "Could not start the import");
  const { task_id: taskId, path, token } = initJson as { task_id: string; odm_uuid: string; path: string; token: string };

  onProgress?.("uploading");
  const { error: upErr } = await supabase.storage.from("orthos")
    .uploadToSignedUrl(path, token, file, { contentType: "image/tiff" });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

  onProgress?.("finishing");
  const commitRes = await fetch(`${FN_BASE}/ortho-import?action=commit`, {
    method: "POST",
    headers: { Authorization: await authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({
      task_id: taskId,
      band_count: metadata.bandCount,
      band_mapping: mapping,
    }),
  });
  const commitJson = await commitRes.json().catch(() => ({}));
  if (!commitRes.ok) throw new Error(commitJson?.error ?? "Could not finish the import");

  onProgress?.("done");
  return { taskId, odmUuid: commitJson.odm_uuid as string };
}
