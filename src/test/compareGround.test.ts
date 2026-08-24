// The honesty rules of the compare view, tested where they live.
//
// The properties pinned here are the ones the UI depends on to never lie:
// change statistics exist only inside the intersection of both footprints, an
// unanalyzed scan yields null (never zero), and the three analysis states —
// never ran, ran and found nothing, failed — are structurally distinct.
import { describe, expect, it } from "vitest";
import {
  abOf, analysisStateOf, centerOffsetM, clipRingToRect, compareStats,
  offsetDescription, polyAcres, rectAcres, rectIntersection, stressedAcres,
  stressedAcresWithin, togglePick,
} from "@/lib/compareGround";
import type { ScanBounds } from "@/lib/scanLayers";

const rect = (west: number, south: number, east: number, north: number): ScanBounds =>
  ({ west, south, east, north });

// ~100 m × ~100 m square at the equator.
const SQUARE_100M = [
  { lat: 0, lng: 0 },
  { lat: 0.000904, lng: 0 },
  { lat: 0.000904, lng: 0.000898 },
  { lat: 0, lng: 0.000898 },
];

describe("footprint geometry", () => {
  it("intersects two overlapping rectangles", () => {
    const r = rectIntersection(rect(0, 0, 2, 2), rect(1, 1, 3, 3));
    expect(r).toEqual(rect(1, 1, 2, 2));
  });

  it("returns null for disjoint footprints rather than a degenerate sliver", () => {
    expect(rectIntersection(rect(0, 0, 1, 1), rect(2, 2, 3, 3))).toBeNull();
    // Touching edges share no area either.
    expect(rectIntersection(rect(0, 0, 1, 1), rect(1, 0, 2, 1))).toBeNull();
  });

  it("a contained footprint intersects to itself", () => {
    expect(rectIntersection(rect(0, 0, 10, 10), rect(2, 2, 3, 3))).toEqual(rect(2, 2, 3, 3));
  });

  it("measures a hectare-scale ring in acres", () => {
    // 100 m × 100 m = 1 ha = 2.471 acres.
    expect(polyAcres(SQUARE_100M)).toBeCloseTo(2.47, 1);
  });

  it("measures a rectangle's acreage from its bounds", () => {
    const r = rect(0, 0, 0.000898, 0.000904); // same ~100 m square
    expect(rectAcres(r)).toBeCloseTo(2.47, 1);
  });
});

describe("clipping a zone to the shared footprint", () => {
  const zone = SQUARE_100M;

  it("keeps a fully-inside ring unchanged in area", () => {
    const clipped = clipRingToRect(zone, rect(-1, -1, 1, 1));
    expect(polyAcres(clipped)).toBeCloseTo(polyAcres(zone), 3);
  });

  it("halves a ring the rectangle covers half of", () => {
    // Clip to the western half of the square.
    const clipped = clipRingToRect(zone, rect(0, 0, 0.000449, 1));
    expect(polyAcres(clipped)).toBeCloseTo(polyAcres(zone) / 2, 2);
  });

  it("erases a ring entirely outside", () => {
    expect(clipRingToRect(zone, rect(5, 5, 6, 6))).toEqual([]);
  });
});

describe("change statistics never leave the overlap", () => {
  const aBounds = rect(0, 0, 0.001, 0.001);
  const bBounds = rect(0.000449, 0, 0.002, 0.001); // covers the eastern half of A

  it("counts only the stressed area inside the shared ground", () => {
    const zones = [{ ring: SQUARE_100M }];
    const overlap = rectIntersection(aBounds, bBounds)!;
    const inside = stressedAcresWithin(zones, overlap);
    // The zone sits half inside the overlap.
    expect(inside).toBeCloseTo(stressedAcres(zones) / 2, 2);
  });

  it("reports null, never zero, for a scan with no completed analysis", () => {
    const s = compareStats({ aBounds, bBounds, aZones: null, bZones: [] });
    expect(s.aStressedAc).toBeNull();
    expect(s.bStressedAc).toBe(0);
    expect(s.deltaPct).toBeNull();
  });

  it("computes a delta only when both scans are analyzed and A has a baseline", () => {
    const zones = [{ ring: SQUARE_100M }];
    const both = compareStats({ aBounds, bBounds, aZones: zones, bZones: [] });
    expect(both.deltaPct).toBeCloseTo(-100, 0);

    const noBaseline = compareStats({ aBounds, bBounds, aZones: [], bZones: zones });
    expect(noBaseline.deltaPct).toBeNull();
  });

  it("claims nothing at all when the footprints share no ground", () => {
    const s = compareStats({
      aBounds, bBounds: rect(5, 5, 6, 6),
      aZones: [{ ring: SQUARE_100M }], bZones: [{ ring: SQUARE_100M }],
    });
    expect(s.overlap).toBeNull();
    expect(s.aStressedAc).toBeNull();
    expect(s.bStressedAc).toBeNull();
    expect(s.deltaPct).toBeNull();
  });

  it("reports the overlap acreage the numbers are scoped to", () => {
    const s = compareStats({ aBounds, bBounds, aZones: [], bZones: [] });
    expect(s.overlapAcres).toBeGreaterThan(0);
    expect(s.overlapAcres).toBeLessThan(rectAcres(aBounds) + 0.001);
  });
});

