// annotationFromCandidate: a Weed Scout candidate becomes exactly the shape
// a hand-drawn user_annotations row already has - no new fields, no rate.
import { describe, expect, it } from "vitest";
import { M_PER_DEG_LAT, mPerDegLng, polygonAreaM2 } from "@/lib/geo";
import { annotationFromCandidate } from "@/lib/weedScout/applyToField";
import type { Candidate, Estimate, RegionClass } from "@/lib/weedScout/types";

const LAT0 = 38.95, LNG0 = -77.45;

const estimate = (summary: string, positionNote = "Sits well outside the row."): Estimate => ({
  model: "swathwise-inhouse-v1", summary, sizeClass: "small", habit: null, colourNote: null,
  positionNote, seasonNote: "Captured in autumn.", whatWouldConfirm: [], caveats: [],
});

const basePlant = (overrides: Partial<Candidate> = {}): Candidate => ({
  id: "c-1", tileId: "t1", centroid: { lat: LAT0, lng: LNG0 },
  kind: "off-row vegetation", score: 0.8,
  distanceToRowM: 0.3, rowConfidence: 0.9,
  anomalyZ: null, anomalyFeature: null, blobZ: null, blobZFeature: null,
  blob: {
    id: "b1", tileId: "t1", centroid: { lat: LAT0, lng: LNG0 },
    areaM2: 0.02, equivDiameterM: 0.16, widthM: 0.16, heightM: 0.16, extent: 0.7,
    chromaR: 0.3, chromaG: 0.5, chromaB: 0.2, exgMean: 0.2, brightness: 90,
    gsdM: 0.02, touchesBorder: false,
  },
  region: null, areaM2: 0.02, feedback: null,
  estimate: estimate("A small plant between the fitted rows."),
  chip: null, chipSpanM: null, chipGsdM: null,
  ...overrides,
});

const baseRegion = (klass: RegionClass): Candidate => {
  const ring = [
    { lat: LAT0 + 0.0001, lng: LNG0 - 0.0001 }, { lat: LAT0 + 0.0001, lng: LNG0 + 0.0001 },
    { lat: LAT0 - 0.0001, lng: LNG0 + 0.0001 }, { lat: LAT0 - 0.0001, lng: LNG0 - 0.0001 },
  ];
  const areaM2 = polygonAreaM2(ring);
  return {
    id: "c-r1", tileId: "t1", centroid: { lat: LAT0, lng: LNG0 },
    kind: "not-average region", score: 0.6,
    distanceToRowM: null, rowConfidence: null, anomalyZ: 4.2, anomalyFeature: "vegetation fraction",
    blobZ: null, blobZFeature: null, blob: null,
    region: {
      id: "r1", tileIds: ["t1"], rings: [ring], centroid: { lat: LAT0, lng: LNG0 },
      areaM2, tileCount: 4, coreTiles: 4, meanStrength: 4.2, maxStrength: 4.5,
      meanFieldZ: new Array(9).fill(0), drivers: [{ feature: "vegetation fraction", z: -4.2, scale: "field" }],
      klass,
    },
    areaM2, feedback: null,
    estimate: estimate(`A ${klass} area.`, "irrelevant for a region"),
    chip: null, chipSpanM: null, chipGsdM: null,
  };
};

describe("annotationFromCandidate: the row Field View and the Planner already understand", () => {
  it("uses a region's own ring and area directly", () => {
    const c = baseRegion("bare or dry ground");
    const a = annotationFromCandidate(c);
    expect(a.ring).toBe(c.region!.rings[0]);
    expect(a.areaHa).toBeCloseTo(c.areaM2 / 10_000, 10);
    expect(a.issue_type).toBe("Bare soil");
    expect(a.name).toContain("bare or dry ground");
    expect(a.notes).toContain("bare or dry ground");
  });

  it("maps region classes to the same issue vocabulary a hand-drawn polygon uses", () => {
    expect(annotationFromCandidate(baseRegion("dark ground (wet, shadow or residue)")).issue_type).toBe("Waterlogging");
    expect(annotationFromCandidate(baseRegion("thin stand")).issue_type).toBe("Bare soil");
    expect(annotationFromCandidate(baseRegion("dense vegetation")).issue_type).toBe("Other");
  });

  it("maps plant kinds to Weed pressure, and anything else to Other", () => {
    expect(annotationFromCandidate(basePlant({ kind: "off-row vegetation" })).issue_type).toBe("Weed pressure");
    expect(annotationFromCandidate(basePlant({ kind: "vegetation outlier" })).issue_type).toBe("Weed pressure");
    expect(annotationFromCandidate(basePlant({ kind: "off-row and outlier" })).issue_type).toBe("Weed pressure");
    expect(annotationFromCandidate(basePlant({ kind: "field outlier", blob: null })).issue_type).toBe("Other");
  });

  it("builds a small square ring around a point candidate, sized like its chip, with a matching area", () => {
    const c = basePlant();
    const a = annotationFromCandidate(c);
    expect(a.ring.length).toBe(4);
    // Roughly centred on the candidate.
    const meanLat = a.ring.reduce((s, p) => s + p.lat, 0) / 4;
    const meanLng = a.ring.reduce((s, p) => s + p.lng, 0) / 4;
    expect(meanLat).toBeCloseTo(LAT0, 5);
    expect(meanLng).toBeCloseTo(LNG0, 5);
    // The reported area matches the ring's own geodesic area (no separate,
    // possibly-disagreeing number invented for storage).
    expect(a.areaHa).toBeCloseTo(polygonAreaM2(a.ring) / 10_000, 10);
    // A 16 cm blob's chip span is at least a couple of metres across.
    const side = Math.hypot(
      (a.ring[1].lng - a.ring[0].lng) * mPerDegLng(LAT0),
      (a.ring[1].lat - a.ring[0].lat) * M_PER_DEG_LAT,
    );
    expect(side).toBeGreaterThan(0.5);
  });

  it("carries the in-house estimate into notes, and marks itself experimental", () => {
    const a = annotationFromCandidate(basePlant());
    expect(a.notes).toContain("A small plant between the fitted rows.");
    expect(a.notes).toContain("Sits well outside the row.");
    expect(a.notes.toLowerCase()).toContain("experimental");
    expect(a.notes.length).toBeLessThanOrEqual(480);
  });

  it("never claims red as the colour of what it does not know", () => {
    // The colour is a display choice, not a severity claim - it never varies
    // with score or kind, which would fabricate confidence this app does not
    // have (see the decision-support house rule).
    expect(annotationFromCandidate(basePlant({ score: 0.99 })).color).toBe("orange");
    expect(annotationFromCandidate(baseRegion("bare or dry ground")).color).toBe("orange");
  });
});
