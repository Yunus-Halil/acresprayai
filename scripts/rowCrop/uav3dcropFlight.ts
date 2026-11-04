// A UAV3DCrop corn scene as a drone flight the Field Twin builder accepts (2026-11-04): copies of its photographs with
// the DJI header fields the builder reads (position, height above take-off, gimbal angles, the lens's DewarpData),
// written from the scene's own camera poses, so the real build pipeline (readPhotographs -> alignCameras -> the corn
// stage -> the bundle) runs on a real overlapping corn flight.
//
// HONEST LABEL: these positions are NOT a drone's GPS. They are the scene reconstruction's poses about a made-up
// origin, scaled by the corn rows taken as 76.2 cm (the scenes carry no GPS). Every file carries swardus:Placement
// saying so; the build records the twin as "local" and the viewer never puts it on the map.
//   npx vite-node scripts/rowCrop/uav3dcropFlight.ts --scene <scene dir> --out <dir> [--n 40] [--scale <m per unit>]
//       [--reads <dir with scale.json from cornFieldBench>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { enuFromCamera, groundSampleAt, rotationOf, type M3 } from "../../src/lib/directGeoref/projection";
import { sceneFrames } from "./uav3dcrop";

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const SCENE = arg("scene")!, OUT = arg("out")!, N = Number(arg("n", "40")), READS = arg("reads");
if (!SCENE || !OUT) { console.error("need --scene and --out"); process.exit(1); }
const scale = arg("scale") ? Number(arg("scale")) : READS && existsSync(join(READS, "scale.json")) ? (JSON.parse(readFileSync(join(READS, "scale.json"), "utf8")).metresPerUnit as number) : NaN;
if (!(scale > 0)) { console.error("need --scale or --reads with scale.json (run cornFieldBench first)"); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const sceneKey = SCENE.replace(/\\/g, "/").split("/").slice(-2).join("/");
const stageIndex = JSON.parse(readFileSync(join(SCENE, "..", "..", "stage_index.json"), "utf8")) as Record<string, { nadir: string[] }>;
const nadir = new Set((stageIndex[sceneKey]?.nadir ?? []).map(p => p.split("/").pop()!));
const { frames, centres } = sceneFrames(SCENE, scale);
const t = JSON.parse(readFileSync(join(SCENE, "transforms.json"), "utf8")) as { w: number; h: number; fl_x: number; fl_y: number; cx: number; cy: number; k1: number; k2: number; k3?: number; p1: number; p2: number };
const cand = [...centres].filter(([n]) => nadir.has(n) && existsSync(join(SCENE, "images", n)));
const mx = cand.map(([, c]) => c[0]).sort((a, b) => a - b)[cand.length >> 1], my = cand.map(([, c]) => c[1]).sort((a, b) => a - b)[cand.length >> 1];
const chosen = cand.sort((a, b) => Math.hypot(a[1][0] - mx, a[1][1] - my) - Math.hypot(b[1][0] - mx, b[1][1] - my)).slice(0, N).map(([n]) => n);

/** The gimbal angles (DJI yaw/pitch/roll as Direct reads them) whose rotation matches the camera's, by search. */
function gimbalOf(R: M3): { yaw: number; pitch: number; roll: number; missDeg: number } {
  const err = (y: number, p: number, r: number) => { const M = enuFromCamera({ yawDeg: y, pitchDeg: p, rollDeg: r, basis: "fit" }); let s = 0; for (let i = 0; i < 9; i++) s += (M[i] - R[i]) ** 2; return s; };
  let best = { y: 0, p: -90, r: 0, e: Infinity };
  for (let y = -180; y < 180; y += 1) { const e = err(y, -90, 0); if (e < best.e) best = { y, p: -90, r: 0, e }; }
  for (const step of [0.5, 0.1, 0.02, 0.005]) for (let it = 0; it < 40; it++) {
    let moved = false;
    for (const [dy, dp, dr] of [[step, 0, 0], [-step, 0, 0], [0, step, 0], [0, -step, 0], [0, 0, step], [0, 0, -step]]) {
      const e = err(best.y + dy, best.p + dp, best.r + dr);
      if (e < best.e) { best = { y: best.y + dy, p: best.p + dp, r: best.r + dr, e }; moved = true; }
    }
    if (!moved) break;
  }
  // The residual as an angle: |R1 - R2|_F = 2 sqrt(2) sin(theta / 2).
  return { yaw: best.y, pitch: best.p, roll: best.r, missDeg: (2 * Math.asin(Math.min(1, Math.sqrt(best.e) / (2 * Math.SQRT2))) * 180) / Math.PI };
}

/** A JPEG with an XMP APP1 segment inserted after its start marker. */
function withXmp(jpeg: Buffer, xmp: string): Buffer {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("not a JPEG");
  const ns = Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1"), body = Buffer.from(xmp, "utf8");
  const len = 2 + ns.length + body.length;
  if (len > 65535) throw new Error("XMP too long for one segment");
  const head = Buffer.from([0xff, 0xe1, len >> 8, len & 0xff]);
  return Buffer.concat([jpeg.subarray(0, 2), head, ns, body, jpeg.subarray(2)]);
}

/** The XMP packet's byte-order mark (written as a code so no invisible character sits in the source). */
const BOM = String.fromCharCode(0xfeff);
const placement = `test flight: positions from the UAV3DCrop scene reconstruction (${sceneKey}) about a made-up origin, scale estimated from the corn rows taken as 76.2 cm (${scale.toFixed(4)} m per reconstruction unit); not the drone's GPS, not a place on the map`;
const rows: string[] = [];
let worst = 0;
for (const name of chosen) {
  const f = frames.get(name)!, c = centres.get(name)!;
  const g = gimbalOf(rotationOf(f.pose));
  worst = Math.max(worst, g.missDeg);
  const groundBelow = f.ground.kind === "surface" ? f.ground.altAt(f.pose.lat, f.pose.lng) ?? 0 : f.ground.altM;
  const rel = c[2] - groundBelow;
  const dewarp = `2024-01-01;${t.fl_x.toFixed(4)},${t.fl_y.toFixed(4)},${(t.cx - t.w / 2).toFixed(4)},${(t.cy - t.h / 2).toFixed(4)},${t.k1},${t.k2},${t.p1},${t.p2},${t.k3 ?? 0}`;
  const xmp = `<?xpacket begin="${BOM}" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/" xmlns:swardus="https://swardus.com/ns/1.0/"
 drone-dji:GpsLatitude="${f.pose.lat.toFixed(9)}" drone-dji:GpsLongtitude="${f.pose.lng.toFixed(9)}" drone-dji:AbsoluteAltitude="${(100 + c[2]).toFixed(3)}" drone-dji:RelativeAltitude="${rel.toFixed(3)}"
 drone-dji:GimbalYawDegree="${g.yaw.toFixed(3)}" drone-dji:GimbalPitchDegree="${g.pitch.toFixed(3)}" drone-dji:GimbalRollDegree="${g.roll.toFixed(3)}" drone-dji:FlightYawDegree="${g.yaw.toFixed(3)}"
 drone-dji:DewarpFlag="0" drone-dji:DewarpData="${dewarp}" swardus:Placement="${placement}"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  writeFileSync(join(OUT, name), withXmp(readFileSync(join(SCENE, "images", name)), xmp));
  rows.push(`${name},${f.pose.lat.toFixed(9)},${f.pose.lng.toFixed(9)},${rel.toFixed(3)},${g.yaw.toFixed(3)},${g.pitch.toFixed(3)},${g.roll.toFixed(3)},${g.missDeg.toFixed(4)},${((groundSampleAt(f, f.intrinsics.cx, f.intrinsics.cy) ?? 0) * 100).toFixed(3)}`);
}
writeFileSync(join(OUT, "flight.csv"), ["photo,lat,lng,height_m,gimbal_yaw,gimbal_pitch,gimbal_roll,fit_miss_deg,gsd_cm", ...rows].join("\n") + "\n");
writeFileSync(join(OUT, "README.txt"), `${placement}\n\n${chosen.length} photographs from ${SCENE}. Build it in the app (Field Twin > Build a twin, crop Corn) or with\nnpx vite-node scripts/directGeoref/buildTwinApp.ts --dir <this folder> --crop corn --weeds none --no-preview\n`);
console.log(`${chosen.length} photographs written to ${OUT}; gimbal angles reproduce the cameras' rotations within ${worst.toFixed(4)} deg`);
