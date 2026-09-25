// The hero's three acts, held to the model they claim to show.
//
// Find, identify, fly. The picture, the label chips and the readouts under
// them are all driven from one timeline in lib/heroTelemetry.ts, and the CSS
// keyframes are generated from the same numbers. These tests are what stops
// the three from drifting: an act that overlaps the next, a finding that
// appears before the scan line reaches it, a wet patch the model quietly
// sprays, or a stylesheet that still animates last month's timing.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIELD_AREA_M2, FINDINGS, FLAGGED_AREA_M2, HERO_FLIGHT_FROM, HERO_FLIGHT_TO, HERO_IDENTIFY_FROM,
  HERO_IDENTIFY_TO, HERO_LOOP_MS, HERO_ROUTE_FROM, HERO_ROUTE_TO, HERO_SCAN_FROM, HERO_SCAN_TO,
  TREATED_ZONE_AREA_M2, WET_POLY, ZONE_POLYS, appearAt, buildHeroMission, identifyWindow, polyAreaM2,
  sprayingAt,
} from "@/lib/heroTelemetry";

const css = readFileSync(join(__dirname, "..", "index.css"), "utf-8");

describe("the three acts", () => {
  it("run in order and do not overlap", () => {
    expect(0).toBeLessThan(HERO_SCAN_FROM);
    expect(HERO_SCAN_FROM).toBeLessThan(HERO_SCAN_TO);
    expect(HERO_SCAN_TO).toBeLessThanOrEqual(HERO_IDENTIFY_FROM);
    expect(HERO_IDENTIFY_FROM).toBeLessThan(HERO_IDENTIFY_TO);
    expect(HERO_IDENTIFY_TO).toBeLessThanOrEqual(HERO_ROUTE_FROM);
    expect(HERO_ROUTE_FROM).toBeLessThan(HERO_ROUTE_TO);
    expect(HERO_ROUTE_TO).toBeLessThanOrEqual(HERO_FLIGHT_FROM);
    expect(HERO_FLIGHT_FROM).toBeLessThan(HERO_FLIGHT_TO);
    expect(HERO_FLIGHT_TO).toBeLessThanOrEqual(1);
  });

  it("are long enough to read, on a loop long enough to hold them", () => {
    // A scan that flashes past is a glitch, not a scan; an identify act too
    // short to read a chip is decoration. Two seconds each is the floor.
    const s = HERO_LOOP_MS / 1000;
    expect((HERO_SCAN_TO - HERO_SCAN_FROM) * s).toBeGreaterThanOrEqual(4);
    expect((HERO_IDENTIFY_TO - HERO_IDENTIFY_FROM) * s).toBeGreaterThanOrEqual(3);
    expect((HERO_FLIGHT_TO - HERO_FLIGHT_FROM) * s).toBeGreaterThanOrEqual(8);
  });
});

describe("the findings", () => {
  it("appear inside the scan act, in the order the sweep reaches them", () => {
    const times = FINDINGS.map(appearAt);
    for (const t of times) {
      expect(t).toBeGreaterThanOrEqual(HERO_SCAN_FROM);
      expect(t).toBeLessThanOrEqual(HERO_SCAN_TO);
    }
    // FINDINGS is declared top to bottom, and the sweep runs top to bottom.
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });

  it("are each given a turn in the identify act, back to back, and nothing else", () => {
    let cursor = HERO_IDENTIFY_FROM;
    FINDINGS.forEach((_, i) => {
      const [a, b] = identifyWindow(i);
      expect(a).toBeCloseTo(cursor, 10);
      expect(b).toBeGreaterThan(a);
      cursor = b;
    });
    expect(cursor).toBeCloseTo(HERO_IDENTIFY_TO, 10);
  });

  it("include one that is left alone, and the model never sprays it", () => {
    // The picture's precision-agriculture point in one shape. It is not in
    // ZONE_POLYS, so the flight model's spray rule cannot see it.
    const wet = FINDINGS.filter(f => !f.treat);
    expect(wet.length).toBe(1);
    expect(wet[0].poly).toBe(WET_POLY);
    expect(ZONE_POLYS).not.toContain(WET_POLY);
    // Sample its interior.
    const xs = WET_POLY.map(p => p[0]), ys = WET_POLY.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    expect(sprayingAt(cx, cy)).toBe(false);
    // And the treated ones are sprayed, so the contrast is real.
    for (const f of FINDINGS.filter(f => f.treat)) {
      const fx = f.poly.map(p => p[0]), fy = f.poly.map(p => p[1]);
      expect(sprayingAt((Math.min(...fx) + Math.max(...fx)) / 2, (Math.min(...fy) + Math.max(...fy)) / 2)).toBe(true);
    }
  });

  it("carry exactly one species name, and it is marked as the operator's", () => {
    // Identification is the operator's call. One finding shows what that looks
    // like; none of the others pretend the pixels named them.
    const named = FINDINGS.filter(f => f.name);
    expect(named.length).toBe(1);
    expect(named[0].treat).toBe(true);
  });
});

