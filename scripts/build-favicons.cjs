/**
 * Generates the favicon set from the one app icon.
 *
 * The source is src/assets/brand/source/app-icon-512.png: the Swardus mark on
 * a rounded field-green square, as the designer exported it. Every size here
 * is that file box-resampled, so the tab icon, the home-screen icon and the
 * search-result icon are the same picture at different sizes; nothing is
 * cropped or re-margined, the icon carries its own ground and corners.
 *
 * Two kinds of output. src/assets/* are referenced from index.html so Vite
 * hashes them (browsers cache favicons past a hard refresh; a hashed URL
 * changes exactly when the picture does). public/* sit at fixed paths for the
 * fetchers that never read the HTML: /favicon.ico, /apple-touch-icon.png, and
 * the manifest's /favicon.png and /favicon-192.png.
 *
 * Run with: node scripts/build-favicons.cjs
 */
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const repo = path.resolve(__dirname, "..");
const SRC = path.join(repo, "src/assets/brand/source/app-icon-512.png");
const icon = PNG.sync.read(fs.readFileSync(SRC));

/** The icon at `size` px a side: box-sampled, alpha kept, so the rounded corners stay soft on whatever is behind them. */
function tile(size) {
  const png = new PNG({ width: size, height: size });
  const step = icon.width / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const x0 = Math.floor(x * step), x1 = Math.min(icon.width, Math.ceil((x + 1) * step));
      const y0 = Math.floor(y * step), y1 = Math.min(icon.height, Math.ceil((y + 1) * step));
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
        const i = (icon.width * sy + sx) << 2;
        const sa = icon.data[i + 3] / 255;
        r += icon.data[i] * sa; g += icon.data[i + 1] * sa; b += icon.data[i + 2] * sa; a += sa; n++;
      }
      if (!n || a === 0) continue;
      const o = (size * y + x) << 2;
      png.data[o] = Math.round(r / a); png.data[o + 1] = Math.round(g / a); png.data[o + 2] = Math.round(b / a); png.data[o + 3] = Math.round((a / n) * 255);
    }
  }
  return png;
}

/** Pack PNGs into an .ico (PNG-encoded entries: every browser we target and Google's fetcher read them). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = header.length + dir.length;
  images.forEach((img, i) => {
    const at = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, at); dir.writeUInt8(img.size >= 256 ? 0 : img.size, at + 1);
    dir.writeUInt8(0, at + 2); dir.writeUInt8(0, at + 3); dir.writeUInt16LE(1, at + 4); dir.writeUInt16LE(32, at + 6);
    dir.writeUInt32LE(img.data.length, at + 8); dir.writeUInt32LE(offset, at + 12);
    offset += img.data.length;
  });
  return Buffer.concat([header, dir, ...images.map(i => i.data)]);
}

const write = (rel, buf) => { const p = path.join(repo, rel); fs.writeFileSync(p, buf); console.log(`${rel.padEnd(34)} ${fs.statSync(p).size} bytes`); };
const png16 = PNG.sync.write(tile(16)), png32 = PNG.sync.write(tile(32)), png48 = PNG.sync.write(tile(48));
const png180 = PNG.sync.write(tile(180)), png192 = PNG.sync.write(tile(192)), png512 = PNG.sync.write(tile(512));
write("src/assets/favicon-16.png", png16);
write("src/assets/favicon-32.png", png32);
write("src/assets/apple-touch-icon.png", png180);
write("public/favicon.ico", ico([{ size: 16, data: png16 }, { size: 32, data: png32 }, { size: 48, data: png48 }]));
write("public/apple-touch-icon.png", png180);
write("public/favicon-192.png", png192);
write("public/favicon.png", png512);
