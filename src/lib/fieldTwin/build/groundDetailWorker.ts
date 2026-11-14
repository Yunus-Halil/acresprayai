// Photo ground detail on demand: the tiles over the view on screen, cut from the flight's own photographs on this device
// at their full resolution, photograph by photograph (each decoded once). Nothing is stored or uploaded; the page keeps
// the tiles for as long as it is open.
import { type GroundImage, groundCams, renderPhotoMajor } from "../photoGround";
import type { DetailMessage, DetailRequest } from "../photoAccess";

const post = (m: DetailMessage) => (self as unknown as { postMessage: (m: DetailMessage) => void }).postMessage(m);

self.onmessage = async (e: MessageEvent<DetailRequest>) => {
  const { manifest, z, plan, files } = e.data;
  const t0 = Date.now();
  try {
    const { cams, origin } = groundCams(new Map(manifest.frames.map(f => [f.name, f])));
    const byName = new Map(files);
    // The manifest's gains are in the order of its frames; groundCams keeps that order for frames it can place.
    const gainOf = new Map(manifest.frames.map((f, i) => [f.name, manifest.gains.slice(i * 3, i * 3 + 3)]));
    const gains = Float64Array.from(cams.flatMap(c => gainOf.get(c.name) ?? [1, 1, 1]));
    const load = async (k: number): Promise<GroundImage | null> => {
      const file = byName.get(cams[k].name);
      if (!file) return null;
      const bmp = await createImageBitmap(file);
      const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(bmp, 0, 0); bmp.close();
      const d = g.getImageData(0, 0, c.width, c.height);
      return { width: d.width, height: d.height, rgba: d.data, scale: d.width / cams[k].f.intrinsics.width };
    };
    const enc = new OffscreenCanvas(256, 256), eg = enc.getContext("2d")!;
    const r = await renderPhotoMajor(cams, origin, z, plan, manifest.featherM, gains, load, async (x, y, rgba) => {
      eg.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), 256, 256), 0, 0);
      post({ type: "tile", z, x, y, blob: await enc.convertToBlob({ type: "image/jpeg", quality: 0.85 }) });
    });
    post({ type: "done", ms: Date.now() - t0, photographs: r.photographs, tiles: r.tiles });
  } catch (err) {
    post({ type: "error", message: (err as Error)?.message ?? String(err) });
  }
};
