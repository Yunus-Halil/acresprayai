// From a map point to a pixel in the photograph that saw it, using the camera
// poses ODM recovered when it built the orthomosaic.
//
// WHAT THIS READS. Three files that NodeODM's all.zip carries for every scan
// (verified on a real one, 2026-10-01; see docs/review/source-frames-architecture.md):
//
//   cameras.json              the calibrated lens: OpenSfM "brown" or "perspective"
//                             model, focal and principal point normalised by the
//                             longer image side, distortion k1 k2 k3 p1 p2
//   odm_report/shots.geojson  one feature per photograph: the camera's optical
//                             centre (lon, lat, altitude) and its rotation as an
//                             axis-angle vector, world to camera, in the local
//                             east-north-up frame OpenSfM reconstructed in
//   images.json               what ODM read from each photograph's EXIF, including
//                             the dimensions it was given AND the dimensions the
//                             EXIF said the camera produced (they differ when the
//                             upload downscaled the frame)
//
// WHAT IT DOES NOT KNOW. The ground's height. ODM's point cloud knows it, but
// it is not on the client. A caller passes the ground altitude; the error from
// getting it wrong is (distance from frame centre / flying height) times the
// height error, which is why selection prefers frames that hold the point near
// their centre. A DSM (`dsm: true` at commit) removes this in a later version.
//
// Conventions (OpenSfM, which ODM runs): X_cam = R (X_world - C); the camera
// looks along +z_cam; normalised image coordinates are (x/z, y/z); pixels are
// norm * max(width, height) + (width/2, height/2). Nothing here is approximate
// where the reconstruction is exact; what is approximate (the ground height)
// is a named input.

export type LatLngAlt = { lat: number; lng: number; altM: number };

export type CameraModel = {
  key: string;
  projection: "brown" | "perspective";
  width: number;
  height: number;
  /** Normalised by max(width, height). */
  focal: number;
  cx: number;
  cy: number;
  k1: number; k2: number; k3: number; p1: number; p2: number;
};

export type Shot = {
  filename: string;
  cameraKey: string;
  centre: LatLngAlt;
  /** Axis-angle, world to camera, radians. */
  rotation: [number, number, number];
  /** Seconds since the epoch, when ODM read one. */
  capturedAt: number | null;
};

export type ImageMeta = {
  filename: string;
  /** The frame ODM reconstructed from (what was uploaded). */
  width: number;
  height: number;
  /** The frame the camera produced, from EXIF. Null when EXIF carried none. */
  exifWidth: number | null;
  exifHeight: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lat: number | null;
  lng: number | null;
  /** GPS altitude as written; usually above sea level, not above ground. */
  altitudeM: number | null;
  exposureS: number | null;
  iso: number | null;
  fNumber: number | null;
  /** Milliseconds since the epoch. */
  utcTimeMs: number | null;
  yaw: number | null;
  pitch: number | null;
  roll: number | null;
};

export type SourceFrameSet = {
  cameras: Record<string, CameraModel>;
  shots: Shot[];
  images: Record<string, ImageMeta>;
  /** Local east-north-up origin: the mean camera position. */
  reference: LatLngAlt;
};

export class UnsupportedCameraError extends Error {}

// --------------------------------------------------------------------------
// Parsing
// --------------------------------------------------------------------------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function parseCameras(json: unknown): Record<string, CameraModel> {
  const out: Record<string, CameraModel> = {};
  if (!json || typeof json !== "object") return out;
  for (const [key, raw] of Object.entries(json as Record<string, Record<string, unknown>>)) {
    const projection = raw.projection_type;
    if (projection !== "brown" && projection !== "perspective") {
      throw new UnsupportedCameraError(`camera "${key}" uses ${String(projection)}; only brown and perspective lenses are projected`);
    }
    const width = num(raw.width), height = num(raw.height);
    const focal = num(raw.focal_x) ?? num(raw.focal);
    if (!width || !height || !focal) throw new UnsupportedCameraError(`camera "${key}" has no usable focal or size`);
    out[key] = {
      key, projection, width, height, focal,
      cx: num(raw.c_x) ?? 0, cy: num(raw.c_y) ?? 0,
      k1: num(raw.k1) ?? 0, k2: num(raw.k2) ?? 0, k3: num(raw.k3) ?? 0,
      p1: num(raw.p1) ?? 0, p2: num(raw.p2) ?? 0,
    };
  }
  return out;
}

type GeoJsonFeature = { geometry?: { type?: string; coordinates?: number[] }; properties?: Record<string, unknown> };

