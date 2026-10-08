// The planting pattern on the map: faint row lines per block, and the crop
// plants as small dots once the map is close enough for a dot to mean a
// plant. Nothing here is interactive; the findings sit on top and take the
// clicks. The explanation the grower never has to read.
import { useState } from "react";
import { CircleMarker, Polyline, useMapEvents } from "react-leaflet";
import type { FieldPattern } from "@/lib/weedScout/fieldPattern";

/** Below this zoom a plant dot is smaller than a pixel's worth of meaning, and tens of thousands of them cost frames. */
export const PLANT_DOT_ZOOM = 19;
/** The most row lines drawn at once; a huge field past this shows its lines where the map is looking. */
export const MAX_LINES = 6000;
export const MAX_PLANTS = 20_000;

export function PatternLayer({ pattern, visible }: { pattern: FieldPattern | null; visible: boolean }) {
  const [zoom, setZoom] = useState<number | null>(null);
  const map = useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const z = zoom ?? map.getZoom();
  if (!pattern || !visible) return null;
  const lines = pattern.lines.length > MAX_LINES ? pattern.lines.slice(0, MAX_LINES) : pattern.lines;
  const showPlants = z >= PLANT_DOT_ZOOM;
  const plants = showPlants ? pattern.plants.filter(p => p.cls === "on pattern").slice(0, MAX_PLANTS) : [];
  return (
    <>
      {lines.map((l, i) => (
        <Polyline key={`row-${i}`} positions={[[l.points[0].lat, l.points[0].lng], [l.points[1].lat, l.points[1].lng]]} interactive={false}
          pathOptions={{ color: "#ffeb3b", weight: 1, opacity: 0.55 }} />
      ))}
      {plants.map(p => (
        <CircleMarker key={p.id} center={[p.centroid.lat, p.centroid.lng]} radius={2} interactive={false}
          pathOptions={{ color: "#4CAF50", weight: 1, fillColor: "#4CAF50", fillOpacity: 0.5, opacity: 0.8 }} />
      ))}
    </>
  );
}
