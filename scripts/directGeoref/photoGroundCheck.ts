// EXPERIMENT (experiment/photo-ground): do the twin's plants and rows sit on the plants in the photographs laid on the
// ground (photoGround.ts)? Read from the detail tiles only, at their own pixels.
//
//   vegetation  a pixel whose excess-green chroma (2g - r - b) / (r + g + b) is above its tile's median by 0.03 (the
//               measure the first independent corn flight's diagnostic used; olive seedlings darker than the soil pass)
//   plants      the share of the twin's certain plants (class 0) with vegetation within 3 cm; the same dots moved half a
//               row spacing across the rows (between the rows) as the control; the shift within +-10 cm (2 cm steps)
//               that would put the most dots on vegetation (a systematic offset between dots and imagery)
//   rows        the same along the corn rows' lines (every 5 cm), and half a spacing across as the control
//   unlocated   of the vegetation within 5 cm of a corn row's line, the share farther than 4 cm from any located plant
//               (classes 0 and 1): green on the row where the twin located no plant (missed plants, or weeds on the row)
//
//   npx vite-node scripts/directGeoref/photoGroundCheck.ts -- --twin <twin dir>
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodeImage } from "../bench/images";
import { TILE, latOfY, lngOfX, metresPerPixel, tileX, tileY } from "../../src/lib/fieldTwin/photoGround";
import type { TwinBundle } from "../../src/lib/fieldTwin/types";

const argv = process.argv.slice(2);
const arg = (k: string, d = "") => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const TWIN = resolve(arg("twin"));
const twin = JSON.parse(readFileSync(join(TWIN, "twin.json"), "utf8")) as TwinBundle;
const ground = JSON.parse(readFileSync(join(TWIN, "pg", "ground.json"), "utf8")) as { detail: { zoom: number } };
const z = ground.detail.zoom;
const plantsFile = join(TWIN, "plants.json");
const P = twin.corn?.plants ?? (existsSync(plantsFile) ? JSON.parse(readFileSync(plantsFile, "utf8")) : null) as { points: [number, number][]; certainty?: number[] } | null;
const corn = twin.corn;
if (!corn) { console.error("not a corn twin"); process.exit(1); }
const spacing = corn.rowSpacingM ?? twin.field.rowSpacingM, dirDeg = corn.rowDirectionDeg ?? twin.field.rowDirectionDeg;
const lat0 = twin.origin.lat, mpp = metresPerPixel(lat0, z);
const kE = Math.cos((lat0 * Math.PI) / 180) * 111_320, kN = 110_574;

// Tiles, their vegetation masks (per tile median threshold), cached.
type Mask = { veg: Uint8Array } | null;
const masks = new Map<string, Mask>();
const maskOf = (x: number, y: number): Mask => {
  const key = `${x}/${y}`;
  if (masks.has(key)) return masks.get(key)!;
  const f = join(TWIN, "pg", "detail", String(z), String(x), `${y}.jpg`);
  let m: Mask = null;
  if (existsSync(f)) {
    const img = decodeImage(new Uint8Array(readFileSync(f)));
    const n = TILE * TILE, exg = new Float32Array(n), bg = new Uint8Array(n);
    for (let o = 0; o < n; o++) { const r = img.data[o * 4], g = img.data[o * 4 + 1], b = img.data[o * 4 + 2]; exg[o] = (2 * g - r - b) / (r + g + b + 1); if (r === 26 && g === 28 && b === 26) bg[o] = 1; }
    const vals = Array.from(exg).filter((_, o) => !bg[o]).sort((p, q) => p - q);
    if (vals.length > n / 4) {
      const med = vals[vals.length >> 1], veg = new Uint8Array(n);
      for (let o = 0; o < n; o++) veg[o] = !bg[o] && exg[o] > med + 0.03 ? 1 : 0;
      m = { veg };
    }
  }
  masks.set(key, m);
  return m;
};
// Global pixel coordinates at zoom z.
const gx = (lng: number) => tileX(lng, z) * TILE, gy = (lat: number) => tileY(lat, z) * TILE;
/** The share of vegetation pixels within r metres of a global pixel position, or null where no imagery. */
const vegNear = (X: number, Y: number, rM: number): number | null => {
  const r = rM / mpp, r2 = r * r;
  let n = 0, v = 0;
  for (let yy = Math.floor(Y - r); yy <= Math.ceil(Y + r); yy++) for (let xx = Math.floor(X - r); xx <= Math.ceil(X + r); xx++) {
    if ((xx - X) ** 2 + (yy - Y) ** 2 > r2) continue;
    const m = maskOf(Math.floor(xx / TILE), Math.floor(yy / TILE));
    if (!m) continue;
    n++; v += m.veg[(yy - Math.floor(yy / TILE) * TILE) * TILE + (xx - Math.floor(xx / TILE) * TILE)];
  }
  return n ? v / n : null;
};
// Across the rows: measured from the corn rows' own lines (length-weighted, doubled angles), never from a stored angle
// (the lattice and plants-first reads do not share one convention).
const across = (() => {
  let sx = 0, sy = 0;
  for (const r of corn.rows) for (let i = 1; i < r.line.length; i++) { const de = (r.line[i][1] - r.line[i - 1][1]) * kE, dn = (r.line[i][0] - r.line[i - 1][0]) * kN, L = Math.hypot(de, dn); if (!L) continue; const a = Math.atan2(dn, de); sx += L * Math.cos(2 * a); sy += L * Math.sin(2 * a); }
  const a = Math.atan2(sy, sx) / 2; return [-Math.sin(a), Math.cos(a)];
})();
const pxOfMetres = (eM: number, nM: number) => [eM / mpp, -nM / mpp];

