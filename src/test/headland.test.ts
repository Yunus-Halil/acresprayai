// The headland: passes held back from the field edge.
//
// Two things must hold and neither is obvious from the geometry alone. The
// passes have to end up inside the boundary by the distance asked for — that is
// the feature. And the chemical has to be priced on the ground actually
// sprayed, not on the ground originally painted, because a plan that flies the
// inner shape and bills the outer one is wrong in the direction that puts more
// chemical in the tank than the field receives.
//
// The third thing is the small-zone case, which is the one that bites in the
// field: a patch narrower than two headlands has no inside left, and the naive
// answer removes it from the plan entirely. An operator does not notice a zone
// that is missing. They notice the pest that comes back through it.
import { describe, expect, it } from "vitest";
import {
  type LatLng2, M_PER_DEG_LAT, distM, mPerDegLng, polygonAreaM2,
} from "@/lib/geo";
import {
  DEFAULT_HEADLAND_M, applyHeadland, headlandAreaScale, headlandReason, insetRing,
} from "@/lib/headland";
import { DRONE_SPECS, coveredSwathM, effectiveSwathM, passSpacingM } from "@/lib/droneSpecs";
import { buildFieldSweep } from "@/lib/mission";
import { pesticideLitres } from "@/lib/missionStats";

const LAT = 45, LNG = -93;

function rect(lat: number, lng: number, widthM: number, heightM: number): LatLng2[] {
  const dLat = heightM / M_PER_DEG_LAT, dLng = widthM / mPerDegLng(lat);
  return [
    { lat, lng }, { lat, lng: lng + dLng },
    { lat: lat + dLat, lng: lng + dLng }, { lat: lat + dLat, lng },
  ];
}

/** Shortest distance from a point to a ring's edges, in metres. */
function distToRingM(p: LatLng2, ring: LatLng2[]): number {
  const mLng = mPerDegLng(p.lat);
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const ax = (a.lng - p.lng) * mLng, ay = (a.lat - p.lat) * M_PER_DEG_LAT;
    const bx = (b.lng - p.lng) * mLng, by = (b.lat - p.lat) * M_PER_DEG_LAT;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + dx * t, ay + dy * t));
  }
  return best;
}

const FIELD = rect(LAT, LNG, 400, 300);
const ZONE = rect(LAT + 80 / M_PER_DEG_LAT, LNG + 80 / mPerDegLng(LAT), 150, 120);
const T40 = DRONE_SPECS["DJI Agras T40"];

describe("insetting a ring", () => {
  it("pulls every edge in by the distance asked for", () => {
    const inner = insetRing(ZONE, 5)!;
    expect(inner).toHaveLength(4);
    for (const p of inner) {
      expect(distToRingM(p, ZONE)).toBeCloseTo(5, 1);
    }
  });

  it("shrinks the shape rather than moving it", () => {
    const inner = insetRing(ZONE, 5)!;
    // 150×120 inset by 5 on all sides is 140×110.
    expect(Math.abs(polygonAreaM2(inner))).toBeCloseTo(140 * 110, -2);
  });

  it("insets the same way whichever way the ring is wound", () => {
    // Winding is not something a caller should have to normalise first: an
    // AI-drawn ring and a hand-drawn one do not agree about it.
    const ccw = insetRing(ZONE, 5)!;
    const cw = insetRing([...ZONE].reverse(), 5)!;
    expect(Math.abs(polygonAreaM2(cw))).toBeCloseTo(Math.abs(polygonAreaM2(ccw)), 3);
    for (const p of cw) expect(distToRingM(p, ZONE)).toBeCloseTo(5, 1);
  });

  it("holds each edge back by its own distance when given a function", () => {
    // The seam for per-edge buffers: a wide hold-back along the edge that meets
    // a road, a narrow one along an open edge. Nothing in the offset assumes a
    // uniform distance.
    const perEdge = insetRing(ZONE, (i) => (i === 0 ? 20 : 2))!;
    const area = Math.abs(polygonAreaM2(perEdge));
    // South edge pulled 20 m, the rest 2 m: 146 × 98.
    expect(area).toBeCloseTo(146 * 98, -2);
  });

  it("declines a degenerate ring rather than returning nonsense", () => {
    expect(insetRing([{ lat: LAT, lng: LNG }, { lat: LAT, lng: LNG }], 1)).toBeNull();
    expect(insetRing([], 1)).toBeNull();
  });
});

