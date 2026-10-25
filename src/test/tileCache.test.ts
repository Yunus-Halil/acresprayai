// @vitest-environment node
// A tile downloaded once is kept: the cache key ignores the login token, placeholders are not kept,
// and the map's native zoom is the depth the tiles were baked to.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => { throw new Error("not in this test"); } } }));

import { LEGACY_BAKED_ZOOM, nativeZoomFor } from "@/lib/bakedZoom";
import { PLACEHOLDER_MAX_BYTES, fetchTileCached, resetTileCacheHandle, tileCacheKey } from "@/lib/tileCache";

function fakeCaches() {
  const store = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (k: string) => store.get(k)?.clone()),
    put: vi.fn(async (k: string, r: Response) => { store.set(k, r); }),
  };
  return { caches: { open: vi.fn(async () => cache) }, cache, store };
}

const png = (bytes: number) => new Response(new Uint8Array(bytes), { status: 200, headers: { "Content-Type": "image/png" } });

beforeEach(() => resetTileCacheHandle());

describe("tileCacheKey", () => {
  it("drops the token and keeps everything that names the tile's content", () => {
    const a = tileCacheKey("https://x.supabase.co/functions/v1/tile/u/20/1/2.png?token=AAA&rev=3&v=plan1");
    const b = tileCacheKey("https://x.supabase.co/functions/v1/tile/u/20/1/2.png?v=plan1&token=BBB&rev=3");
    expect(a).toBe(b);
    expect(a).not.toContain("token");
    expect(a).toContain("rev=3");
    expect(tileCacheKey("https://x/tile/u/20/1/2.png?token=A&rev=4")).not.toBe(tileCacheKey("https://x/tile/u/20/1/2.png?token=A&rev=3"));
  });
});

describe("fetchTileCached", () => {
  it("downloads a tile once and serves it from the cache under a new token", async () => {
    const { caches, store } = fakeCaches();
    const fetchImpl = vi.fn(async () => png(5000));
    const first = await fetchTileCached("https://x/tile/u/20/1/2.png?token=OLD", { fetchImpl: fetchImpl as unknown as typeof fetch, caches });
    expect(first.size).toBe(5000);
    await new Promise(r => setTimeout(r, 0));
    expect(store.size).toBe(1);
    const second = await fetchTileCached("https://x/tile/u/20/1/2.png?token=NEW", { fetchImpl: fetchImpl as unknown as typeof fetch, caches });
    expect(second.size).toBe(5000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not keep the transparent placeholder, and throws on a failed download", async () => {
    const { caches, store } = fakeCaches();
    const placeholder = vi.fn(async () => png(PLACEHOLDER_MAX_BYTES - 100));
    await fetchTileCached("https://x/tile/u/23/1/2.png?token=A", { fetchImpl: placeholder as unknown as typeof fetch, caches });
    await new Promise(r => setTimeout(r, 0));
    expect(store.size).toBe(0);
    const fail = vi.fn(async () => new Response("no", { status: 401 }));
    await expect(fetchTileCached("https://x/tile/u/20/9/9.png?token=A", { fetchImpl: fail as unknown as typeof fetch, caches })).rejects.toThrow(/401/);
  });

  it("works without Cache Storage at all", async () => {
    const fetchImpl = vi.fn(async () => png(3000));
    const blob = await fetchTileCached("https://x/tile/u/20/1/2.png?token=A", { fetchImpl: fetchImpl as unknown as typeof fetch, caches: undefined });
    expect(blob.size).toBe(3000);
  });
});

describe("nativeZoomFor", () => {
  it("uses the stored bake depth, never the file's deeper maxzoom", () => {
    expect(nativeZoomFor(20, 22)).toBe(20); // the bug: a scan baked to 20 asked for 22 and went blank
    expect(nativeZoomFor(23, 23)).toBe(23);
    expect(nativeZoomFor(24, 24)).toBe(24);
    expect(nativeZoomFor(26, 26)).toBe(26); // zoom 26 since 2026-10-25 (orthoZoom.ts)
    expect(nativeZoomFor(27, 27)).toBe(26); // never past the cap
  });
  it("falls back to the legacy bake depth when the row has none", () => {
    expect(nativeZoomFor(null, 22)).toBe(LEGACY_BAKED_ZOOM);
    expect(nativeZoomFor(null, 18.4)).toBe(19);
    expect(nativeZoomFor(undefined, null)).toBe(LEGACY_BAKED_ZOOM);
  });
});
