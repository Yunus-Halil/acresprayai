// Nearby same-rate zones are flown as one sweep, not as a bounce-around.
//
// The complaint these tests encode: a field marked as a cluster of parallel
// strips was planned strip by strip — cover one, fly away, come back for its
// neighbour two metres over. The route was mostly transit. Grouping fixes the
// traversal, and the hard constraint is that it must not buy that with
// coverage or with chemical, so most of what follows is a coverage or a volume
// assertion in disguise.
import { describe, it, expect } from "vitest";
import { type LatLng2, M_PER_DEG_LAT, mPerDegLng, pointInRing } from "@/lib/geo";
import {
  DEFAULT_GROUPING_SWATHS, groupZones, groupingDistanceM, ringGapM,
} from "@/lib/zoneGroups";
import { type Pass, buildFieldSweep, buildMission } from "@/lib/mission";
import { computeMissionStats, pesticideLitres } from "@/lib/missionStats";
import { DRONE_SPECS } from "@/lib/droneSpecs";

const LAT = 45, LNG = -93;

/** Axis-aligned rectangle sized in metres, anchored at its south-west corner. */
function rect(lat: number, lng: number, widthM: number, heightM: number): LatLng2[] {
  const dLat = heightM / M_PER_DEG_LAT, dLng = widthM / mPerDegLng(lat);
  return [
    { lat, lng }, { lat, lng: lng + dLng },
    { lat: lat + dLat, lng: lng + dLng }, { lat: lat + dLat, lng },
  ];
}

const north = (m: number) => m / M_PER_DEG_LAT;
const east = (m: number) => m / mPerDegLng(LAT);

const FIELD = rect(LAT, LNG, 400, 300);
const HOME: LatLng2 = { lat: LAT, lng: LNG };
const T40 = DRONE_SPECS["DJI Agras T40"];

const PARAMS = (extra: Partial<Parameters<typeof buildMission>[2]> = {}) => ({
  home: HOME, transitAltM: 30, sprayAltM: 3,
  transitSpeed: 10, spraySpeed: 3, spacingM: 8, ...extra,
});

/**
 * Four 60 m × 8 m strips stacked with 8 m of unmarked ground between them —
 * the fragmented-strips field the planner used to bounce around.
 */
function strips(rateLha = 20, gapM = 8) {
  return [0, 1, 2, 3].map(i => ({
    id: `s${i}`,
    ring: rect(LAT + north(100 + i * (8 + gapM)), LNG + east(100), 60, 8),
    rateLha,
  }));
}

const allSegs = (frags: Pass[][]) => frags.flat().flatMap(p => p.segs);

describe("groupZones", () => {
  it("merges same-rate zones inside the grouping distance", () => {
    const groups = groupZones(strips(), { distanceM: 12 });
    expect(groups.length).toBe(1);
    expect(groups[0].zones.map(z => z.id)).toEqual(["s0", "s1", "s2", "s3"]);
  });

  it("keeps zones further apart than the distance separate", () => {
    const groups = groupZones(strips(20, 40), { distanceM: 12 });
    expect(groups.length).toBe(4);
  });

  it("never merges across rates, however close the zones sit", () => {
    // Two strips that physically touch, at different rates.
    const a = { id: "a", ring: rect(LAT + north(100), LNG + east(100), 60, 8), rateLha: 20 };
    const b = { id: "b", ring: rect(LAT + north(108), LNG + east(100), 60, 8), rateLha: 35 };
    expect(ringGapM(a.ring, b.ring)).toBeLessThan(0.5);
    const groups = groupZones([a, b], { distanceM: 50 });
    expect(groups.length).toBe(2);
    expect(new Set(groups.map(g => g.rateLha))).toEqual(new Set([20, 35]));
  });

  it("groups an unrated zone only with other unrated zones", () => {
    const a = { id: "a", ring: rect(LAT + north(100), LNG + east(100), 60, 8) };
    const b = { id: "b", ring: rect(LAT + north(108), LNG + east(100), 60, 8) };
    const c = { id: "c", ring: rect(LAT + north(116), LNG + east(100), 60, 8), rateLha: 20 };
    const groups = groupZones([a, b, c], { distanceM: 20 });
    expect(groups.length).toBe(2);
    expect(groups.find(g => g.rateLha == null)!.zones.map(z => z.id)).toEqual(["a", "b"]);
  });

  it("is transitive: A near B near C is one group even if A and C are far", () => {
    const s = strips(20, 8);
    const gap = ringGapM(s[0].ring, s[3].ring);
    expect(gap).toBeGreaterThan(12);
    expect(groupZones(s, { distanceM: 12 })).toHaveLength(1);
  });

  it("turns off at zero distance: one group per zone", () => {
    const groups = groupZones(strips(), { distanceM: 0 });
    expect(groups.length).toBe(4);
    for (const g of groups) expect(g.zones).toHaveLength(1);
  });

  it("derives the default distance from the swath", () => {
    expect(groupingDistanceM(9)).toBeCloseTo(9 * DEFAULT_GROUPING_SWATHS, 6);
    expect(groupingDistanceM(9, 2)).toBeCloseTo(18, 6);
  });

  it("measures the gap edge to edge, not centroid to centroid", () => {
    // Two long strips side by side: 8 m apart, but their centroids are close
    // only because they are parallel — a length-blind measure would disagree.
    const a = rect(LAT + north(100), LNG + east(100), 200, 8);
    const b = rect(LAT + north(116), LNG + east(100), 200, 8);
    expect(ringGapM(a, b)).toBeCloseTo(8, 0);
  });

  it("reports zero gap for overlapping and for nested rings", () => {
    const big = rect(LAT + north(100), LNG + east(100), 60, 60);
    const inner = rect(LAT + north(120), LNG + east(120), 10, 10);
    expect(ringGapM(big, inner)).toBe(0);
    expect(ringGapM(inner, big)).toBe(0);
  });
});

