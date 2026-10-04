// Step three of the engine: a shape the mosaic flagged, and the original
// photos to check for it. Pure; the scan stores the short form, the map
// lights up the chosen photos' positions, and the closer-look viewer shows
// them.
import type { LatLng2 } from "../geo";
import { chipSpanM } from "../weedScout/candidates";
import type { Candidate, SourceImages } from "../weedScout/types";
import { lookupOriginal } from "./manifest";
import type { LatLngAlt } from "./odm";
import type { ScanSources } from "./sources";
import { type AreaView, coverZone, nearestViews, selectFramesForArea } from "./select";

/** Outline vertices sent through the projection; a region's ring is thinned to this. */
const MAX_OUTLINE_POINTS = 64;
/** A point finding is looked at as a square this many metres across, at least. */
const MIN_POINT_SPAN_M = 3;

export type SpotSources = {
  /** Why there is nothing to show, when there is nothing. */
  unavailable: "no reconstruction" | "no ground height" | "not seen by any photo" | null;
  /** Every photo that holds part of the shape, best first. */
  views: AreaView[];
  /** The photos to check: the fewest that together hold the whole shape (see coverZone). */
  chosen: AreaView[];
  /** True when no photo was found to hold the shape and `chosen` is the nearest photos instead. */
  nearestOnly: boolean;
  /** The chosen photos whose originals were kept, so they can be opened. */
  lookable: AreaView[];
  /** Whether any originals were kept for this scan at all, matching or not. */
  originalsKept: boolean;
  /** Camera-native over uploaded size. Null when EXIF did not say. */
  nativeScale: number | null;
  /** Map detail and photo detail at this shape, metres per pixel. */
  orthoGsdM: number | null;
  nativeGsdM: number | null;
  /** The outline on the ground, for drawing it over a photo. */
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

/** The short form the scan stores on each shape. */
export function sourceImagesOf(spot: SpotSources): SourceImages | null {
  if (spot.unavailable === "no reconstruction" || spot.unavailable === "no ground height") return null;
  const best = spot.views[0] ?? null;
  return {
    photos: spot.views.length,
    best: best?.filename ?? null,
    coverage: best?.coverage ?? null,
    chosen: spot.chosen.map(v => v.filename),
    nearestOnly: spot.nearestOnly,
    kept: spot.lookable.length > 0,
  };
}

/** One line for the run's notes: did step three find the photos. */
export function sourceImagesNote(candidates: readonly { sourceImages?: SourceImages | null }[], sources: ScanSources | null): string {
  if (!sources?.set) {
    return sources?.reconstruction === "none"
      ? "Source images: no camera positions for this scan (an imported map, or its processing archive is missing), so no shape can be matched to a photo."
      : "Source images: the camera positions had not loaded when the scan ran; run it again to match shapes to photos.";
  }
  const shapes = candidates.filter(c => c.sourceImages);
  const seen = shapes.filter(c => c.sourceImages!.photos > 0);
  const nearest = shapes.filter(c => c.sourceImages!.nearestOnly);
  const kept = shapes.filter(c => c.sourceImages!.kept);
  const whole = seen.filter(c => (c.sourceImages!.coverage ?? 0) >= 0.999);
  const counts = seen.map(c => c.sourceImages!.chosen.length);
  const range = counts.length ? (Math.min(...counts) === Math.max(...counts) ? `${counts[0]}` : `${Math.min(...counts)} to ${Math.max(...counts)}`) : "0";
  return `Source images: ${seen.length} of ${shapes.length} shapes matched to original photos; ${whole.length} held whole by one photo; ${range} photo${range === "1" ? "" : "s"} to check per shape` +
    (nearest.length ? `; ${nearest.length} not held by any photo, given the nearest instead. ` : ". ") +
    (kept.length ? `${kept.length} can be opened at full resolution.` : "None can be opened: the originals were not kept for this scan.");
}

/**
 * A shape the operator drew or applied, as the candidate step three reads:
 * its ring is the outline, its centroid the centre. Nothing else is claimed
 * about it, so the closer look works on a hand-marked area exactly as on a
 * scout spot.
 */
export function ringCandidate(id: string, ring: LatLng2[]): Candidate {
  const n = ring.length || 1;
  const centroid = { lat: ring.reduce((s, p) => s + p.lat, 0) / n, lng: ring.reduce((s, p) => s + p.lng, 0) / n };
  return {
    id, tileId: "", centroid, kind: "not-average region", score: 0,
    distanceToRowM: null, rowConfidence: null, anomalyZ: null, anomalyFeature: null, blobZ: null, blobZFeature: null,
    blob: null, areaM2: 0, feedback: null, estimate: null, prediction: null, chip: null, chipSpanM: null, chipGsdM: null,
    region: ring.length >= 3
      ? { id, tileIds: [], rings: [ring], centroid, areaM2: 0, tileCount: 0, coreTiles: 0, meanStrength: 0, maxStrength: 0, meanFieldZ: [], drivers: [], klass: "different from the field" }
      : null,
  };
}

export function spotSources(sources: ScanSources | null, c: Candidate): SpotSources {
  const empty = (why: SpotSources["unavailable"]): SpotSources =>
    ({ unavailable: why, views: [], chosen: [], nearestOnly: false, lookable: [], originalsKept: !!sources?.frames && Object.keys(sources.frames).length > 0, nativeScale: null, orthoGsdM: c.chipGsdM, nativeGsdM: null, outline: [] });
  if (!sources?.set) return empty("no reconstruction");
  if (sources.groundAltM == null) return empty("no ground height");
  const outline = findingOutline(c, sources.groundAltM);
  const centre = { ...c.centroid, altM: sources.groundAltM };
  const views = selectFramesForArea(sources.set, outline, centre);
  // No photo holds any of it: offer the nearest photos, and say they are only that.
  const nearestOnly = views.length === 0;
  const chosen = nearestOnly ? nearestViews(sources.set, centre, outline) : coverZone(views);
  if (!chosen.length) return { ...empty("not seen by any photo"), outline };
  const meta = sources.set.images[chosen[0].filename];
  const nativeScale = meta?.exifWidth && meta.width ? meta.exifWidth / meta.width : null;
  return {
    unavailable: null,
    views,
    chosen,
    nearestOnly,
    lookable: chosen.filter(v => lookupOriginal(sources.frames, v.filename).ok),
    originalsKept: !!sources.frames && Object.keys(sources.frames).length > 0,
    nativeScale,
    orthoGsdM: c.chipGsdM,
    nativeGsdM: nativeScale && chosen[0].gsdM ? chosen[0].gsdM / nativeScale : null,
    outline,
  };
}
