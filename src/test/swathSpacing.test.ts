// Pass spacing comes from the boom, and the passes run down the zone.
//
// The complaint these tests encode: the planner was laying parallel lines far
// closer together than an Agras sprays, so a zone got flown many times over —
// redundant back-and-forth, wasted battery, double application. The fix is one
// boom width less a small overlap, oriented along each zone's long axis. The
// hard constraint is that it must not buy that with coverage, so most of what
// follows is a coverage assertion in disguise.
import { describe, it, expect } from "vitest";
import {
  type LatLng2, M_PER_DEG_LAT, distM, mPerDegLng, polygonAreaM2, principalAxisAngle,
} from "@/lib/geo";
import {
  DRONE_SPECS, effectiveSwathM, passSpacingM,
} from "@/lib/droneSpecs";
import { type Pass, buildFieldSweep, buildMission } from "@/lib/mission";
import { computeMissionStats, pesticideLitres } from "@/lib/missionStats";
import { type CellRate, buildTreatmentGrid, gridDefinitionFor } from "@/lib/treatmentGrid";
import { gridZonesFor } from "@/lib/gridZones";
import { parseCellId } from "@/lib/gridMigrate";

const LAT = 45, LNG = -93;

/** Axis-aligned rectangle sized in metres, anchored at its south-west corner. */
function rect(lat: number, lng: number, widthM: number, heightM: number): LatLng2[] {
  const dLat = heightM / M_PER_DEG_LAT, dLng = widthM / mPerDegLng(lat);
  return [
    { lat, lng }, { lat, lng: lng + dLng },
    { lat: lat + dLat, lng: lng + dLng }, { lat: lat + dLat, lng },
  ];
}

/** The same rectangle turned about its own centre. */
function turned(ring: LatLng2[], deg: number): LatLng2[] {
  const cx = ring.reduce((a, p) => a + p.lng, 0) / ring.length;
  const cy = ring.reduce((a, p) => a + p.lat, 0) / ring.length;
  const mLng = mPerDegLng(cy);
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
  return ring.map(p => {
    const x = (p.lng - cx) * mLng, y = (p.lat - cy) * M_PER_DEG_LAT;
    return { lng: cx + (x * c - y * s) / mLng, lat: cy + (x * s + y * c) / M_PER_DEG_LAT };
  });
}

// 400 m × 300 m field: its long axis runs east-west.
const FIELD = rect(LAT, LNG, 400, 300);
const HOME: LatLng2 = { lat: LAT, lng: LNG };
const T40 = DRONE_SPECS["DJI Agras T40"];

const PARAMS = (spacingM: number) => ({
  home: HOME, transitAltM: 30, sprayAltM: 3,
  transitSpeed: 10, spraySpeed: 3, spacingM,
});

const allPasses = (frags: Pass[][]) => frags.flat();

/** Perpendicular distance from a point to a segment, in metres. */
function distToSegM(p: LatLng2, a: LatLng2, b: LatLng2): number {
  const mLng = mPerDegLng(p.lat);
  const px = (p.lng - a.lng) * mLng, py = (p.lat - a.lat) * M_PER_DEG_LAT;
  const bx = (b.lng - a.lng) * mLng, by = (b.lat - a.lat) * M_PER_DEG_LAT;
  const len2 = bx * bx + by * by;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
  return Math.hypot(px - bx * t, py - by * t);
}

/** How far the worst-covered point of a zone sits from the nearest spray line. */
function worstUncoveredM(zone: LatLng2[], frags: Pass[][], samples = 60): number {
  const segs = allPasses(frags).flatMap(p => p.segs);
  if (!segs.length) return Infinity;
  const lats = zone.map(p => p.lat), lngs = zone.map(p => p.lng);
  const [lo, hi] = [Math.min(...lats), Math.max(...lats)];
  const [w, e] = [Math.min(...lngs), Math.max(...lngs)];
  let worst = 0;
  for (let i = 0; i <= samples; i++) {
    for (let j = 0; j <= samples; j++) {
      const p = {
        lat: lo + ((hi - lo) * i) / samples,
        lng: w + ((e - w) * j) / samples,
      };
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
        && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) {
      inside = !inside;
    }
  }
  return inside;
}

/** Bearing of a pass, folded to 0–180° so direction of travel does not matter. */
function passBearingDeg(pass: Pass): number {
  const a = pass.segs[0].a, b = pass.segs[pass.segs.length - 1].b;
  const dy = (b.lat - a.lat) * M_PER_DEG_LAT;
  const dx = (b.lng - a.lng) * mPerDegLng(a.lat);
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg < 0) deg += 180;
  return deg % 180;
}

