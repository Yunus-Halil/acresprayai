// The flight's own photographs on this device, for photo ground (photoGround.ts): the files this tab just built from,
// or a folder the operator opens. Read here, never uploaded. They give the photographs behind a finding (a crop of
// each photograph that saw the place, with the place marked) and the detail tiles for the view on screen.
import type { GeorefFrame } from "@/lib/directGeoref/projection";
import { type GroundManifest, type PhotoView, type TilePlan, groundCams, lngOfX, latOfY, planTiles, tileX, tileY, viewsOf } from "./photoGround";

export type PhotoAccess = {
  /** Photograph name (file name without its extension, as the build names them) to its file. */
  byName: Map<string, File>;
  /** Where they came from, said beside them. */
  source: "this build" | "opened on this device";
};

/** The build's own name for a file: its base name without the extension (groupPhotoFiles does the same). */
export const photoNameOf = (file: File) => file.name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");

export function photoAccessFrom(files: File[] | FileList, source: PhotoAccess["source"]): PhotoAccess {
  const byName = new Map<string, File>();
  for (const f of Array.from(files)) if (/\.(jpe?g|tiff?)$/i.test(f.name)) byName.set(photoNameOf(f), f);
  return { byName, source };
}

/** How many of the twin's photographs these files hold. */
export const photosMatched = (access: PhotoAccess, frames: GeorefFrame[]) => frames.filter(f => access.byName.has(f.name)).length;

export type EvidenceView = PhotoView & { url: string; widthM: number; markerPx: number; px: number };

/**
 * The photographs that saw a place (nearest nadir first, at most `max`), each cropped around it from the original file
 * at its full resolution, `windowM` metres across, with the place marked by a ring `markM` across. Only photographs on
 * this device; the rest are named and skipped. `others`: further places marked in each crop, each by a smaller ring
 * in its own colour (a plant's neighbours as the twin located them).
 */
export async function evidenceViews(access: PhotoAccess, frames: GeorefFrame[], lat: number, lng: number, opts: { windowM?: number; markM?: number; px?: number; max?: number; others?: { lat: number; lng: number; colour: string }[] } = {}): Promise<{ views: EvidenceView[]; missing: string[] }> {
  const windowM = opts.windowM ?? 1.2, markM = opts.markM ?? 0.12, px = opts.px ?? 240, others = opts.others ?? [];
  const views = viewsOf(frames, lat, lng, opts.max ?? 4, others.length ? others.map(o => [o.lat, o.lng] as [number, number]) : undefined), out: EvidenceView[] = [], missing: string[] = [];
  const intr = new Map(frames.map(f => [f.name, f.intrinsics]));
  for (const v of views) {
    const file = access.byName.get(v.name);
    if (!file) { missing.push(v.name); continue; }
    const bmp = await createImageBitmap(file);
    try {
      const k = bmp.width / intr.get(v.name)!.width, sz = Math.max(16, (windowM / Math.max(1e-4, v.pixelM)) * k);
      const sx = v.u * k - sz / 2, sy = v.v * k - sz / 2;
      const c = new OffscreenCanvas(px, px), g = c.getContext("2d")!;
      g.fillStyle = "#1a1c1a"; g.fillRect(0, 0, px, px);
      g.drawImage(bmp, sx, sy, sz, sz, 0, 0, px, px);
      bmp.close();
      const markerPx = Math.max(6, (markM / 2 / windowM) * px);
      // The other places first, under the selected one's ring: a smaller ring each, in its own colour.
      const toCrop = px / sz, otherPx = Math.max(3, markerPx * 0.6);
      for (const o of v.others ?? []) {
        const x = (o.u * k - sx) * toCrop, y = (o.v * k - sy) * toCrop;
        if (x < -otherPx || y < -otherPx || x > px + otherPx || y > px + otherPx) continue;
        g.strokeStyle = "rgba(0,0,0,0.55)"; g.lineWidth = 3; g.beginPath(); g.arc(x, y, otherPx, 0, 2 * Math.PI); g.stroke();
        g.strokeStyle = others[o.i].colour; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, otherPx, 0, 2 * Math.PI); g.stroke();
      }
      g.strokeStyle = "rgba(255,255,255,0.95)"; g.lineWidth = 2; g.beginPath(); g.arc(px / 2, px / 2, markerPx, 0, 2 * Math.PI); g.stroke();
      g.strokeStyle = "rgba(0,0,0,0.6)"; g.lineWidth = 1; g.beginPath(); g.arc(px / 2, px / 2, markerPx + 2, 0, 2 * Math.PI); g.stroke();
      const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.88 });
      out.push({ ...v, url: URL.createObjectURL(blob), widthM: windowM, markerPx, px });
    } finally { bmp.close(); }
  }
  return { views: out, missing };
}

/** The detail tiles over a view (south-west, north-east), at most `maxTiles`, from the photographs on this device. */
export function detailPlanFor(manifest: GroundManifest, sw: [number, number], ne: [number, number], maxTiles = 48): { z: number; plan: TilePlan[]; tooMany: boolean } {
  const z = manifest.detail.zoom;
  const { cams, origin } = groundCams(new Map(manifest.frames.map(f => [f.name, f])));
  const x0 = Math.floor(tileX(sw[1], z)), x1 = Math.floor(tileX(ne[1], z)), y0 = Math.floor(tileY(ne[0], z)), y1 = Math.floor(tileY(sw[0], z));
  const want = new Set<string>();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) want.add(`${x}/${y}`);
  if (want.size > maxTiles) return { z, plan: [], tooMany: true };
  const plan = planTiles(cams, z, origin, manifest.featherM).filter(t => want.has(`${t.x}/${t.y}`));
  return { z, plan, tooMany: false };
}

export type DetailRequest = { manifest: GroundManifest; z: number; plan: TilePlan[]; files: [string, File][] };
export type DetailMessage = { type: "tile"; z: number; x: number; y: number; blob: Blob } | { type: "done"; ms: number; photographs: number; tiles: number } | { type: "error"; message: string };

/** Cuts detail tiles in a worker; `onTile` gets each as it is finished. Resolves with the time and counts. */
export function cutDetail(req: DetailRequest, onTile: (z: number, x: number, y: number, url: string) => void): Promise<{ ms: number; photographs: number; tiles: number }> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("./build/groundDetailWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<DetailMessage>) => {
      const m = e.data;
      if (m.type === "tile") onTile(m.z, m.x, m.y, URL.createObjectURL(m.blob));
      else if (m.type === "done") { w.terminate(); resolve({ ms: m.ms, photographs: m.photographs, tiles: m.tiles }); }
      else { w.terminate(); reject(new Error(m.message)); }
    };
    w.onerror = e => { w.terminate(); reject(new Error(e.message || "the detail worker failed to start")); };
    w.postMessage(req);
  });
}

/** The centre of a tile, for tests and labels. */
export const tileCentre = (z: number, x: number, y: number): [number, number] => [latOfY(y + 0.5, z), lngOfX(x + 0.5, z)];
