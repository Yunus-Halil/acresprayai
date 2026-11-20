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

export type EvidenceView = PhotoView & { url: string; widthM: number; markerPx: number; px: number; /** The crop was turned this far (radians) to put north up. */ turned?: number;
  /** Asked to align (`marks`): on how many of this photograph's own marks it was aligned and how far it moved, metres; null: not aligned (too few marks around). */
  aligned?: { on: number; movedM: number } | null };

/**
 * Where a pixel of the photograph lands in a crop `px` square centred on (cu, cv), `sz` photograph pixels across,
 * turned by `turn` radians about its centre (0: the photograph's own way up).
 */
export function cropPoint(u: number, v: number, cu: number, cv: number, sz: number, px: number, turn: number): [number, number] {
  const s = px / sz, x = (u - cu) * s, y = (v - cv) * s, c = Math.cos(turn), n = Math.sin(turn);
  return [px / 2 + x * c - y * n, px / 2 + x * n + y * c];
}

/** The turn (radians) that puts a photograph's north (a unit step in pixels) straight up. */
export const northUpTurn = (north: [number, number]) => -Math.PI / 2 - Math.atan2(north[1], north[0]);

/**
 * How far to move a view so the places around it (`others`, as drawn through the camera) sit on this photograph's own
 * marks of them: each place paired with the photograph's nearest mark within `withinM`, the median of the pairs' steps,
 * in the photograph's pixels. Null with fewer than `minPairs` pairs (the view stays as the camera draws it).
 */
