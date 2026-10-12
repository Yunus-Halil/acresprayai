// Field validation: hand-measured plants against Swardus's measurements.
//
//   npm run validate:sizes -- --truth path/to/plants.json [--scan <scan id>] [--dir samplerowtestingimagery] [--max-distance-m 0.5]
//
// The truth file is a JSON array of plants (scripts/bench/referencePlants.example.json
// shows every field; src/lib/weedScout/sizing/validate.ts defines them). Each
// plant is matched to a prediction:
//
//   --scan <id>    the saved findings of that scan, read with the service-role
//                  key from the environment (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//                  as the other benchmarks), matched by the finding's id, else by
//                  position, else by photo and pixel
//   otherwise      plants that name a photo and a pixel are measured here, in that
//                  photo under --dir, with the pixel size from its EXIF, exactly as
//                  the app measures (no pose: the photo is taken flat)
//
// Reports mean and median absolute diameter error, relative error, area error
// where reference areas exist, match and measurement rates, positional error
// where reference coordinates exist, and the errors by pixel size and by
// confidence. With under 20 measured plants the verdict says accuracy is not
// established. Nothing here invents a reference. Writes data/bench/validation/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import jpeg from "jpeg-js";
import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "./cli";
import { readBenchEnv, redact } from "./env";
import { estimateGsd, parsePhotoHeader } from "../../src/lib/photoScout/exif";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";
import { segmentWeed, vegetationThreshold } from "../../src/lib/weedScout/sizing/segment";
import { CONTEXT_M, FIRST_WINDOW_MAX_M, MAX_WINDOW_M, MIN_WINDOW_M, WINDOW_DIAMETERS, squareWindow } from "../../src/lib/weedScout/sizing/measure";
import { DEFAULT_SIZE_THRESHOLDS, type WeedMeasurement, readMeasurement } from "../../src/lib/weedScout/sizing/types";
import { type Prediction, matchReferences, predictionFromMeasurement, readReferences, reportLines, validationReport } from "../../src/lib/weedScout/sizing/validate";

const args = parseArgs(process.argv.slice(2));
const truthFile = typeof args.truth === "string" ? args.truth : null;
const scanId = typeof args.scan === "string" ? args.scan : null;
const dir = String(args.dir ?? "samplerowtestingimagery");
const maxDistanceM = args["max-distance-m"] ? Number(args["max-distance-m"]) : undefined;

type Raw = { width: number; height: number; data: Uint8Array };
const cut = (img: Raw, w: { x: number; y: number; width: number; height: number }): PhotoPixels => {
  const W = Math.min(w.width, img.width - w.x), H = Math.min(w.height, img.height - w.y);
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let r = 0; r < H; r++) rgba.set(img.data.subarray(((w.y + r) * img.width + w.x) * 4, ((w.y + r) * img.width + w.x + W) * 4), r * W * 4);
  return { width: W, height: H, rgba };
};
function measureAt(img: Raw, centre: { x: number; y: number }, gsdM: number, expectedM: number): WeedMeasurement {
  let sideM = Math.min(FIRST_WINDOW_MAX_M, Math.max(MIN_WINDOW_M, WINDOW_DIAMETERS * expectedM));
  const context = vegetationThreshold(cut(img, squareWindow(centre, CONTEXT_M / gsdM, img.width, img.height)));
  for (let attempt = 0; ; attempt++) {
    const win = squareWindow(centre, sideM / gsdM, img.width, img.height);
    const o = segmentWeed({ px: cut(img, win), centre: { x: centre.x - win.x, y: centre.y - win.y }, gsdM, thresholds: DEFAULT_SIZE_THRESHOLDS, context, expectedDiameterM: expectedM, cropCircles: null,
      photoEdge: { left: win.x === 0, top: win.y === 0, right: win.x + win.width >= img.width, bottom: win.y + win.height >= img.height }, viewAngleDeg: 0 });
    if (o.wider && attempt === 0 && sideM < MAX_WINDOW_M) { sideM = Math.min(MAX_WINDOW_M, sideM * 2); continue; }
    const m = o.measurement;
    return { ...m, sourceFrame: null, source: null, outline: null, outlinePx: null, centrePx: m.centrePx ? { x: m.centrePx.x + win.x, y: m.centrePx.y + win.y } : null };
  }
}

(async () => {
  if (!truthFile) { console.error("--truth <file> is required"); process.exit(1); }
  if (!existsSync(truthFile)) { console.error(`no truth file at ${truthFile}`); process.exit(1); }
  const { references, errors } = readReferences(JSON.parse(readFileSync(truthFile, "utf-8")));
  for (const e of errors) console.error("reference file: " + e);
  const predictions: Prediction[] = [];
  let source: string;
  if (scanId) {
    const env = readBenchEnv(typeof args["env-file"] === "string" ? args["env-file"] : null);
    if (!env.supabaseUrl || !env.serviceRoleKey) { console.error("--scan needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment"); process.exit(1); }
    const client = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.from("scan_findings").select("candidate_id, lat, lng, candidate").eq("scan_id", scanId);
    if (error) { console.error(redact(error.message, [env.serviceRoleKey])); process.exit(1); }
    for (const row of (data ?? []) as { candidate_id: string; lat: number; lng: number; candidate: { measurement?: unknown } }[]) {
      predictions.push(predictionFromMeasurement(row.candidate_id, { lat: row.lat, lng: row.lng }, readMeasurement(row.candidate?.measurement)));
    }
    source = `scan ${scanId}: ${predictions.length} saved findings`;
  } else {
    // Local: each referenced photo decoded once, each plant measured at its pixel.
    const photos = new Map<string, { raw: Raw; gsdM: number | null }>();
    for (const r of references) {
      if (!r.image || r.x == null || r.y == null) continue;
      const path = existsSync(r.image) ? r.image : join(dir, r.image);
      if (!photos.has(r.image)) {
        if (!existsSync(path)) { photos.set(r.image, { raw: { width: 0, height: 0, data: new Uint8Array(0) }, gsdM: null }); console.error(`${r.image}: not found under ${dir}`); continue; }
        const bytes = readFileSync(path);
        const exif = parsePhotoHeader(new Uint8Array(bytes.subarray(0, 1 << 20)));
        const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048 });
        photos.set(r.image, { raw: { width: img.width, height: img.height, data: img.data }, gsdM: estimateGsd(exif, { imageWidth: img.width }).gsdM });
      }
      const ph = photos.get(r.image)!;
      if (!ph.gsdM) { predictions.push({ id: `${r.image}@${r.x},${r.y}`, image: r.image, lat: null, lng: null, x: r.x, y: r.y, status: "unavailable", diameterCm: null, areaCm2: null, gsdCmPx: null, confidence: null, reason: "no pixel size in the photo's EXIF" }); continue; }
      const m = measureAt(ph.raw, { x: r.x, y: r.y }, ph.gsdM, r.diameterCm / 100);
      predictions.push({ ...predictionFromMeasurement(`${r.image}@${r.x},${r.y}`, null, m), image: r.image, x: r.x, y: r.y });
    }
    source = `local measurement in ${photos.size} photo(s) under ${dir}`;
  }
  const matches = matchReferences(references, predictions, { maxDistanceM });
  const report = validationReport(matches);
  console.log(`Source of predictions: ${source}`);
  for (const line of reportLines(report)) console.log(line);
  const outDir = join("data", "bench", "validation");
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${basename(truthFile).replace(/\.json$/, "")}${scanId ? `-${scanId.slice(0, 8)}` : ""}.json`);
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), truthFile, source, report, matches }, null, 2));
  console.log("wrote " + out);
})();