const passLengthM = (pass: Pass) =>
  pass.segs.reduce((s, seg) => s + distM(seg.a, seg.b), 0);

describe("spacing comes from the aircraft's boom", () => {
  it("is one swath less the overlap, per drone", () => {
    expect(passSpacingM(T40)).toBeCloseTo(9 * 0.9, 9);
    expect(passSpacingM(DRONE_SPECS["DJI Agras T30"])).toBeCloseTo(6.5 * 0.9, 9);
    expect(passSpacingM(DRONE_SPECS["XAG P100 Pro"])).toBeCloseTo(10 * 0.9, 9);
  });

  it("changes when the drone changes", () => {
    const spacings = ["DJI Agras T40", "DJI Agras T30", "XAG V40"]
      .map(k => passSpacingM(DRONE_SPECS[k]));
    expect(new Set(spacings).size).toBe(3);
    for (const k of ["DJI Agras T40", "DJI Agras T30", "XAG V40"]) {
      // Never wider than the boom: a lane wider than the spray pattern is a gap.
      expect(passSpacingM(DRONE_SPECS[k])).toBeLessThan(DRONE_SPECS[k].spray_swath_m);
    }
  });

  it("refuses an overlap that would be double application by construction", () => {
    const daft = { ...T40, spray_overlap: 0.9 };
    expect(passSpacingM(daft)).toBeCloseTo(9 * 0.5, 9);
    const negative = { ...T40, spray_overlap: -1 };
    expect(passSpacingM(negative)).toBeCloseTo(9, 9);
  });

  it("falls back to a real width for an aircraft with no boom", () => {
    // A survey drone has no swath. Zero would divide a field into infinitely
    // many passes, so the Custom profile's width stands in.
    expect(effectiveSwathM(DRONE_SPECS["DJI Mavic 3M"])).toBe(6);
    expect(passSpacingM(DRONE_SPECS["DJI Mavic 3M"])).toBeCloseTo(5.4, 9);
  });
});

describe("passes are laid one boom apart", () => {
  const ZONE = rect(LAT + 100 / M_PER_DEG_LAT, LNG + 100 / mPerDegLng(LAT), 120, 100);
  const spacing = passSpacingM(T40);

  it("puts adjacent lines exactly a spacing apart, not a cell or a guess", () => {
    const passes = allPasses(buildFieldSweep([FIELD], [{ id: "z", ring: ZONE }], spacing));
    expect(passes.length).toBeGreaterThan(1);
    // The field's long axis is east-west, so lanes are constant-latitude lines.
    const lats = passes.map(p => p.segs[0].a.lat).sort((a, b) => a - b);
    for (let i = 1; i < lats.length; i++) {
      expect((lats[i] - lats[i - 1]) * M_PER_DEG_LAT).toBeCloseTo(spacing, 3);
    }
  });

  it("lays far fewer lines than the old tight spacing, in proportion", () => {
    const oldSpacing = 2;
    const before = allPasses(buildFieldSweep([FIELD], [{ id: "z", ring: ZONE }], oldSpacing)).length;
    const after = allPasses(buildFieldSweep([FIELD], [{ id: "z", ring: ZONE }], spacing)).length;
    expect(after).toBeLessThan(before);
    // Pass count scales with 1/spacing, so the ratio is the spacing ratio.
    expect(after / before).toBeCloseTo(oldSpacing / spacing, 1);
  });

  it("covers every square metre of the zone all the same", () => {
    const frags = buildFieldSweep([FIELD], [{ id: "z", ring: ZONE }], spacing);
    // Every point in the zone must fall under some pass's boom: within half a
    // swath of a line. This is the constraint the whole change is bounded by.
    expect(worstUncoveredM(ZONE, frags)).toBeLessThanOrEqual(effectiveSwathM(T40) / 2 + 0.05);
  });

  it("still covers a zone narrower than a single lane", () => {
    // One centred pass, and the boom is wider than the strip.
    const sliver = rect(LAT + 150 / M_PER_DEG_LAT, LNG + 150 / mPerDegLng(LAT), 60, 5);
    const frags = buildFieldSweep([FIELD], [{ id: "z", ring: sliver }], spacing);
    expect(allPasses(frags)).toHaveLength(1);
    expect(worstUncoveredM(sliver, frags)).toBeLessThanOrEqual(effectiveSwathM(T40) / 2 + 0.05);
  });

  it("keeps covering the zone at every drone's own spacing", () => {
    for (const key of ["DJI Agras T40", "DJI Agras T30", "DJI Agras T25", "XAG P100 Pro", "XAG V40"]) {
      const spec = DRONE_SPECS[key];
      const frags = buildFieldSweep([FIELD], [{ id: "z", ring: ZONE }], passSpacingM(spec));
      expect(worstUncoveredM(ZONE, frags), key)
        .toBeLessThanOrEqual(effectiveSwathM(spec) / 2 + 0.05);
    }
  });

  it("halves the spacing for a double-coverage pass, and no more", () => {
    // Double coverage means lanes at half the distance, not the same lanes flown
    // twice — so the claim to check is the step, not the count. The count then
    // follows from it, give or take the one lane a rounded-up division adds.
    const stepOf = (repeats: number) => {
      const lats = allPasses(buildFieldSweep([FIELD], [{ id: "z", ring: ZONE }], spacing, repeats))
        .map(p => p.segs[0].a.lat).sort((a, b) => a - b);
      return (lats[1] - lats[0]) * M_PER_DEG_LAT;
    };
    expect(stepOf(1)).toBeCloseTo(spacing, 3);
    expect(stepOf(2)).toBeCloseTo(spacing / 2, 3);

    const once = allPasses(buildFieldSweep([FIELD], [{ id: "z", ring: ZONE }], spacing, 1)).length;
    const twice = allPasses(buildFieldSweep([FIELD], [{ id: "z", ring: ZONE }], spacing, 2)).length;
    expect(Math.abs(twice - once * 2)).toBeLessThanOrEqual(1);
  });
});

