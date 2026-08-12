// Endpoints and load-loop bounds. Extracted from OrthomosaicViewer.tsx.

export const PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID;
export const FN_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;
// Static pre-baked tiles live in the private `tiles` bucket and are streamed
// through the `tile` edge function. Leaflet loads them as plain <img> GETs.
export const TILE_BASE = `${FN_BASE}/tile`;
export const NDVI_BASE = `${FN_BASE}/ndvi-tile`;

// Bounds on the load loops. An unbounded retry is indistinguishable from a hang
// to the person looking at it, so every wait ends in something actionable.
export const MAX_WAIT_ATTEMPTS = 40;          // ~15 min of backed-off polling
export const MAX_BAKE_PASSES = 400;           // far above a legitimate bake
export const MAX_STALLED_BAKE_PASSES = 8;     // consecutive passes with zero progress
