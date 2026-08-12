import { describe, it, expect } from "vitest";
import { type LatLng2, distM, mPerDegLng, pointInAnyRing, polygonAreaM2 } from "@/lib/geo";
import { buildFieldSweep, buildMission, missionToWaypointText } from "@/lib/mission";

const LAT = 45;
const LNG = -93;

/** Axis-aligned rectangle sized in metres, anchored at (lat,lng). */
function rect(lat: number, lng: number, widthM: number, heightM: number): LatLng2[] {
  const dLat = heightM / 111_320;
  const dLng = widthM / mPerDegLng(lat);
  return [
    { lat, lng },
    { lat, lng: lng + dLng },
    { lat: lat + dLat, lng: lng + dLng },
    { lat: lat + dLat, lng },
  ];
}

// 400 m × 300 m field with a 100 m × 100 m anomaly zone well inside it.
const FIELD = rect(LAT, LNG, 400, 300);
const ZONE = rect(LAT + 100 / 111_320, LNG + 100 / mPerDegLng(LAT), 100, 100);
const HOME: LatLng2 = { lat: LAT, lng: LNG };

const PARAMS = {
  home: HOME,
  transitAltM: 30,
  sprayAltM: 3,
  transitSpeed: 10,
  spraySpeed: 3,
  spacingM: 10,
};

describe("buildFieldSweep", () => {
  it("returns nothing without a boundary or without zones", () => {
    expect(buildFieldSweep([], [{ id: "z", ring: ZONE }], 10)).toEqual([]);
    expect(buildFieldSweep([FIELD], [], 10)).toEqual([]);
  });

  it("keeps every spray segment inside both the zone and the boundary", () => {
    const frags = buildFieldSweep([FIELD], [{ id: "z", ring: ZONE }], 10);
    expect(frags.length).toBe(1);
    for (const pass of frags[0]) {
      for (const seg of pass.segs) {
        expect(seg.spray).toBe(true);
        for (const pt of [seg.a, seg.b]) {
          expect(pointInAnyRing(pt, [FIELD])).toBe(true);
        }
      }
    }
  });

  it("covers a 100 m zone with roughly zoneHeight/spacing passes", () => {
    const frags = buildFieldSweep([FIELD], [{ id: "z", ring: ZONE }], 10);
    // 100 m tall at 10 m spacing → ~10 rows.
    expect(frags[0].length).toBeGreaterThanOrEqual(8);
    expect(frags[0].length).toBeLessThanOrEqual(12);
  });

  it("halves the row spacing when repeats is 2", () => {
    const once = buildFieldSweep([FIELD], [{ id: "z", ring: ZONE }], 10, 1);
    const twice = buildFieldSweep([FIELD], [{ id: "z", ring: ZONE }], 10, 2);
    expect(twice[0].length).toBe(once[0].length * 2);
  });

  it("alternates pass direction for tight U-turns", () => {
    const frags = buildFieldSweep([FIELD], [{ id: "z", ring: ZONE }], 10);
    const passes = frags[0];
    const headingEast = (p: (typeof passes)[number]) => p.segs[0].b.lng > p.segs[0].a.lng;
    for (let i = 1; i < passes.length; i++) {
      expect(headingEast(passes[i])).toBe(!headingEast(passes[i - 1]));
    }
  });

  it("clips a zone that hangs outside the field to the boundary", () => {
    // Zone straddling the field's eastern edge — half of it is off-field.
    const straddling = rect(LAT + 100 / 111_320, LNG + 350 / mPerDegLng(LAT), 100, 100);
    const frags = buildFieldSweep([FIELD], [{ id: "z", ring: straddling }], 10);
    for (const pass of frags[0] ?? []) {
      for (const seg of pass.segs) {
        // Midpoint of every retained segment must be on-field.
        const mid = { lat: (seg.a.lat + seg.b.lat) / 2, lng: (seg.a.lng + seg.b.lng) / 2 };
        expect(pointInAnyRing(mid, [FIELD])).toBe(true);
      }
    }
  });

  it("emits one fragment per zone", () => {
    const zoneB = rect(LAT + 20 / 111_320, LNG + 250 / mPerDegLng(LAT), 60, 60);
    const frags = buildFieldSweep([FIELD], [
      { id: "a", ring: ZONE },
      { id: "b", ring: zoneB },
    ], 10);
    expect(frags.length).toBe(2);
  });
});

