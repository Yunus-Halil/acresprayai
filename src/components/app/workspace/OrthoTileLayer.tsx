// The orthomosaic's tile layer, with every tile kept on disk once downloaded
// (lib/tileCache.ts). A drop-in for react-leaflet's TileLayer: same props.
//
// Leaflet's own tiles are <img src=url>; this layer fetches the bytes through
// the cache instead and hands the <img> an object URL, so a tile seen once
// shows instantly on every later zoom, pan, visit and login refresh. Tiles
// leaving the screen abort their download.
import { createTileLayerComponent, updateGridLayer, createElementObject } from "@react-leaflet/core";
import L from "leaflet";
import type { TileLayerProps } from "react-leaflet";
import { fetchTileCached } from "@/lib/tileCache";

type TileEl = HTMLImageElement & { _abort?: AbortController; _objectUrl?: string };

export const CachedTileLayer = L.TileLayer.extend({
  createTile(this: L.TileLayer, coords: L.Coords, done: L.DoneCallback) {
    const tile = document.createElement("img") as TileEl;
    tile.alt = "";
    tile.setAttribute("role", "presentation");
    const ctrl = new AbortController();
    tile._abort = ctrl;
    const url = this.getTileUrl(coords);
    fetchTileCached(url, { signal: ctrl.signal })
      .then(blob => {
        if (ctrl.signal.aborted) return;
        const objectUrl = URL.createObjectURL(blob);
        tile._objectUrl = objectUrl;
        tile.onload = () => done(undefined, tile);
        tile.onerror = () => done(new Error("tile could not be decoded"), tile);
        tile.src = objectUrl;
      })
      .catch(err => { if (!ctrl.signal.aborted) done(err as Error, tile); });
    return tile;
  },
  _removeTile(this: L.TileLayer & { _tiles: Record<string, { el: TileEl }> }, key: string) {
    const t = this._tiles[key];
    if (t?.el) {
      t.el._abort?.abort();
      if (t.el._objectUrl) URL.revokeObjectURL(t.el._objectUrl);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- calling Leaflet's private base implementation
    (L.TileLayer.prototype as any)._removeTile.call(this, key);
  },
  // The default aborts by clearing img.src, which would cancel nothing here.
  _abortLoading(this: L.TileLayer & { _tiles: Record<string, { el: TileEl; coords: L.Coords }>; _tileZoom: number }) {
    for (const key in this._tiles) {
      const t = this._tiles[key];
      if (t.coords.z !== this._tileZoom) t.el._abort?.abort();
    }
  },
}) as unknown as new (url: string, options?: L.TileLayerOptions) => L.TileLayer;

export const OrthoTileLayer = createTileLayerComponent<L.TileLayer, TileLayerProps>(
  function createOrthoTileLayer({ url, ...options }, context) {
    const layer = new CachedTileLayer(url, options);
    return createElementObject(layer, context);
  },
  function updateOrthoTileLayer(layer, props, prevProps) {
    updateGridLayer(layer, props, prevProps);
    if (props.url != null && props.url !== prevProps.url) layer.setUrl(props.url);
  },
);
