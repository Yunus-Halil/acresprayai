// The vegetation off the pattern on the map, at the scale the map is looked
// at. Detect at the finest reliable scale, display at the most useful one:
//
//   zoomed out (under VEG_MEDIUM_ZOOM)   coverage zones as soft squares shaded by how
//                                        much of them is small vegetation, and the
//                                        clusters as footprints. No dots.
//   medium (to VEG_DETAIL_ZOOM)          the zones faint, the clusters, and the plants
//                                        at least twice the measurable size as small
//                                        rings
//   zoomed in                            every measurable plant as a ring with its size
//                                        on hover, the clusters, the photos' own finer
//                                        zones where photos were read
//
// Two sources: the field map (every blob at the map's pixel size, field
// wide) and the original photos (at theirs, where the pass read them). Plants
// and clusters come from the photos where there are any and from the map
// otherwise; zones come from the map zoomed out and from the photos zoomed
// in. Only what the map is looking at is drawn, and never more than
// VEG_MAX_MARKERS, so a field of thousands stays responsive. Nothing here is
// clicked: the findings on top take the clicks; these say their numbers on
// hover.
import { useMemo, useState } from "react";
import { CircleMarker, Polygon, Rectangle, Tooltip, useMapEvents } from "react-leaflet";
import type { LatLngBounds } from "leaflet";
import type { GroundCluster, GroundIndividual, GroundStructure, GroundZone } from "@/lib/weedScout/structure/ground";
import { type UnitSystem, fmtArea, fmtAreaCm2, fmtLengthCm } from "@/lib/units";

export const VEG_MEDIUM_ZOOM = 18;
export const VEG_DETAIL_ZOOM = 20;
export const VEG_MAX_MARKERS = 4000;
/** At medium zoom a plant is drawn only at this many times the measurable size. */
export const VEG_MEDIUM_SIZE_MULT = 2;

export const ZONE_COLOUR = "#ab47bc";
export const CLUSTER_COLOUR = "#ff7043";
export const PLANT_COLOUR = "#ef5350";
export const UNKNOWN_COLOUR = "#9e9e9e";

export type Vegetation = { map: GroundStructure | null; photos: GroundStructure | null };

/** What is drawn at a zoom, from which source. Pure, for a test. */
export function vegetationAtZoom(v: Vegetation, zoom: number): { individuals: GroundIndividual[]; clusters: GroundCluster[]; zones: GroundZone[]; objectsFrom: "photos" | "map" | null; zonesFrom: "photos" | "map" | null; minMeasurableM: number | null } {
  const objects = v.photos && (v.photos.individuals.length || v.photos.clusters.length) ? v.photos : v.map;
  const zonesSrc = zoom >= VEG_DETAIL_ZOOM && v.photos?.zones.length ? v.photos : v.map;
  const minM = objects?.minMeasurableM ?? null;
  const individuals = !objects ? [] : zoom < VEG_MEDIUM_ZOOM ? [] : zoom < VEG_DETAIL_ZOOM ? objects.individuals.filter(i => i.equivDiameterM >= VEG_MEDIUM_SIZE_MULT * objects.minMeasurableM) : objects.individuals;
  return {
    individuals, clusters: objects?.clusters ?? [], zones: zonesSrc?.zones ?? [],
    objectsFrom: objects ? objects.source === "photo" ? "photos" : "map" : null, zonesFrom: zonesSrc ? zonesSrc.source === "photo" ? "photos" : "map" : null, minMeasurableM: minM,
  };
}

/** A zone's fill: faint at a trace of coverage, solid by five percent. */
export const zoneOpacity = (coverage: number, zoom: number): number => Math.min(0.55, Math.max(0.08, coverage / 0.05 * 0.55)) * (zoom >= VEG_MEDIUM_ZOOM ? 0.5 : 1);

/** Small ground in square centimetres, larger ground in the field's unit: a cluster's canopy is not a hectare. */
export const smallArea = (m2: number, units: UnitSystem): string => (m2 < 1 ? fmtAreaCm2(m2 * 1e4, units).text : fmtArea(m2, units).text);

export function individualLine(i: GroundIndividual, units: UnitSystem, source: "photos" | "map", gsdM: number): string {
  const what = i.rowsKnown ? (i.kind === "between plants" ? "Plant on the row, between crop plants" : "Plant off the row") : "Vegetation (rows unknown)";
  return `${what}: ${fmtLengthCm(i.equivDiameterM * 100, units).text} across, ${fmtAreaCm2(i.areaM2 * 1e4, units).text}, ${i.pixelsAcross} px at ${fmtLengthCm(gsdM * 100, units).text}/px on the ${source === "photos" ? `photo${i.frame ? ` ${i.frame}` : ""}` : "map"}.`;
}

