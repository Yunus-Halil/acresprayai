// The weed model run on the field map itself.
//
// Run on the photographs, a weed's outline is carried to the map through the
// camera's pose, a ground height and an alignment, and whatever any of them
// leaves wrong shows as an outline beside its weed. Run on the orthomosaic,
// there is nothing to carry: the outline is drawn in the map's own pixels and
// a map pixel IS a place (Web Mercator, the same arithmetic Leaflet draws the
// tiles with), so every weed sits exactly where the map shows it. This is how
// survey platforms keep anomalies in place: the georeferenced map is the one
// source of position.
//
// The map is read at its deepest baked zoom in square chunks with an overlap,
// so a weed cut by one chunk's edge is whole in its neighbour; each weed
// belongs to the chunk whose core holds its centre, so none is counted twice.
// Each chunk's crop rows are read from the chunk (the photo pass's pattern
// reader), and the chunk is enlarged to the photographs' sharpness before the
// model sees it, the resolution it was shown to work at.
import { type LatLng2, pointInRing } from "../geo";
import { analysePhotoOffThread } from "../photoScout/runPattern";
import type { PhotoPixels } from "../photoScout/pattern";
import { fetchTileCached } from "../tileCache";
import type { photoPassParams } from "../weedScout/photoPass";
import type { WeedInstance, WeedVisionResult } from "./client";
import { type FrameDetection, type FrameRunParams, MAX_RING_POINTS, frameRunKey, thinPolygon } from "./frames";
import { ALIGNMENT_VERSION } from "./register";
import { type RowContext, rowContextFromPattern, rowStatusOf } from "./rowFilter";

export const TILE_PX = 256;
/** A chunk's owned square, map pixels: 1536 at zoom 23 is about 22 m. */
export const MAP_CHUNK_PX = 1536;
/** Map pixels read past each side of the owned square. */
export const MAP_OVERLAP_PX = 96;
/** Coarser than this the map is too soft for the model; the photographs are used instead. */
export const MAP_MAX_MPP = 0.035;
/** The deepest zoom read. */
export const MAP_MAX_ZOOM = 23;
/** Largest enlargement before the model: past it a run takes too long for what it adds. */
export const MAX_UPSCALE = 2;
/** A chunk with less of its area imaged than this is skipped. */
export const MIN_COVERAGE = 0.02;

/** Global Web Mercator pixel of a point at zoom z (256 px tiles). */
export function mercatorPx(lat: number, lng: number, z: number): [number, number] {
  const s = TILE_PX * 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [((lng + 180) / 360) * s, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s];
}

/** The point at a global Web Mercator pixel position (pixel edges at integers) at zoom z. */
export function latLngOfPx(X: number, Y: number, z: number): LatLng2 {
  const s = TILE_PX * 2 ** z;
  const lng = (X / s) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * Y) / s;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lat, lng };
}

