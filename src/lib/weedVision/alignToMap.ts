// The browser half of register.ts: the photo and the orthomosaic as samplers.
//
// The map is read from its own tiles through the shared tile cache, in exact
// Web Mercator (not the linear-latitude raster of orthoRaster.ts, which is fine
// for cell statistics and a few centimetres wrong for this). The zoom is the
// one whose pixel is closest to ~4 cm, never deeper than the scan was baked;
// the samples are spaced at that pixel size. The photo is decoded once, at most
// ALIGN_PHOTO_EDGE px on its long edge, and sampled in the posed frame's
// pixels. Browser only.
import type { Shot, SourceFrameSet } from "../sourceFrames/odm";
import { fetchTileCached } from "../tileCache";
import { type FrameAlignment, type MapSampler, type PhotoSampler, alignPhoto, patchCentres } from "./register";
import { fromEnu } from "../sourceFrames/odm";

export const ALIGN_PHOTO_EDGE = 2048;
const TILE = 256;
/** Sample spacing the zoom is chosen for, metres. */
const TARGET_STEP_M = 0.04;

const mercatorPx = (lat: number, lng: number, z: number): [number, number] => {
  const s = TILE * 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [((lng + 180) / 360) * s, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s];
};
const metresPerPixel = (lat: number, z: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

async function decode(blob: Blob, maxEdge?: number): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null> {
  if (typeof createImageBitmap === "undefined") return null;
  const probe = await createImageBitmap(blob, { imageOrientation: "from-image" }).catch(() => null);
  if (!probe) return null;
  let bmp = probe;
  if (maxEdge && Math.max(probe.width, probe.height) > maxEdge) {
    const s = maxEdge / Math.max(probe.width, probe.height);
    const resized = await createImageBitmap(probe, { resizeWidth: Math.round(probe.width * s), resizeHeight: Math.round(probe.height * s), resizeQuality: "medium" }).catch(() => null);
    probe.close?.();
    if (!resized) return null;
    bmp = resized;
  }
  const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement("canvas"), { width: bmp.width, height: bmp.height });
  const ctx = (canvas as HTMLCanvasElement).getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | null;
  if (!ctx) { bmp.close?.(); return null; }
  ctx.drawImage(bmp, 0, 0);
  const out = { width: bmp.width, height: bmp.height, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
  bmp.close?.();
  return out;
}

/** Bilinear RGB from an RGBA buffer; null outside or on transparent pixels. */
function bilinear(img: { width: number; height: number; data: Uint8ClampedArray }, x: number, y: number): [number, number, number] | null {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= img.width || y0 + 1 >= img.height) return null;
  const tx = x - x0, ty = y - y0;
  const px = (xx: number, yy: number) => (yy * img.width + xx) * 4;
  const a = px(x0, y0), b = px(x0 + 1, y0), c = px(x0, y0 + 1), d = px(x0 + 1, y0 + 1);
  if (img.data[a + 3] === 0 || img.data[b + 3] === 0 || img.data[c + 3] === 0 || img.data[d + 3] === 0) return null;
  const mix = (o: number) => (img.data[a + o] * (1 - tx) + img.data[b + o] * tx) * (1 - ty) + (img.data[c + o] * (1 - tx) + img.data[d + o] * tx) * ty;
  return [mix(0), mix(1), mix(2)];
}

/** Decoded tiles, kept across photos of one run: neighbouring photos share most of their tiles. */
const decodedTiles = new Map<string, Promise<{ width: number; height: number; data: Uint8ClampedArray } | null>>();
const DECODED_TILES_KEPT = 160;

function tileImage(url: string): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null> {
  const key = url.replace(/[?&]token=[^&]*/, "");
  const have = decodedTiles.get(key);
  if (have) return have;
  const p = fetchTileCached(url).then(b => decode(b)).catch(() => null);
  decodedTiles.set(key, p);
  while (decodedTiles.size > DECODED_TILES_KEPT) {
    const oldest = decodedTiles.keys().next().value;
    if (oldest == null) break;
    decodedTiles.delete(oldest);
  }
  return p;
}

export type AlignToMapInput = {
  set: SourceFrameSet;
  shot: Shot;
  altM: number;
  /** The original photo. */
  blob: Blob;
  /** The orthomosaic's tile URL for a tile. */
  tileUrl: (z: number, x: number, y: number) => string;
  /** The deepest zoom the scan was baked to. */
  maxZoom: number;
};

/** The photo's alignment to the map, or null when it cannot be measured (no texture, no imagery, no browser). */
export async function alignPhotoToMap(input: AlignToMapInput): Promise<FrameAlignment | null> {
  const { set, shot, altM } = input;
  const cam = set.cameras[shot.cameraKey];
  if (!cam) return null;
  const centres = patchCentres(set, shot, altM);
  if (!centres.length) return null;
  const lat0 = shot.centre.lat;
  let z = input.maxZoom;
  while (z > 15 && metresPerPixel(lat0, z) < TARGET_STEP_M * 0.75) z--;
  const stepM = Math.max(TARGET_STEP_M * 0.5, metresPerPixel(lat0, z));
  // Every tile the patches (plus the largest shift searched) touch, decoded up front.
  const halfM = (128 / 2) * stepM + 3.5;
  const up = altM - set.reference.altM;
  const tiles = new Set<string>();
  for (const c of centres) {
    for (const [de, dn] of [[-halfM, -halfM], [halfM, -halfM], [halfM, halfM], [-halfM, halfM]]) {
      const g = fromEnu([c[0] + de, c[1] + dn, up], set.reference);
      const [X, Y] = mercatorPx(g.lat, g.lng, z);
      tiles.add(`${Math.floor(X / TILE)}:${Math.floor(Y / TILE)}`);
    }
  }
  const xs = [...tiles].map(k => Number(k.split(":")[0])), ys = [...tiles].map(k => Number(k.split(":")[1]));
  const loaded = new Map<string, { width: number; height: number; data: Uint8ClampedArray } | null>();
  const jobs: Promise<void>[] = [];
  for (let tx = Math.min(...xs); tx <= Math.max(...xs); tx++) for (let ty = Math.min(...ys); ty <= Math.max(...ys); ty++) {
    jobs.push(tileImage(input.tileUrl(z, tx, ty)).then(img => { loaded.set(`${tx}:${ty}`, img); }));
  }
  await Promise.all(jobs);
  const mapAt: MapSampler = (lat, lng) => {
    const [X, Y] = mercatorPx(lat, lng, z);
    const tx = Math.floor(X / TILE), ty = Math.floor(Y / TILE);
    const img = loaded.get(`${tx}:${ty}`);
    if (!img) return null;
    // Within a tile only; samples on the last pixel row or column of a tile are skipped (a handful per patch).
    return bilinear(img, X - tx * TILE, Y - ty * TILE);
  };
  const photo = await decode(input.blob, ALIGN_PHOTO_EDGE);
  if (!photo) return null;
  const sx = photo.width / cam.width, sy = photo.height / cam.height;
  const photoAt: PhotoSampler = (u, v) => bilinear(photo, u * sx, v * sy);
  // Let the page breathe before the arithmetic.
  await new Promise(r => setTimeout(r, 0));
  return alignPhoto({ set, shot, altM, photoAt, mapAt, stepM });
}

/** For tests and after a rebake: forget the decoded tiles. */
export function resetAlignTiles(): void { decodedTiles.clear(); }
