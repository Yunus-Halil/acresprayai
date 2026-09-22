// The one place a marked shape becomes a planned shape and an area.
//
// This test exists because two screens now quote the same acreage: the Flight
// Planner, which prices the chemical, and the Weed Scout results screen, which
// tells the operator what the scan found. Before the extraction they could not
// agree — the planner ignores the area stored on an annotation row and
// recomputes it after insetting the ring, so any scout-side sum of stored
// areas was out by the whole headland bite on every zone wide enough to take
// one. These cases pin the transformation so the two cannot drift apart again.
import { describe, expect, it } from "vitest";
import { M_PER_DEG_LAT, type LatLng2, mPerDegLng, polygonAreaM2 } from "@/lib/geo";
import { DEFAULT_HEADLAND_M, MAX_HEADLAND_M } from "@/lib/headland";
import {
  clampHeadlandM, plannedAreaM2, plannedZones, zonesInsideBoundary,
} from "@/lib/treatment/plannedArea";

const LAT0 = 38.95, LNG0 = -77.45;

/** A square of `sideM` metres centred on a point, the shape a Weed Scout plant spot writes. */
function square(centre: LatLng2, sideM: number): LatLng2[] {
  const half = sideM / 2;
  const dLat = half / M_PER_DEG_LAT;
  const dLng = half / mPerDegLng(centre.lat);
  return [
    { lat: centre.lat + dLat, lng: centre.lng - dLng },
    { lat: centre.lat + dLat, lng: centre.lng + dLng },
    { lat: centre.lat - dLat, lng: centre.lng + dLng },
    { lat: centre.lat - dLat, lng: centre.lng - dLng },
  ];
}

/** A 200 m field, big enough to hold everything below well clear of its edge. */
const BOUNDARY: LatLng2[][] = [square({ lat: LAT0, lng: LNG0 }, 200)];

describe("zonesInsideBoundary", () => {
  it("keeps a zone whose centroid is inside and drops one whose centroid is outside", () => {
    const inside = { id: "in", ring: square({ lat: LAT0, lng: LNG0 }, 4) };
    // 150 m north of centre: outside a 200 m square's 100 m half-width.
    const outside = { id: "out", ring: square({ lat: LAT0 + 150 / M_PER_DEG_LAT, lng: LNG0 }, 4) };
    const kept = zonesInsideBoundary([inside, outside], BOUNDARY);
    expect(kept.map(z => z.id)).toEqual(["in"]);
  });

  it("drops a ring with fewer than three points, and everything when there is no boundary", () => {
    const degenerate = { id: "d", ring: [{ lat: LAT0, lng: LNG0 }, { lat: LAT0, lng: LNG0 }] };
    expect(zonesInsideBoundary([degenerate], BOUNDARY)).toEqual([]);
    const fine = { id: "f", ring: square({ lat: LAT0, lng: LNG0 }, 4) };
    expect(zonesInsideBoundary([fine], null)).toEqual([]);
    expect(zonesInsideBoundary([fine], [])).toEqual([]);
  });
});