export const metresPerPixel = (lat: number, z: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

/** The zoom the map is read at, or null when the deepest baked zoom is too coarse. */
export function chooseMapZoom(maxNative: number, lat: number): { z: number; mpp: number } | null {
  const z = Math.min(MAP_MAX_ZOOM, Math.floor(maxNative));
  const mpp = metresPerPixel(lat, z);
  return mpp <= MAP_MAX_MPP ? { z, mpp } : null;
}

/** How much a chunk is enlarged so the model sees it as sharp as the photographs (1 to MAX_UPSCALE, in quarter steps). */
export function upscaleFor(mpp: number, photoGsdM: number | null): number {
  const target = photoGsdM && photoGsdM > 0 ? photoGsdM : 0.01;
  return Math.min(MAX_UPSCALE, Math.max(1, Math.round((mpp / target) * 4) / 4));
}

/**
 * The tiling that gives the model the sampling an enlargement by `upscale` would, on the chunk at its own pixels.
 * RF-DETR resizes every tile to its fixed input (504 px), so a 1024 px tile of a chunk enlarged 1.5x and a 680 px tile
 * of the chunk itself reach the model at the same ground sampling. Sending the chunk unenlarged gives the same model
 * input for a fraction of the upload, the mask pixels and the outline work (profile 2026-10-19: -20% service time,
 * -60% upload on a 2x chunk). Tile sizes are multiples of 8 within the service's 256 to 2048 px; the overlap keeps
 * its ground width.
 */
export function mapTiling(params: Pick<FrameRunParams, "tile" | "overlap">, upscale: number): { tile: number; overlap: number } {
  const tile = Math.min(2048, Math.max(256, Math.round(params.tile / upscale / 8) * 8));
  const overlap = Math.min(tile - 8, Math.max(0, Math.round(params.overlap / upscale)));
  return { tile, overlap };
}

/** The cache key of a map run: the zoom and enlargement are part of what was run. */
export function mapRunKey(params: FrameRunParams, modelSha: string | null, z: number, upscale: number): string {
  return `map|z${z}|u${upscale}|${frameRunKey(params, modelSha)}`;
}
export const isMapRunKey = (k: string | null | undefined): boolean => !!k && k.startsWith("map|");
export const isMapFrame = (name: string): boolean => name.startsWith("map/");

export type MapChunk = {
  name: string;
  z: number;
  /** The owned square's top-left, global map pixels. */
  x0: number;
  y0: number;
  size: number;
  overlap: number;
};

/** The canvas a chunk is read into: the owned square plus the overlap on every side. */
export const chunkCanvas = (c: MapChunk) => ({ left: c.x0 - c.overlap, top: c.y0 - c.overlap, width: c.size + 2 * c.overlap, height: c.size + 2 * c.overlap });

/** The chunks that cover the field: every owned square that touches a ring, row by row from the north-west. */
export function planMapChunks(rings: LatLng2[][], z: number, size = MAP_CHUNK_PX, overlap = MAP_OVERLAP_PX): MapChunk[] {
  const pts = rings.flat();
  if (!pts.length) return [];
  const px = rings.map(r => r.map(p => mercatorPx(p.lat, p.lng, z)));
  const xs = px.flat().map(p => p[0]), ys = px.flat().map(p => p[1]);
  const cx0 = Math.floor(Math.min(...xs) / size), cx1 = Math.floor(Math.max(...xs) / size);
  const cy0 = Math.floor(Math.min(...ys) / size), cy1 = Math.floor(Math.max(...ys) / size);
  const inside = (X: number, Y: number) => { const g = latLngOfPx(X, Y, z); return rings.some(r => pointInRing(g, r)); };
  const out: MapChunk[] = [];
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const x0 = cx * size, y0 = cy * size;
    // Touches the field: a ring vertex in the square, or a point of a 5 x 5 grid over the square in a ring.
    let hit = px.some(r => r.some(([X, Y]) => X >= x0 && X < x0 + size && Y >= y0 && Y < y0 + size));
    for (let i = 0; i <= 4 && !hit; i++) for (let j = 0; j <= 4 && !hit; j++) hit = inside(x0 + (size * i) / 4, y0 + (size * j) / 4);
    if (hit) out.push({ name: `map/z${z}/${cx}_${cy}`, z, x0, y0, size, overlap });
  }
  return out;
}

/**
 * A chunk's model answer as detections on the map. The service's pixels are
 * the enlarged chunk's (centres at integers); `upscale` brings them back to
 * the chunk canvas, the canvas offset to global map pixels, and the Mercator
 * inverse to the ground. Only instances whose centre lies in the chunk's own
 * square are kept. `rows` is the chunk's pattern in canvas pixels.
 */
export function groundMapResult(input: { chunk: MapChunk; result: WeedVisionResult; upscale: number; rows: RowContext | null; lat: number }): FrameDetection[] {
  const { chunk, result, upscale: s, rows } = input;
  const cv = chunkCanvas(chunk);
  const toCanvas = (j: number) => (j + 0.5) / s;
  const toLatLng = (x: number, y: number) => latLngOfPx(cv.left + toCanvas(x), cv.top + toCanvas(y), chunk.z);
  const gsdM = metresPerPixel(input.lat, chunk.z) / s;
  const own = (x: number, y: number) => { const cx = toCanvas(x), cy = toCanvas(y); return cx >= chunk.overlap && cx < chunk.overlap + chunk.size && cy >= chunk.overlap && cy < chunk.overlap + chunk.size; };
  const one = (inst: WeedInstance, klass: "weed" | "crop"): FrameDetection | null => {
    const [x, y] = inst.centroid_px;
    if (!own(x, y)) return null;
    const poly = thinPolygon(inst.polygons_px[0] ?? [], MAX_RING_POINTS);
    return {
      id: `${chunk.name}#${klass}${inst.id}`,
      frame: chunk.name, instanceId: inst.id, klass,
      score: inst.score, scoreKind: inst.score_kind,
      nativePolygon: poly, nativeCentroid: inst.centroid_px, nativeBbox: inst.bbox_px,
      areaPx: inst.area_px, equivalentDiameterPx: inst.equivalent_diameter_px,
      ring: poly.length >= 3 ? poly.map(([px, py]) => toLatLng(px, py)) : null,
      centre: toLatLng(x, y),
      gsdM, areaM2: inst.area_px * gsdM * gsdM, diameterM: inst.equivalent_diameter_px * gsdM,
      viewAngleDeg: 0,
      status: "ok",
      flags: inst.flags ?? [], tiny: !!inst.tiny, touchesBorder: !!inst.touches_border,
      fusedFromTiles: inst.fused_from_tiles ?? 1,
      rowStatus: klass === "weed" ? rowStatusOf(rows, toCanvas(x), toCanvas(y)) : undefined,
      // On the map by construction: nothing to align.
      alignment: { v: ALIGNMENT_VERSION, shiftM: 0, k: 0, patches: 0, rmsM: 0 },
    };
  };
  const out: FrameDetection[] = [];
  for (const inst of result.instances) { const d = one(inst, inst.class ?? "weed"); if (d) out.push(d); }
  for (const inst of result.crop_instances ?? []) { const d = one(inst, inst.class ?? "crop"); if (d) out.push(d); }
  return out;
}

