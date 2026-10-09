/**
 * Generates public/share-card.png - the 1200x630 image link previews show.
 *
 * The Swardus lockup (src/assets/brand/lockup-white.png) centred on field
 * green, nothing else: og:title and og:description supply the words on every
 * surface that renders a preview, and baked-in copy is exactly the thing that
 * ends up contradicting the page.
 *
 * Run with: node scripts/build-share-card.cjs
 */
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const W = 1200, H = 630;                 // 1.91:1, what OG consumers expect
const GREEN = [18, 31, 20];               // the lockup's own ground

const repo = path.resolve(__dirname, "..");
const logoPath = path.join(repo, "src/assets/brand/lockup-white.png");
const outPath = path.join(repo, "public/share-card.png");

const out = new PNG({ width: W, height: H });
const put = (x, y, [r, g, b]) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (W * y + x) << 2;
  out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = 255;
};
const mix = (base, over, a) => base.map((c, i) => Math.round(c * (1 - a) + over[i] * a));

for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, GREEN);

// The lockup, 760 px wide, centred, box-sampled so the downscale does not alias.
const logo = PNG.sync.read(fs.readFileSync(logoPath));
const targetW = 760, scale = logo.width / targetW, targetH = Math.round(logo.height / scale);
const originX = Math.round((W - targetW) / 2), originY = Math.round((H - targetH) / 2);
for (let y = 0; y < targetH; y++) {
  for (let x = 0; x < targetW; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    const x0 = Math.floor(x * scale), x1 = Math.min(logo.width, Math.ceil((x + 1) * scale));
    const y0 = Math.floor(y * scale), y1 = Math.min(logo.height, Math.ceil((y + 1) * scale));
    for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
      const i = (logo.width * sy + sx) << 2;
      const sa = logo.data[i + 3] / 255;
      r += logo.data[i] * sa; g += logo.data[i + 1] * sa; b += logo.data[i + 2] * sa; a += sa; n++;
    }
    if (!n || a === 0) continue;
    put(originX + x, originY + y, mix(GREEN, [r / a, g / a, b / a], a / n));
  }
}

fs.writeFileSync(outPath, PNG.sync.write(out));
console.log(`share-card.png  ${W}x${H}  ${fs.statSync(outPath).size} bytes`);
