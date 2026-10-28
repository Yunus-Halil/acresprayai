// The in-app build pipeline (src/lib/fieldTwin/build) run in Node over a folder of photographs: the same code the
// Field Twin page runs in its worker, so the port can be checked against the milestone scripts' twin.
//
//   npx vite-node scripts/directGeoref/buildTwinApp.ts -- [--dir directtestimagery] [--out data/direct-georef/twin-app]
//       [--name "Apricot orchard"] [--id apricot-app] [--weeds saved|none] [--limit N] [--no-preview] [--holdout 0.3]
//
// --weeds saved reads the service's saved answers in data/direct-georef/apricot/m1/rfdetr/<photo>.json (the GPU
// service need not run); none builds without weeds. Writes <out>/<id>/{twin.json, atlas-N.jpg, report.json}.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildFieldTwin } from "../../src/lib/fieldTwin/build/pipeline";
import type { WeedDetector } from "../../src/lib/fieldTwin/build/types";
import type { WeedVisionResult } from "../../src/lib/weedVision/client";
import { nodeCodec, nodePhoto } from "./nodePhotos";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const ROOT = resolve(__dirname, "../..");
const DIR = resolve(ROOT, arg("dir", "directtestimagery"));
const OUT = resolve(ROOT, arg("out", "data/direct-georef/twin-app"));
const NAME = arg("name", "Apricot orchard, built in the app");
const ID = argv.includes("--id") ? arg("id", "") : undefined;
const LIMIT = Number(arg("limit", "0"));
const WEEDS = arg("weeds", "saved");
const USE_PREVIEW = !argv.includes("--no-preview");
const HOLDOUT = Number(arg("holdout", "0"));
const CELL = Number(arg("cell", "0.08"));
const SAVED = resolve(ROOT, "data/direct-georef/apricot/m1/rfdetr");

let files = readdirSync(DIR).filter(f => /\.jpe?g$/i.test(f)).sort();
if (LIMIT) files = files.slice(0, LIMIT);
const photos = files.map(f => nodePhoto(join(DIR, f)));
const detector: WeedDetector = WEEDS === "saved"
  ? async p => { const path = join(SAVED, `${p.name}.json`); return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as WeedVisionResult) : null; }
  : null;

const t0 = Date.now();
let lastStage = "";
const out = await buildFieldTwin(photos, { name: NAME, id: ID, detector, usePreview: USE_PREVIEW, holdOutShare: HOLDOUT, rowRasterCellM: CELL }, nodeCodec, {
  onProgress: p => { if (p.stage !== lastStage) { lastStage = p.stage; console.log(`\n[${p.stage}]`); } if (p.total != null && p.done % 10 === 0) process.stdout.write(`  ${p.done}/${p.total} ${p.message} (${(p.elapsedMs / 1000).toFixed(0)} s)\n`); },
  log: line => console.log(`  ${line}`),
});
const dir = join(OUT, out.twin.id);
mkdirSync(dir, { recursive: true });
for (const [name, bytes] of out.files) writeFileSync(join(dir, name), bytes instanceof Uint8Array ? bytes : new Uint8Array(await (bytes as Blob).arrayBuffer()));
writeFileSync(join(dir, "report.json"), JSON.stringify(out.report, null, 1));
const t = out.twin;
console.log(`\ntwin ${t.id}: ${t.trees.length} trees, ${t.rows.filter(r => r.kept).length} rows kept of ${t.rows.length}, ${t.weeds.length} weed objects (${t.weeds.filter(w => w.status === "verified").length} verified), ${t.vegetation.length} vegetation patches, boundary ${t.boundary ? `${(t.boundary.cultivated.areaM2 / 10_000).toFixed(3)} ha` : "none"}; ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${dir}`);
console.log("timings", out.report.timings);
console.log("cameras", JSON.stringify({ ...out.report.cameras, globals: undefined, rejected: undefined }), "rejected", JSON.stringify(out.report.cameras.rejected));
for (const n of out.report.notes) console.log(`note: ${n}`);
