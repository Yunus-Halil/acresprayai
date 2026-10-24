// What resolution reaches each stage of a scan, measured on its stored artifacts: the orthophoto GeoTIFF's own pixel,
// format and overviews (read by HTTP range, never downloaded whole), the tile pyramid's depth and pixel at the field's
// latitude, and the edge sharpness of the same ground in the orthophoto and in the baked tiles of the two deepest
// zooms (src/lib/imageSharpness.ts). Read-only: it SELECTs, signs one URL and reads storage; it writes nothing.
//
//   npm run audit:resolution -- --field "CORN FIELD TESTING"      (the field's newest scan)
//   npm run audit:resolution -- --scan <odm_tasks.id>
//   [--env-file path]   SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY, as for bench:frames
//
// The photographs' side of the comparison is measured from the originals on disk with
// docs/research/orthomosaic-resolution-audit-2026-10-24.md's method; the camera's GSD from its EXIF.
import { createClient } from "@supabase/supabase-js";
import { fromUrl } from "geotiff";
import { PNG } from "pngjs";
import { type Gray, edgeWidthPx } from "../../src/lib/imageSharpness";
import { metresPerPixel } from "../../src/lib/weedVision/mapRun";
import { readBenchEnv, redact } from "./env";
import { utmToLatLng } from "./utm";

const args = process.argv.slice(2);
const str = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] ?? null : null; };
const USAGE = 'usage: npm run audit:resolution -- (--field "<name>" | --scan <odm_tasks.id>) [--env-file path]';

const COMPRESSION: Record<number, string> = { 1: "none", 5: "LZW (lossless)", 7: "JPEG (lossy)", 8: "Deflate (lossless)", 32946: "Deflate (lossless)", 34887: "LERC", 50000: "ZSTD (lossless)", 50001: "WebP" };

