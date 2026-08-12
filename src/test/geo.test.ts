import { describe, it, expect } from "vitest";
import {
  type LatLng2,
  M2_PER_ACRE,
  bboxOfRings,
  centroidOfRings,
  distM,
  interiorPointOfRing,
  lerp,
  m2ToAcres,
  mPerDegLng,
  pointInAnyRing,
  pointInRing,
  polygonAreaM2,
  polylineLengthM,
  principalAxisAngle,
  ringsAreaM2,
  rotateLL,
  routeInsideBoundary,
  segRingIntersections,
  segSegT,
  segmentInsideRings,
} from "@/lib/geo";

// A ~100 m square near the equator at 45°N, built from metre offsets so the
// expected area is known independently of the code under test.
function squareAt(lat: number, lng: number, sideM: number): LatLng2[] {
  const dLat = sideM / 111_320;
  const dLng = sideM / mPerDegLng(lat);
  return [
    { lat, lng },
    { lat, lng: lng + dLng },
    { lat: lat + dLat, lng: lng + dLng },
    { lat: lat + dLat, lng },
  ];
}

describe("polygonAreaM2", () => {
  it("returns 0 for degenerate rings", () => {
    expect(polygonAreaM2([])).toBe(0);
    expect(polygonAreaM2([{ lat: 1, lng: 1 }])).toBe(0);
    expect(polygonAreaM2([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }])).toBe(0);
  });

  it("measures a 100 m square to within 1%", () => {
    const area = polygonAreaM2(squareAt(45, -93, 100));
    expect(area).toBeGreaterThan(10_000 * 0.99);
    expect(area).toBeLessThan(10_000 * 1.01);
  });

  it("is independent of winding direction", () => {
    const ring = squareAt(45, -93, 100);
    expect(polygonAreaM2([...ring].reverse())).toBeCloseTo(polygonAreaM2(ring), 6);
  });

  it("works in the southern hemisphere", () => {
    const area = polygonAreaM2(squareAt(-33.9, 151.2, 200));
    expect(area).toBeGreaterThan(40_000 * 0.99);
    expect(area).toBeLessThan(40_000 * 1.01);
  });

  it("sums multi-part fields via ringsAreaM2", () => {
    const a = squareAt(45, -93, 100);
    const b = squareAt(45.01, -93.01, 100);
    expect(ringsAreaM2([a, b])).toBeCloseTo(polygonAreaM2(a) + polygonAreaM2(b), 6);
  });
});

describe("acre conversion", () => {
  it("uses the survey-acre constant", () => {
    expect(m2ToAcres(M2_PER_ACRE)).toBeCloseTo(1, 10);
  });

  // Regression guard: HistoryTab previously divided by a rounded 4047, and the
  // report PDF divided by the exact constant, so the same zone reported two
  // different acreages depending on which screen you looked at.
  it("agrees with the value the report PDF uses", () => {
    const oneHectare = 10_000;
    expect(m2ToAcres(oneHectare)).toBeCloseTo(2.4710538, 5);
  });
});

describe("pointInRing", () => {
  const sq = squareAt(45, -93, 100);

  it("detects interior points", () => {
    const c = centroidOfRings([sq]);
    expect(pointInRing(c, sq)).toBe(true);
  });

  it("rejects exterior points", () => {
    expect(pointInRing({ lat: 46, lng: -93 }, sq)).toBe(false);
    expect(pointInRing({ lat: 45, lng: -94 }, sq)).toBe(false);
  });

  it("searches every ring of a multi-part field", () => {
    const other = squareAt(45.5, -93.5, 100);
    const inOther = centroidOfRings([other]);
    expect(pointInAnyRing(inOther, [sq])).toBe(false);
    expect(pointInAnyRing(inOther, [sq, other])).toBe(true);
  });
});

describe("segment intersection", () => {
  it("finds the crossing parameter of two crossing segments", () => {
    const t = segSegT(
      { lat: 0, lng: -1 }, { lat: 0, lng: 1 },
      { lat: -1, lng: 0 }, { lat: 1, lng: 0 },
    );
    expect(t).toBeCloseTo(0.5, 10);
  });

  it("returns null for parallel and non-touching segments", () => {
    expect(segSegT({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 0 }, { lat: 1, lng: 1 })).toBeNull();
    expect(segSegT({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 5, lng: 5 }, { lat: 6, lng: 6 })).toBeNull();
  });

  it("crosses a ring exactly twice when the line spans it", () => {
    const sq = squareAt(45, -93, 100);
    const bb = bboxOfRings([sq]);
    const midLat = (bb.minLat + bb.maxLat) / 2;
    const ts = segRingIntersections(
      { lat: midLat, lng: bb.minLng - 0.001 },
      { lat: midLat, lng: bb.maxLng + 0.001 },
      sq,
    );
    expect(ts).toHaveLength(2);
  });
});

describe("distM / polylineLengthM", () => {
  it("measures a known 100 m offset", () => {
    const [a, , , d] = squareAt(45, -93, 100);
    expect(distM(a, d)).toBeGreaterThan(99);
    expect(distM(a, d)).toBeLessThan(101);
  });

  it("is symmetric and zero for identical points", () => {
    const a = { lat: 45, lng: -93 };
    const b = { lat: 45.001, lng: -93.001 };
    expect(distM(a, b)).toBeCloseTo(distM(b, a), 9);
    expect(distM(a, a)).toBe(0);
  });

  it("sums polyline legs", () => {
    const sq = squareAt(45, -93, 100);
    const perimeter = polylineLengthM([...sq, sq[0]]);
    expect(perimeter).toBeGreaterThan(400 * 0.99);
    expect(perimeter).toBeLessThan(400 * 1.01);
  });
});

