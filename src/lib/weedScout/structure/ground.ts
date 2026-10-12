// A structure on the ground: the same individuals, clusters and zones in
// lat/lng, from whichever frame they were grouped in, through a projection
// the caller supplies (a photo's pose, or the field's local frame). The
// frame-independent numbers (areas, diameters, counts, accounting) are
// carried as they are; only positions and outlines are projected.
import type { LatLng2 } from "../../geo";
import type { Accounting, Cluster, Individual, Structure, StructureParams, Zone } from "./types";

export type GroundIndividual = Omit<Individual, "x" | "y"> & { centroid: LatLng2; /** The photo it was seen in, when one. */ frame?: string | null };
export type GroundCluster = Omit<Cluster, "x" | "y" | "hull"> & { centroid: LatLng2; hull: LatLng2[]; frame?: string | null };
export type GroundZone = Omit<Zone, "x0" | "y0" | "x1" | "y1"> & { ring: LatLng2[]; centroid: LatLng2; frame?: string | null };

export type GroundStructure = {
  version: string;
  params: StructureParams;
  /** Where it was read: the field map, or the original photos. */
  source: "map" | "photo";
  gsdM: number;
  minMeasurableM: number;
  /** The photos read, for the photo source. */
  frames: string[];
  individuals: GroundIndividual[];
  clusters: GroundCluster[];
  zones: GroundZone[];
  accounting: Accounting;
  notes: string[];
};

/** Hull points kept on a cluster, so a saved run stays small. */
export const MAX_HULL_POINTS = 24;

const round = (p: LatLng2): LatLng2 => ({ lat: +p.lat.toFixed(8), lng: +p.lng.toFixed(8) });

/** Carry a structure to the ground. `toLatLng` may return null for a point the projection cannot place; such an object is dropped and counted. */
export function groundStructure(s: Structure, source: GroundStructure["source"], toLatLng: (x: number, y: number) => LatLng2 | null, frame: string | null = null): GroundStructure {
  let dropped = 0;
  const individuals: GroundIndividual[] = [];
  for (const i of s.individuals) {
    const c = toLatLng(i.x, i.y);
    if (!c) { dropped++; continue; }
    const { x: _x, y: _y, ...rest } = i;
    individuals.push({ ...rest, centroid: round(c), frame });
  }
  const clusters: GroundCluster[] = [];
  for (const k of s.clusters) {
    const c = toLatLng(k.x, k.y);
    if (!c) { dropped++; continue; }
    const step = Math.max(1, Math.ceil(k.hull.length / MAX_HULL_POINTS));
    const hull = k.hull.filter((_, j) => j % step === 0).map(p => toLatLng(p.x, p.y)).filter((p): p is LatLng2 => !!p).map(round);
    const { x: _x, y: _y, hull: _h, ...rest } = k;
    clusters.push({ ...rest, centroid: round(c), hull, frame });
  }
  const zones: GroundZone[] = [];
  for (const z of s.zones) {
    const corners = [toLatLng(z.x0, z.y0), toLatLng(z.x1, z.y0), toLatLng(z.x1, z.y1), toLatLng(z.x0, z.y1)];
    const c = toLatLng((z.x0 + z.x1) / 2, (z.y0 + z.y1) / 2);
    if (!c || corners.some(p => !p)) { dropped++; continue; }
    const { x0: _a, y0: _b, x1: _c, y1: _d, ...rest } = z;
    zones.push({ ...rest, ring: (corners as LatLng2[]).map(round), centroid: round(c), frame });
  }
  const notes = [...s.notes];
  if (dropped) notes.push(`${dropped} object(s) could not be placed on the ground and were left out.`);
  return { version: s.version, params: s.params, source, gsdM: s.gsdM, minMeasurableM: s.minMeasurableM, frames: frame ? [frame] : [], individuals, clusters, zones, accounting: s.accounting, notes };
}

/** An empty structure on the ground, for a run that read nothing. */
export function emptyGroundStructure(source: GroundStructure["source"], params: StructureParams, gsdM: number): GroundStructure {
  return {
    version: "veg-structure-v1", params, source, gsdM, minMeasurableM: params.minPixelsAcross * gsdM, frames: [], individuals: [], clusters: [], zones: [],
    accounting: { totalM2: 0, cropM2: 0, individualsM2: 0, clustersM2: 0, microM2: 0, borderM2: 0, counts: { items: 0, crop: 0, individuals: 0, clusters: 0, clusterMembers: 0, micro: 0, border: 0, zones: 0 } },
    notes: [],
  };
}

/**
 * Several photos' structures as one: an object seen in two photos is kept
 * once, from the photo listed first (the caller orders by how centrally the
 * photo holds the ground). An individual or cluster within `dupM` of one
 * already kept is the same object; a zone whose centre falls inside a kept
 * zone's ring is the same ground. Accounting is summed over what is kept,
 * so nothing is counted twice.
 */
export function mergeGroundStructures(parts: GroundStructure[], dupM = 0.4): GroundStructure | null {
  if (!parts.length) return null;
  const first = parts[0];
  const out: GroundStructure = { ...emptyGroundStructure(first.source, first.params, first.gsdM), version: first.version, minMeasurableM: first.minMeasurableM, frames: [], notes: [] };
  const mLat = 111_320, mLng = 111_320 * Math.cos((first.individuals[0]?.centroid.lat ?? first.zones[0]?.centroid.lat ?? 0) * Math.PI / 180);
  const near = (a: LatLng2, b: LatLng2) => Math.hypot((a.lat - b.lat) * mLat, (a.lng - b.lng) * mLng) <= dupM;
  const inRing = (p: LatLng2, ring: LatLng2[]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
    }
    return inside;
  };
  let duplicates = 0;
  for (const p of parts) {
    out.frames.push(...p.frames);
    const acc = out.accounting;
    for (const i of p.individuals) {
      if (out.individuals.some(k => near(k.centroid, i.centroid)) || out.clusters.some(k => near(k.centroid, i.centroid))) { duplicates++; continue; }
      out.individuals.push(i); acc.individualsM2 += i.areaM2; acc.counts.individuals++; acc.totalM2 += i.areaM2;
    }
    for (const k of p.clusters) {
      if (out.clusters.some(q => near(q.centroid, k.centroid)) || out.individuals.some(q => near(q.centroid, k.centroid))) { duplicates++; continue; }
      out.clusters.push(k); acc.clustersM2 += k.canopyAreaM2; acc.counts.clusters++; acc.counts.clusterMembers += k.components; acc.totalM2 += k.canopyAreaM2;
    }
    for (const z of p.zones) {
      if (out.zones.some(q => inRing(z.centroid, q.ring))) { duplicates++; continue; }
      out.zones.push(z); acc.microM2 += z.microAreaM2; acc.counts.micro += z.count; acc.counts.zones++; acc.totalM2 += z.microAreaM2;
    }
    acc.cropM2 += p.accounting.cropM2; acc.borderM2 += p.accounting.borderM2; acc.counts.crop += p.accounting.counts.crop; acc.counts.border += p.accounting.counts.border; acc.counts.items += p.accounting.counts.items;
    acc.totalM2 += p.accounting.cropM2 + p.accounting.borderM2;
  }
  out.notes.push(`${parts.length} photo(s) read: ${out.individuals.length} individual plants, ${out.clusters.length} clusters, ${out.zones.length} coverage zones${duplicates ? `; ${duplicates} seen in a second photo were kept once` : ""}.`);
  return out;
}
