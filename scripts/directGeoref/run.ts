// Direct photo georeferencing v0 over a folder of DJI photographs: no orthomosaic, no ODM, no ground control.
//
//   npx vite-node scripts/directGeoref/run.ts -- [--dir directtestimagery] [--out data/direct-georef/<name>] [--limit N]
//
// For every photograph: read its header, build the camera (src/lib/directGeoref/frame.ts), decode it at quarter size,
// find green patches (objects.ts), and put each patch's centroid and outline on the declared flat ground. Then every
// pair of overlapping photographs is matched and triangulated (multiView.ts): the photographs check each other.
//
// Writes, under --out (gitignored data/):
//   index.html + data.js + frames/*.jpg   the map viewer: each photograph drawn on satellite imagery from its four
//                                          projected corners (a CSS homography), patches, multi-view positions, the
//                                          DJI_0301 hand labels, and a flip-through of the photographs
//   footprints.geojson objects.geojson clusters.geojson labels.geojson   the same, for any GIS
//   summary.json report.md                                                 the numbers
//   cache/<frame>.json                                                     detection per photo (pose-independent);
//                                                                           delete to re-detect
// The photographs are only read.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { decodeImage, encodeJpeg } from "../bench/images";
import {
  type AngleOrder, type Calibration, type Cluster, type DjiPhotoMeta, type GeorefFrame, type GroundObject, type PairResult, type PixelObject,
  NO_CALIBRATION, applyCalibration, calibrateFromOverlap, clusterMatches, frameCorners, frameFootprint, frameFromDji, groundSampleAt, matchPair, median, objectsToGround, parseDjiHeader,
  pixelToGround, takeoffPlane, vegetationObjects,
} from "../../src/lib/directGeoref";
import { toEnu } from "../../src/lib/sourceFrames/odm";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const ROOT = resolve(__dirname, "../..");
const DIR = resolve(ROOT, arg("dir", "directtestimagery")!);
const OUT = resolve(ROOT, arg("out", "data/direct-georef/apricot")!);
const LIMIT = Number(arg("limit", "0"));
const DOWN = 4; // decode factor for detection and the viewer
const LABELS = join(ROOT, "evaluation/groundtruth/image1/DJI_0301.labels.json");

mkdirSync(join(OUT, "frames"), { recursive: true });
mkdirSync(join(OUT, "cache"), { recursive: true });

type Cached = { name: string; meta: DjiPhotoMeta; viewW: number; viewH: number; objects: PixelObject[] };

function downsample(img: { width: number; height: number; data: Uint8Array }, k: number) {
  const W = Math.floor(img.width / k), H = Math.floor(img.height / k);
  const out = new Uint8ClampedArray(W * H * 4);
  const kk = k * k;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < k; dy++) { let o = ((y * k + dy) * img.width + x * k) * 4; for (let dx = 0; dx < k; dx++, o += 4) { r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; } }
    const p = (y * W + x) * 4;
    out[p] = r / kk; out[p + 1] = g / kk; out[p + 2] = b / kk; out[p + 3] = 255;
  }
  return { width: W, height: H, rgba: out };
}

