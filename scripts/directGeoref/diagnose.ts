// What the disagreement between overlapping photographs is made of, from the cache run.ts wrote.
//
//   npx vite-node scripts/directGeoref/diagnose.ts -- [--out data/direct-georef/apricot] [--yaw gimbal|flight] [--straight] [--sizes] [--print] [--save file] [--yawcorr file]
//
// For each overlapping pair the matched patches (flat ground, both projected) are fitted with a 2D similarity B ~ s R A + t
// about the pair's midpoint: the rotation is a yaw disagreement between the two cameras, the scale a height/focal
// disagreement, the shift a position or timing disagreement, and what is left after the fit is detection noise plus
// relief. Then one yaw offset per photograph is solved by least squares over all pairs (the overall level is fixed
// by setting the mean to 0) and compared with the photographs' flight-minus-gimbal yaw.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type GeorefFrame, type GroundObject, frameFootprint, frameFromDji, matchPair, median, objectsToGround, takeoffPlane, type DjiPhotoMeta, type PixelObject } from "../../src/lib/directGeoref";
import { toEnu } from "../../src/lib/sourceFrames/odm";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = resolve(__dirname, "../..", arg("out", "data/direct-georef/apricot")!);
const YAW = arg("yaw", "gimbal");
const SKIPTURN = argv.includes("--straight");

type Cached = { name: string; meta: DjiPhotoMeta; objects: PixelObject[] };
const cached: Cached[] = readdirSync(join(OUT, "cache")).filter(f => f.endsWith(".json")).sort().map(f => JSON.parse(readFileSync(join(OUT, "cache", f), "utf8")));
const yawCorr = new Map<string, number>((arg("yawcorr") ? JSON.parse(readFileSync(arg("yawcorr")!, "utf8")) : []) as [string, number][]);

type F = { name: string; f: GeorefFrame; foot: { lat: number; lng: number }[]; g: GroundObject[]; turn: boolean; dYaw: number };
const frames: F[] = [];
for (const c of cached) {
  const m = { ...c.meta };
  if (YAW === "flight" && m.flightYawDeg != null) m.gimbalYawDeg = m.flightYawDeg;
  const r = frameFromDji(c.name, m, { ground: takeoffPlane(0) });
  if ("reason" in r) continue;
  r.frame.pose.attitude.yawDeg += yawCorr.get(c.name) ?? 0;
  const a = r.frame.pose.attitude;
  const turn = Math.abs(a.rollDeg) > 0.5 || Math.abs(a.pitchDeg + 90) > 1;
  if (SKIPTURN && turn) continue;
  const foot = frameFootprint(r.frame, 8)!.map(g => ({ lat: g.lat, lng: g.lng }));
  frames.push({ name: c.name, f: r.frame, foot, g: objectsToGround(r.frame, c.objects), turn, dYaw: (c.meta.flightYawDeg ?? 0) - (c.meta.gimbalYawDeg ?? 0) });
}

