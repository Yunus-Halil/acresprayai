// Why an in-app (Chrome) build and a Node build of the same corn flight differ (2026-11-05). Reads every photograph
// twice with the same Corn V1 code: once on Chrome's decode (createImageBitmap + OffscreenCanvas, exactly the app's
// browserPhotos.ts path, the read run in the page through the dev server) and once on Node's (jpeg-js), then combines
// each set over the field with the SAME camera frames, and lists every field weed whose verdict differs with the
// per-photograph sightings behind it, and every photograph whose own read differs. Nothing is tuned.
//   npx vite-node scripts/rowCrop/cornDecoderTrace.ts --dir <flight> [--base http://localhost:8080] [--out <file.json>]
import "../bench/nodeStorageShim";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { NODE_DECODER, decodeImage } from "../bench/images";
import { nodePhoto } from "../directGeoref/nodePhotos";
import { readPhotographs } from "../../src/lib/fieldTwin/build/photos";
import { alignCameras } from "../../src/lib/fieldTwin/build/cameras";
import { cornPhotoRead } from "../../src/lib/fieldTwin/build/corn";
import { cornField, type CornPhotoRead } from "../../src/lib/fieldTwin/cornField";
import { groundSampleAt } from "../../src/lib/directGeoref/projection";
import type { PhotoPixels } from "../../src/lib/photoScout/pattern";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const DIR = resolve(arg("dir")!), BASE = arg("base", "http://localhost:8080"), OUT = arg("out");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const files = readdirSync(DIR).filter(f => /\.jpe?g$/i.test(f)).sort();

// The camera frames, once, from Node (this flight's are header-only: no soil ties, so no pixels enter them).
const { reads: photoReads } = await readPhotographs(files.map(f => nodePhoto(join(DIR, f))), 4, {}, true);
const cams = await alignCameras(photoReads, {}, 40, 0, null);
const gsd: Record<string, number | null> = {};
for (const [name, f] of cams.frames) gsd[name] = groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy);
console.log(`cameras: ${cams.frames.size} frames, ${cams.report.ties ?? 0} soil ties`);

// Chrome: the app's decode and the app's own read, in the page.
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const chromeVersion = browser.version();
const page = await browser.newPage();
await page.route("**/__trace/**", route => route.fulfill({ body: readFileSync(join(DIR, decodeURIComponent(route.request().url().split("/__trace/")[1]))), contentType: "image/jpeg" }));
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
const chrome: Record<string, CornPhotoRead> = {}, node: Record<string, CornPhotoRead> = {};
const pixelDiff: Record<string, { meanAbs: number; max: number; meanSigned: number[] }> = {};
for (const f of files) {
  const name = f.replace(/\.[^.]+$/, "");
  if (!(name in gsd)) continue;
  // As a string: vite-node would rewrite an import() written here into its own loader, which the page lacks.
  const r = await page.evaluate(`(async ({ url, name, gsdM }) => {
    const { cornPhotoRead } = await import("/src/lib/fieldTwin/build/corn.ts");
    const b = await createImageBitmap(await (await fetch(url)).blob());
    const c = new OffscreenCanvas(b.width, b.height), g = c.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high"; g.drawImage(b, 0, 0, b.width, b.height); b.close();
    const d = g.getImageData(0, 0, c.width, c.height);
    // A sample of the pixels (every 97th) for the decoder comparison; the read itself uses every pixel.
    const sample = []; for (let i = 0; i < d.data.length; i += 97 * 4) sample.push(d.data[i], d.data[i + 1], d.data[i + 2]);
    return { read: cornPhotoRead(name, { width: d.width, height: d.height, rgba: d.data }, gsdM), sample, w: d.width, h: d.height };
})(${JSON.stringify({ url: `${BASE}/__trace/${encodeURIComponent(f)}`, name, gsdM: gsd[name] })})`) as { read: CornPhotoRead; sample: number[]; w: number; h: number };
  chrome[name] = r.read as CornPhotoRead;
  const raw = decodeImage(new Uint8Array(readFileSync(join(DIR, f))));
  const px: PhotoPixels = { width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength) };
  node[name] = cornPhotoRead(name, px, gsd[name]);
  let s = 0, mx = 0, k = 0; const sg = [0, 0, 0];
  for (let i = 0, j = 0; i < px.rgba.length; i += 97 * 4, j += 3) for (let ch = 0; ch < 3; ch++) { const dv = r.sample[j + ch] - px.rgba[i + ch]; s += Math.abs(dv); sg[ch] += dv; mx = Math.max(mx, Math.abs(dv)); k++; }
  pixelDiff[name] = { meanAbs: +(s / k).toFixed(3), max: mx, meanSigned: sg.map(v => +(v / (k / 3)).toFixed(3)) };
  const same = JSON.stringify(chrome[name]) === JSON.stringify(node[name]);
  const wc = (x: CornPhotoRead) => x.patches.filter(p => p.verdict === "weed candidate").length;
  console.log(`${name}: pixels |d| ${pixelDiff[name].meanAbs} (max ${mx}, R/G/B ${pixelDiff[name].meanSigned.join("/")}) | read ${same ? "identical" : `DIFFERENT (rows ${chrome[name].rows.length}/${node[name].rows.length}, patches ${chrome[name].patches.length}/${node[name].patches.length}, weed candidates ${wc(chrome[name])}/${wc(node[name])})`}`);
}
await browser.close();