export function parseShots(geojson: unknown, cameras: Record<string, CameraModel>): Shot[] {
  const features = (geojson as { features?: GeoJsonFeature[] })?.features ?? [];
  const keys = Object.keys(cameras);
  const shots: Shot[] = [];
  for (const f of features) {
    const p = f.properties ?? {};
    const c = f.geometry?.coordinates;
    const rot = p.rotation as unknown;
    if (!Array.isArray(c) || c.length < 3 || !Array.isArray(rot) || rot.length !== 3) continue;
    const filename = String(p.filename ?? "");
    if (!filename) continue;
    // shots.geojson prefixes the camera key with "v2 "; cameras.json does not.
    const rawKey = String(p.camera ?? "");
    const cameraKey = keys.find(k => rawKey === k || rawKey === `v2 ${k}`) ?? (keys.length === 1 ? keys[0] : null);
    if (!cameraKey) continue;
    shots.push({
      filename, cameraKey,
      centre: { lng: c[0], lat: c[1], altM: c[2] },
      rotation: [Number(rot[0]), Number(rot[1]), Number(rot[2])],
      capturedAt: num(p.capture_time),
    });
  }
  return shots;
}

export function parseImages(json: unknown): Record<string, ImageMeta> {
  const out: Record<string, ImageMeta> = {};
  if (!Array.isArray(json)) return out;
  for (const r of json as Record<string, unknown>[]) {
    const filename = String(r.filename ?? "");
    const width = num(r.width), height = num(r.height);
    if (!filename || !width || !height) continue;
    out[filename] = {
      filename, width, height,
      exifWidth: num(r.exif_width), exifHeight: num(r.exif_height),
      cameraMake: typeof r.camera_make === "string" ? r.camera_make : null,
      cameraModel: typeof r.camera_model === "string" ? r.camera_model : null,
      lat: num(r.latitude), lng: num(r.longitude), altitudeM: num(r.altitude),
      exposureS: num(r.exposure_time), iso: num(r.iso_speed), fNumber: num(r.fnumber),
      utcTimeMs: num(r.utc_time),
      yaw: num(r.yaw), pitch: num(r.pitch), roll: num(r.roll),
    };
  }
  return out;
}

export function parseOdmOutputs(input: { camerasJson: unknown; shotsGeojson: unknown; imagesJson: unknown }): SourceFrameSet {
  const cameras = parseCameras(input.camerasJson);
  const shots = parseShots(input.shotsGeojson, cameras);
  const images = parseImages(input.imagesJson);
  const n = shots.length || 1;
  const reference: LatLngAlt = {
    lat: shots.reduce((s, x) => s + x.centre.lat, 0) / n,
    lng: shots.reduce((s, x) => s + x.centre.lng, 0) / n,
    altM: shots.reduce((s, x) => s + x.centre.altM, 0) / n,
  };
  return { cameras, shots, images, reference };
}

// --------------------------------------------------------------------------
// Geometry
// --------------------------------------------------------------------------

const EARTH_R = 6378137;
type V3 = [number, number, number];

/** Local tangent plane about the set's reference: metres east, north, up. */
export function toEnu(p: LatLngAlt, ref: LatLngAlt): V3 {
  const lat0 = (ref.lat * Math.PI) / 180;
  return [
    ((p.lng - ref.lng) * Math.PI / 180) * EARTH_R * Math.cos(lat0),
    ((p.lat - ref.lat) * Math.PI / 180) * EARTH_R,
    p.altM - ref.altM,
  ];
}

export function fromEnu(v: V3, ref: LatLngAlt): LatLngAlt {
  const lat0 = (ref.lat * Math.PI) / 180;
  return {
    lng: ref.lng + (v[0] / (EARTH_R * Math.cos(lat0))) * 180 / Math.PI,
    lat: ref.lat + (v[1] / EARTH_R) * 180 / Math.PI,
    altM: ref.altM + v[2],
  };
}

/** Rodrigues: axis-angle to a 3x3 rotation, row-major. */
export function rotationMatrix(r: [number, number, number]): number[] {
  const th = Math.hypot(r[0], r[1], r[2]);
  if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const [kx, ky, kz] = [r[0] / th, r[1] / th, r[2] / th];
  const c = Math.cos(th), s = Math.sin(th), t = 1 - c;
  return [
    t * kx * kx + c, t * kx * ky - s * kz, t * kx * kz + s * ky,
    t * kx * ky + s * kz, t * ky * ky + c, t * ky * kz - s * kx,
    t * kx * kz - s * ky, t * ky * kz + s * kx, t * kz * kz + c,
  ];
}

const mul = (m: number[], v: V3): V3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
const mulT = (m: number[], v: V3): V3 => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];

function distort(cam: CameraModel, x: number, y: number): [number, number] {
  const r2 = x * x + y * y;
  const radial = 1 + cam.k1 * r2 + cam.k2 * r2 * r2 + cam.k3 * r2 * r2 * r2;
  return [
    x * radial + 2 * cam.p1 * x * y + cam.p2 * (r2 + 2 * x * x),
    y * radial + cam.p1 * (r2 + 2 * y * y) + 2 * cam.p2 * x * y,
  ];
}