describe("rotateLL", () => {
  it("is a no-op at zero rotation", () => {
    const c = { lat: 45, lng: -93 };
    const p = { lat: 45.001, lng: -93.001 };
    const r = rotateLL(p, c, Math.cos(0), Math.sin(0));
    expect(r.lat).toBeCloseTo(p.lat, 9);
    expect(r.lng).toBeCloseTo(p.lng, 9);
  });

  it("preserves distance from the rotation centre", () => {
    const c = { lat: 45, lng: -93 };
    const p = { lat: 45.002, lng: -93.003 };
    const a = 0.7;
    const r = rotateLL(p, c, Math.cos(a), Math.sin(a));
    // Rotation is exact in the local metric frame; the residual is the
    // flat-earth frame mismatch (rotateLL scales longitude at the centre
    // latitude, distM at the segment midpoint). Assert relative, not absolute:
    // ~10 ppm over a few hundred metres is millimetres.
    const before = distM(c, p);
    expect(Math.abs(distM(c, r) - before) / before).toBeLessThan(1e-4);
  });
});

describe("principalAxisAngle", () => {
  it("returns ~0 for a field elongated east-west", () => {
    // 400 m wide, 50 m tall — long axis runs along longitude.
    const lat = 45, lng = -93;
    const dLat = 50 / 111_320, dLng = 400 / mPerDegLng(lat);
    const ring = [
      { lat, lng }, { lat, lng: lng + dLng },
      { lat: lat + dLat, lng: lng + dLng }, { lat: lat + dLat, lng },
    ];
    expect(Math.abs(principalAxisAngle([ring]))).toBeLessThan(0.05);
  });

  it("returns ~90deg for a field elongated north-south", () => {
    const lat = 45, lng = -93;
    const dLat = 400 / 111_320, dLng = 50 / mPerDegLng(lat);
    const ring = [
      { lat, lng }, { lat, lng: lng + dLng },
      { lat: lat + dLat, lng: lng + dLng }, { lat: lat + dLat, lng },
    ];
    expect(Math.abs(principalAxisAngle([ring]))).toBeCloseTo(Math.PI / 2, 1);
  });

  it("does not throw on an empty input", () => {
    expect(principalAxisAngle([])).toBe(0);
  });
});

describe("interiorPointOfRing", () => {
  it("uses the centroid when the field is convex", () => {
    const sq = squareAt(45, -93, 100);
    const p = interiorPointOfRing(sq)!;
    expect(p).toEqual(centroidOfRings([sq]));
  });

  it("finds an interior point when the centroid falls in a concave notch", () => {
    // C-shaped field: the vertex centroid (1.5, 1.75) sits in the notch, i.e.
    // outside the field. Returning it as a routing anchor used to send the
    // flight path across ground the drone must not cross.
    const cShape: LatLng2[] = [
      { lat: 0, lng: 0 }, { lat: 0, lng: 3 }, { lat: 1, lng: 3 }, { lat: 1, lng: 1 },
      { lat: 2, lng: 1 }, { lat: 2, lng: 3 }, { lat: 3, lng: 3 }, { lat: 3, lng: 0 },
    ];
    expect(pointInRing(centroidOfRings([cShape]), cShape)).toBe(false);
    const p = interiorPointOfRing(cShape)!;
    expect(p).not.toBeNull();
    expect(pointInRing(p, cShape)).toBe(true);
  });

  it("returns null for a degenerate ring", () => {
    expect(interiorPointOfRing([{ lat: 0, lng: 0 }])).toBeNull();
  });
});

describe("routeInsideBoundary", () => {
  const cShape: LatLng2[] = [
    { lat: 0, lng: 0 }, { lat: 0, lng: 3 }, { lat: 1, lng: 3 }, { lat: 1, lng: 1 },
    { lat: 2, lng: 1 }, { lat: 2, lng: 3 }, { lat: 3, lng: 3 }, { lat: 3, lng: 0 },
  ];

  it("leaves an already-inside leg untouched", () => {
    const a = { lat: 0.5, lng: 0.5 };
    const b = { lat: 0.5, lng: 2.5 };
    const { path, fullyInside } = routeInsideBoundary(a, b, [cShape]);
    expect(path).toEqual([a, b]);
    expect(fullyInside).toBe(true);
  });

  it("detours around a concave notch and stays inside the whole way", () => {
    const a = { lat: 0.5, lng: 2.5 };
    const b = { lat: 2.5, lng: 2.5 };
    const { path, fullyInside } = routeInsideBoundary(a, b, [cShape]);
    expect(path.length).toBeGreaterThan(2);
    expect(fullyInside).toBe(true);
    for (let i = 1; i < path.length; i++) {
      expect(segmentInsideRings(path[i - 1], path[i], [cShape])).toBe(true);
    }
  });

  it("reports fullyInside=false rather than pretending an impossible route is safe", () => {
    const a = { lat: 0.5, lng: 0.5 };
    const outside = { lat: 50, lng: 50 };
    const { path, fullyInside } = routeInsideBoundary(a, outside, [cShape]);
    expect(fullyInside).toBe(false);
    expect(path[path.length - 1]).toEqual(outside);
  });
});

describe("lerp", () => {
  it("hits both endpoints and the midpoint", () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 10, lng: 20 };
    expect(lerp(a, b, 0)).toEqual(a);
    expect(lerp(a, b, 1)).toEqual(b);
    expect(lerp(a, b, 0.5)).toEqual({ lat: 5, lng: 10 });
  });
});