describe("plannedZones: what the planner will actually say", () => {
  it("leaves a small spot's square alone, because the headland cannot fit inside it", () => {
    // A Weed Scout plant spot is chip-sized: 2 m across, narrower than twice
    // the 3 m headland, so the inset is waived and the ring is untouched.
    const ring = square({ lat: LAT0, lng: LNG0 }, 2);
    const [planned] = plannedZones([{ id: "spot", ring }], BOUNDARY, DEFAULT_HEADLAND_M);
    expect(planned.headland.kind).toBe("waived");
    expect(planned.ring).toBe(ring);
    expect(planned.areaM2).toBeCloseTo(Math.abs(polygonAreaM2(ring)), 6);
    expect(planned.areaM2).toBeCloseTo(4, 0);
  });

  it("insets a wide region, so the planner reports less ground than the raw ring holds", () => {
    // 40 m across: comfortably wider than twice the headland, so it is inset.
    const ring = square({ lat: LAT0, lng: LNG0 }, 40);
    const raw = Math.abs(polygonAreaM2(ring));
    const [planned] = plannedZones([{ id: "region", ring }], BOUNDARY, DEFAULT_HEADLAND_M);
    expect(planned.headland.kind).toBe("applied");
    expect(planned.areaM2).toBeLessThan(raw);
    // 40 m square held back 3 m a side is a 34 m square.
    expect(planned.areaM2).toBeCloseTo(34 * 34, -1);
  });

  it("a spot centred outside the boundary contributes nothing at all", () => {
    const outside = square({ lat: LAT0 + 150 / M_PER_DEG_LAT, lng: LNG0 }, 4);
    const planned = plannedZones([{ id: "gone", ring: outside }], BOUNDARY, DEFAULT_HEADLAND_M);
    expect(planned).toEqual([]);
    expect(plannedAreaM2(planned)).toBe(0);
  });

  it("scales a carried area rather than re-measuring it, for a zone that has one", () => {
    // A grid zone knows its true clipped-cell area; ring geometry cannot
    // reproduce it, so the headland takes a proportional bite instead.
    const ring = square({ lat: LAT0, lng: LNG0 }, 40);
    const carried = 1234;
    const [planned] = plannedZones([{ id: "grid", ring, areaM2: carried, source: "grid" as const }], BOUNDARY, DEFAULT_HEADLAND_M);
    expect(planned.headland.kind).toBe("applied");
    expect(planned.areaM2).toBeLessThan(carried);
    // The same ratio the ring lost, applied to the number the zone brought.
    const scale = planned.areaM2 / carried;
    const ringScale = Math.abs(polygonAreaM2(planned.ring)) / Math.abs(polygonAreaM2(ring));
    expect(scale).toBeCloseTo(ringScale, 6);
  });

  it("with the headland off, a zone keeps its full extent", () => {
    const ring = square({ lat: LAT0, lng: LNG0 }, 40);
    const [planned] = plannedZones([{ id: "z", ring }], BOUNDARY, 0);
    expect(planned.headland.kind).toBe("waived");
    expect(planned.areaM2).toBeCloseTo(Math.abs(polygonAreaM2(ring)), 6);
  });

  it("passes the caller's own fields through untouched", () => {
    const ring = square({ lat: LAT0, lng: LNG0 }, 2);
    const [planned] = plannedZones(
      [{ id: "z", ring, source: "user" as const, severity: "medium", rateLha: 25 }],
      BOUNDARY, DEFAULT_HEADLAND_M,
    );
    expect(planned.severity).toBe("medium");
    expect(planned.rateLha).toBe(25);
    expect(planned.id).toBe("z");
  });

  it("sums to the ground the plan covers", () => {
    const zones = [
      { id: "a", ring: square({ lat: LAT0, lng: LNG0 }, 2) },
      { id: "b", ring: square({ lat: LAT0 + 20 / M_PER_DEG_LAT, lng: LNG0 }, 2) },
    ];
    const planned = plannedZones(zones, BOUNDARY, DEFAULT_HEADLAND_M);
    expect(planned.length).toBe(2);
    expect(plannedAreaM2(planned)).toBeCloseTo(8, 0);
  });
});

describe("clampHeadlandM", () => {
  it("defaults when unset and never exceeds what the planner allows", () => {
    expect(clampHeadlandM(null)).toBe(DEFAULT_HEADLAND_M);
    expect(clampHeadlandM(undefined)).toBe(DEFAULT_HEADLAND_M);
    expect(clampHeadlandM(0)).toBe(0);
    expect(clampHeadlandM(-5)).toBe(0);
    expect(clampHeadlandM(5)).toBe(5);
    expect(clampHeadlandM(MAX_HEADLAND_M + 100)).toBe(MAX_HEADLAND_M);
  });

  it("is applied inside plannedZones, so no caller can plan against a headland the planner would not use", () => {
    const ring = square({ lat: LAT0, lng: LNG0 }, 100);
    const [huge] = plannedZones([{ id: "z", ring }], BOUNDARY, 9999);
    const [capped] = plannedZones([{ id: "z", ring }], BOUNDARY, MAX_HEADLAND_M);
    expect(huge.areaM2).toBeCloseTo(capped.areaM2, 6);
  });
});