describe("passes run along the zone's long axis", () => {
  const spacing = passSpacingM(T40);
  // A long strip lying ACROSS the field: 200 m north-south, 30 m wide, inside a
  // field whose own long axis runs east-west.
  const CROSSWISE = rect(LAT + 50 / M_PER_DEG_LAT, LNG + 180 / mPerDegLng(LAT), 30, 200);

  it("flies the strip down its length, not across it", () => {
    const passes = allPasses(buildFieldSweep([FIELD], [{ id: "z", ring: CROSSWISE }], spacing));
    // Along the length: ~30 m of width to cover, so a handful of long passes.
    expect(passes.length).toBeLessThanOrEqual(6);
    for (const p of passes) expect(passLengthM(p)).toBeGreaterThan(150);
    // Following the field's heading instead would be ~25 passes of 30 m, which
    // is 25 U-turns to cover the same ground.
    expect(passes.length).toBeLessThan(200 / spacing / 2);
  });

  it("runs them square to the field, which is where the cells are", () => {
    const passes = allPasses(buildFieldSweep([FIELD], [{ id: "z", ring: CROSSWISE }], spacing));
    const fieldDeg = (principalAxisAngle([FIELD]) * 180) / Math.PI;
    const bearing = passBearingDeg(passes[0]);
    const offSquare = Math.abs(((bearing - fieldDeg - 90) % 180 + 270) % 180 - 90);
    expect(offSquare).toBeLessThan(1);
  });

  it("does not chase a few degrees of noise off the field heading", () => {
    // Nearly aligned with the field: snapping keeps passes parallel to the crop
    // rows and to the treatment-grid lattice, which share that heading.
    const nearlyAligned = turned(
      rect(LAT + 100 / M_PER_DEG_LAT, LNG + 100 / mPerDegLng(LAT), 150, 60), 5);
    const passes = allPasses(buildFieldSweep([FIELD], [{ id: "z", ring: nearlyAligned }], spacing));
    const fieldDeg = (principalAxisAngle([FIELD]) * 180) / Math.PI;
    expect(Math.abs(passBearingDeg(passes[0]) - fieldDeg)).toBeLessThan(1);
  });

  it("follows a zone that genuinely lies on the diagonal", () => {
    const diagonal = turned(
      rect(LAT + 120 / M_PER_DEG_LAT, LNG + 120 / mPerDegLng(LAT), 160, 40), 45);
    const passes = allPasses(buildFieldSweep([FIELD], [{ id: "z", ring: diagonal }], spacing));
    expect(Math.abs(passBearingDeg(passes[0]) - 45)).toBeLessThan(2);
    expect(worstUncoveredM(diagonal, passes.length ? [passes] : []))
      .toBeLessThanOrEqual(effectiveSwathM(T40) / 2 + 0.05);
  });
});