const fc = cornField(Object.values(chrome), cams.frames), fn = cornField(Object.values(node), cams.frames);
console.log(`\nfield, Chrome pixels: ${JSON.stringify({ ...fc.summary, ms: undefined })}\nfield, Node pixels:   ${JSON.stringify({ ...fn.summary, ms: undefined })}`);
// Field weeds matched by place (within 10 cm), verdicts compared.
const near = (a: { e: number; n: number }, b: { e: number; n: number }) => Math.hypot(a.e - b.e, a.n - b.n) < 0.1;
const changed = [];
for (const w of fc.weeds) {
  const m = fn.weeds.find(x => near(x, w));
  if (m && m.verdict === w.verdict && JSON.stringify(m.votes) === JSON.stringify(w.votes)) continue;
  changed.push({ at: [+w.e.toFixed(2), +w.n.toFixed(2)], chrome: { verdict: w.verdict, votes: w.votes, seenBy: w.seenBy, coveredBy: w.coveredBy, why: w.why, sightings: w.sightings.map(s => ({ photo: s.photo, verdict: s.verdict, u: Math.round(s.u), v: Math.round(s.v) })) }, node: m ? { verdict: m.verdict, votes: m.votes, seenBy: m.seenBy, coveredBy: m.coveredBy, why: m.why, sightings: m.sightings.map(s => ({ photo: s.photo, verdict: s.verdict, u: Math.round(s.u), v: Math.round(s.v) })) } : null });
}
for (const w of fn.weeds) if (!fc.weeds.some(x => near(x, w))) changed.push({ at: [+w.e.toFixed(2), +w.n.toFixed(2)], chrome: null, node: { verdict: w.verdict, votes: w.votes, seenBy: w.seenBy, coveredBy: w.coveredBy, why: w.why, sightings: w.sightings.map(s => ({ photo: s.photo, verdict: s.verdict, u: Math.round(s.u), v: Math.round(s.v) })) } });
console.log(`\n${changed.length} field weed object(s) differ:`);
for (const c of changed) console.log(JSON.stringify(c));
const out = { dir: DIR, chrome: { decoder: "Chrome createImageBitmap + OffscreenCanvas getImageData (the app's path)", environment: `Chrome ${chromeVersion} headless, Playwright` }, node: NODE_DECODER, frames: "Node, header-only (shared by both)", pixelDiff, fieldChrome: fc.summary, fieldNode: fn.summary, changedWeeds: changed, readsDiffer: Object.keys(chrome).filter(n => JSON.stringify(chrome[n]) !== JSON.stringify(node[n])), chromeReads: chrome, nodeReads: node };
if (OUT) writeFileSync(OUT, JSON.stringify(out));
