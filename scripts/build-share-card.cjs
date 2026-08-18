/**
 * Generates public/share-card.png - the 1200x630 image link previews show.
 *
 * Built from the site's own palette and mark rather than a screenshot, so it
 * cannot go stale when copy changes. Deliberately carries no text: og:title and
 * og:description supply the words on every surface that renders a preview, and
 * baked-in text is exactly the thing that ends up contradicting the page.
 *
 * Run with: node scripts/build-share-card.cjs
 */
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const W = 1200, H = 630;                 // 1.91:1, what OG consumers expect
const PAPER = [0xf4, 0xf3, 0xec];
const INK = [0x14, 0x17, 0x12];
const GREEN = [0x2f, 0x7a, 0x24];
const GRID = 72;                          // matches the landing page's grid
const GRID_ALPHA = 0.045;

const repo = path.resolve(__dirname, "..");
const logoPath = path.join(repo, "src/assets/swathwise-logo.png");
const outPath = path.join(repo, "public/share-card.png");

const out = new PNG({ width: W, height: H });

const put = (x, y, [r, g, b]) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (W * y + x) << 2;
  out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = 255;
};
const mix = (base, over, a) => base.map((c, i) => Math.round(c * (1 - a) + over[i] * a));

// 1. Paper ground.
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, PAPER);

// 2. The faint ink grid, fading out toward the bottom the way the page does.
const gridTint = mix(PAPER, INK, GRID_ALPHA);
for (let y = 0; y < H; y++) {
  const fade = 1 - Math.max(0, (y - H * 0.45) / (H * 0.55)) * 0.85;
  for (let x = 0; x < W; x++) {
    if (x % GRID === 0 || y % GRID === 0) put(x, y, mix(PAPER, gridTint, fade));
  }
}

// 3. A green rule down the left edge - the same device the page uses to mark
//    a factual block.
for (let y = 0; y < H; y++) for (let x = 0; x < 8; x++) put(x, y, GREEN);

// 4. The swath mark, centred, alpha-composited onto the paper.
const logo = PNG.sync.read(fs.readFileSync(logoPath));
const target = 340;                                  // rendered size, px
const scale = logo.width / target;
const originX = Math.round((W - target) / 2);
const originY = Math.round((H - target) / 2);

for (let y = 0; y < target; y++) {
  for (let x = 0; x < target; x++) {
    // Box-sample the source so downscaling does not alias the mark's curves.
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    const x0 = Math.floor(x * scale), x1 = Math.min(logo.width, Math.ceil((x + 1) * scale));
    const y0 = Math.floor(y * scale), y1 = Math.min(logo.height, Math.ceil((y + 1) * scale));
    for (let sy = y0; sy < y1; sy++) {
      for (let sx = x0; sx < x1; sx++) {
        const i = (logo.width * sy + sx) << 2;
        const sa = logo.data[i + 3] / 255;
        r += logo.data[i] * sa; g += logo.data[i + 1] * sa; b += logo.data[i + 2] * sa;
        a += sa; n++;
      }
    }
    if (!n || a === 0) continue;
    const alpha = a / n;
    const src = [r / a, g / a, b / a];
    put(originX + x, originY + y, mix(PAPER, src, alpha));
  }
}

fs.writeFileSync(outPath, PNG.sync.write(out));
console.log(`share-card.png  ${W}x${H}  ${fs.statSync(outPath).size} bytes`);