// ------------------------------------------------------------------------------------------------------------------
// 1. Per photograph: header, decode, detect (cached)
// ------------------------------------------------------------------------------------------------------------------
let files = readdirSync(DIR).filter(f => /\.jpe?g$/i.test(f)).sort();
if (LIMIT) files = files.slice(0, LIMIT);
const cached: Cached[] = [];
const t0 = Date.now();
for (const [i, file] of files.entries()) {
  const name = basename(file).replace(/\.[^.]+$/, "");
  const cpath = join(OUT, "cache", `${name}.json`);
  if (existsSync(cpath) && existsSync(join(OUT, "frames", `${name}.jpg`))) { cached.push(JSON.parse(readFileSync(cpath, "utf8"))); continue; }
  const bytes = new Uint8Array(readFileSync(join(DIR, file)));
  const meta = parseDjiHeader(bytes.subarray(0, 1 << 20));
  const img = decodeImage(bytes);
  if (meta.width !== img.width || meta.height !== img.height) { meta.width = img.width; meta.height = img.height; }
  const small = downsample(img, DOWN);
  writeFileSync(join(OUT, "frames", `${name}.jpg`), encodeJpeg({ width: small.width, height: small.height, data: new Uint8Array(small.rgba.buffer) }, 80));
  const objects = vegetationObjects(small, DOWN);
  const c: Cached = { name, meta, viewW: small.width, viewH: small.height, objects };
  writeFileSync(cpath, JSON.stringify(c));
  cached.push(c);
  console.log(`[${i + 1}/${files.length}] ${name}: ${objects.length} patches (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

// ------------------------------------------------------------------------------------------------------------------
// 2. Cameras, footprints, patches on the declared flat ground
// ------------------------------------------------------------------------------------------------------------------
type Built = { c: Cached; frame: GeorefFrame; foot: { lat: number; lng: number }[]; ground: GroundObject[]; notes: string[]; turn: boolean };

let CAL_BASIS = "";
const CAL_OPTS = arg("cal") ? JSON.parse(arg("cal")!) : {};
function build(order: AngleOrder, groundOffsetM: number, cal: Calibration = NO_CALIBRATION): Built[] {
  const out: Built[] = [];
  for (const c of cached) {
    const r = frameFromDji(c.name, c.meta, { ground: takeoffPlane(groundOffsetM) });
    if ("reason" in r) { console.log(`${c.name}: skipped (${r.reason})`); continue; }
    if (cal !== NO_CALIBRATION) r.frame = applyCalibration(r.frame, cal, CAL_BASIS);
    r.frame.pose.attitude.order = order;
    const foot = frameFootprint(r.frame, 8);
    if (!foot) continue;
    const a = r.frame.pose.attitude;
    out.push({ c, frame: r.frame, foot: foot.map(g => ({ lat: g.lat, lng: g.lng })), ground: objectsToGround(r.frame, c.objects), notes: r.notes, turn: Math.abs(a.rollDeg) > 0.5 || Math.abs(a.pitchDeg + 90) > 1 });
  }
  return out;
}

function pairsOf(frames: Built[]): PairResult[] {
  const out: PairResult[] = [];
  for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) {
    const A = frames[i], B = frames[j];
    const e = toEnu({ lat: B.frame.pose.lat, lng: B.frame.pose.lng, altM: 0 }, { lat: A.frame.pose.lat, lng: A.frame.pose.lng, altM: 0 });
    if (Math.hypot(e[0], e[1]) > 45) continue;
    const r = matchPair(A.frame, A.ground, B.frame, B.ground, A.foot, B.foot);
    if (r.matches.length) out.push(r);
  }
  return out;
}

const q = (v: number[], p: number) => { if (!v.length) return NaN; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r2 = (x: number) => Math.round(x * 100) / 100;
function stats(pairs: PairResult[], filter: (p: PairResult) => boolean = () => true) {
  const ps = pairs.filter(filter), ms = ps.flatMap(p => p.matches);
  const tri = ms.filter(m => m.tri);
  return {
    pairs: ps.length, matches: ms.length,
    flatDisagreementM: { median: r2(median(ms.map(m => m.distM))), p90: r2(q(ms.map(m => m.distM), 0.9)) },
    rayMissM: { median: r2(median(tri.map(m => m.tri!.missM))), p90: r2(q(tri.map(m => m.tri!.missM), 0.9)) },
    triangulatedHeightM: { p10: r2(q(tri.map(m => m.tri!.altM), 0.1)), median: r2(median(tri.map(m => m.tri!.altM))), p90: r2(q(tri.map(m => m.tri!.altM), 0.9)) },
  };
}
const turnPair = (frames: Built[]) => { const t = new Set(frames.filter(f => f.turn).map(f => f.c.name)); return (p: PairResult) => t.has(p.a) || t.has(p.b); };

console.log(`\n${cached.length} photographs; building cameras and matching overlaps...`);
const frames = build("ZYX", 0);
const pairs = pairsOf(frames);
const isTurn = turnPair(frames);
const same = (p: PairResult) => !isTurn(p) && p.headingDiffDeg < 30;
const opposite = (p: PairResult) => !isTurn(p) && p.headingDiffDeg > 150;

// The turn frames decide the angle order (they are the only ones with gimbal roll).
const framesZXY = build("ZXY", 0);
const pairsZXY = pairsOf(framesZXY);

// The patches stand above the soil: the median triangulated height is the surface the matched patches sit on. Put
// the declared plane there and the flat-ground disagreement between photographs should collapse.
const surfaceM = median(pairs.flatMap(p => p.matches.filter(m => m.tri && !isTurn(p)).map(m => m.tri!.altM)));
const framesSurf = build("ZYX", surfaceM);
const pairsSurf = pairsOf(framesSurf);

// Self-calibration from the overlap: boresight + effective ground plane, fitted on the straight legs.
const tc = Date.now();
const cal = calibrateFromOverlap(frames.filter(f => !f.turn).map(f => ({ frame: f.frame, objects: f.c.objects })), CAL_OPTS);
CAL_BASIS = `estimated from this flight's overlap: ${cal.patchesUsed} patches in ${cal.frames} straight-leg photographs, tilt across ${cal.calibration.tiltAcrossDeg.toFixed(2)} deg, along ${cal.calibration.tiltAlongDeg.toFixed(2)} deg, spin ${cal.calibration.spinDeg.toFixed(2)} deg, ground slope ${(cal.calibration.slopeEast * 100).toFixed(2)} % east / ${(cal.calibration.slopeNorth * 100).toFixed(2)} % north`;
console.log(`calibration (${((Date.now() - tc) / 1000).toFixed(0)} s): ${JSON.stringify(cal)}`);
const framesCal = build("ZYX", 0, cal.calibration);
const pairsCal = pairsOf(framesCal);
const isTurnCal = turnPair(framesCal);

const summary = {
  photographs: cached.length, cameras: frames.length, turnFrames: frames.filter(f => f.turn).map(f => f.c.name),
  patches: frames.reduce((s, f) => s + f.ground.length, 0),
  inputs: {
    intrinsics: frames[0]?.frame.intrinsics.basis, position: frames[0]?.frame.pose.basis, attitude: frames[0]?.frame.pose.attitude.basis,
    boresight: frames[0]?.frame.pose.boresight.basis, ground: frames[0]?.frame.ground.basis, notes: [...new Set(frames.flatMap(f => f.notes))],
  },
  gsdAtCentreCm: r2(100 * median(frames.map(f => groundSampleAt(f.frame, f.frame.intrinsics.cx, f.frame.intrinsics.cy) ?? NaN))),
  agreement: {
    all: stats(pairs),
    sameHeadingStraightLegs: stats(pairs, same),
    oppositeHeadingStraightLegs: stats(pairs, opposite),
    involvingTurnFrames_ZYX: stats(pairs, isTurn),
    involvingTurnFrames_ZXY: stats(pairsZXY, turnPair(framesZXY)),
  },
  surfacePlane: { heightAboveTakeoffM: r2(surfaceM), sameHeading: stats(pairsSurf, same), oppositeHeading: stats(pairsSurf, opposite) },
  calibration: {
    ...cal.calibration, agreeingPatchPairsBefore: cal.agreeingBefore, agreeingPatchPairsAfter: cal.agreeingAfter, basis: CAL_BASIS,
    all: stats(pairsCal),
    sameHeadingStraightLegs: stats(pairsCal, p => !isTurnCal(p) && p.headingDiffDeg < 30),
    oppositeHeadingStraightLegs: stats(pairsCal, p => !isTurnCal(p) && p.headingDiffDeg > 150),
    involvingTurnFrames: stats(pairsCal, isTurnCal),
  },
};

// ------------------------------------------------------------------------------------------------------------------
// 3. Multi-view positions and the hand labels of DJI_0301
// ------------------------------------------------------------------------------------------------------------------
// The angle order stays ZYX: the turn frames are too few and too short of overlap to choose (see the report table).
const order: AngleOrder = "ZYX";
const finalPairs = pairsCal;
const finalFrames = framesCal;
const rawCorners = new Map(frames.map(f => [f.c.name, frameCorners(f.frame)!]));
const clusters: Cluster[] = clusterMatches(finalPairs);
const multi = clusters.filter(c => c.views.length >= 2);
Object.assign(summary, {
  angleOrderChosen: order,
  clusters: { count: multi.length, medianViews: median(multi.map(c => c.views.length)), spreadM: { median: r2(median(multi.map(c => c.spreadM))), p90: r2(q(multi.map(c => c.spreadM), 0.9)) } },
});

type Label = { cls: string; x: number; y: number };
let labels: { cls: string; lat: number; lng: number }[] = [];
const f301 = finalFrames.find(f => f.c.name === "DJI_0301");
if (f301 && existsSync(LABELS)) {
  const L = (JSON.parse(readFileSync(LABELS, "utf8")).labels as Label[]);
  labels = L.map(l => { const g = pixelToGround(f301.frame, l.x, l.y); return g ? { cls: l.cls, lat: g.lat, lng: g.lng } : null; }).filter((x): x is { cls: string; lat: number; lng: number } => !!x);
}

// ------------------------------------------------------------------------------------------------------------------
// 4. Write
// ------------------------------------------------------------------------------------------------------------------
const ring = (pts: { lat: number; lng: number }[]) => { const c = pts.map(p => [+p.lng.toFixed(8), +p.lat.toFixed(8)]); return [[...c, c[0]]]; };
const fc = (features: unknown[]) => JSON.stringify({ type: "FeatureCollection", features });
writeFileSync(join(OUT, "footprints.geojson"), fc(finalFrames.map(f => ({
  type: "Feature", geometry: { type: "Polygon", coordinates: ring(f.foot) },
  properties: { frame: f.c.name, yaw: f.frame.pose.attitude.yawDeg, pitch: f.frame.pose.attitude.pitchDeg, roll: f.frame.pose.attitude.rollDeg, heightAboveTakeoffM: f.frame.pose.altM, turn: f.turn },
}))));
writeFileSync(join(OUT, "objects.geojson"), fc(finalFrames.flatMap(f => f.ground.filter(o => o.outline.length >= 3).map(o => ({
  type: "Feature", geometry: { type: "Polygon", coordinates: ring(o.outline) },
  properties: { frame: o.frame, id: o.id, lat: +o.ground.lat.toFixed(8), lng: +o.ground.lng.toFixed(8), areaM2: r2(o.areaM2), touchesFrameEdge: o.touchesEdge, pixelU: Math.round(o.u), pixelV: Math.round(o.v) },
})))));
writeFileSync(join(OUT, "clusters.geojson"), fc(multi.map(c => ({
  type: "Feature", geometry: { type: "Point", coordinates: [+c.lng.toFixed(8), +c.lat.toFixed(8)] },
  properties: { id: c.id, views: c.views.length, heightAboveTakeoffM: r2(c.altM), spreadM: r2(c.spreadM), rayMissM: r2(c.missM) },
}))));
writeFileSync(join(OUT, "labels.geojson"), fc(labels.map(l => ({ type: "Feature", geometry: { type: "Point", coordinates: [l.lng, l.lat] }, properties: { cls: l.cls, source: "DJI_0301 hand labels, projected" } }))));
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 1));