type Fit = { a: string; b: string; n: number; rotDeg: number; scale: number; tAlongM: number; tCrossM: number; rawRms: number; fitRms: number; baselineM: number; hd: number };
const fits: Fit[] = [];
for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) {
  const A = frames[i], B = frames[j];
  const o = { lat: (A.f.pose.lat + B.f.pose.lat) / 2, lng: (A.f.pose.lng + B.f.pose.lng) / 2, altM: 0 };
  const cb = toEnu({ lat: B.f.pose.lat, lng: B.f.pose.lng, altM: 0 }, { lat: A.f.pose.lat, lng: A.f.pose.lng, altM: 0 });
  if (Math.hypot(cb[0], cb[1]) > 45) continue;
  const r = matchPair(A.f, A.g, B.f, B.g, A.foot, B.foot);
  if (r.matches.length < 8) continue;
  const P = r.matches.map(m => toEnu({ lat: m.a.ground.lat, lng: m.a.ground.lng, altM: 0 }, o));
  const Q = r.matches.map(m => toEnu({ lat: m.b.ground.lat, lng: m.b.ground.lng, altM: 0 }, o));
  const n = P.length;
  const mp = [P.reduce((s, p) => s + p[0], 0) / n, P.reduce((s, p) => s + p[1], 0) / n];
  const mq = [Q.reduce((s, p) => s + p[0], 0) / n, Q.reduce((s, p) => s + p[1], 0) / n];
  let sxx = 0, sxy = 0, spp = 0;
  for (let k = 0; k < n; k++) {
    const px = P[k][0] - mp[0], py = P[k][1] - mp[1], qx = Q[k][0] - mq[0], qy = Q[k][1] - mq[1];
    sxx += px * qx + py * qy; sxy += px * qy - py * qx; spp += px * px + py * py;
  }
  const th = Math.atan2(sxy, sxx), s = Math.hypot(sxx, sxy) / spp;
  let raw = 0, res = 0;
  for (let k = 0; k < n; k++) {
    const px = P[k][0] - mp[0], py = P[k][1] - mp[1];
    const fx = s * (Math.cos(th) * px - Math.sin(th) * py) + mq[0], fy = s * (Math.sin(th) * px + Math.cos(th) * py) + mq[1];
    res += (fx - Q[k][0]) ** 2 + (fy - Q[k][1]) ** 2;
    raw += (P[k][0] - Q[k][0]) ** 2 + (P[k][1] - Q[k][1]) ** 2;
  }
  const t = [mq[0] - mp[0], mq[1] - mp[1]];
  const bl = Math.hypot(cb[0], cb[1]) || 1, ux = cb[0] / bl, uy = cb[1] / bl;
  fits.push({ a: A.name, b: B.name, n, rotDeg: (th * 180) / Math.PI, scale: s, tAlongM: t[0] * ux + t[1] * uy, tCrossM: -t[0] * uy + t[1] * ux, rawRms: Math.sqrt(raw / n), fitRms: Math.sqrt(res / n), baselineM: bl, hd: r.headingDiffDeg });
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const show = (label: string, fs: Fit[]) => console.log(label.padEnd(26), `pairs ${String(fs.length).padStart(3)}`, `| rot deg med ${r3(median(fs.map(f => f.rotDeg)))} |rot| ${r3(median(fs.map(f => Math.abs(f.rotDeg))))}`, `| scale med ${r3(median(fs.map(f => f.scale)))}`, `| shift along ${r3(median(fs.map(f => f.tAlongM)))} cross ${r3(median(fs.map(f => f.tCrossM)))}`, `| rms raw ${r3(median(fs.map(f => f.rawRms)))} after fit ${r3(median(fs.map(f => f.fitRms)))}`);
console.log(`yaw source: ${YAW}${SKIPTURN ? ", straight legs only" : ""}${yawCorr.size ? ", per-photo yaw corrections applied" : ""}`);
show("all", fits);
show("same heading", fits.filter(f => f.hd < 30));
show("opposite heading", fits.filter(f => f.hd > 150));

// One yaw offset per photo: rot_ab ~ e_b - e_a (a yaw error e rotates that photo's projection by -e about its nadir
// point; the sign is absorbed consistently). Gauss-Seidel on the normal equations, mean fixed at 0.
const names = frames.map(f => f.name), idx = new Map(names.map((n, i) => [n, i]));
const e = new Float64Array(names.length);
for (let it = 0; it < 500; it++) {
  for (let k = 0; k < names.length; k++) {
    let num = 0, den = 0;
    for (const f of fits) {
      const w = f.n;
      if (idx.get(f.b) === k) { num += w * (f.rotDeg + e[idx.get(f.a)!]); den += w; }
      else if (idx.get(f.a) === k) { num += w * (e[idx.get(f.b)!] - f.rotDeg); den += w; }
    }
    if (den) e[k] = num / den;
  }
  const mean = e.reduce((s, v) => s + v, 0) / e.length;
  for (let k = 0; k < e.length; k++) e[k] -= mean;
}
let resid = 0;
for (const f of fits) resid += (f.rotDeg - (e[idx.get(f.b)!] - e[idx.get(f.a)!])) ** 2;
console.log(`\nper-photo yaw offsets: spread (sd) ${r3(Math.sqrt(e.reduce((s, v) => s + v * v, 0) / e.length))} deg; pair rotation residual after them ${r3(Math.sqrt(resid / fits.length))} deg`);
const dy = frames.map(f => f.dYaw);
const md = dy.reduce((s, v) => s + v, 0) / dy.length;
let cov = 0, va = 0, vb = 0;
for (let k = 0; k < e.length; k++) { cov += e[k] * (dy[k] - md); va += e[k] ** 2; vb += (dy[k] - md) ** 2; }
console.log(`correlation of the offsets with flight-minus-gimbal yaw: ${r3(cov / Math.sqrt(va * vb))}`);
const byHeading = (lo: number, hi: number) => frames.map((f, k) => ({ f, k })).filter(({ f }) => { const y = ((f.f.pose.attitude.yawDeg % 360) + 360) % 360; return y >= lo && y < hi; });
for (const [label, lo, hi] of [["heading ~40 (NE legs)", 0, 90], ["heading ~-139 (SW legs)", 180, 270]] as const) {
  const g = byHeading(lo, hi);
  if (g.length) console.log(`${label}: ${g.length} photos, mean yaw offset ${r3(g.reduce((s, x) => s + e[x.k], 0) / g.length)} deg`);
}
if (argv.includes("--print")) for (let k = 0; k < names.length; k++) console.log(names[k], r3(e[k]), "flight-gimbal", r3(dy[k]), frames[k].turn ? "turn" : "");
if (arg("save")) writeFileSync(arg("save")!, JSON.stringify(names.map((n, k) => [n, -e[k]])));

// Miss and height by patch size: small low patches are nearly points on the soil; crowns are 3D blobs whose visible
// green centroid moves with the viewing direction.
if (argv.includes("--sizes")) {
  const buckets: [string, number, number][] = [["0.01-0.05 m2", 0.01, 0.05], ["0.05-0.2 m2", 0.05, 0.2], ["0.2-1 m2", 0.2, 1], ["1-3 m2", 1, 3], [">3 m2", 3, 1e9]];
  const rows = buckets.map(b => ({ b, miss: [] as number[], dist: [] as number[], alt: [] as number[] }));
  for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) {
    const A = frames[i], B = frames[j];
    const cb = toEnu({ lat: B.f.pose.lat, lng: B.f.pose.lng, altM: 0 }, { lat: A.f.pose.lat, lng: A.f.pose.lng, altM: 0 });
    const bl = Math.hypot(cb[0], cb[1]);
    if (bl > 45 || bl < 5) continue;
    const r = matchPair(A.f, A.g, B.f, B.g, A.foot, B.foot, { minAreaM2: 0.01, maxM: 1.2 });
    for (const m of r.matches) {
      if (!m.tri) continue;
      const area = (m.a.areaM2 + m.b.areaM2) / 2;
      const row = rows.find(x => area >= x.b[1] && area < x.b[2])!;
      row.miss.push(m.tri.missM); row.dist.push(m.distM); row.alt.push(m.tri.altM);
    }
  }
  const p = (v: number[], q: number) => { const s = [...v].sort((a, b) => a - b); return s.length ? r3(s[Math.floor(q * (s.length - 1))]) : NaN; };
  console.log("\npatch size        matches  ray miss p25/med/p75     flat disagreement med   height above take-off p25/med/p75");
  for (const x of rows) console.log(x.b[0].padEnd(16), String(x.miss.length).padStart(7), `   ${p(x.miss, 0.25)} / ${p(x.miss, 0.5)} / ${p(x.miss, 0.75)}`.padEnd(26), `   ${p(x.dist, 0.5)}`.padEnd(24), `   ${p(x.alt, 0.25)} / ${p(x.alt, 0.5)} / ${p(x.alt, 0.75)}`);
}
