// The emergence variant's green, checked by eye: the old mask (soil-relative ExGR at 1 cm) beside the seedling mask
// (tint against the soil beside it, with hysteresis, at the photo's own pixel) on crops of the very early photographs.
// Writes <photos>/outputs/seedling-mask/<photo>_<x>_<y>.png: left old, right new, plant pixels magenta.
// Usage: vite-node scripts/rowCrop/seedlingMaskProbe.ts -- [--photos directtestimagery/veryearlystage] [--opts '{"weakTint":9}'] [--tag _t9] [photo:x:y:w:h ...]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GREEN_DEFAULTS, greenMaskWithExcess } from "../../src/lib/directGeoref/green";
import { downsample } from "../../src/lib/rowCrop/readRowCrop";
import { SEEDLING_GREEN, seedlingMask } from "../../src/lib/rowCrop/seedlingGreen";
import { encodePng } from "../bench/images";
import { nodePhoto } from "../directGeoref/nodePhotos";

const argv = process.argv.slice(2);
const dirI = argv.indexOf("--photos");
const dir = dirI >= 0 ? argv[dirI + 1] : "directtestimagery/veryearlystage";
const optI = argv.indexOf("--opts"), tagI = argv.indexOf("--tag");
const over = optI >= 0 ? JSON.parse(argv[optI + 1]) : {}, tag = tagI >= 0 ? argv[tagI + 1] : "";
const specs = argv.filter((a, i) => a.includes(":") && (dirI < 0 || i !== dirI + 1) && (optI < 0 || i !== optI + 1));
const crops = specs.length ? specs : ["40:2300:1600:500:350", "54:100:2000:500:350", "4:2350:1300:500:350", "3:2400:1400:500:350", "60:4700:3400:500:350"];
const out = join(dir, "outputs", "seedling-mask");
mkdirSync(out, { recursive: true });
const cache = new Map<string, { old: Uint8Array; neu: Uint8Array; px: { width: number; height: number; rgba: Uint8ClampedArray } }>();
for (const spec of crops) {
  const [name, xs, ys, ws, hs] = spec.split(":"), x0 = +xs, y0 = +ys, w = +ws, h = +hs;
  let c = cache.get(name);
  if (!c) {
    const px = await nodePhoto(join(dir, `${name}.JPG`)).decode(1);
    const work = downsample(px, 2);
    const { mask } = greenMaskWithExcess({ width: work.W, height: work.H, rgba: work.rgba }, { ...GREEN_DEFAULTS, index: "exgr-soil", soilTilePx: 66, cellPx: 1, soilCapAboveGlobal: 0.05 });
    const t = Date.now(); const neu = seedlingMask(px, { ...SEEDLING_GREEN, ...over }); console.log(`${name}: seedling mask ${Date.now() - t} ms`);
    let a = 0, b = 0; for (const v of mask) a += v; for (const v of neu) b += v;
    console.log(`${name}: old ${(100 * a / mask.length).toFixed(2)} % green (1 cm), new ${(100 * b / neu.length).toFixed(2)} % (photo pixel)`);
    c = { old: mask, neu, px }; cache.set(name, c);
  }
  const S = 2, img = new Uint8Array(w * S * 2 * h * S * 4 + 0);
  const W2 = w * S * 2;
  for (let y = 0; y < h * S; y++) for (let x = 0; x < w * S; x++) {
    const sx = x0 + Math.floor(x / S), sy = y0 + Math.floor(y / S), q = (sy * c.px.width + sx) * 4;
    const o = c.old[Math.floor(sy / 2) * Math.floor(c.px.width / 2) + Math.floor(sx / 2)], n = c.neu[sy * c.px.width + sx];
    for (const [ox, m] of [[0, o], [w * S, n]] as const) {
      const p = (y * W2 + x + ox) * 4;
      img[p] = m ? 255 : c.px.rgba[q]; img[p + 1] = m ? 0 : c.px.rgba[q + 1]; img[p + 2] = m ? 255 : c.px.rgba[q + 2]; img[p + 3] = 255;
    }
  }
  writeFileSync(join(out, `${name}_${x0}_${y0}${tag}.png`), encodePng({ width: W2, height: h * S, data: img }));
}
console.log(`pictures in ${out}`);
