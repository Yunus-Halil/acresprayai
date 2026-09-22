// Import an already-finished GeoTIFF orthomosaic as a field's first scan,
// with no drone-image upload and no ODM reconstruction.
//
// TWO JOBS, kept separate because they fail differently:
//
//   readOrthoMetadata   reads the file's OWN header (geotiff.js, header only —
//                       never the pixel data, so this is cheap even on a
//                       multi-gigabyte COG) and refuses anything the rest of
//                       the pipeline could not honestly render: no
//                       georeferencing, a geographic CRS, a non-metre
//                       projected CRS, non-square pixels, or a rotated
//                       transform. These are exactly the conditions
//                       offrow/io.py already refuses, for the same reason:
//                       say which one, and stop, rather than fail three
//                       screens later as a black map or a wrong-coloured one.
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
// ProjLinearUnitsGeoKey / GeogLinearUnitsGeoKey value for the metre (EPSG 9001).
const LINEAR_UNIT_METRE = 9001;
/** Non-square pixels beyond this relative difference are refused. */
const SQUARE_PIXEL_TOLERANCE = 0.01;
/** A shear/rotation term this large relative to the pixel scale is refused. */
const ROTATION_TOLERANCE = 1e-6;

export type OrthoMetadata = {
  ok: true;
  widthPx: number;
  heightPx: number;
  bandCount: number;
  /** Ground sample distance in metres per pixel, averaged over x and y (they agree within tolerance). */
  gsdM: number;
  epsg: number | null;
  crsLabel: string;
  /** "8-bit" / "16-bit" / "32-bit float", informational only. */
  dtype: string;
};

export type OrthoRefusal = { ok: false; reason: string };

const bail = (reason: string): OrthoRefusal => ({ ok: false, reason });

/** Read and validate a GeoTIFF's header. Never reads pixel data. */
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
  if (modelType === MODEL_TYPE_GEOGRAPHIC) {
    return bail(
      "This file is in a geographic CRS (latitude/longitude, in degrees), not a projected one. " +
      "Reproject it to a projected CRS in metres, such as UTM, before importing.",
    );
  }
  if (modelType !== MODEL_TYPE_PROJECTED) {
    return bail(
      "This file's CRS is not a recognised projected coordinate system. " +
      "Reproject it to a projected CRS in metres, such as UTM, before importing.",
    );
  }
  const linearUnit = keys.ProjLinearUnitsGeoKey as number | undefined;
  if (linearUnit !== undefined && linearUnit !== LINEAR_UNIT_METRE) {
    return bail(
      "This file's projected CRS is not in metres (it declares a different linear unit, such as feet). " +
      "Reproject it to a metric CRS, such as UTM, before importing.",
    );
  }

  const [xRes, yRes] = resolution;
  const px = Math.abs(xRes), py = Math.abs(yRes);
  if (!(px > 0) || !(py > 0)) {
    return bail("This file's pixel size could not be determined.");
  }
  const rel = Math.abs(px - py) / Math.max(px, py);
  if (rel > SQUARE_PIXEL_TOLERANCE) {
    return bail(
      `This file has non-square pixels (${px.toFixed(3)} m x ${py.toFixed(3)} m, ${(rel * 100).toFixed(1)}% ` +
      "different). Re-export the orthomosaic with square pixels.",
    );
  }

  // ImageFileDirectory is a class wrapping raw tag entries behind getValue(),
  // not a plain object - `fileDirectory.ModelTransformation` is always
  // undefined regardless of whether the tag is present.
  const transform = image.getFileDirectory().getValue("ModelTransformation") as number[] | undefined;
  // geotiff.js hands this back as a Float64Array, not a plain Array -
  // Array.isArray() is false for a typed array, so that check silently never
  // ran and a rotated file passed straight through.
  if (transform && transform.length >= 6) {
    const scale = Math.max(Math.abs(transform[0]), Math.abs(transform[5]), 1e-9);
    const shearB = Math.abs(transform[1]) / scale;
    const shearE = Math.abs(transform[4]) / scale;
    if (shearB > ROTATION_TOLERANCE || shearE > ROTATION_TOLERANCE) {
      return bail(
        "This file has a rotated transform (it is not north-up). Re-export the orthomosaic without rotation, " +
        "or reproject it so north is up.",
      );
    }
  }

  const bandCount = image.getSamplesPerPixel();
  if (!(bandCount >= 1)) {
    return bail("This file has no readable bands.");
  }

  const bits = image.getBitsPerSample(0);
  const sampleFormat = image.getSampleFormat(0);
  const dtype = sampleFormat === 3 ? `${bits}-bit float` : `${bits}-bit`;

  const epsg = keys.ProjectedCSTypeGeoKey as number | undefined;
  const crsLabel = epsg && epsg !== 32767 ? `EPSG:${epsg}` : "Projected CRS (code not embedded in the file)";

  return {
    ok: true,
    widthPx: image.getWidth(),
    heightPx: image.getHeight(),
    bandCount,
    gsdM: (px + py) / 2,
    epsg: epsg && epsg !== 32767 ? epsg : null,
    crsLabel,
    dtype,
  };
}

/** The role each band plays. Red, green and blue are required; the rest are optional. */
export type OrthoBandMapping = Partial<Record<BandRole, number>> & { red: number; green: number; blue: number };

/** The default mapping for a plain 3-band camera GeoTIFF: file order is R, G, B. */
export const defaultThreeBandMapping = (): OrthoBandMapping => ({ red: 1, green: 2, blue: 3 });

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
