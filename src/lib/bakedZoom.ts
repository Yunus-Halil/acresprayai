// How deep a scan's map tiles were actually baked.
//
// The map's "native" zoom must be the deepest zoom that has tiles in storage:
// past it Leaflet enlarges the last real tiles. TiTiler's maxzoom describes the
// orthophoto file, not the bake, and scans baked before 2026-10-15 stopped at
// zoom 20 whatever the file allowed; asking for zoom 21 or 22 there returned
// the tile function's transparent placeholder, and the map went blank.
import { supabase } from "@/integrations/supabase/client";
import { ORTHO_MAX_NATIVE_ZOOM } from "./orthoZoom";

/** The zoom scans were baked to before the bake depth was stored per scan. */
export const LEGACY_BAKED_ZOOM = 20;

/** The baked depth from the row, else the file's own maxzoom capped at the legacy depth. Pure. */
export function nativeZoomFor(tilesMaxZoom: number | null | undefined, tilejsonMaxZoom: number | null | undefined): number {
  if (typeof tilesMaxZoom === "number" && tilesMaxZoom > 0) return Math.min(ORTHO_MAX_NATIVE_ZOOM, tilesMaxZoom);
  const file = typeof tilejsonMaxZoom === "number" ? Math.ceil(tilejsonMaxZoom) : LEGACY_BAKED_ZOOM;
  return Math.min(LEGACY_BAKED_ZOOM, file);
}

/** The scan's stored bake depth, or null when the row has none (or cannot be read). */
export async function bakedMaxZoom(taskId: string): Promise<number | null> {
  try {
    const { data, error } = await supabase.from("odm_tasks").select("tiles_max_zoom").eq("id", taskId).maybeSingle();
    if (error || !data) return null;
    const z = (data as { tiles_max_zoom: number | null }).tiles_max_zoom;
    return typeof z === "number" ? z : null;
  } catch {
    return null;
  }
}
