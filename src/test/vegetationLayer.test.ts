// The vegetation layer shows the right things at each zoom, from the right
// source, and says their numbers in the operator's units.
import { describe, expect, it } from "vitest";
import { VEG_DETAIL_ZOOM, VEG_MEDIUM_ZOOM, clusterLine, individualLine, vegetationAtZoom, zoneLine, zoneOpacity } from "@/components/app/workspace/VegetationLayer";
import { emptyGroundStructure, type GroundCluster, type GroundIndividual, type GroundStructure, type GroundZone } from "@/lib/weedScout/structure/ground";
import { DEFAULT_STRUCTURE_PARAMS } from "@/lib/weedScout/structure/types";

const at = { lat: 38.9, lng: -77.5 };
const ind = (id: string, dM: number, over: Partial<GroundIndividual> = {}): GroundIndividual => ({ id, itemId: id, centroid: at, areaM2: Math.PI * (dM / 2) ** 2, equivDiameterM: dM, pixelsAcross: Math.round(dM / 0.01), kind: "off-row", rowsKnown: true, frame: "A.JPG", ...over });
const cluster: GroundCluster = { id: "k", centroid: at, hull: [at, at, at], members: ["a", "b", "c"], components: 3, canopyAreaM2: 0.12, footprintAreaM2: 0.3, boxWidthM: 0.6, boxHeightM: 0.4, maxExtentM: 0.65, plantCount: null, kinds: { offRow: 2, between: 1 }, rowsKnown: true, continuous: false, lengthM: 0.65, widthM: 0.4, frame: "A.JPG" };
const zone: GroundZone = { id: "z", col: 0, row: 0, ring: [at, at, at, at], centroid: at, cellAreaM2: 16, microAreaM2: 0.256, coverage: 0.016, count: 640, density: 40, fragments: 640, subMeasurable: 0, measurableObjects: 2, rowsKnown: true, frame: "A.JPG" };

const photos: GroundStructure = { ...emptyGroundStructure("photo", DEFAULT_STRUCTURE_PARAMS, 0.01), frames: ["A.JPG"], individuals: [ind("small", 0.08), ind("big", 0.3)], clusters: [cluster], zones: [zone] };
const map: GroundStructure = { ...emptyGroundStructure("map", DEFAULT_STRUCTURE_PARAMS, 0.04), individuals: [ind("m", 0.5, { frame: null })], clusters: [], zones: [{ ...zone, id: "mz", frame: null, coverage: 0.03 }] };

describe("vegetationAtZoom", () => {
  it("zoomed out: zones from the map, clusters, no plants", () => {
    const v = vegetationAtZoom({ map, photos }, VEG_MEDIUM_ZOOM - 1);
    expect(v.individuals).toHaveLength(0);
    expect(v.clusters).toHaveLength(1);
    expect(v.zones.map(z => z.id)).toEqual(["mz"]);
    expect(v.objectsFrom).toBe("photos");
    expect(v.zonesFrom).toBe("map");
  });
  it("medium: only plants at twice the measurable size, from the photos when there are any", () => {
    const v = vegetationAtZoom({ map, photos }, VEG_MEDIUM_ZOOM);
    expect(v.individuals.map(i => i.id)).toEqual(["big"]);
    expect(v.minMeasurableM).toBeCloseTo(0.06, 6);
    expect(v.zonesFrom).toBe("map");
  });
  it("zoomed in: every plant, and the photos' finer zones", () => {
    const v = vegetationAtZoom({ map, photos }, VEG_DETAIL_ZOOM);
    expect(v.individuals.map(i => i.id)).toEqual(["small", "big"]);
    expect(v.zones.map(z => z.id)).toEqual(["z"]);
    expect(v.zonesFrom).toBe("photos");
  });
  it("without photos the map stands in, at its own scale; without anything, nothing", () => {
    const v = vegetationAtZoom({ map, photos: null }, VEG_DETAIL_ZOOM);
    expect(v.objectsFrom).toBe("map");
    expect(v.individuals.map(i => i.id)).toEqual(["m"]);
    expect(v.minMeasurableM).toBeCloseTo(0.24, 6);
    expect(vegetationAtZoom({ map: null, photos: null }, 19)).toMatchObject({ individuals: [], clusters: [], zones: [], objectsFrom: null, zonesFrom: null, minMeasurableM: null });
  });
  it("a zone's fill grows with its coverage and fades at medium zoom", () => {
    expect(zoneOpacity(0, 15)).toBe(0.08);
    expect(zoneOpacity(0.05, 15)).toBe(0.55);
    expect(zoneOpacity(0.2, 15)).toBe(0.55);
    expect(zoneOpacity(0.05, VEG_MEDIUM_ZOOM)).toBeCloseTo(0.275, 6);
  });
});

describe("the words on hover", () => {
  it("say what each thing is, its numbers, its scale and its source, and claim no plant count for a cluster", () => {
    expect(individualLine(ind("a", 0.14), "metric", "photos", 0.01)).toBe("Plant off the row: 14.0 cm across, 154 cm², 14 px at 1.0 cm/px on the photo A.JPG.");
    expect(individualLine(ind("a", 0.14, { kind: "between plants" }), "imperial", "map", 0.04)).toMatch(/^Plant on the row, between crop plants: 5\.5 in across, 23\.9 in², 14 px at 1\.6 in\/px on the map\.$/);
    expect(individualLine(ind("a", 0.14, { rowsKnown: false, kind: null }), "metric", "map", 0.04)).toMatch(/^Vegetation \(rows unknown\)/);
    expect(clusterLine(cluster, "metric")).toBe("Cluster of 3 touching objects: canopy 1,200 cm², footprint 3,000 cm², 65.0 cm by 40.0 cm. Plant count not claimed.");
    expect(clusterLine({ ...cluster, continuous: true, components: 1, lengthM: 5, widthM: 0.3, canopyAreaM2: 1.2, footprintAreaM2: 1.5 }, "metric")).toBe("Continuous vegetation, not one plant: 500.0 cm long, 30.0 cm across, canopy 1.20 m², footprint 1.50 m². Plant count not claimed.");
    expect(zoneLine(zone, "metric", 0.06, 4)).toBe("Coverage zone, 4 m: 1.6% small vegetation (2,560 cm²), 640 fragments and objects under 6.0 cm, 40.0 per m²; 2 measurable plants counted beside them.");
  });
});