describe("over a painted treatment grid", () => {
  // The case that matters in practice: cells painted at the T40's own swath,
  // projected into zones, flown at the T40's own spacing. A cell is a lane the
  // aircraft can fly, so every painted one has to end up under a boom.
  const PLOT = [rect(LAT, LNG, 126, 90)];
  const GRID = buildTreatmentGrid(PLOT, gridDefinitionFor(PLOT, effectiveSwathM(T40)));
  const spacing = passSpacingM(T40);

  const painted = (() => {
    const parsed = GRID.cells.map(c => parseCellId(c.id)!);
    const col0 = Math.min(...parsed.map(p => p.col)) + 1;
    const row0 = Math.min(...parsed.map(p => p.row)) + 1;
    const want = new Set<string>();
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) want.add(`${col0 + i},${row0 + j}`);
    return {
      ...GRID,
      cells: GRID.cells.map(c => {
        const p = parseCellId(c.id)!;
        return want.has(`${p.col},${p.row}`)
          ? { ...c, rate: { state: "treated", rateLha: 25, source: "operator" } as CellRate }
          : c;
      }),
    };
  })();

  const zones = gridZonesFor(painted);
  const frags = buildFieldSweep(PLOT, zones.map(z => ({ id: z.id, ring: z.ring })), spacing);

  it("leaves no marked cell unsprayed", () => {
    const segs = allPasses(frags).flatMap(p => p.segs);
    expect(segs.length).toBeGreaterThan(0);
    for (const c of painted.cells) {
      if (c.rate.state !== "treated") continue;
      // Every corner and the centre of a painted cell, under some boom.
      for (const p of [...c.ring, c.centroid]) {
        const nearest = Math.min(...segs.map(s => distToSegM(p, s.a, s.b)));
        expect(nearest).toBeLessThanOrEqual(effectiveSwathM(T40) / 2 + 0.05);
      }
    }
  });

  it("does it in about one lane per cell row, not many", () => {
    // Three cell rows of 9 m is 27 m of width; at 8.1 m lanes that is 4 passes.
    // The old tight spacing would have flown this a dozen times over.
    expect(allPasses(frags).length).toBeLessThanOrEqual(5);
  });
});

describe("the downstream numbers follow the corrected route", () => {
  const ZONE = rect(LAT + 80 / M_PER_DEG_LAT, LNG + 80 / mPerDegLng(LAT), 150, 120);
  const spacing = passSpacingM(T40);
  const dense = buildMission([FIELD], [{ id: "z", ring: ZONE }], PARAMS(2));
  const correct = buildMission([FIELD], [{ id: "z", ring: ZONE }], PARAMS(spacing));

  const statsFor = (mission: typeof dense) => computeMissionStats({
    mission, spec: T40, sprayAltM: 3, transitAltM: 30, tankLoadPct: 80,
    zones: [{ areaM2: polygonAreaM2(ZONE), rateLha: 25 }],
    wx: null,
  });

  it("flies less distance and so less time", () => {
    expect(correct.sprayDistM).toBeLessThan(dense.sprayDistM * 0.5);
    expect(statsFor(correct).flightTimeMinutes).toBeLessThan(statsFor(dense).flightTimeMinutes);
  });

  it("draws less battery for the same ground", () => {
    expect(statsFor(correct).batteriesNeeded).toBeLessThanOrEqual(statsFor(dense).batteriesNeeded);
  });

  it("does not change the chemical, because that was never about the path", () => {
    // Volume is area × rate. A more efficient route treats the same hectares,
    // so the Prescription panel's figure must not move — if it did, one of the
    // two numbers would be derived from the wrong thing.
    const fromPanel = pesticideLitres([{ areaM2: polygonAreaM2(ZONE), rateLha: 25 }]);
    expect(statsFor(correct).pesticideAmountLiters).toBeCloseTo(fromPanel, 9);
    expect(statsFor(dense).pesticideAmountLiters).toBeCloseTo(fromPanel, 9);
  });

  it("keeps covering the zone after all that", () => {
    const frags = buildFieldSweep([FIELD], [{ id: "z", ring: ZONE }], spacing);
    expect(worstUncoveredM(ZONE, frags)).toBeLessThanOrEqual(effectiveSwathM(T40) / 2 + 0.05);
  });
});