describe("the numbers on the panel", () => {
  it("come from the geometry, and nest the way ground does", () => {
    expect(FIELD_AREA_M2).toBeGreaterThan(0);
    expect(FLAGGED_AREA_M2).toBeGreaterThan(0);
    expect(TREATED_ZONE_AREA_M2).toBeGreaterThan(0);
    // Treated is a subset of flagged is a subset of the field.
    expect(TREATED_ZONE_AREA_M2).toBeLessThan(FLAGGED_AREA_M2);
    expect(FLAGGED_AREA_M2).toBeLessThan(FIELD_AREA_M2);
    // The difference is exactly the finding left alone.
    expect(FLAGGED_AREA_M2 - TREATED_ZONE_AREA_M2).toBeCloseTo(polyAreaM2(WET_POLY), 6);
  });

  it("describe a field a grower would recognise", () => {
    // The polygon sits inside a 560 x 260 m box and does not fill it: about
    // 9.7 ha, a normal block. A code comment used to say 14.5 ha, which was
    // the box. Most of the field is never sprayed, which is the whole story.
    const ha = FIELD_AREA_M2 / 10_000;
    expect(ha).toBeGreaterThan(9);
    expect(ha).toBeLessThan(11);
    expect(TREATED_ZONE_AREA_M2 / FIELD_AREA_M2).toBeLessThan(0.35);
  });

  it("report TREATED as what the passes cover, and never a bigger number before takeoff", () => {
    // TREATED on the panel is sprayed distance times the boom, what the
    // planner calls treated area. At this drawing's scale the passes are 25 m
    // apart against a 9 m boom, so that is well under the flagged polygons'
    // area. The panel has to use the swath figure in every act: quoting the
    // polygon before takeoff and the swath after would make the number fall
    // the moment the aircraft left the ground.
    const m = buildHeroMission();
    const sprayedM = m.segs.reduce((n, s) => n + (s.spray ? s.distEnd - s.distStart : 0), 0);
    expect(sprayedM).toBeGreaterThan(0);
    const swathM2 = sprayedM * 9;
    expect(swathM2).toBeGreaterThan(0);
    expect(swathM2).toBeLessThan(TREATED_ZONE_AREA_M2);
    // And it is a real share of the field, not a rounding error.
    expect(swathM2 / FIELD_AREA_M2).toBeGreaterThan(0.02);
  });
});

describe("the stylesheet", () => {
  const pct = (f: number) => `${(f * 100).toFixed(2)}%`;

  it("animates the same timeline the model reads", () => {
    // The keyframes are generated from these constants. If someone edits one
    // side by hand, the sweep on screen and the FOUND counter under it stop
    // agreeing about when a finding appeared.
    expect(css).toMatch(new RegExp(`@keyframes sw-b \\{ 0% \\{[^}]*\\} ${pct(HERO_SCAN_FROM)}, 100%`));
    expect(css).toMatch(new RegExp(`@keyframes sw-scan \\{[^}]*\\} ${pct(HERO_SCAN_FROM)} \\{[^}]*\\} ${pct(HERO_SCAN_TO)} \\{`));
    expect(css).toMatch(new RegExp(`@keyframes sw-r \\{ 0%, ${pct(HERO_ROUTE_FROM)} \\{[^}]*\\} ${pct(HERO_ROUTE_TO)}, 100%`));
    FINDINGS.forEach((f, i) => {
      expect(css).toMatch(new RegExp(`@keyframes sw-f${i + 1} \\{ 0%, ${pct(appearAt(f))} \\{ opacity: 0; \\}`));
      const [a] = identifyWindow(i);
      expect(css).toMatch(new RegExp(`@keyframes sw-h${i + 1} \\{ 0%, ${pct(a)} \\{ opacity: 0; \\}`));
    });
  });

  it("shows the finished picture, chips included, when motion is reduced", () => {
    expect(css).toMatch(/\[data-sw-anim\] \[data-sw-static-show\] \{ opacity: 1 !important; \}/);
  });
});
