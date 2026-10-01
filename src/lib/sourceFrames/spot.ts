// What the source frames can say about one scout spot: which photographs saw
// it, which one to read it from, and how many pixels it would get there
// against the orthomosaic chip it has now. Pure; the popup only prints it.
import type { Candidate } from "../weedScout/types";
import type { ScanSources } from "./scan";
import { type FrameCandidate, selectFrames } from "./select";

export type SpotSources = {
  /** Why there is nothing to show, when there is nothing. */
  unavailable: "no reconstruction" | "no ground height" | "not seen by any frame" | null;
  views: number;
  best: FrameCandidate | null;
  /** The best frame's original exists in storage. */
  frameKept: boolean;
  /** Camera-native over uploaded: how much larger the original is. Null when EXIF did not say. */
  nativeScale: number | null;
  /** The spot's ground diameter in pixels: in the ortho chip, in the uploaded frame, in the camera's frame. */
  targetPx: { ortho: number | null; uploaded: number | null; native: number | null };
};

export function spotSources(sources: ScanSources | null, c: Candidate): SpotSources {
  const none = (why: SpotSources["unavailable"]): SpotSources =>
    ({ unavailable: why, views: 0, best: null, frameKept: false, nativeScale: null, targetPx: { ortho: null, uploaded: null, native: null } });
  if (!sources?.set) return none("no reconstruction");
  if (sources.groundAltM == null) return none("no ground height");
  const diameterM = c.blob?.equivDiameterM ?? (c.areaM2 > 0 ? 2 * Math.sqrt(c.areaM2 / Math.PI) : null);
  const r = selectFrames(sources.set, {
    centroid: { lat: c.centroid.lat, lng: c.centroid.lng, altM: sources.groundAltM },
    radiusM: diameterM ? diameterM / 2 : 0,
  });
  if (!r.best) return none("not seen by any frame");
  const meta = sources.set.images[r.best.filename];
  const nativeScale = meta?.exifWidth && meta.width ? meta.exifWidth / meta.width : null;
  return {
    unavailable: null,
    views: r.views,
    best: r.best,
    frameKept: !!sources.frames?.[r.best.filename],
    nativeScale,
    targetPx: {
      ortho: diameterM && c.chipGsdM ? diameterM / c.chipGsdM : null,
      uploaded: diameterM ? diameterM / r.best.gsdM : null,
      native: diameterM && r.best.nativeGsdM ? diameterM / r.best.nativeGsdM : null,
    },
  };
}
