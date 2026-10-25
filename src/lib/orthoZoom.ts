// How far the orthomosaic can be zoomed before it is stretched, and how deep the analysis may read it.
//
// Tiles are baked to the orthophoto's own pixel (supabase/functions/bake-tiles reads it from the file), capped at
// zoom 26: 0.19 cm a pixel at 38° N, finer than any flight this app plans. A 6 cm orthophoto stops at zoom 21 and
// nothing is baked that cannot be shown. History: the cap was 23 until 2026-10-24, when zoom 23 (1.61 cm at
// 30.5° N) was found to cost the first corn field half its edge sharpness (photo edges 2.1 cm wide, the same ground
// at the zoom-23 pixel 3.2 cm; docs/research/orthomosaic-resolution-audit-2026-10-24.md), then 24 until 2026-10-25,
// when the whole chain was opened to the flight's own pixel. Scans baked shallower stay as they were until their
// owner deepens them (the scan panel's "Bake finer map tiles"). The map may zoom one level past the tiles so a
// person can look closely; beyond that the pixels are only stretched.
export const ORTHO_MAX_NATIVE_ZOOM = 26;
export const MAP_MAX_ZOOM = 27;

/**
 * The deepest zoom any analysis may read. Each reader picks its own pixel under it, by its method and a budget: the
 * row readers at 3-5 cm (fieldRows.ts READ_MPP, a crop profile's readGsdCm), the pattern pass at 5 cm (zoom 22 at
 * most), the field scan by its cell size and tile budget (orthoRaster.ts zoomForSampling), the sweep and chips at
 * zoom 21, the photo aligner by its step. Only the weed-hotspot read asks for the finest pixel there is, within a
 * pixel budget (HotspotFinder), so a finer map is read finer there and nowhere it would change a validated method.
 * The model's map run keeps its own cap (weedVision/mapRun.ts MAP_MAX_ZOOM).
 */
export const ANALYSIS_MAX_ZOOM = ORTHO_MAX_NATIVE_ZOOM;