describe("applying a headland to a zone", () => {
  it("reports the area actually left sprayable", () => {
    const out = applyHeadland(ZONE, 5);
    expect(headlandReason(out)).toBeNull();
    // (140 × 110) / (150 × 120)
    expect(headlandAreaScale(out)).toBeCloseTo((140 * 110) / (150 * 120), 3);
  });

  it("is a no-op when no headland is set", () => {
    const out = applyHeadland(ZONE, 0);
    expect(headlandAreaScale(out)).toBe(1);
    expect(out.ring).toBe(ZONE);
  });

  it("keeps a narrow zone whole instead of emptying it", () => {
    // 6 m wide, asked for a 4 m headland on each side. There is no inside left.
    // The zone must survive the plan, not vanish from it.
    const sliver = rect(LAT + 150 / M_PER_DEG_LAT, LNG + 150 / mPerDegLng(LAT), 60, 6);
    const out = applyHeadland(sliver, 4, { label: "This patch" });
    expect(headlandAreaScale(out)).toBe(1);
    expect(out.ring).toBe(sliver);
    expect(headlandReason(out)).toMatch(/narrower than/i);
    // And it says what happened to it, in the operator's terms.
    expect(headlandReason(out)).toMatch(/full extent/i);
  });

  it("names the zone in the reason it gives", () => {
    const sliver = rect(LAT, LNG, 40, 4);
    expect(headlandReason(applyHeadland(sliver, 5, { label: "A treatment-grid zone" })))
      .toMatch(/^A treatment-grid zone/);
  });

  it("waives rather than inverting when the inset would swallow the zone", () => {
    // Exactly at the boundary of the degenerate case: 10 m across, 5 m inset.
    const out = applyHeadland(rect(LAT, LNG, 80, 10), 5);
    expect(headlandAreaScale(out)).toBe(1);
    expect(headlandReason(out)).toBeTruthy();
  });

  it("never returns a shape bigger than it started with", () => {
    for (const inset of [1, 3, 7, 15, 40]) {
      const out = applyHeadland(ZONE, inset);
      const area = Math.abs(polygonAreaM2(out.ring));
      expect(area).toBeLessThanOrEqual(Math.abs(polygonAreaM2(ZONE)) + 1e-6);
    }
  });
});

describe("the plan flies inside the headland", () => {
  const spacing = passSpacingM(T40);

  it("keeps every spray segment back from the boundary", () => {
    const inset = DEFAULT_HEADLAND_M;
    const planned = applyHeadland(ZONE, inset);
    const frags = buildFieldSweep([FIELD], [{ id: "z", ring: planned.ring }], spacing);
    const segs = frags.flat().flatMap(p => p.segs);
    expect(segs.length).toBeGreaterThan(0);

    for (const s of segs) {
      for (const p of [s.a, s.b]) {
        // Inside the zone's true edge by the headland, give or take the
        // half-metre of slack the lane centring introduces.
        expect(distToRingM(p, ZONE)).toBeGreaterThan(inset - 0.5);
      }
    }
  });

  it("flies fewer lanes than it would without one", () => {
    const withOut = buildFieldSweep([FIELD], [{ id: "z", ring: ZONE }], spacing).flat().length;
    const withIn = buildFieldSweep(
      [FIELD], [{ id: "z", ring: applyHeadland(ZONE, 6).ring }], spacing,
    ).flat().length;
    expect(withIn).toBeLessThan(withOut);
  });

  it("still plans passes for a zone whose headland was waived", () => {
    // The whole point of waiving rather than emptying: the patch is still flown.
    const sliver = rect(LAT + 150 / M_PER_DEG_LAT, LNG + 150 / mPerDegLng(LAT), 60, 6);
    const out = applyHeadland(sliver, 4);
    const frags = buildFieldSweep([FIELD], [{ id: "z", ring: out.ring }], spacing);
    expect(frags.flat().length).toBeGreaterThan(0);
  });
});

