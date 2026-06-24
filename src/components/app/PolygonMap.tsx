import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import type { Bounds, LatLng } from "@/lib/ndvi";

// Fix default icon paths (Vite asset handling)
// @ts-expect-error - internal default icon override
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export type ZoneShape = {
  id: string;
  name: string;
  crop: string;
  ring: LatLng[];
  color?: string;
};

export type AnomalyShape = {
  id: string;
  ring: LatLng[];
  severity: "low" | "medium" | "high";
  label: string;
};

type Props = {
  height?: number;
  center: LatLng;
  overlay?: { url: string; bounds: Bounds; opacity?: number } | null;
  ndviOverlay?: { url: string; bounds: Bounds; opacity?: number } | null;
  zones: ZoneShape[];
  anomalies?: AnomalyShape[];
  drawing: boolean;
  draftRing?: LatLng[];
  onDraftComplete?: (ring: LatLng[]) => void;
  onDrawCancel?: () => void;
  onZoneClick?: (id: string) => void;
  onZoneEdit?: (id: string, ring: LatLng[]) => void;
};

const sevColor = (s: AnomalyShape["severity"]) =>
  s === "high" ? "#ef4444" : s === "medium" ? "#f59e0b" : "#10b981";

export default function PolygonMap({
  height = 520, center, overlay, ndviOverlay, zones, anomalies = [],
  draftRing = [],
  drawing, onDraftComplete, onDrawCancel, onZoneClick, onZoneEdit,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.ImageOverlay | null>(null);
  const ndviRef = useRef<L.ImageOverlay | null>(null);
  const drawnRef = useRef<L.LayerGroup | null>(null);
  const zoneLayersRef = useRef<Map<string, L.Polygon>>(new Map());

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true }).setView([center.lat, center.lng], 17);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 22, attribution: "Tiles © Esri",
    }).addTo(map);
    drawnRef.current = L.layerGroup().addTo(map);

    // Geoman global settings — snapping on by default
    map.pm.setGlobalOptions({
      snappable: true,
      snapDistance: 20,
      allowSelfIntersection: false,
      finishOn: "dblclick",
      templineStyle: { color: "#38bdf8", weight: 2, dashArray: "5 5" },
      hintlineStyle: { color: "#38bdf8", weight: 1, dashArray: "3 6" },
      pathOptions: { color: "#38bdf8", weight: 2, fillOpacity: 0.2 },
    });

    map.on("pm:create", (e: any) => {
      const layer = e.layer as L.Polygon;
      const latlngs = (layer.getLatLngs()[0] as L.LatLng[]).map(ll => ({ lat: ll.lat, lng: ll.lng }));
      // Remove Geoman's temporary layer — parent re-renders the zone after save
      map.removeLayer(layer);
      onDraftCompleteRef.current?.(latlngs);
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep latest callback refs so the persistent map listener uses fresh closures
  const onDraftCompleteRef = useRef(onDraftComplete);
  const onZoneEditRef = useRef(onZoneEdit);
  useEffect(() => { onDraftCompleteRef.current = onDraftComplete; }, [onDraftComplete]);
  useEffect(() => { onZoneEditRef.current = onZoneEdit; }, [onZoneEdit]);

  // Toggle Geoman draw mode based on `drawing` prop
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (drawing) {
      map.pm.enableDraw("Polygon", {
        snappable: true,
        snapDistance: 20,
        finishOn: "dblclick",
        allowSelfIntersection: false,
      });
    } else {
      if (map.pm.globalDrawModeEnabled()) map.pm.disableDraw();
    }
  }, [drawing]);

  // Orthomosaic overlay
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (overlayRef.current) { map.removeLayer(overlayRef.current); overlayRef.current = null; }
    if (overlay) {
      const bounds: L.LatLngBoundsExpression = [
        [overlay.bounds.south, overlay.bounds.west],
        [overlay.bounds.north, overlay.bounds.east],
      ];
      overlayRef.current = L.imageOverlay(overlay.url, bounds, { opacity: overlay.opacity ?? 1 }).addTo(map);
      map.fitBounds(bounds);
    }
  }, [overlay]);

  // NDVI overlay
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (ndviRef.current) { map.removeLayer(ndviRef.current); ndviRef.current = null; }
    if (ndviOverlay) {
      const bounds: L.LatLngBoundsExpression = [
        [ndviOverlay.bounds.south, ndviOverlay.bounds.west],
        [ndviOverlay.bounds.north, ndviOverlay.bounds.east],
      ];
      ndviRef.current = L.imageOverlay(ndviOverlay.url, bounds, { opacity: ndviOverlay.opacity ?? 0.6 }).addTo(map);
    }
  }, [ndviOverlay]);

  // Render polygons + draft
  useEffect(() => {
    const map = mapRef.current;
    const group = drawnRef.current;
    if (!map || !group) return;
    group.clearLayers();
    zoneLayersRef.current.clear();

    zones.forEach(z => {
      const color = z.color ?? "#84cc16";
      const poly = L.polygon(z.ring.map(p => [p.lat, p.lng] as [number, number]), {
        color, weight: 2, fillOpacity: 0.2,
      });
      poly.bindTooltip(`${z.name} · ${z.crop}`, { permanent: true, direction: "center", className: "zone-label" });
      if (onZoneClick) poly.on("click", (e) => { L.DomEvent.stopPropagation(e); onZoneClick(z.id); });

      // Enable in-place editing (drag vertices, drag whole shape)
      (poly as any).pm.enable({
        allowSelfIntersection: false,
        snappable: true,
        snapDistance: 20,
        draggable: true,
      });
      poly.on("pm:edit pm:dragend", () => {
        const latlngs = (poly.getLatLngs()[0] as L.LatLng[]).map(ll => ({ lat: ll.lat, lng: ll.lng }));
        onZoneEditRef.current?.(z.id, latlngs);
      });

      group.addLayer(poly);
      zoneLayersRef.current.set(z.id, poly);
    });

    anomalies.forEach(a => {
      const color = sevColor(a.severity);
      const poly = L.polygon(a.ring.map(p => [p.lat, p.lng] as [number, number]), {
        color, weight: 2, fillOpacity: 0.45, dashArray: "4 4",
      });
      poly.bindTooltip(a.label, { permanent: false, direction: "top" });
      group.addLayer(poly);
    });

    if (draftRing.length >= 3) {
      const poly = L.polygon(draftRing.map(p => [p.lat, p.lng] as [number, number]), {
        color: "#38bdf8", weight: 2, fillOpacity: 0.25, dashArray: "5 5",
      });
      group.addLayer(poly);
    }
  }, [zones, anomalies, onZoneClick, draftRing]);

  return (
    <>
      <div ref={containerRef} style={{ height, width: "100%" }} className="rounded-lg overflow-hidden border" />
      <style>{`
        .zone-label { background: rgba(0,0,0,0.65); color: white; border: none; font-size: 10px; padding: 2px 6px; border-radius: 3px; box-shadow: none; }
        .zone-label::before { display: none; }
        .leaflet-pm-tooltip { background: rgba(15,23,42,0.92); color: #f1f5f9; border: 1px solid rgba(56,189,248,0.4); font-size: 11px; padding: 4px 8px; border-radius: 4px; }
        .marker-icon.leaflet-pm-draggable { cursor: grab; }
      `}</style>
    </>
  );
}