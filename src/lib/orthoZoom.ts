// How far the orthomosaic can be zoomed before it is stretched.
//
// Tiles are baked to the orthophoto's own resolution, capped at zoom 23
// (supabase/functions/bake-tiles MAX_Z_CAP): about 1.5 cm per pixel at mid
// latitudes, finer than any current scan. Below the cap TiTiler's maxzoom for
// the file decides, so a 6 cm orthophoto stops at zoom 21 and nothing is
// baked that cannot be shown. The map may zoom one level past the tiles so a
// person can look closely; beyond that the pixels are only stretched.
export const ORTHO_MAX_NATIVE_ZOOM = 23;
export const MAP_MAX_ZOOM = 24;