export function alignOnMarks(v: PhotoView, marks: [number, number][], withinM = 0.08, minPairs = 3): { du: number; dv: number; on: number } | null {
  const o = v.others ?? [], within = withinM / Math.max(1e-6, v.pixelM);
  if (o.length < minPairs || !marks.length) return null;
  // Only the marks near the view (the others lie within a metre or so of it).
  const reach = within + Math.max(...o.map(p => Math.hypot(p.u - v.u, p.v - v.v)));
  const near = marks.filter(([x, y]) => Math.abs(x - v.u) <= reach && Math.abs(y - v.v) <= reach);
  const du: number[] = [], dv: number[] = [];
  for (const p of o) {
    let best = within, bx = 0, by = 0, hit = false;
    for (const [x, y] of near) { const d = Math.hypot(x - p.u, y - p.v); if (d <= best) { best = d; bx = x; by = y; hit = true; } }
    if (hit) { du.push(bx - p.u); dv.push(by - p.v); }
  }
  if (du.length < minPairs) return null;
  const med = (x: number[]) => { const s = [...x].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  return { du: med(du), dv: med(dv), on: du.length };
}

/**
 * The photographs that saw a place (nearest nadir first, at most `max`), each cropped around it from the original file
 * at its full resolution, `windowM` metres across, with the place marked by a ring `markM` across. Only photographs on
 * this device; the rest are named and skipped. `others`: further places marked in each crop, each by a smaller ring
 * in its own colour (a plant's neighbours as the twin located them). `northUp`: each crop turned so north is up, as
 * the map is; `scaleM`: a bar that long drawn in the corner; `bold`: thicker rings.
 */
export async function evidenceViews(access: PhotoAccess, frames: GeorefFrame[], lat: number, lng: number, opts: { windowM?: number; markM?: number; px?: number; max?: number; others?: { lat: number; lng: number; colour: string }[]; northUp?: boolean; scaleM?: number; bold?: boolean; /** Per photograph its own marks, in its pixels: each crop aligned on them (alignOnMarks). */ marks?: Map<string, [number, number][]> } = {}): Promise<{ views: EvidenceView[]; missing: string[] }> {
  const windowM = opts.windowM ?? 1.2, markM = opts.markM ?? 0.12, px = opts.px ?? 240, others = opts.others ?? [], w = opts.bold ? 2 : 1;
  const views = viewsOf(frames, lat, lng, opts.max ?? 4, { ...(others.length ? { others: others.map(o => [o.lat, o.lng] as [number, number]) } : {}), ...(opts.northUp ? { north: true } : {}) }), out: EvidenceView[] = [], missing: string[] = [];
  const intr = new Map(frames.map(f => [f.name, f.intrinsics]));
  for (const v0 of views) {
    const file = access.byName.get(v0.name);
    if (!file) { missing.push(v0.name); continue; }
    // Aligned on the photograph's own marks of the places around it, when asked: the place and the others move together.
    const al = opts.marks ? alignOnMarks(v0, opts.marks.get(v0.name) ?? []) : null;
    const v: PhotoView = al ? { ...v0, u: v0.u + al.du, v: v0.v + al.dv, others: v0.others?.map(o => ({ ...o, u: o.u + al.du, v: o.v + al.dv })) } : v0;
    const aligned = opts.marks ? (al ? { on: al.on, movedM: Math.hypot(al.du, al.dv) * v0.pixelM } : null) : undefined;
    const bmp = await createImageBitmap(file);
    try {
      const k = bmp.width / intr.get(v.name)!.width, sz = Math.max(16, (windowM / Math.max(1e-4, v.pixelM)) * k);
      const cu = v.u * k, cv = v.v * k, turn = opts.northUp && v.north ? northUpTurn(v.north) : 0;
      const c = new OffscreenCanvas(px, px), g = c.getContext("2d")!;
      g.fillStyle = "#1a1c1a"; g.fillRect(0, 0, px, px);
      if (turn) {
        // Turned: a wider square cut so the corners stay photograph.
        const big = sz * 1.5, s = px / sz;
        g.save(); g.translate(px / 2, px / 2); g.rotate(turn);
        g.drawImage(bmp, cu - big / 2, cv - big / 2, big, big, (-big / 2) * s, (-big / 2) * s, big * s, big * s);
        g.restore();
      } else g.drawImage(bmp, cu - sz / 2, cv - sz / 2, sz, sz, 0, 0, px, px);
      bmp.close();
      const markerPx = Math.max(6, (markM / 2 / windowM) * px);
      // The other places first, under the selected one's ring: a smaller ring each, in its own colour.
      const otherPx = Math.max(3, markerPx * 0.6);
      for (const o of v.others ?? []) {
        const [x, y] = cropPoint(o.u * k, o.v * k, cu, cv, sz, px, turn);
        if (x < -otherPx || y < -otherPx || x > px + otherPx || y > px + otherPx) continue;
        g.strokeStyle = "rgba(0,0,0,0.6)"; g.lineWidth = 3 * w; g.beginPath(); g.arc(x, y, otherPx, 0, 2 * Math.PI); g.stroke();
        g.strokeStyle = others[o.i].colour; g.lineWidth = 1.5 * w; g.beginPath(); g.arc(x, y, otherPx, 0, 2 * Math.PI); g.stroke();
      }
      g.strokeStyle = "rgba(0,0,0,0.6)"; g.lineWidth = 2 * w; g.beginPath(); g.arc(px / 2, px / 2, markerPx + 1.5 * w, 0, 2 * Math.PI); g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.95)"; g.lineWidth = 2 * w; g.beginPath(); g.arc(px / 2, px / 2, markerPx, 0, 2 * Math.PI); g.stroke();
      if (opts.scaleM) {
        // The bar, bottom left, with its length beside it.
        const L = (opts.scaleM / windowM) * px, x0 = 10, y0 = px - 12;
        g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect(x0 - 4, y0 - 15, L + 50, 22);
        g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.moveTo(x0, y0 - 4); g.lineTo(x0, y0); g.lineTo(x0 + L, y0); g.lineTo(x0 + L, y0 - 4); g.stroke();
        g.fillStyle = "#fff"; g.font = "11px sans-serif"; g.fillText(`${Math.round(opts.scaleM * 100)} cm`, x0 + L + 6, y0 + 1);
      }
      const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.88 });
      out.push({ ...v, url: URL.createObjectURL(blob), widthM: windowM, markerPx, px, ...(turn ? { turned: turn } : {}), ...(aligned !== undefined ? { aligned } : {}) });
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
