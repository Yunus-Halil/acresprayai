import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "@geoman-io/leaflet-geoman-free";

export type DraftPolygon = { ring: { lat: number; lng: number }[]; areaHa: number };

/** Lets the user draw a single polygon. On finish, calls onComplete with the
 * ring + area (ha). Caller is expected to immediately turn drawing off and
 * open a form modal. Map panning stays enabled the entire time. */
export default function UserPolygonTool({
  active, onComplete,
}: {
  active: boolean;
  onComplete: (p: DraftPolygon) => void;
}) {
  const map = useMap();
  useEffect(() => {
    if (!active) return;
    const pmAny = (map as any).pm;
    if (!pmAny) return;
    try { map.dragging.enable(); map.scrollWheelZoom.enable(); } catch { /* noop */ }
    try {
      pmAny.enableDraw("Polygon", {
        snappable: true, snapDistance: 12, allowSelfIntersection: false,
        continueDrawing: false,
        templineStyle: { color: "#fb923c", weight: 2, dashArray: "4 4" },
        hintlineStyle: { color: "#fb923c", dashArray: "3 5" },
        pathOptions: { color: "#fb923c", weight: 2, fillColor: "#fb923c", fillOpacity: 0.15 },
      });
    } catch { /* noop */ }
    const handler = (e: any) => {
      const layer = e.layer as L.Polygon;
      const ll = (layer.getLatLngs()[0] as L.LatLng[]).map(p => ({ lat: p.lat, lng: p.lng }));
      // shoelace-ish via Leaflet's geodesic area helper
      const areaM2 = (L as any).GeometryUtil?.geodesicArea
        ? (L as any).GeometryUtil.geodesicArea(layer.getLatLngs()[0])
        : roughArea(ll);
      try { layer.remove(); } catch { /* noop */ }
      onComplete({ ring: ll, areaHa: Math.abs(areaM2) / 10000 });
    };
    map.on("pm:create", handler);
    return () => {
      map.off("pm:create", handler);
      try { pmAny.disableDraw(); } catch { /* noop */ }
    };
  }, [active, map, onComplete]);
  return null;
}

function roughArea(ring: { lat: number; lng: number }[]) {
  // equirectangular projection — accurate enough for a few-hectare polygon
  if (ring.length < 3) return 0;
  const R = 6378137;
  const lat0 = (ring[0].lat * Math.PI) / 180;
  const xs = ring.map(p => R * (p.lng * Math.PI / 180) * Math.cos(lat0));
  const ys = ring.map(p => R * (p.lat * Math.PI / 180));
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    s += xs[i] * ys[j] - xs[j] * ys[i];
  }
  return Math.abs(s) / 2;
}