// ---------------------------------------------------------------- browser

export type RenderedChunk = { pixels: PhotoPixels; image: Blob; coverage: number };

type Canvas2D = { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D };
function canvas2d(w: number, h: number): Canvas2D | null {
  const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = (canvas as HTMLCanvasElement).getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | null;
  return ctx ? { canvas, ctx } : null;
}
const toBlob = (c: HTMLCanvasElement | OffscreenCanvas, type: string, quality: number): Promise<Blob | null> =>
  "convertToBlob" in c ? c.convertToBlob({ type, quality }) : new Promise(res => (c as HTMLCanvasElement).toBlob(b => res(b), type, quality));

/** A chunk read from the map's tiles (through the tile cache) and enlarged for the model; null when the browser cannot draw. */
export async function renderMapChunk(chunk: MapChunk, tile: (z: number, x: number, y: number) => string, upscale: number, signal?: AbortSignal): Promise<RenderedChunk | null> {
  const cv = chunkCanvas(chunk);
  const c = canvas2d(cv.width, cv.height);
  if (!c) return null;
  const tx0 = Math.floor(cv.left / TILE_PX), tx1 = Math.floor((cv.left + cv.width - 1) / TILE_PX);
  const ty0 = Math.floor(cv.top / TILE_PX), ty1 = Math.floor((cv.top + cv.height - 1) / TILE_PX);
  const jobs: Promise<void>[] = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    jobs.push(fetchTileCached(tile(chunk.z, tx, ty), { signal })
      .then(b => createImageBitmap(b))
      .then(bmp => { c.ctx.drawImage(bmp, tx * TILE_PX - cv.left, ty * TILE_PX - cv.top); bmp.close?.(); })
      .catch(() => { /* a missing tile stays transparent */ }));
  }
  await Promise.all(jobs);
  if (signal?.aborted) return null;
  const data = c.ctx.getImageData(0, 0, cv.width, cv.height).data;
  let covered = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) covered++;
  const coverage = covered / (cv.width * cv.height);
  let image: Blob | null;
  if (upscale === 1) image = await toBlob(c.canvas, "image/jpeg", 0.95);
  else {
    const big = canvas2d(Math.round(cv.width * upscale), Math.round(cv.height * upscale));
    if (!big) return null;
    big.ctx.imageSmoothingEnabled = true;
    big.ctx.imageSmoothingQuality = "high";
    big.ctx.drawImage(c.canvas as CanvasImageSource, 0, 0, big.canvas.width, big.canvas.height);
    image = await toBlob(big.canvas, "image/jpeg", 0.95);
  }
  if (!image) return null;
  return { pixels: { width: cv.width, height: cv.height, rgba: data }, image, coverage };
}

/** A chunk's crop rows, read with the photo pass's pattern reader on the chunk's own pixels; null when none were read. */
export async function readChunkRows(pixels: PhotoPixels, gsdM: number, passParams: ReturnType<typeof photoPassParams>, signal?: AbortSignal): Promise<RowContext | null> {
  try {
    const pattern = await analysePhotoOffThread(pixels, { gsdM, ...passParams }, { transfer: true, signal });
    return rowContextFromPattern(pattern, 1);
  } catch {
    return null;
  }
}
