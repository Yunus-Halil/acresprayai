// Step two of the two-step look: a finding the orthomosaic flagged, and the
// original photographs that show that same area up close. Pure; the popup
// prints it and the closer-look viewer draws it.
import type { LatLng2 } from "../geo";
import { chipSpanM } from "../weedScout/candidates";
import type { Candidate } from "../weedScout/types";
import type { LatLngAlt } from "./odm";
import type { ScanSources } from "./scan";
import { type AreaView, selectFramesForArea } from "./select";

/** Outline vertices sent through the projection; a region's ring is thinned to this. */
const MAX_OUTLINE_POINTS = 64;
/** A point finding is looked at as a square this many metres across, at least. */
const MIN_POINT_SPAN_M = 3;

export type SpotSources = {
  /** Why there is nothing to show, when there is nothing. */
  unavailable: "no reconstruction" | "no ground height" | "not seen by any photo" | null;
  /** Every photograph that holds part of the area, best first. */
  views: AreaView[];
  /** Up to three of them whose originals were kept, best first. */
  lookable: AreaView[];
  /** Camera-native over uploaded size. Null when EXIF did not say. */
  nativeScale: number | null;
  /** Map detail and photo detail at this finding, metres per pixel. */
  orthoGsdM: number | null;
  nativeGsdM: number | null;
  /** The outline on the ground, for drawing it over a photograph. */
  outline: LatLngAlt[];
};

/** The area a finding covers: its region's outer ring, or a square around a point. */
export function findingOutline(c: Candidate, groundAltM: number): LatLngAlt[] {
  const ring: LatLng2[] | undefined = c.region?.rings[0];
  if (ring && ring.length >= 3) {
    const step = Math.max(1, Math.ceil(ring.length / MAX_OUTLINE_POINTS));
    return ring.filter((_, i) => i % step === 0).map(p => ({ lat: p.lat, lng: p.lng, altM: groundAltM }));
  }
  const half = Math.max(MIN_POINT_SPAN_M, chipSpanM(c)) / 2;
  const dLat = half / 111_320, dLng = half / (111_320 * Math.cos((c.centroid.lat * Math.PI) / 180));
  const { lat, lng } = c.centroid;
  return [
    { lat: lat + dLat, lng: lng - dLng, altM: groundAltM }, { lat: lat + dLat, lng: lng + dLng, altM: groundAltM },
    { lat: lat - dLat, lng: lng + dLng, altM: groundAltM }, { lat: lat - dLat, lng: lng - dLng, altM: groundAltM },
  ];
}

export function spotSources(sources: ScanSources | null, c: Candidate): SpotSources {
  const empty = (why: SpotSources["unavailable"]): SpotSources =>
    ({ unavailable: why, views: [], lookable: [], nativeScale: null, orthoGsdM: c.chipGsdM, nativeGsdM: null, outline: [] });
  if (!sources?.set) return empty("no reconstruction");
  if (sources.groundAltM == null) return empty("no ground height");
  const outline = findingOutline(c, sources.groundAltM);
  const views = selectFramesForArea(sources.set, outline, { ...c.centroid, altM: sources.groundAltM });
  if (!views.length) return { ...empty("not seen by any photo"), outline };
  const meta = sources.set.images[views[0].filename];
  const nativeScale = meta?.exifWidth && meta.width ? meta.exifWidth / meta.width : null;
  return {
    unavailable: null,
    views,
    lookable: views.filter(v => sources.frames?.[v.filename]).slice(0, 3),
    nativeScale,
    orthoGsdM: c.chipGsdM,
    nativeGsdM: nativeScale ? views[0].gsdM / nativeScale : null,
    outline,
  };
}