export function clusterLine(c: GroundCluster, units: UnitSystem): string {
  return `Cluster of ${c.components} touching objects${c.rowsKnown ? "" : " (rows unknown)"}: canopy ${smallArea(c.canopyAreaM2, units)}, footprint ${smallArea(c.footprintAreaM2, units)}, ${fmtLengthCm(c.boxWidthM * 100, units).text} by ${fmtLengthCm(c.boxHeightM * 100, units).text}. Plant count not claimed.`;
}

export function zoneLine(z: GroundZone, units: UnitSystem, minMeasurableM: number, cellM: number): string {
  return `Coverage zone, ${cellM} m: ${(z.coverage * 100).toFixed(z.coverage < 0.01 ? 2 : 1)}% small vegetation (${smallArea(z.microAreaM2, units)}), ${z.count.toLocaleString()} fragment${z.count === 1 ? "" : "s"} and objects under ${fmtLengthCm(minMeasurableM * 100, units).text}, ${z.density.toFixed(1)} per m²${z.measurableObjects ? `; ${z.measurableObjects} measurable plant${z.measurableObjects === 1 ? "" : "s"} counted beside them` : ""}.`;
}

export function VegetationLayer({ vegetation, visible, units }: { vegetation: Vegetation | null; visible: boolean; units: UnitSystem }) {
  const [view, setView] = useState<{ zoom: number; bounds: LatLngBounds } | null>(null);
  const map = useMapEvents({
    zoomend: () => setView({ zoom: map.getZoom(), bounds: map.getBounds() }),
    moveend: () => setView({ zoom: map.getZoom(), bounds: map.getBounds() }),
  });
  const zoom = view?.zoom ?? map.getZoom();
  const bounds = view?.bounds ?? map.getBounds();
  const shown = useMemo(() => {
    if (!vegetation || !visible) return null;
    const at = vegetationAtZoom(vegetation, zoom);
    const inView = (p: { lat: number; lng: number }) => bounds.contains([p.lat, p.lng]);
    return {
      ...at,
      individuals: at.individuals.filter(i => inView(i.centroid)).slice(0, VEG_MAX_MARKERS),
      clusters: at.clusters.filter(c => inView(c.centroid)).slice(0, VEG_MAX_MARKERS),
      zones: at.zones.filter(z => inView(z.centroid)).slice(0, VEG_MAX_MARKERS),
    };
  }, [vegetation, visible, zoom, bounds]);
  if (!shown || !vegetation) return null;
  const objects = shown.objectsFrom === "photos" ? vegetation.photos! : vegetation.map;
  const zonesSrc = shown.zonesFrom === "photos" ? vegetation.photos! : vegetation.map;
  const minM = shown.minMeasurableM ?? 0;
  return (
    <>
      {shown.zones.map(z => (
        <Rectangle key={`z-${z.frame ?? "map"}-${z.id}`} bounds={[[z.ring[0].lat, z.ring[0].lng], [z.ring[2].lat, z.ring[2].lng]]}
          pathOptions={{ color: ZONE_COLOUR, weight: 0.5, opacity: 0.4, fillColor: ZONE_COLOUR, fillOpacity: zoneOpacity(z.coverage, zoom) }}>
          <Tooltip sticky>{zoneLine(z, units, zonesSrc?.minMeasurableM ?? minM, zonesSrc?.params.cellM ?? 4)}</Tooltip>
        </Rectangle>
      ))}
      {shown.clusters.map(c => (
        <Polygon key={`k-${c.frame ?? "map"}-${c.id}`} positions={c.hull.map(p => [p.lat, p.lng] as [number, number])}
          pathOptions={{ color: CLUSTER_COLOUR, weight: 1.5, opacity: 0.9, fillColor: CLUSTER_COLOUR, fillOpacity: 0.25 }}>
          <Tooltip sticky>{clusterLine(c, units)}</Tooltip>
        </Polygon>
      ))}
      {shown.individuals.map(i => (
        <CircleMarker key={`i-${i.frame ?? "map"}-${i.id}`} center={[i.centroid.lat, i.centroid.lng]} radius={zoom >= VEG_DETAIL_ZOOM ? 4 : 3}
          pathOptions={{ color: i.rowsKnown ? PLANT_COLOUR : UNKNOWN_COLOUR, weight: 1.5, opacity: 0.9, fillOpacity: 0 }}>
          <Tooltip sticky>{individualLine(i, units, shown.objectsFrom ?? "map", objects?.gsdM ?? 0)}</Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}