describe("the chemical follows the sprayed ground", () => {
  it("prices the inset area, not the painted one", () => {
    const rateLha = 25;
    const paintedM2 = Math.abs(polygonAreaM2(ZONE));
    const out = applyHeadland(ZONE, 5);
    const sprayedM2 = paintedM2 * headlandAreaScale(out);

    const painted = pesticideLitres([{ areaM2: paintedM2, rateLha }]);
    const sprayed = pesticideLitres([{ areaM2: sprayedM2, rateLha }]);

    expect(sprayed).toBeLessThan(painted);
    // The reduction is exactly the area's, since volume is area × rate.
    expect(sprayed / painted).toBeCloseTo(headlandAreaScale(out), 9);
  });

  it("scales a grid zone's true clipped area rather than re-measuring its ring", () => {
    // A grid zone's area is summed from its member cells, clipped to the field
    // boundary — a number ring geometry cannot reproduce. Applying the headland
    // as a ratio keeps that arithmetic and takes only the headland's bite.
    const clippedArea = 1234.5;                     // what the cells actually summed to
    const scale = headlandAreaScale(applyHeadland(ZONE, 5));
    const after = clippedArea * scale;
    expect(after).toBeLessThan(clippedArea);
    expect(after / clippedArea).toBeCloseTo(scale, 12);
    // And it is NOT the inset ring's own area, which describes different ground.
    expect(after).not.toBeCloseTo(Math.abs(polygonAreaM2(applyHeadland(ZONE, 5).ring)), 0);
  });

  it("leaves the volume alone when the headland was waived", () => {
    const sliver = rect(LAT, LNG, 60, 6);
    const out = applyHeadland(sliver, 4);
    expect(headlandAreaScale(out)).toBe(1);
    const areaM2 = Math.abs(polygonAreaM2(sliver));
    expect(pesticideLitres([{ areaM2: areaM2 * headlandAreaScale(out), rateLha: 25 }]))
      .toBeCloseTo(pesticideLitres([{ areaM2, rateLha: 25 }]), 9);
  });
});

// ---------------------------------------------------------------------------
// Spread factor
// ---------------------------------------------------------------------------

/** How far the worst-covered interior point of a zone sits from a spray line. */
function worstUncoveredM(zone: LatLng2[], frags: ReturnType<typeof buildFieldSweep>): number {
  const segs = frags.flat().flatMap(p => p.segs);
  if (!segs.length) return Infinity;
  const lats = zone.map(p => p.lat), lngs = zone.map(p => p.lng);
  const [lo, hi] = [Math.min(...lats), Math.max(...lats)];
  const [w, e] = [Math.min(...lngs), Math.max(...lngs)];
  let worst = 0;
  for (let i = 0; i <= 50; i++) {
    for (let j = 0; j <= 50; j++) {
      const p = { lat: lo + ((hi - lo) * i) / 50, lng: w + ((e - w) * j) / 50 };
      if (!inRing(p, zone)) continue;
      let best = Infinity;
      for (const s of segs) best = Math.min(best, distToSegM(p, s.a, s.b));
      worst = Math.max(worst, best);
    }
  }
  return worst;
}

function inRing(p: LatLng2, ring: LatLng2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.lat > p.lat) !== (b.lat > p.lat)
        && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside;
}

function distToSegM(p: LatLng2, a: LatLng2, b: LatLng2): number {
  const mLng = mPerDegLng(p.lat);
  const px = (p.lng - a.lng) * mLng, py = (p.lat - a.lat) * M_PER_DEG_LAT;
  const bx = (b.lng - a.lng) * mLng, by = (b.lat - a.lat) * M_PER_DEG_LAT;
  const len2 = bx * bx + by * by;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
  return Math.hypot(px - bx * t, py - by * t);
}

