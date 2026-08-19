/**
 * Generates the favicon set from the single source mark.
 *
 * WHY A GENERATOR RATHER THAN CHECKED-IN ART. There is one mark
 * (src/assets/swathwise-logo.png) and five derived files. Hand-exporting five
 * sizes is five chances for one of them to drift from the others, and the
 * drift is invisible until someone notices the tab icon disagrees with the
 * home-screen icon. Same reasoning as scripts/build-share-card.cjs.
 *
 * WHAT IT FIXES. The source mark is a 1024x1024 green glyph carrying ~35% of
 * its own padding. Handing that to a browser as a 16 px tab icon spends most of
 * the pixels on margin, so the mark is cropped to its ink and re-margined to a
 * known fraction. That is the whole transform: the background stays
 * transparent, so the mark sits on whatever the tab bar, home screen or search
 * result puts behind it.
 *
 * Run with: node scripts/build-favicons.cjs
 */
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const repo = path.resolve(__dirname, "..");
const SRC = path.join(repo, "src/assets/swathwise-logo.png");

/** Fraction of the tile left as margin on the tighter axis. */
const MARGIN = 0.08;

const logo = PNG.sync.read(fs.readFileSync(SRC));

// Crop to the mark's actual ink. The source carries its own generous padding,
// which is right for a logo on a page and wrong for a 16 px tile where every
// pixel of margin is a pixel the glyph does not get.
const ink = (() => {
  let minX = logo.width, minY = logo.height, maxX = -1, maxY = -1;
  for (let y = 0; y < logo.height; y++) {
    for (let x = 0; x < logo.width; x++) {
      if (logo.data[((logo.width * y + x) << 2) + 3] < 16) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error("logo is fully transparent");
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
})();

/**
 * Render the mark into a transparent `size` x `size` RGBA tile.
 *
 * Box-samples the source rather than point-sampling it: at 16 px each output
 * pixel covers roughly 40 source pixels, and taking one of them turns a smooth
 * curve into a staircase.
 *
 * Coverage becomes ALPHA rather than being flattened against a background.
 * That is what keeps the edges anti-aliased against whatever the icon is
 * eventually drawn on, instead of against a ground guessed here.
 */
function tile(size) {
  // pngjs zero-fills, which is transparent black — exactly the ground we want.
  const png = new PNG({ width: size, height: size });

  // Fit the ink box inside the margin, preserving aspect.
  const box = size * (1 - 2 * MARGIN);
  const scale = Math.min(box / ink.w, box / ink.h);
  const drawW = Math.max(1, Math.round(ink.w * scale));
  const drawH = Math.max(1, Math.round(ink.h * scale));
  const offX = Math.round((size - drawW) / 2);
  const offY = Math.round((size - drawH) / 2);
  const stepX = ink.w / drawW, stepY = ink.h / drawH;

  for (let y = 0; y < drawH; y++) {
    for (let x = 0; x < drawW; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const x0 = ink.x + Math.floor(x * stepX);
      const x1 = ink.x + Math.min(ink.w, Math.ceil((x + 1) * stepX));
      const y0 = ink.y + Math.floor(y * stepY);
      const y1 = ink.y + Math.min(ink.h, Math.ceil((y + 1) * stepY));
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
      // Un-premultiply: r/g/b were accumulated weighted by source alpha, so
      // dividing by the alpha total recovers the mark's own colour rather than
      // a version darkened toward whatever it was averaged against.
      const src = [r / a, g / a, b / a];
      const o = (size * (offY + y) + (offX + x)) << 2;
      for (let c = 0; c < 3; c++) png.data[o + c] = Math.round(src[c]);
      png.data[o + 3] = Math.round(alpha * 255);
    }
  }
  return png;
}

/**
 * Pack PNGs into an .ico.
 *
 * The entries are PNG-encoded rather than BMP. That is the Vista-era ICO
 * variant, understood by every browser we target and by Google's favicon
 * fetcher, and it avoids hand-rolling a BMP encoder with its bottom-up rows and
 * separate AND mask - a lot of fiddly code to produce a larger file.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const dir = Buffer.alloc(16 * images.length);
  let offset = header.length + dir.length;
  images.forEach((img, i) => {
    const at = i * 16;
    // 256 is encoded as 0; nothing here is that big, but the rule is the rule.
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, at);
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, at + 1);
    dir.writeUInt8(0, at + 2);             // palette size, 0 for truecolour
    dir.writeUInt8(0, at + 3);             // reserved
    dir.writeUInt16LE(1, at + 4);          // colour planes
    dir.writeUInt16LE(32, at + 6);         // bits per pixel
    dir.writeUInt32LE(img.data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += img.data.length;
  });

  return Buffer.concat([header, dir, ...images.map(i => i.data)]);
}

const write = (rel, buf) => {
  const p = path.join(repo, rel);
  fs.writeFileSync(p, buf);
  console.log(`${rel.padEnd(34)} ${fs.statSync(p).size} bytes`);
};

// Hashed by Vite because index.html references them from src/. Browsers cache
// favicons past a hard refresh, so a fixed URL would strand the old mark in
// everyone's tab; a content-hashed one changes exactly when the image does.
const png16 = PNG.sync.write(tile(16));
const png32 = PNG.sync.write(tile(32));
const png48 = PNG.sync.write(tile(48));
const png180 = PNG.sync.write(tile(180));
const png512 = PNG.sync.write(tile(512));

write("src/assets/favicon-16.png", png16);
write("src/assets/favicon-32.png", png32);
write("src/assets/apple-touch-icon.png", png180);

// Fixed public paths, for the fetchers that never read the HTML: /favicon.ico
// is requested blindly by browsers and by search-engine icon crawlers, and iOS
// falls back to /apple-touch-icon.png the same way. These cannot be hashed -
// being at a known URL is the entire job.
write("public/favicon.ico", ico([
  { size: 16, data: png16 },
  { size: 32, data: png32 },
  { size: 48, data: png48 },
]));
write("public/apple-touch-icon.png", png180);
write("public/favicon.png", png512);
