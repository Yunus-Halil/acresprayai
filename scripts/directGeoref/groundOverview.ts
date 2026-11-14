// Photo ground's overview for a twin already built, with the build's own code (photoGround.overviewGround, the
// function the in-browser build calls when the flag is on), so the dev preview (/dev/field-twin) shows exactly what a
// build would make. Cameras: the build's own (a corn build's analysis record) or aligned here as the build aligns them.
//
//   npx vite-node scripts/directGeoref/groundOverview.ts -- --twin <twin dir> --dir <photographs> [--analysis <analysis.json>]
//
// Writes <twin>/ground/<z>/<x>/<y>.jpg and <twin>/ground/ground.json. Local files only: never uploaded, data/ is never committed.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { encodeJpeg } from "../bench/images";
import { nodePhoto } from "./nodePhotos";
import { framesFromAnalysis, parseTwinAnalysis } from "../../src/lib/fieldTwin/analysis";
import { readPhotographs } from "../../src/lib/fieldTwin/build/photos";
import { alignCameras } from "../../src/lib/fieldTwin/build/cameras";
import type { GeorefFrame } from "../../src/lib/directGeoref/projection";
import { overviewGround } from "../../src/lib/fieldTwin/photoGround";

const argv = process.argv.slice(2);
const arg = (k: string, d = "") => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const TWIN = resolve(arg("twin")), DIR = resolve(arg("dir"));
const twin = JSON.parse(readFileSync(join(TWIN, "twin.json"), "utf8")) as { id: string };
const photos = new Map(readdirSync(DIR).filter(f => /\.jpe?g$/i.test(f)).map(f => { const p = nodePhoto(join(DIR, f)); return [p.name, p] as const; }));
let frames: Map<string, GeorefFrame>;
if (arg("analysis")) {
  const parsed = parseTwinAnalysis(JSON.parse(readFileSync(arg("analysis"), "utf8")));
  if (!parsed.ok) throw new Error(parsed.reason);
  frames = framesFromAnalysis(parsed.analysis);
} else {
  const { reads } = await readPhotographs([...photos.values()], 4, {}, true);
  frames = (await alignCameras(reads, {}, 40, 0, null)).frames;
}
frames = new Map([...frames].filter(([n]) => photos.has(n)));
// As the build's `pixels`: each photograph's preview, else its quarter decode.
let fromPreview = 0, quarter = 0;
const pixels = async (name: string) => { const p = photos.get(name)!; const pv = await p.preview(); if (pv) { fromPreview++; return pv; } quarter++; return p.decode(4); };
const anyPreview = !!(await photos.values().next().value!.preview());
rmSync(join(TWIN, "ground"), { recursive: true, force: true });
const t0 = Date.now();
let n = 0;
for await (const f of overviewGround(twin.id, frames, pixels, async (rgba, w, h) => encodeJpeg({ width: w, height: h, data: rgba }, 82), { source: anyPreview ? "the camera's own previews" : "quarter decodes of the photographs" })) {
  const out = join(TWIN, f.file); mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(await (f.bytes as Blob).arrayBuffer()));
  n++;
}
const m = JSON.parse(readFileSync(join(TWIN, "ground", "ground.json"), "utf8"));
void fromPreview; void quarter;
console.log(JSON.stringify({ twin: twin.id, files: n, ms: Date.now() - t0, overview: m.overview, detail: m.detail, timings: m.timings }));