// Viewer data: compact.
const view = {
  summary,
  frames: finalFrames.map(f => {
    const corners = frameCorners(f.frame)!;
    return {
      name: f.c.name, w: f.c.viewW, h: f.c.viewH, lat: f.frame.pose.lat, lng: f.frame.pose.lng,
      yaw: f.frame.pose.attitude.yawDeg, pitch: f.frame.pose.attitude.pitchDeg, roll: f.frame.pose.attitude.rollDeg, turn: f.turn,
      corners: corners.map(g => [+g.lat.toFixed(8), +g.lng.toFixed(8)]),
      rawCorners: rawCorners.get(f.c.name)!.map(g => [+g.lat.toFixed(8), +g.lng.toFixed(8)]),
      objects: f.ground.filter(o => o.areaM2 >= 0.02 && o.outline.length >= 3).map(o => ({ a: r2(o.areaM2), e: o.touchesEdge ? 1 : 0, o: o.outline.map(p => [+p.lat.toFixed(7), +p.lng.toFixed(7)]) })),
    };
  }),
  clusters: multi.map(c => [+c.lat.toFixed(8), +c.lng.toFixed(8), c.views.length, r2(c.altM), r2(c.spreadM)]),
  labels: labels.map(l => [l.lat, l.lng, l.cls]),
};
writeFileSync(join(OUT, "data.js"), `window.DATA = ${JSON.stringify(view)};`);
writeFileSync(join(OUT, "index.html"), readFileSync(join(__dirname, "viewer.html"), "utf8"));