describe("continuous coverage across a group", () => {
  const S = strips();

  it("sweeps the whole cluster as one fragment", () => {
    const grouped = buildFieldSweep([FIELD], S, 8, 1, { groupingDistanceM: 12 });
    const ungrouped = buildFieldSweep([FIELD], S, 8, 1, { groupingDistanceM: 0 });
    expect(grouped).toHaveLength(1);
    expect(ungrouped).toHaveLength(4);
  });

  it("runs the group's passes along the cluster's long axis", () => {
    // The cluster is 60 m east-west and ~56 m north-south, so its passes run
    // east-west: every segment is longer in longitude than in latitude.
    const [frag] = buildFieldSweep([FIELD], S, 8, 1, { groupingDistanceM: 12 });
    for (const seg of frag.flatMap(p => p.segs)) {
      const dx = Math.abs(seg.b.lng - seg.a.lng) * mPerDegLng(LAT);
      const dy = Math.abs(seg.b.lat - seg.a.lat) * M_PER_DEG_LAT;
      expect(dx).toBeGreaterThan(dy);
    }
  });

  it("alternates direction pass to pass across the whole group", () => {
    const [frag] = buildFieldSweep([FIELD], S, 8, 1, { groupingDistanceM: 12 });
    const eastward = frag.map(p => p.segs[0].b.lng > p.segs[0].a.lng);
    for (let i = 1; i < eastward.length; i++) {
      expect(eastward[i]).toBe(!eastward[i - 1]);
    }
  });

  it("holds the boom off over the unmarked ground between members", () => {
    const [frag] = buildFieldSweep([FIELD], S, 8, 1, { groupingDistanceM: 12 });
    // Every spray segment's midpoint must be inside a marked strip. Nothing is
    // sprayed just because two strips were grouped.
    for (const seg of frag.flatMap(p => p.segs)) {
      const mid = { lat: (seg.a.lat + seg.b.lat) / 2, lng: (seg.a.lng + seg.b.lng) / 2 };
      expect(S.some(z => pointInRing(mid, z.ring))).toBe(true);
    }
  });

  it("covers exactly the same ground grouped as ungrouped", () => {
    const grouped = allSegs(buildFieldSweep([FIELD], S, 8, 1, { groupingDistanceM: 12 }));
    const ungrouped = allSegs(buildFieldSweep([FIELD], S, 8, 1, { groupingDistanceM: 0 }));
    // Sample the marked ground densely; every sample covered by one route must
    // be covered by the other, to within a lane's half-width.
    const half = 8 / 2 + 0.01;
    const worst = (segs: typeof grouped, ring: LatLng2[]) => {
      const lats = ring.map(p => p.lat), lngs = ring.map(p => p.lng);
      let w = 0;
      for (let i = 0; i <= 12; i++) for (let j = 0; j <= 40; j++) {
        const p = {
          lat: Math.min(...lats) + (Math.max(...lats) - Math.min(...lats)) * (i / 12),
          lng: Math.min(...lngs) + (Math.max(...lngs) - Math.min(...lngs)) * (j / 40),
        };
        let d = Infinity;
        for (const s of segs) d = Math.min(d, distToSegM(p, s.a, s.b));
        w = Math.max(w, d);
      }
      return w;
    };
    for (const z of S) {
      expect(worst(grouped, z.ring)).toBeLessThanOrEqual(half);
      expect(worst(ungrouped, z.ring)).toBeLessThanOrEqual(half);
    }
  });

  it("does not double-spray where two members of a group overlap", () => {
    const a = { id: "a", ring: rect(LAT + north(100), LNG + east(100), 60, 20), rateLha: 20 };
    const b = { id: "b", ring: rect(LAT + north(100), LNG + east(130), 60, 20), rateLha: 20 };
    const [frag] = buildFieldSweep([FIELD], [a, b], 8, 1, { groupingDistanceM: 12 });
    for (const pass of frag) {
      // Overlapping members merge into one interval per pass, not two.
      expect(pass.segs.length).toBe(1);
    }
  });
});