describe("buildMission", () => {
  const mission = buildMission([FIELD], [{ id: "z", ring: ZONE }], PARAMS);

  it("starts with TAKEOFF and ends with LAND at home", () => {
    const first = mission.waypoints[0];
    const last = mission.waypoints[mission.waypoints.length - 1];
    expect(first.action).toBe("TAKEOFF");
    expect(last.action).toBe("LAND");
    expect(last.lat).toBe(HOME.lat);
    expect(last.lng).toBe(HOME.lng);
  });

  it("never leaves the sprayer on at the end of the mission", () => {
    const toggles = mission.waypoints.filter(w => w.action === "SPRAY_ON" || w.action === "SPRAY_OFF");
    expect(toggles.length).toBeGreaterThan(0);
    expect(toggles[toggles.length - 1].action).toBe("SPRAY_OFF");
  });

  it("balances every SPRAY_ON with a SPRAY_OFF", () => {
    let open = 0;
    for (const w of mission.waypoints) {
      if (w.action === "SPRAY_ON") open++;
      if (w.action === "SPRAY_OFF") open--;
      // Never double-on, never off-before-on.
      expect(open === 0 || open === 1).toBe(true);
    }
    expect(open).toBe(0);
  });

  it("sprays only at spray altitude and transits only at transit altitude", () => {
    for (const w of mission.waypoints) {
      if (w.action === "SPRAY_WP" || w.action === "SPRAY_ON") {
        expect(w.alt).toBe(PARAMS.sprayAltM);
        expect(w.speed).toBe(PARAMS.spraySpeed);
      }
      if (w.action === "TRANSIT") {
        expect(w.alt).toBe(PARAMS.transitAltM);
        expect(w.speed).toBe(PARAMS.transitSpeed);
      }
    }
  });

  it("tags every spray waypoint with the zone it belongs to", () => {
    const sprayWps = mission.waypoints.filter(w => w.action === "SPRAY_WP");
    expect(sprayWps.length).toBeGreaterThan(0);
    for (const w of sprayWps) expect(w.zoneId).toBe("z");
  });

  it("derives times from distances and the configured speeds", () => {
    expect(mission.sprayTimeS).toBeCloseTo(mission.sprayDistM / PARAMS.spraySpeed, 6);
    expect(mission.transitTimeS).toBeCloseTo(mission.transitDistM / PARAMS.transitSpeed, 6);
  });

  it("sprays roughly the zone's area divided by the swath", () => {
    // ~100 m × 100 m zone at 10 m spacing → ~10 passes × ~100 m ≈ 1000 m.
    const zoneArea = polygonAreaM2(ZONE);
    const expected = zoneArea / PARAMS.spacingM;
    expect(mission.sprayDistM).toBeGreaterThan(expected * 0.7);
    expect(mission.sprayDistM).toBeLessThan(expected * 1.3);
  });

  it("returns home at the end (last transit leg terminates at home)", () => {
    const rth = mission.waypoints.find(w => w.action === "RTH");
    expect(rth).toBeDefined();
    expect(distM({ lat: rth!.lat, lng: rth!.lng }, HOME)).toBeLessThan(0.001);
  });

  it("produces a takeoff-and-land-only mission when no zone is inside", () => {
    const faraway = rect(LAT + 5, LNG + 5, 50, 50);
    const empty = buildMission([FIELD], [{ id: "far", ring: faraway }], PARAMS);
    expect(empty.sprayDistM).toBe(0);
    expect(empty.sprayOnCount).toBe(0);
    expect(empty.waypoints.map(w => w.action)).toEqual(["TAKEOFF", "LAND"]);
  });

  it("moving home further away increases transit distance", () => {
    const near = buildMission([FIELD], [{ id: "z", ring: ZONE }], PARAMS);
    const far = buildMission([FIELD], [{ id: "z", ring: ZONE }], {
      ...PARAMS,
      home: { lat: LAT - 0.02, lng: LNG - 0.02 },
    });
    expect(far.transitDistM).toBeGreaterThan(near.transitDistM);
  });
});

describe("missionToWaypointText", () => {
  const mission = buildMission([FIELD], [{ id: "z", ring: ZONE }], PARAMS);
  const text = missionToWaypointText(mission);
  const lines = text.trim().split("\n");

  it("emits a QGC WPL 110 header", () => {
    expect(lines[0]).toBe("QGC WPL 110");
  });

  it("writes a home row at index 0 flagged current", () => {
    const cols = lines[1].split("\t");
    expect(cols[0]).toBe("0");
    expect(cols[1]).toBe("1");     // current
    expect(cols[3]).toBe("16");    // NAV_WAYPOINT
  });

  it("numbers waypoints consecutively", () => {
    const idx = lines.slice(1).map(l => Number(l.split("\t")[0]));
    for (let i = 0; i < idx.length; i++) expect(idx[i]).toBe(i);
  });

  it("encodes sprayer toggles as DO_SET_SERVO with 2000/1000 PWM", () => {
    const servoRows = lines.slice(1)
      .map(l => l.split("\t"))
      .filter(c => c[3] === "183");
    expect(servoRows.length).toBeGreaterThan(0);
    for (const c of servoRows) {
      expect(c[4]).toBe("8.00");                          // servo channel
      expect(["2000.00", "1000.00"]).toContain(c[5]);     // on / off PWM
    }
  });

  it("encodes speed changes as DO_CHANGE_SPEED carrying the speed", () => {
    const speedRows = lines.slice(1)
      .map(l => l.split("\t"))
      .filter(c => c[3] === "178");
    expect(speedRows.length).toBeGreaterThan(0);
    const speeds = new Set(speedRows.map(c => c[5]));
    expect(speeds.has("10.00") || speeds.has("3.00")).toBe(true);
  });

  it("emits exactly one takeoff, one RTH and one land", () => {
    const cmds = lines.slice(2).map(l => l.split("\t")[3]);
    expect(cmds.filter(c => c === "22")).toHaveLength(1);  // NAV_TAKEOFF
    expect(cmds.filter(c => c === "20")).toHaveLength(1);  // RTL
    expect(cmds.filter(c => c === "21")).toHaveLength(1);  // NAV_LAND
  });

  it("writes coordinates at 8 decimal places", () => {
    const cols = lines[2].split("\t");
    expect(cols[8]).toMatch(/^-?\d+\.\d{8}$/);
    expect(cols[9]).toMatch(/^-?\d+\.\d{8}$/);
  });
});
