// How far the orthomosaic can be zoomed before it is stretched, and how deep the analysis reads it.
//
// Tiles are baked to the orthophoto's own resolution, capped at zoom 24
// (supabase/functions/bake-tiles MAX_Z_CAP). Below the cap TiTiler's maxzoom for
// the file decides, so a 6 cm orthophoto stops at zoom 21 and nothing is baked
// that cannot be shown. The cap was 23 until 2026-10-24: zoom 23 is 1.61 cm a
// pixel at 30.5° N, and the first corn field (DJI FC300X at 25 m, 1.07 cm) lost
// half its edge sharpness to it (photo edges 2.1 cm wide, the same ground at the
// zoom-23 pixel 3.2 cm; docs/research/orthomosaic-resolution-audit-2026-10-24.md).
// Scans baked before then stay at 23 until their owner deepens them (the scan
// panel's "Bake finer tiles"). The map may zoom one level past the tiles so a
// person can look closely; beyond that the pixels are only stretched.
export const ORTHO_MAX_NATIVE_ZOOM = 24;
export const MAP_MAX_ZOOM = 25;

/**
 * The deepest zoom the analysis reads (the field scan's stitch, the treatment grid, Weed Scout's map, the photo
 * aligner), apart from what the map shows. Every one of them measures its pixel from the raster it reads, but their
 * thresholds and benchmarks were set at zoom 23 or coarser, and zoom 24 is four times the pixels in the browser.
 * Raising it is a measured change of its own, not a side effect of a finer display.
 */
export const ANALYSIS_MAX_ZOOM = 23;