describe("the downwash spread factor", () => {
  it("defaults to 1.0 on every drone, changing nothing", () => {
    // A regression guard on the shipped behaviour. If a default is ever bumped,
    // this is what says so.
    for (const [name, spec] of Object.entries(DRONE_SPECS)) {
      expect(spec.spray_spread_factor, name).toBe(1.0);
      expect(coveredSwathM(spec), name).toBe(effectiveSwathM(spec));
      expect(passSpacingM(spec), name)
        .toBeCloseTo(effectiveSwathM(spec) * (1 - spec.spray_overlap), 9);
    }
  });

  it("widens the lanes when an operator raises it", () => {
    const base = passSpacingM(T40);
    const wider = passSpacingM({ ...T40, spray_spread_factor: 1.1 });
    expect(wider).toBeCloseTo(base * 1.1, 9);
  });

  it("still covers the zone at a modest factor", () => {
    // 1.1 × 0.9 = 0.99 of a boom, so the mechanical boom still covers the gap.
    const spec = { ...T40, spray_spread_factor: 1.1 };
    const frags = buildFieldSweep([FIELD], [{ id: "z", ring: ZONE }], passSpacingM(spec));
    expect(worstUncoveredM(ZONE, frags)).toBeLessThanOrEqual(effectiveSwathM(spec) / 2 + 0.05);
  });

  it("fails the coverage assertion at a factor that would open gaps", () => {
    // THIS TEST PASSING MEANS THE GUARD WORKS. At 1.5 the lanes are 12.15 m
    // apart on a 9 m boom: nearly a third of the ground between them is covered
    // only if downwash reaches it, and if it does not, that strip is under-dosed
    // and nobody finds out until the pest returns through it.
    const spec = { ...T40, spray_spread_factor: 1.5 };
    const frags = buildFieldSweep([FIELD], [{ id: "z", ring: ZONE }], passSpacingM(spec));
    expect(worstUncoveredM(ZONE, frags)).toBeGreaterThan(effectiveSwathM(spec) / 2);
  });

  it("leaves the treatment grid's cell size on the mechanical boom", () => {
    // The cell is the unit a rate is assigned in, and the aircraft cannot vary
    // its rate within one boom width whatever the downwash does. Spread must
    // not reach this number.
    const spec = { ...T40, spray_spread_factor: 1.4 };
    expect(effectiveSwathM(spec)).toBe(T40.spray_swath_m);
  });

  it("ignores a nonsensical factor rather than dividing by it", () => {
    expect(coveredSwathM({ ...T40, spray_spread_factor: 0 })).toBe(effectiveSwathM(T40));
    expect(coveredSwathM({ ...T40, spray_spread_factor: NaN })).toBe(effectiveSwathM(T40));
  });
});

describe("headland and spacing together", () => {
  it("holds the plan back and keeps the lanes one boom apart", () => {
    // The two changes are independent and must stay that way: the headland
    // decides where the lanes may go, the spacing decides how far apart they
    // are once inside.
    const planned = applyHeadland(ZONE, 5);
    const spacing = passSpacingM(T40);
    const lats = buildFieldSweep([FIELD], [{ id: "z", ring: planned.ring }], spacing)
      .flat().map(p => p.segs[0].a.lat).sort((a, b) => a - b);
    expect(lats.length).toBeGreaterThan(1);
    for (let i = 1; i < lats.length; i++) {
      expect((lats[i] - lats[i - 1]) * M_PER_DEG_LAT).toBeCloseTo(spacing, 3);
    }
  });

  it("covers everything inside the headland", () => {
    // Coverage is still absolute — within the ground the plan claims to treat.
    const planned = applyHeadland(ZONE, 5);
    const frags = buildFieldSweep([FIELD], [{ id: "z", ring: planned.ring }], passSpacingM(T40));
    expect(worstUncoveredM(planned.ring, frags))
      .toBeLessThanOrEqual(effectiveSwathM(T40) / 2 + 0.05);
  });

  it("does not move the home-to-field geometry", () => {
    // A sanity check that insetting a zone does not relocate it.
    const before = ZONE.reduce((s, p) => s + p.lat, 0) / ZONE.length;
    const after = applyHeadland(ZONE, 5).ring.reduce((s, p) => s + p.lat, 0) / 4;
    expect(distM({ lat: before, lng: LNG }, { lat: after, lng: LNG })).toBeLessThan(0.5);
  });
});