describe("the georeferencing offset is reported, not hidden", () => {
  it("stays quiet about sub-2m differences", () => {
    const a = rect(-93.001, 45.0, -93.0, 45.001);
    expect(offsetDescription(a, a)).toBeNull();
  });

  it("names the direction and size of a real offset, and where it lives", () => {
    const a = rect(-93.001, 45.0, -93.0, 45.001);
    // Shift ~0.0005° east at 45°N ≈ 39 m.
    const b = rect(-93.0005, 45.0, -92.9995, 45.001);
    const msg = offsetDescription(a, b)!;
    expect(msg).toMatch(/east/);
    expect(msg).toMatch(/not this viewer/);
    const { eastM } = centerOffsetM(a, b);
    expect(eastM).toBeCloseTo(39.4, 0);
  });
});

describe("analysis states are structurally distinct", () => {
  it("never analyzed", () => {
    expect(analysisStateOf({ ai_analysis: null, ai_analysis_at: null }))
      .toEqual({ kind: "none" });
  });

  it("failed, with the stored reason", () => {
    const s = analysisStateOf({
      ai_analysis: { last_run: { status: "failed", at: "2026-08-20T10:00:00Z", error: "AI rate limit" } },
      ai_analysis_at: null,
    });
    expect(s).toEqual({ kind: "failed", error: "AI rate limit", at: "2026-08-20T10:00:00Z" });
  });

  it("analyzed with zero zones is DONE, not none — a clean field is a result", () => {
    const s = analysisStateOf({
      ai_analysis: { zones: [], last_run: { status: "completed", at: "2026-08-20T10:00:00Z" } },
      ai_analysis_at: "2026-08-20T10:00:00Z",
    });
    expect(s.kind).toBe("done");
    if (s.kind === "done") expect(s.zones).toEqual([]);
  });

  it("keeps the last good result when a re-run failed, and says the re-run failed", () => {
    const s = analysisStateOf({
      ai_analysis: {
        zones: [{ id: "z1" }],
        last_run: { status: "failed", at: "2026-08-21T10:00:00Z", error: "boom" },
      },
      ai_analysis_at: "2026-08-20T10:00:00Z",
    });
    expect(s.kind).toBe("done");
    if (s.kind === "done") {
      expect(s.zones).toHaveLength(1);
      expect(s.rerunFailed).toEqual({ error: "boom", at: "2026-08-21T10:00:00Z" });
    }
  });
});

describe("picking the two scans", () => {
  const dates: Record<string, string> = {
    s1: "2026-03-01T00:00:00Z",
    s2: "2026-04-01T00:00:00Z",
    s3: "2026-05-01T00:00:00Z",
  };
  const dateOf = (id: string) => dates[id];

  it("a third pick replaces the first-made pick", () => {
    let p = togglePick([], "s1");
    p = togglePick(p, "s2");
    p = togglePick(p, "s3");
    expect(p).toEqual(["s2", "s3"]);
  });

  it("picking again unpicks", () => {
    expect(togglePick(["s1", "s2"], "s1")).toEqual(["s2"]);
  });

  it("assigns A to the older flight whatever the click order", () => {
    expect(abOf(["s3", "s1"], dateOf)).toEqual({ a: "s1", b: "s3" });
    expect(abOf(["s1", "s3"], dateOf)).toEqual({ a: "s1", b: "s3" });
    expect(abOf(["s2"], dateOf)).toEqual({ a: "s2", b: null });
    expect(abOf([], dateOf)).toEqual({ a: null, b: null });
  });
});