describe("transit order", () => {
  /**
   * Six 60 m × 20 m strips with 6 m between them: the "cluster of parallel
   * strips over one problem area" the planner used to fly one strip at a time.
   */
  const cluster = Array.from({ length: 6 }, (_, i) => ({
    id: `c${i}`,
    ring: rect(LAT + north(60 + i * 26), LNG + east(100), 60, 20),
    rateLha: 20,
  }));

  /** Ten one-lane strips, offset row to row — a grid selection full of holes. */
  const fragmented = Array.from({ length: 10 }, (_, i) => ({
    id: `f${i}`,
    ring: rect(LAT + north(100 + i * 8), LNG + east(100 + (i * 5) % 20), 32, 8),
    rateLha: 20,
  }));

  it("cuts the criss-crossing over a fragmented field", () => {
    const on = buildMission([FIELD], fragmented, PARAMS({ groupingDistanceM: 16 }));
    const off = buildMission([FIELD], fragmented, PARAMS({ groupingDistanceM: 0 }));
    // Measured over the field, not counting the commute out and back: the
    // commute is the same either way and would drown the difference.
    expect(inFieldTransitM(on)).toBeLessThan(inFieldTransitM(off) * 0.85);
  });

  it("stops re-covering ground the neighbouring zone already had", () => {
    const on = buildMission([FIELD], cluster, PARAMS({ groupingDistanceM: 16 }));
    const off = buildMission([FIELD], cluster, PARAMS({ groupingDistanceM: 0 }));
    // Per-zone lane sets round up separately and land on their own offsets, so
    // the cluster used to be flown with more lanes than it needs.
    expect(on.sprayDistM).toBeLessThan(off.sprayDistM);
  });

  it("never lengthens the route it is given", () => {
    for (const zones of [cluster, fragmented]) {
      const on = buildMission([FIELD], zones, PARAMS({ groupingDistanceM: 16 }));
      const off = buildMission([FIELD], zones, PARAMS({ groupingDistanceM: 0 }));
      const total = (m: typeof on) => m.sprayTimeS + m.transitTimeS;
      expect(total(on)).toBeLessThanOrEqual(total(off) * 1.02);
    }
  });

  it("drops flight time and battery count off the shorter route", () => {
    const zones = cluster.map(() => ({ areaM2: 60 * 20, rateLha: 20 }));
    const base = { spec: T40, sprayAltM: 3, transitAltM: 30, tankLoadPct: 100, zones, wx: null };
    const on = computeMissionStats({
      ...base, mission: buildMission([FIELD], cluster, PARAMS({ groupingDistanceM: 16 })),
    });
    const off = computeMissionStats({
      ...base, mission: buildMission([FIELD], cluster, PARAMS({ groupingDistanceM: 0 })),
    });
    expect(on.flightTimeMinutes).toBeLessThan(off.flightTimeMinutes);
    expect(on.batteriesNeeded).toBeLessThanOrEqual(off.batteriesNeeded);
  });

  it("leaves chemical volume untouched — it is area × rate, not path", () => {
    const zones = cluster.map(() => ({ areaM2: 60 * 20, rateLha: 20 }));
    const litres = pesticideLitres(zones);
    const base = { spec: T40, sprayAltM: 3, transitAltM: 30, tankLoadPct: 100, zones, wx: null };
    const on = computeMissionStats({
      ...base, mission: buildMission([FIELD], cluster, PARAMS({ groupingDistanceM: 16 })),
    });
    const off = computeMissionStats({
      ...base, mission: buildMission([FIELD], cluster, PARAMS({ groupingDistanceM: 0 })),
    });
    expect(on.pesticideAmountLiters).toBeCloseTo(litres, 6);
    expect(off.pesticideAmountLiters).toBeCloseTo(litres, 6);
    expect(on.treatedAreaHa).toBeCloseTo(off.treatedAreaHa, 9);
  });

  it("orders scattered groups without doubling back over the field", () => {
    const patches = [0, 1, 2, 3, 4, 5].map(i => ({
      id: `p${i}`,
      ring: rect(LAT + north(30 + i * 40), LNG + east(30 + i * 55), 25, 25),
      rateLha: 20,
    }));
    const m = buildMission([FIELD], patches, PARAMS({ groupingDistanceM: 16 }));
    // Straight-line walk home → p0 → … → p5 → home is the floor; the planner
    // must land within a modest factor of it rather than bouncing.
    let floor = 0, cur = HOME;
    for (const p of patches) {
      const c = { lat: (p.ring[0].lat + p.ring[2].lat) / 2, lng: (p.ring[0].lng + p.ring[2].lng) / 2 };
      floor += distM(cur, c); cur = c;
    }
    floor += distM(cur, HOME);
    expect(m.transitDistM).toBeLessThan(floor * 1.6);
  });

  it("turning grouping off reproduces the per-zone route exactly", () => {
    // The regression guard: a single zone can only ever be one group, so the
    // two settings must produce identical geometry.
    const one = [{ id: "z", ring: rect(LAT + north(100), LNG + east(100), 100, 100), rateLha: 20 }];
    const off = buildMission([FIELD], one, PARAMS({ groupingDistanceM: 0 }));
    const on = buildMission([FIELD], one, PARAMS({ groupingDistanceM: 16 }));
    expect(on.sprayDistM).toBeCloseTo(off.sprayDistM, 9);
    expect(on.transitDistM).toBeCloseTo(off.transitDistM, 9);
    expect(on.waypoints.length).toBe(off.waypoints.length);
  });

  it("does not lay its lanes across a cluster of strips", () => {
    // The trap the group's own principal axis walks into: this cluster is
    // "longest" north-south, but a north-south pass over it is mostly gap.
    const on = buildMission([FIELD], cluster, PARAMS({ groupingDistanceM: 16 }));
    for (const seg of on.spraySegments) {
      const dx = Math.abs(seg[1].lng - seg[0].lng) * mPerDegLng(LAT);
      const dy = Math.abs(seg[1].lat - seg[0].lat) * M_PER_DEG_LAT;
      expect(dx).toBeGreaterThan(dy);
    }
  });

  it("keeps the route valid when a service pad is given", () => {
    const patches = [0, 1, 2, 3].map(i => ({
      id: `p${i}`,
      ring: rect(LAT + north(40 + i * 55), LNG + east(40 + i * 80), 30, 30),
      rateLha: 20,
    }));
    const pad: LatLng2 = { lat: LAT + north(40), lng: LNG + east(40) };
    const withPad = buildMission([FIELD], patches, PARAMS({
      groupingDistanceM: 16, servicePoints: [pad], serviceAtSprayFractions: [0.5],
    }));
    const without = buildMission([FIELD], patches, PARAMS({ groupingDistanceM: 16 }));
    // Both are valid routes over the same ground; steering for the pad must not
    // cost coverage.
    expect(withPad.sprayDistM).toBeCloseTo(without.sprayDistM, 0);
    expect(withPad.spraySegments.length).toBe(without.spraySegments.length);
  });
});

// ---------------------------------------------------------------------------

/**
 * Transit flown OVER the field: everything but the commute out and the commute
 * home, which are the same whatever the route does in between.
 */
function inFieldTransitM(m: ReturnType<typeof buildMission>): number {
  const segs = m.transitSegments;
  let d = 0;
  for (let i = 1; i < segs.length - 1; i++) d += distM(segs[i][0], segs[i][1]);
  return d;
}

/** Perpendicular distance from a point to a segment, in metres. */
function distToSegM(p: LatLng2, a: LatLng2, b: LatLng2): number {
  const mLng = mPerDegLng(p.lat);
  const px = (p.lng - a.lng) * mLng, py = (p.lat - a.lat) * M_PER_DEG_LAT;
  const bx = (b.lng - a.lng) * mLng, by = (b.lat - a.lat) * M_PER_DEG_LAT;
  const len2 = bx * bx + by * by;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
  return Math.hypot(px - bx * t, py - by * t);
}

function distM(a: LatLng2, b: LatLng2): number {
  const dLat = (b.lat - a.lat) * M_PER_DEG_LAT;
  const dLng = (b.lng - a.lng) * mPerDegLng((a.lat + b.lat) / 2);
  return Math.hypot(dLat, dLng);
}