/** Inverse of `distort`: divide out the radial term and subtract the tangential one, iterated (OpenCV's scheme). */
function undistort(cam: CameraModel, xd: number, yd: number): [number, number] {
  let x = xd, y = yd;
  for (let i = 0; i < 100; i++) {
    const r2 = x * x + y * y;
    const radial = 1 + cam.k1 * r2 + cam.k2 * r2 * r2 + cam.k3 * r2 * r2 * r2;
    const nx = (xd - (2 * cam.p1 * x * y + cam.p2 * (r2 + 2 * x * x))) / radial;
    const ny = (yd - (cam.p1 * (r2 + 2 * y * y) + 2 * cam.p2 * x * y)) / radial;
    const done = Math.abs(nx - x) < 1e-12 && Math.abs(ny - y) < 1e-12;
    x = nx; y = ny;
    if (done) break;
  }
  return [x, y];
}

export type Projection = {
  /** Pixel column and row in the frame ODM reconstructed from. */
  u: number;
  v: number;
  /** Metres from the optical centre along the optical axis. */
  depthM: number;
  inside: boolean;
  /** Pixels from the nearest frame edge; negative when outside. */
  edgeDistancePx: number;
  /** Angle between the ray to the point and straight down, degrees. */
  viewAngleDeg: number;
  /** Ground metres per pixel at this point in this frame. */
  gsdM: number;
};

/** Where a ground point lands in a photograph, or null when it is behind the camera. */
export function projectToFrame(set: SourceFrameSet, shot: Shot, point: LatLngAlt): Projection | null {
  const cam = set.cameras[shot.cameraKey];
  const R = rotationMatrix(shot.rotation);
  const X = toEnu(point, set.reference), C = toEnu(shot.centre, set.reference);
  const d: V3 = [X[0] - C[0], X[1] - C[1], X[2] - C[2]];
  const p = mul(R, d);
  if (p[2] <= 1e-6) return null;
  const [xd, yd] = distort(cam, p[0] / p[2], p[1] / p[2]);
  const S = Math.max(cam.width, cam.height);
  const u = (cam.focal * xd + cam.cx) * S + cam.width / 2;
  const v = (cam.focal * yd + cam.cy) * S + cam.height / 2;
  const edgeDistancePx = Math.min(u, v, cam.width - u, cam.height - v);
  const len = Math.hypot(d[0], d[1], d[2]);
  const viewAngleDeg = (Math.acos(Math.min(1, Math.max(-1, -d[2] / len))) * 180) / Math.PI;
  return {
    u, v, depthM: p[2], inside: edgeDistancePx >= 0, edgeDistancePx, viewAngleDeg,
    gsdM: p[2] / (cam.focal * S),
  };
}

/** Where a pixel's ray meets a horizontal plane at `groundAltM`, or null when it never does. */
export function pixelToGround(set: SourceFrameSet, shot: Shot, u: number, v: number, groundAltM: number): LatLngAlt | null {
  const cam = set.cameras[shot.cameraKey];
  const S = Math.max(cam.width, cam.height);
  // Distortion acts on (x/z, y/z), before the focal length: divide first, then invert it.
  const [x, y] = undistort(cam, ((u - cam.width / 2) / S - cam.cx) / cam.focal, ((v - cam.height / 2) / S - cam.cy) / cam.focal);
  const R = rotationMatrix(shot.rotation);
  const dir = mulT(R, [x, y, 1]);
  const C = toEnu(shot.centre, set.reference);
  const groundZ = groundAltM - set.reference.altM;
  if (Math.abs(dir[2]) < 1e-9) return null;
  const t = (groundZ - C[2]) / dir[2];
  if (t <= 0) return null;
  return fromEnu([C[0] + t * dir[0], C[1] + t * dir[1], groundZ], set.reference);
}

/** The frame's four corners on the ground plane, clockwise from the top-left pixel. Null when a corner misses the plane. */
export function frameFootprint(set: SourceFrameSet, shot: Shot, groundAltM: number): LatLngAlt[] | null {
  const cam = set.cameras[shot.cameraKey];
  const corners: [number, number][] = [[0, 0], [cam.width, 0], [cam.width, cam.height], [0, cam.height]];
  const out: LatLngAlt[] = [];
  for (const [u, v] of corners) {
    const g = pixelToGround(set, shot, u, v, groundAltM);
    if (!g) return null;
    out.push(g);
  }
  return out;
}

/** Straight-down direction check: degrees between the optical axis and nadir. */
export function offNadirDeg(shot: Shot): number {
  const axis = mulT(rotationMatrix(shot.rotation), [0, 0, 1]);
  return (Math.acos(Math.min(1, Math.max(-1, -axis[2]))) * 180) / Math.PI;
}

/**
 * A ground altitude when nothing better is known: the median camera altitude
 * minus the flying height ODM's own average GSD implies. Returns null unless
 * every number it needs was recorded; nothing is invented.
 */
export function groundAltitudeFromOdm(set: SourceFrameSet, averageGsdCm: number | null | undefined): number | null {
  if (!averageGsdCm || !set.shots.length) return null;
  const cam = set.cameras[set.shots[0].cameraKey];
  const focalPx = cam.focal * Math.max(cam.width, cam.height);
  const alts = set.shots.map(s => s.centre.altM).sort((a, b) => a - b);
  const median = alts[Math.floor(alts.length / 2)];
  return median - (averageGsdCm / 100) * focalPx;
}
