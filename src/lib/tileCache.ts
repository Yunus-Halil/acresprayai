// A map tile downloaded once is kept: the browser's Cache Storage, on disk,
// across zooms, visits and login refreshes.
//
// Every orthomosaic tile URL carries the session token (`?token=`, because an
// <img> cannot send a header) and the token rotates hourly, so the browser's
// own HTTP cache, keyed on the full URL, lost every tile at each refresh and
// re-downloaded the field through the tile function. Tiles are immutable per
// scan and render version (`rev`, `v` stay in the key), so the token is the
// only part of the address that does not name the content: it is stripped
// from the key. The map layer (OrthoTileLayer) and the scout's tile reader
// (orthoRaster.stitchTiles) both go through here, so one warms the other.
//
// Transparent placeholders for cells outside the coverage are not kept: they
// are a few dozen bytes, and keeping one would hide a tile baked later.
export const TILE_CACHE_NAME = "swardus-tiles-v1";
/** Responses at or under this size are the tile function's 1x1 placeholder, not imagery. */
export const PLACEHOLDER_MAX_BYTES = 200;
/** Query parameters that authenticate the request rather than name the tile. */
const AUTH_PARAMS = ["token", "apikey", "access_token"];

/** The cache key of a tile URL: the URL without its authentication parameters, parameters sorted. */
export function tileCacheKey(url: string): string {
  try {
    const u = new URL(url);
    for (const p of AUTH_PARAMS) u.searchParams.delete(p);
    u.searchParams.sort();
    return u.toString();
  } catch {
    return url;
  }
}

type CacheLike = { match(key: string): Promise<Response | undefined>; put(key: string, res: Response): Promise<void> };
type CachesLike = { open(name: string): Promise<CacheLike> };

let opened: Promise<CacheLike | null> | null = null;
function openCache(store: CachesLike | undefined): Promise<CacheLike | null> {
  if (!store) return Promise.resolve(null);
  if (!opened) opened = store.open(TILE_CACHE_NAME).catch(() => null);
  return opened;
}

/** The tile's image bytes: from the cache when held, else fetched and kept. Throws on a failed download. */
export async function fetchTileCached(
  url: string,
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch; caches?: CachesLike } = {},
): Promise<Blob> {
  const store = opts.caches ?? (typeof caches !== "undefined" ? (caches as unknown as CachesLike) : undefined);
  const cache = await openCache(store);
  const key = tileCacheKey(url);
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return await hit.blob();
    } catch { /* a broken cache entry is a miss */ }
  }
  const res = await (opts.fetchImpl ?? fetch)(url, { signal: opts.signal, mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`tile HTTP ${res.status}`);
  const blob = await res.blob();
  if (cache && blob.size > PLACEHOLDER_MAX_BYTES) {
    const headers = { "Content-Type": blob.type || "image/png" };
    void cache.put(key, new Response(blob, { headers })).catch(() => { /* quota: the tile is still shown */ });
  }
  return blob;
}

/** For tests: forget the opened cache handle. */
export function resetTileCacheHandle(): void { opened = null; }