async function main() {
  const env = readBenchEnv(str("env-file"));
  if (!env.supabaseUrl || !env.serviceRoleKey) { console.error(`${USAGE}\nset SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment or an --env-file`); process.exit(2); }
  const db = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const fieldName = str("field"), scanId = str("scan");
  if (!fieldName && !scanId) { console.error(USAGE); process.exit(2); }

  const cols = "id, field_id, user_id, odm_uuid, created_at, image_count, ortho_path, tiles_baked, tiles_min_zoom, tiles_max_zoom, tiles_total";
  let task: Record<string, unknown> | null = null;
  if (scanId) task = (await db.from("odm_tasks").select(cols).eq("id", scanId).maybeSingle()).data;
  else {
    const { data: fields } = await db.from("fields").select("id, name").ilike("name", fieldName!);
    if (!fields?.length) throw new Error(`no field named "${fieldName}"`);
    if (fields.length > 1) throw new Error(`${fields.length} fields named "${fieldName}"; pass --scan`);
    task = (await db.from("odm_tasks").select(cols).eq("field_id", fields[0].id).not("ortho_path", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle()).data;
  }
  if (!task?.ortho_path) throw new Error("no scan with an orthophoto found");
  const t = task as { id: string; user_id: string; odm_uuid: string; created_at: string; image_count: number | null; ortho_path: string; tiles_baked: boolean | null; tiles_min_zoom: number | null; tiles_max_zoom: number | null; tiles_total: number | null };
  console.log(`scan ${t.id} (${t.created_at.slice(0, 10)}), ${t.image_count ?? "?"} photographs`);

  // The orthophoto, by HTTP range.
  const { data: signed, error } = await db.storage.from("orthos").createSignedUrl(t.ortho_path, 3600);
  if (error || !signed) throw new Error(`could not sign the orthophoto: ${error?.message}`);
  const tiff = await fromUrl(signed.signedUrl);
  const image = await tiff.getImage();
  const levels = await tiff.getImageCount();
  const [rx, ry] = image.getResolution().map(Math.abs);
  const keys = image.getGeoKeys() as Record<string, number>;
  const epsg = keys.ProjectedCSTypeGeoKey ?? null;
  const [w0, s0, e0, n0] = image.getBoundingBox();
  let centre: { lat: number; lng: number };
  let pixelM: number;
  if (epsg && ((epsg > 32600 && epsg < 32661) || (epsg > 32700 && epsg < 32761))) {
    centre = utmToLatLng((w0 + e0) / 2, (s0 + n0) / 2, epsg % 100, epsg > 32700);
    pixelM = (rx + ry) / 2;
  } else if (keys.GTModelTypeGeoKey === 2) {
    centre = { lat: (s0 + n0) / 2, lng: (w0 + e0) / 2 };
    pixelM = ((rx * 111320 * Math.cos((centre.lat * Math.PI) / 180)) + ry * 110540) / 2;
  } else throw new Error(`orthophoto CRS EPSG:${epsg ?? "?"} is not handled here (UTM or geographic only)`);
  const fd = image.fileDirectory as Record<string, number>;
  console.log(`orthophoto: ${image.getWidth()} x ${image.getHeight()} px, ${(pixelM * 100).toFixed(2)} cm a pixel (EPSG:${epsg ?? keys.GeographicTypeGeoKey}), ${image.getSamplesPerPixel()} bands, compression ${COMPRESSION[fd.Compression] ?? fd.Compression}, ${levels - 1} overview level(s), tiled ${fd.TileWidth ? `${fd.TileWidth} px` : "no"}`);
  console.log(`ground covered: ${((image.getWidth() * pixelM) / 1).toFixed(0)} x ${((image.getHeight() * pixelM) / 1).toFixed(0)} m; centre ${centre.lat.toFixed(5)}, ${centre.lng.toFixed(5)}`);

  // The same ground in the orthophoto and in the tiles: about 12 m square at the centre.
  const sideM = 12;
  const half = Math.round(sideM / pixelM / 2), cx = Math.round(image.getWidth() / 2), cy = Math.round(image.getHeight() / 2);
  const rasters = await image.readRasters({ window: [cx - half, cy - half, cx + half, cy + half], samples: [1] }) as unknown as ArrayLike<number>[];
  const ortho: Gray = { width: 2 * half, height: 2 * half, data: Float32Array.from(rasters[0]) };
  const ow = edgeWidthPx(ortho);
  const rows: [string, number, string][] = [["orthophoto", pixelM, ow ? `${ow.widthPx.toFixed(2)} px = ${(ow.widthPx * pixelM * 100).toFixed(2)} cm (${ow.edges} edges)` : "too few edges"]];

  const maxZ = t.tiles_max_zoom ?? 20;
  for (const z of [maxZ, maxZ - 1]) {
    const mpp = metresPerPixel(centre.lat, z), n = 2 ** z;
    const X = ((centre.lng + 180) / 360) * n * 256;
    const latR = (centre.lat * Math.PI) / 180;
    const Y = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n * 256;
    const span = Math.ceil(sideM / mpp / 256 / 2);
    const tx0 = Math.floor(X / 256) - span, ty0 = Math.floor(Y / 256) - span, k = 2 * span + 1;
    const mosaic: Gray = { width: k * 256, height: k * 256, data: new Float32Array(k * 256 * k * 256) };
    let got = 0;
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) {
      for (const key of [`${t.user_id}/${t.odm_uuid}/${z}/${tx0 + i}/${ty0 + j}.png`, `${t.odm_uuid}/${z}/${tx0 + i}/${ty0 + j}.png`]) {
        const { data } = await db.storage.from("tiles").download(key);
        if (!data) continue;
        const png = PNG.sync.read(Buffer.from(await data.arrayBuffer()));
        if (png.width !== 256) break;
        for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) mosaic.data[(j * 256 + y) * mosaic.width + i * 256 + x] = png.data[(y * 256 + x) * 4 + 1];
        got++;
        break;
      }
    }
    const tw = got === k * k ? edgeWidthPx(mosaic) : null;
    rows.push([`tiles, zoom ${z}`, mpp, got < k * k ? `${got} of ${k * k} tiles found` : tw ? `${tw.widthPx.toFixed(2)} px = ${(tw.widthPx * mpp * 100).toFixed(2)} cm (${tw.edges} edges)` : "too few edges"]);
  }
  console.log(`\ntile pyramid: zoom ${t.tiles_min_zoom}-${t.tiles_max_zoom}, ${t.tiles_total ?? "?"} tiles, baked ${t.tiles_baked}`);
  console.log("\nstage                pixel      edge width (10-90%, median; same ground)");
  for (const [name, mpp, edge] of rows) console.log(`${name.padEnd(20)} ${(mpp * 100).toFixed(2).padStart(5)} cm   ${edge}`);
  console.log("\nA tile edge wider on the ground than the orthophoto's is detail the pyramid lost; narrower in pixels but no narrower in cm is oversampling, not detail.");
}

main().catch(e => {
  const env = readBenchEnv(str("env-file"));
  console.error(redact(String((e as Error)?.message ?? e), [env.serviceRoleKey]));
  process.exit(1);
});
