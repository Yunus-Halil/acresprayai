// UAV3DCrop scenes as Swardus Direct camera frames (2026-11-04), so Corn V1 over a whole field can be run and checked on
// a real overlapping corn flight with known camera poses.
//
// Each scene has transforms.json (nerfstudio, from COLMAP: OpenCV lens, a camera-to-world matrix per photograph in an
// OpenGL camera convention, world z up) and sparse_pc.ply (the reconstruction's points, same world frame). The units
// are the reconstruction's own, not metres (on Day023_Corn1 the rows come out 1.54 units apart, about twice 76 cm): the
// scenes carry no GPS, so the bench fixes the scale from the corn rows (metresPerUnit) and says so.
//
// A Direct GeorefFrame holds a pose as latitude/longitude, a height, an attitude and a boresight rotation; the whole
// camera rotation goes into the boresight with a zero attitude (enuFromCamera = ENU_FROM_NED * body(0) * BODY_FROM_CAMERA
// * boresight), so Direct's own pixelToGround / groundToPixel run unchanged. The world's x, y are taken as east, north
// about a made-up origin (the scenes carry no GPS); the ground is the point cloud's lower surface on a 1 m grid.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fromEnu, toEnu } from "../../src/lib/sourceFrames/odm";
import { IDENTITY, enuFromCamera, mulM, type GeorefFrame, type M3 } from "../../src/lib/directGeoref/projection";

export const SCENE_ORIGIN = { lat: 40.0, lng: -90.0, altM: 0 };
const DATUM = "scene reconstruction (metres, z up)";

type Transforms = { w: number; h: number; fl_x: number; fl_y: number; cx: number; cy: number; k1: number; k2: number; k3?: number; p1: number; p2: number; frames: { file_path: string; transform_matrix: number[][] }[] };

/** The point cloud's xyz (binary little-endian PLY with float x y z and three uchar colours). */
export function readPly(path: string): Float32Array {
  const b = readFileSync(path);
  const end = b.indexOf("end_header");
  const nl = b.indexOf(0x0a, end) + 1;
  const n = Number(/element vertex (\d+)/.exec(b.subarray(0, end).toString("latin1"))![1]);
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const o = nl + i * 15; out[i * 3] = b.readFloatLE(o); out[i * 3 + 1] = b.readFloatLE(o + 4); out[i * 3 + 2] = b.readFloatLE(o + 8); }
  return out;
}

/** The ground: per 1 m cell the 20th percentile of the points' heights (soil under the plants), else the median. */
export function groundGrid(xyz: Float32Array, cellM = 1) {
  const cells = new Map<string, number[]>(), all: number[] = [];
  for (let i = 0; i < xyz.length; i += 3) { const x = xyz[i], y = xyz[i + 1], z = xyz[i + 2]; if (!Number.isFinite(x + y + z)) continue; const k = `${Math.floor(x / cellM)},${Math.floor(y / cellM)}`; (cells.get(k) ?? cells.set(k, []).get(k)!).push(z); all.push(z); }
  all.sort((a, b) => a - b);
  const med = all[all.length >> 1];
  const lowOf = new Map<string, number>();
  for (const [k, zs] of cells) if (zs.length >= 5) { zs.sort((a, b) => a - b); lowOf.set(k, zs[Math.floor(zs.length * 0.2)]); }
  return { altAtXY: (x: number, y: number) => lowOf.get(`${Math.floor(x / cellM)},${Math.floor(y / cellM)}`) ?? med, median: med };
}

/** Direct camera frames for a scene's photographs (keyed by image file name). */
export function sceneFrames(sceneDir: string, metresPerUnit = 1): { frames: Map<string, GeorefFrame>; centres: Map<string, [number, number, number]>; groundMedian: number } {
  const t = JSON.parse(readFileSync(join(sceneDir, "transforms.json"), "utf8")) as Transforms;
  const xyz = readPly(join(sceneDir, "sparse_pc.ply"));
  for (let i = 0; i < xyz.length; i++) xyz[i] *= metresPerUnit;
  const g = groundGrid(xyz);
  const M0 = enuFromCamera({ yawDeg: 0, pitchDeg: 0, rollDeg: 0, basis: "zero" }, { rotation: IDENTITY, basis: "identity" });
  const M0t: M3 = [M0[0], M0[3], M0[6], M0[1], M0[4], M0[7], M0[2], M0[5], M0[8]];
  const ground = { kind: "surface" as const, datum: DATUM, basis: "the scene's point cloud, 20th percentile per 1 m cell", altAt: (lat: number, lng: number) => { const v = toEnu({ lat, lng, altM: 0 }, SCENE_ORIGIN); return g.altAtXY(v[0], v[1]); } };
  const intrinsics = { width: t.w, height: t.h, fx: t.fl_x, fy: t.fl_y, cx: t.cx, cy: t.cy, distortion: { k1: t.k1, k2: t.k2, k3: t.k3 ?? 0, p1: t.p1, p2: t.p2 }, basis: "the scene's COLMAP calibration (OpenCV model)" };
  const frames = new Map<string, GeorefFrame>(), centres = new Map<string, [number, number, number]>();
  for (const fr of t.frames) {
    const T = fr.transform_matrix;
    // OpenGL camera (x right, y up, z back) to OpenCV (x right, y down, z forward): flip y and z.
    const Rcv: M3 = [T[0][0], -T[0][1], -T[0][2], T[1][0], -T[1][1], -T[1][2], T[2][0], -T[2][1], -T[2][2]];
    const B = mulM(M0t, Rcv);
    const [x, y, z] = [T[0][3] * metresPerUnit, T[1][3] * metresPerUnit, T[2][3] * metresPerUnit];
    const p = fromEnu([x, y, 0], SCENE_ORIGIN);
    const name = fr.file_path.split("/").pop()!;
    frames.set(name, { name, intrinsics, pose: { lat: p.lat, lng: p.lng, altM: z, datum: DATUM, attitude: { yawDeg: 0, pitchDeg: 0, rollDeg: 0, basis: "carried in the boresight" }, boresight: { rotation: B, basis: "the scene's camera-to-world rotation" }, basis: "UAV3DCrop transforms.json" }, ground });
    centres.set(name, [x, y, z]);
  }
  return { frames, centres, groundMedian: g.median };
}