/** Over the points (moved by de, dn metres): how many have imagery, the share with at least 20 % vegetation within rM,
 * and the mean vegetation share within rM. */
const rate = (pts: [number, number][], de: number, dn: number, rM: number) => {
  let hit = 0, n = 0, sum = 0;
  const [ox, oy] = pxOfMetres(de, dn);
  for (const [la, lo] of pts) { const v = vegNear(gx(lo) + ox, gy(la) + oy, rM); if (v === null) continue; n++; sum += v; if (v >= 0.2) hit++; }
  return { n, share: n ? +(hit / n).toFixed(3) : null, meanVeg: n ? +(sum / n).toFixed(3) : null };
};
const out: Record<string, unknown> = { twin: twin.id, zoom: z, pixelCm: +(mpp * 100).toFixed(3), spacingM: spacing, directionDeg: dirDeg };
const half = 0.5 * spacing;

if (P) {
  const certain = P.points.filter((_, i) => (P.certainty?.[i] ?? 0) === 0);
  const sample = certain.filter((_, i) => i % Math.max(1, Math.floor(certain.length / 6000)) === 0);
  out.plants = { certain: certain.length, sampled: sample.length, onVegetation3cm: rate(sample, 0, 0, 0.03), controlHalfSpacingAcross: rate(sample, across[0] * half, across[1] * half, 0.03) };
  // Systematic offset: the shift that puts the most dots on vegetation.
  const sub = sample.filter((_, i) => i % 3 === 0);
  let best = { de: 0, dn: 0, share: -1 };
  for (let de = -0.1; de <= 0.1001; de += 0.02) for (let dn = -0.1; dn <= 0.1001; dn += 0.02) { const r = rate(sub, de, dn, 0.03); if (r.share != null && r.share > best.share) best = { de: +de.toFixed(2), dn: +dn.toFixed(2), share: r.share }; }
  (out.plants as Record<string, unknown>).bestShift = { eastCm: best.de * 100, northCm: best.dn * 100, share: best.share, atZero: rate(sub, 0, 0, 0.03).share };
}
// Rows: the corn rows' lines every 5 cm.
const rowPts: [number, number][] = [];
for (const r of corn.rows.filter(r => r.status === "corn")) {
  for (let i = 1; i < r.line.length; i++) {
    const [a, b] = [r.line[i - 1], r.line[i]], L = Math.hypot((b[1] - a[1]) * kE, (b[0] - a[0]) * kN), n = Math.max(1, Math.round(L / 0.05));
    for (let k = 0; k < n; k++) rowPts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
}
const rs = rowPts.filter((_, i) => i % Math.max(1, Math.floor(rowPts.length / 8000)) === 0);
out.rows = { points: rowPts.length, sampled: rs.length, onVegetation3cm: rate(rs, 0, 0, 0.03), controlHalfSpacingAcross: rate(rs, across[0] * half, across[1] * half, 0.03) };

// Green on the rows with no located plant near it.
if (P) {
  const located = P.points.filter((_, i) => (P.certainty?.[i] ?? 0) <= 1);
  const grid = new Map<string, [number, number][]>(), cell = 0.1 / mpp;
  for (const [la, lo] of located) { const X = gx(lo), Y = gy(la), k = `${Math.floor(X / cell)}/${Math.floor(Y / cell)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push([X, Y]); }
  const nearDot = (X: number, Y: number, rPx: number) => { const cx = Math.floor(X / cell), cy = Math.floor(Y / cell); for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) for (const [px, py] of grid.get(`${cx + i}/${cy + j}`) ?? []) if ((px - X) ** 2 + (py - Y) ** 2 <= rPx * rPx) return true; return false; };
  let veg = 0, unloc = 0;
  const band = 0.05 / mpp, step = Math.max(1, Math.round(0.01 / mpp));
  for (const [la, lo] of rs) {
    const X = gx(lo), Y = gy(la);
    for (let yy = Math.floor(Y - band); yy <= Y + band; yy += step) for (let xx = Math.floor(X - band); xx <= X + band; xx += step) {
      const m = maskOf(Math.floor(xx / TILE), Math.floor(yy / TILE)); if (!m) continue;
      if (!m.veg[(yy - Math.floor(yy / TILE) * TILE) * TILE + (xx - Math.floor(xx / TILE) * TILE)]) continue;
      veg++; if (!nearDot(xx, yy, 0.04 / mpp)) unloc++;
    }
  }
  out.unlocated = { vegetationSamplesOnRows: veg, fartherThan4cmFromALocatedPlant: unloc, share: veg ? +(unloc / veg).toFixed(3) : null };
}
writeFileSync(join(TWIN, "pg", "check.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
void latOfY; void lngOfX;