const A = summary.agreement;
const line = (k: string, s: ReturnType<typeof stats>) => `| ${k} | ${s.pairs} | ${s.matches} | ${s.flatDisagreementM.median} / ${s.flatDisagreementM.p90} | ${s.rayMissM.median} / ${s.rayMissM.p90} | ${s.triangulatedHeightM.p10} / ${s.triangulatedHeightM.median} / ${s.triangulatedHeightM.p90} |`;
const report = [
  `# Direct photo georeferencing v0: ${basename(DIR)}`,
  "",
  `${summary.photographs} photographs, ${summary.patches} green patches projected, pixel ${summary.gsdAtCentreCm} cm at the frame centre. Angle order kept: ${order}.`,
  "",
  "Inputs and what they stand on:",
  "",
  ...Object.entries(summary.inputs).map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join("; ") || "none" : v}`),
  "",
  "Agreement between overlapping photographs (metres; median / 90th percentile; heights above take-off):",
  "",
  "| pairs of | pairs | matched patches | flat-ground disagreement | ray miss | triangulated height p10 / median / p90 |",
  "|---|---|---|---|---|---|",
  line("all", A.all), line("same heading, straight legs", A.sameHeadingStraightLegs), line("opposite heading, straight legs", A.oppositeHeadingStraightLegs),
  line("with a turn frame, ZYX", A.involvingTurnFrames_ZYX), line("with a turn frame, ZXY", A.involvingTurnFrames_ZXY),
  "",
  `Declared plane moved to the matched patches' median height (${summary.surfacePlane.heightAboveTakeoffM} m above take-off):`,
  "",
  "| pairs of | pairs | matched patches | flat-ground disagreement | ray miss | triangulated height |",
  "|---|---|---|---|---|---|",
  line("same heading", summary.surfacePlane.sameHeading), line("opposite heading", summary.surfacePlane.oppositeHeading),
  "",
  `Self-calibration from the overlap: ${CAL_BASIS}; effective ground plane ${cal.calibration.groundOffsetM >= 0 ? "+" : ""}${cal.calibration.groundOffsetM.toFixed(2)} m against take-off. Agreement score (patch pairs from different photographs within 0.25 m, weighted by closeness): ${Math.round(cal.agreeingBefore)} before, ${Math.round(cal.agreeingAfter)} after.`,
  "",
  "| pairs of (after calibration) | pairs | matched patches | flat-ground disagreement | ray miss | triangulated height p10 / median / p90 |",
  "|---|---|---|---|---|---|",
  line("all", summary.calibration.all), line("same heading, straight legs", summary.calibration.sameHeadingStraightLegs), line("opposite heading, straight legs", summary.calibration.oppositeHeadingStraightLegs), line("with a turn frame", summary.calibration.involvingTurnFrames),
  "",
  `Multi-view positions (after calibration): ${multi.length} patches seen in 2+ photographs (median ${median(multi.map(c => c.views.length))} views), horizontal spread of their pair triangulations median ${r2(median(multi.map(c => c.spreadM)))} m, 90th percentile ${r2(q(multi.map(c => c.spreadM), 0.9))} m.`,
  "",
].join("\n");
writeFileSync(join(OUT, "report.md"), report);
console.log(report);
console.log(`\nViewer: ${join(OUT, "index.html")}`);
