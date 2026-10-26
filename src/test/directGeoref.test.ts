import { describe, expect, it } from "vitest";
import {
  type GeorefFrame, type Intrinsics, GeorefError, TAKEOFF_DATUM, UNCALIBRATED_BORESIGHT, applyHomography, bilinear, clusterMatches, frameCorners,
  frameFootprint, frameFromDji, groundSampleAt, groundToPixel, homographyFrom4, matchPair, objectsToGround, parseDewarpData, parseDjiHeader,
  pixelToGround, takeoffPlane, triangulateRays, vegetationObjects, type DjiPhotoMeta, type GroundObject, type P2,
} from "@/lib/directGeoref";
import { applyCalibration, boresightOf, calibrateFromOverlap, NO_CALIBRATION, type PixelObject } from "@/lib/directGeoref";
import { toEnu } from "@/lib/sourceFrames/odm";

// A Phantom 4 RTK-like camera: 5472 x 3648, f = 3666.67 px, principal point at the centre.
const K: Intrinsics = { width: 5472, height: 3648, fx: 3666.666504, fy: 3666.666504, cx: 2736, cy: 1824, distortion: null, basis: "test" };
const LAT = 10, LNG = 20;

function frame(yaw: number, pitch = -90, roll = 0, opts: Partial<GeorefFrame> & { alt?: number; lat?: number; lng?: number } = {}): GeorefFrame {
  return {
    name: opts.name ?? "f",
    intrinsics: opts.intrinsics ?? K,
    ground: opts.ground ?? takeoffPlane(),
    pose: {
      lat: opts.lat ?? LAT, lng: opts.lng ?? LNG, altM: opts.alt ?? 36, datum: TAKEOFF_DATUM,
      attitude: { yawDeg: yaw, pitchDeg: pitch, rollDeg: roll, basis: "test" }, boresight: UNCALIBRATED_BORESIGHT, basis: "test",
    },
  };
}
const enu = (p: { lat: number; lng: number }, o = { lat: LAT, lng: LNG }) => toEnu({ ...p, altM: 0 }, { ...o, altM: 0 });

describe("conventions", () => {
  it("nadir, yaw 0: the centre is straight below, the top faces north, the right faces east", () => {
    const f = frame(0);
    const c = pixelToGround(f, 2736, 1824)!;
    expect(Math.hypot(c.eastM, c.northM)).toBeLessThan(1e-9);
    expect(c.offNadirDeg).toBeLessThan(1e-6);
    const top = pixelToGround(f, 2736, 0)!;
    expect(top.eastM).toBeCloseTo(0, 9);
    expect(top.northM).toBeCloseTo((36 * 1824) / 3666.666504, 6);
    const right = pixelToGround(f, 5472, 1824)!;
    expect(right.eastM).toBeCloseTo((36 * 2736) / 3666.666504, 6);
    expect(right.northM).toBeCloseTo(0, 9);
  });

  it("yaw is clockwise from north: at yaw 90 the top of the image faces east", () => {
    const top = pixelToGround(frame(90), 2736, 0)!;
    expect(top.eastM).toBeGreaterThan(17);
    expect(Math.abs(top.northM)).toBeLessThan(1e-6);
    const t40 = pixelToGround(frame(40), 2736, 0)!;
    expect((Math.atan2(t40.eastM, t40.northM) * 180) / Math.PI).toBeCloseTo(40, 6);
  });

  it("pitch above -90 looks forward: the centre ray lands ahead along the heading", () => {
    const c = pixelToGround(frame(0, -80), 2736, 1824)!;
    expect(c.northM).toBeCloseTo(36 * Math.tan((10 * Math.PI) / 180), 6);
    expect(c.offNadirDeg).toBeCloseTo(10, 6);
  });

  it("roll at nadir: ZYX (default) spins the image about the optical axis; ZXY (gimbal motor order) tips the view", () => {
    const zyx = frame(0, -90, 5);
    const c1 = pixelToGround(zyx, 2736, 1824)!;
    expect(Math.hypot(c1.eastM, c1.northM)).toBeLessThan(1e-9);
    const zxy = frame(0, -90, 5);
    zxy.pose.attitude.order = "ZXY";
    const c2 = pixelToGround(zxy, 2736, 1824)!;
    expect(Math.abs(c2.eastM)).toBeCloseTo(36 * Math.tan((5 * Math.PI) / 180), 6);
    // Positive roll = right side down, so the optical axis swings to the left of the heading (west at yaw 0).
    expect(c2.eastM).toBeLessThan(0);
    expect(Math.abs(c2.northM)).toBeLessThan(1e-9);
  });

  it("the two orders agree whenever roll is 0", () => {
    const a = frame(-137.3, -84), b = frame(-137.3, -84);
    b.pose.attitude.order = "ZXY";
    const p = pixelToGround(a, 100, 3000)!, q = pixelToGround(b, 100, 3000)!;
    expect(Math.hypot(p.eastM - q.eastM, p.northM - q.northM)).toBeLessThan(1e-9);
  });

  it("ground sample distance at the centre of a nadir frame is height / focal", () => {
    expect(groundSampleAt(frame(33), 2736, 1824)!).toBeCloseTo(36 / 3666.666504, 8);
  });

  it("refuses a ground in another vertical datum", () => {
    const f = frame(0, -90, 0, { ground: { kind: "flat", altM: 600, datum: "ellipsoid", basis: "x" } });
    expect(() => pixelToGround(f, 1, 1)).toThrow(GeorefError);
  });

  it("returns null for a ray at or above the horizon", () => {
    expect(pixelToGround(frame(0, 0), 2736, 1000)).toBeNull();
  });
});

describe("round trips", () => {
  const distorted: Intrinsics = { ...K, cx: 2750.5, cy: 1810.25, fy: 3660, distortion: { k1: -0.12, k2: 0.05, k3: -0.01, p1: 0.0001, p2: -0.0002 } };
  for (const [name, f] of [["nadir pinhole", frame(40.4)], ["tilted with Brown distortion", frame(-137.3, -84, 2.5, { intrinsics: distorted })]] as const) {
    it(`pixel -> ground -> pixel is exact (${name})`, () => {
      for (const [u, v] of [[0, 0], [5472, 0], [5472, 3648], [0, 3648], [1234.5, 2987.25], [2736, 1824]]) {
        const g = pixelToGround(f, u, v)!;
        const p = groundToPixel(f, g.lat, g.lng, g.altM)!;
        expect(Math.abs(p.u - u)).toBeLessThan(1e-4);
        expect(Math.abs(p.v - v)).toBeLessThan(1e-4);
      }
    });
  }

  it("no ray where the lens polynomial folds back (no inverse exists): null, never a wrong ground point", () => {
    const folded = frame(0, -90, 0, { intrinsics: { ...K, distortion: { k1: -0.27, k2: 0.11, k3: -0.035, p1: 0, p2: 0 } } });
    expect(pixelToGround(folded, 0, 0)).toBeNull();
    expect(pixelToGround(folded, 2736, 1824)).not.toBeNull();
  });

  it("a point behind the camera has no pixel", () => {
    expect(groundToPixel(frame(0), LAT, LNG, 50)).toBeNull();
  });
});

describe("ground models", () => {
  it("a surface that is flat everywhere gives the flat answer", () => {
    const flat = frame(25, -88);
    const surf = frame(25, -88, 0, { ground: { kind: "surface", altAt: () => 0, datum: TAKEOFF_DATUM, basis: "test" } });
    const a = pixelToGround(flat, 300, 3000)!, b = pixelToGround(surf, 300, 3000)!;
    expect(Math.hypot(a.eastM - b.eastM, a.northM - b.northM)).toBeLessThan(1e-6);
  });

  it("a sloped surface: the answer lies on the surface and on the pixel's ray", () => {
    const slope = (lat: number, lng: number) => 0.08 * enu({ lat, lng })[0] + 0.5; // 8 % rise to the east
    const f = frame(60, -90, 0, { ground: { kind: "surface", altAt: slope, datum: TAKEOFF_DATUM, basis: "test" } });
    const g = pixelToGround(f, 5000, 400)!;
    expect(g.altM).toBeCloseTo(slope(g.lat, g.lng), 3);
    const p = groundToPixel(f, g.lat, g.lng, g.altM)!;
    expect(Math.abs(p.u - 5000)).toBeLessThan(0.05);
    expect(Math.abs(p.v - 400)).toBeLessThan(0.05);
  });

  it("raising the declared ground by dh moves a point toward the nadir by distance x dh / height", () => {
    const lo = pixelToGround(frame(0), 5472, 1824)!, hi = pixelToGround(frame(0, -90, 0, { ground: takeoffPlane(1) }), 5472, 1824)!;
    expect(lo.eastM - hi.eastM).toBeCloseTo((lo.eastM * 1) / 36, 6);
  });
});

describe("four corners are enough on flat ground, if the interpolation is projective", () => {
  const cornersPx: P2[] = [[0, 0], [5472, 0], [5472, 3648], [0, 3648]];
  const groundOf = (f: GeorefFrame) => frameCorners(f)!.map(g => [g.eastM, g.northM] as P2);
  const worst = (f: GeorefFrame, interp: (s: number, t: number) => P2) => {
    let w = 0;
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
      const u = (5472 * i) / 10, v = (3648 * j) / 10;
      const g = pixelToGround(f, u, v)!;
      const q = interp(u, v);
      w = Math.max(w, Math.hypot(q[0] - g.eastM, q[1] - g.northM));
    }
    return w;
  };
  it("homography from the 4 corners reproduces the ray cast everywhere, tilted or not", () => {
    for (const f of [frame(40), frame(116.6, -93.7, -1.9)]) {
      const H = homographyFrom4(cornersPx, groundOf(f))!;
      expect(worst(f, (u, v) => applyHomography(H, u, v))).toBeLessThan(1e-6);
    }
  });
  it("bilinear interpolation is exact only straight down; a turn frame (pitch -93.7, roll -1.9) is off by centimetres", () => {
    const nadir = frame(40), turn = frame(116.6, -93.7, -1.9);
    expect(worst(nadir, (u, v) => bilinear(groundOf(nadir), u / 5472, v / 3648))).toBeLessThan(1e-6);
    const err = worst(turn, (u, v) => bilinear(groundOf(turn), u / 5472, v / 3648));
    expect(err).toBeGreaterThan(0.05);
  });
  it("the footprint border passes through the corners", () => {
    const f = frame(12, -87);
    const ring = frameFootprint(f, 4)!, c = frameCorners(f)!;
    expect(ring).toHaveLength(16);
    expect(ring[0].lat).toBeCloseTo(c[0].lat, 12);
    expect(ring[4].lng).toBeCloseTo(c[1].lng, 12);
  });
});

describe("DJI header", () => {
  const xmp = [
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description',
    ' drone-dji:AbsoluteAltitude="+681.16" drone-dji:RelativeAltitude="+35.98"',
    ' drone-dji:GpsLatitude="12.34567890" drone-dji:GpsLongtitude="-1.23456789"',
    ' drone-dji:GimbalRollDegree="+0.00" drone-dji:GimbalYawDegree="+40.40" drone-dji:GimbalPitchDegree="-90.00"',
    ' drone-dji:FlightRollDegree="-10.20" drone-dji:FlightYawDegree="+41.40" drone-dji:FlightPitchDegree="-4.60"',
    ' drone-dji:CalibratedFocalLength="3666.666504" drone-dji:CalibratedOpticalCenterX="2736.000000" drone-dji:CalibratedOpticalCenterY="1824.000000"',
    ' drone-dji:RtkFlag="50" drone-dji:RtkStdLon="0.01240" drone-dji:RtkStdLat="0.01054" drone-dji:RtkStdHgt="0.01972" drone-dji:DewarpFlag="1"',
    "></rdf:Description></rdf:RDF></x:xmpmeta>",
  ].join("");
  const jpegHead = () => {
    const payload = new TextEncoder().encode(`http://ns.adobe.com/xap/1.0/\0${xmp}`);
    const len = payload.length + 2;
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...payload, 0xff, 0xda, 0, 2]);
  };

  it("reads position, heights, gimbal, flight attitude, calibration, RTK and dewarp from the XMP", () => {
    const m = parseDjiHeader(jpegHead());
    expect(m.lat).toBeCloseTo(12.3456789, 8);
    expect(m.lng).toBeCloseTo(-1.23456789, 8);
    expect(m.positionSource).toBe("xmp");
    expect(m.relativeAltitudeM).toBe(35.98);
    expect(m.absoluteAltitudeM).toBe(681.16);
    expect([m.gimbalYawDeg, m.gimbalPitchDeg, m.gimbalRollDeg]).toEqual([40.4, -90, 0]);
    expect([m.flightYawDeg, m.flightPitchDeg, m.flightRollDeg]).toEqual([41.4, -4.6, -10.2]);
    expect(m.calibratedFocalPx).toBeCloseTo(3666.666504, 6);
    expect([m.opticalCenterX, m.opticalCenterY]).toEqual([2736, 1824]);
    expect(m.rtkFlag).toBe(50);
    expect(m.dewarpFlag).toBe(1);
    expect(m.dewarpData).toBeNull();
  });

  const base: DjiPhotoMeta = { ...parseDjiHeader(jpegHead()), width: 5472, height: 3648 };

  it("builds a pinhole camera for a dewarped frame and records every basis", () => {
    const r = frameFromDji("x", base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.frame.intrinsics.distortion).toBeNull();
    expect(r.frame.intrinsics.basis).toMatch(/DewarpFlag 1/);
    expect(r.frame.pose.basis).toMatch(/RTK fixed/);
    expect(r.frame.ground.basis).toMatch(/declared flat ground/);
    expect(r.frame.pose.altM).toBe(35.98);
    expect(r.notes).toEqual([]);
  });

  it("scales the intrinsics to a downsized decode", () => {
    const r = frameFromDji("x", base, { imageWidth: 1368, imageHeight: 912 });
    if ("reason" in r) throw new Error(r.reason);
    expect(r.frame.intrinsics.fx).toBeCloseTo(3666.666504 / 4, 6);
    expect(r.frame.intrinsics.cx).toBe(684);
  });

  it("uses per-unit DewarpData (offsets from the centre) on a raw frame", () => {
    const d = parseDewarpData("2018-09-04;3678.87,3671.84,10.09,-5.09,-0.268652,0.114663,0.000015,-0.000209,-0.035215")!;
    expect(d).toMatchObject({ date: "2018-09-04", fx: 3678.87, dcx: 10.09, k1: -0.268652, p2: -0.000209, k3: -0.035215 });
    const r = frameFromDji("x", { ...base, dewarpFlag: 0, dewarpData: d });
    if ("reason" in r) throw new Error(r.reason);
    expect(r.frame.intrinsics.cx).toBeCloseTo(2746.09, 6);
    expect(r.frame.intrinsics.cy).toBeCloseTo(1818.91, 6);
    expect(r.frame.intrinsics.distortion?.k1).toBe(-0.268652);
  });

  it("refuses rather than guesses", () => {
    expect(frameFromDji("x", { ...base, relativeAltitudeM: null })).toMatchObject({ ok: false });
    expect(frameFromDji("x", { ...base, gimbalYawDeg: null })).toMatchObject({ ok: false });
    expect(frameFromDji("x", { ...base, lat: null })).toMatchObject({ ok: false });
    expect(frameFromDji("x", base, { imageWidth: 1000, imageHeight: 1000 })).toMatchObject({ ok: false });
  });

  it("notes a position that is not RTK fixed", () => {
    const r = frameFromDji("x", { ...base, rtkFlag: 16 });
    expect(r.ok && r.notes.some(n => /not an RTK fixed/.test(n))).toBe(true);
  });
});

describe("vegetation objects", () => {
  // 200 x 100 raster of soil with one green square inside and one cut by the right edge.
  const W = 200, H = 100;
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) rgba.set([150, 120, 90, 255], i * 4);
  const paint = (x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) rgba.set([40, 140, 30, 255], (y * W + x) * 4); };
  paint(40, 20, 60, 40);
  paint(190, 50, 200, 70);
  const objs = vegetationObjects({ width: W, height: H, rgba }, 4);

  it("finds both patches, flags the one the frame cuts, and reports original-frame pixels", () => {
    expect(objs).toHaveLength(2);
    const inner = objs.find(o => !o.touchesEdge)!;
    expect(inner.u).toBeCloseTo(50 * 4, 6);
    expect(inner.v).toBeCloseTo(30 * 4, 6);
    expect(inner.areaPx).toBe(20 * 20 * 16);
    expect(objs.filter(o => o.touchesEdge)).toHaveLength(1);
    const xs = inner.hull.map(p => p[0]);
    expect(Math.min(...xs)).toBe(160);
    expect(Math.max(...xs)).toBe(240);
  });

  it("projects them: area on the ground = pixels x GSD squared", () => {
    const f = frame(0, -90, 0, { intrinsics: { ...K, width: 800, height: 400, cx: 400, cy: 200 } });
    const g = objectsToGround(f, objs);
    const inner = g.find(o => !o.touchesEdge)!;
    const gsd = 36 / 3666.666504;
    expect(inner.areaM2).toBeCloseTo(6400 * gsd * gsd, 6);
    expect(inner.outline.length).toBeGreaterThanOrEqual(4);
  });
});

describe("two photographs check each other", () => {
  it("triangulates two crossing rays exactly and measures a miss", () => {
    const t = triangulateRays([0, 0, 10], [1, 0, -1], [20, 0, 10], [-1, 0, -1])!;
    expect(t.point[0]).toBeCloseTo(10, 9);
    expect(t.point[2]).toBeCloseTo(0, 9);
    expect(t.missM).toBeCloseTo(0, 9);
    const m = triangulateRays([0, 0, 10], [1, 0, -1], [20, 0.3, 10], [-1, 0, -1])!;
    expect(m.missM).toBeCloseTo(0.3, 9);
  });

  it("an object 2 m above the declared ground: flat projections disagree by baseline x 2 / (36 - 2), triangulation finds 2 m with no miss", () => {
    // Two nadir frames 10 m apart along north, the same heading; four objects 2 m up, seen by both.
    const fa = frame(0, -90, 0, { name: "a" });
    const dLat = 10 / 111319.49;
    const fb = frame(0, -90, 0, { name: "b", lat: LAT + dLat });
    const truth = [[3, 5], [-6, 4], [8, 7], [-2, 9]].map(([e, n]) => ({ lat: LAT + n / 111319.49, lng: LNG + e / (111319.49 * Math.cos((LAT * Math.PI) / 180)) }));
    const objsIn = (f: GeorefFrame): GroundObject[] => objectsToGround(f, truth.map((p, i) => {
      const px = groundToPixel(f, p.lat, p.lng, 2)!;
      return { id: i + 1, u: px.u, v: px.v, hull: [[px.u - 50, px.v - 50], [px.u + 50, px.v - 50], [px.u + 50, px.v + 50], [px.u - 50, px.v + 50]], cells: 100, areaPx: 10000, touchesEdge: false };
    }));
    const ring = (f: GeorefFrame) => frameFootprint(f, 2)!.map(g => ({ lat: g.lat, lng: g.lng }));
    const r = matchPair(fa, objsIn(fa), fb, objsIn(fb), ring(fa), ring(fb));
    expect(r.matches).toHaveLength(4);
    expect(r.baselineM).toBeCloseTo(10, 3);
    for (const m of r.matches) {
      expect(m.distM).toBeCloseTo((10 * 2) / (36 - 2), 6);
      expect(m.tri!.altM).toBeCloseTo(2, 4);
      expect(m.tri!.missM).toBeLessThan(1e-4);
    }
    const clusters = clusterMatches([r]);
    expect(clusters).toHaveLength(4);
    for (const c of clusters) {
      const nearestTruth = Math.min(...truth.map(p => Math.hypot(...(enu(p, c).slice(0, 2) as [number, number]))));
      expect(nearestTruth).toBeLessThan(1e-3);
    }
  });

  it("a yaw error makes the rays miss, which a height error never does", () => {
    const fa = frame(0, -90, 0, { name: "a" });
    const dLat = 10 / 111319.49;
    const fbTrue = frame(0, -90, 0, { name: "b", lat: LAT + dLat });
    const fbWrong = frame(1, -90, 0, { name: "b", lat: LAT + dLat }); // 1 deg yaw error in b
    const p = { lat: LAT + 5 / 111319.49, lng: LNG + 12 / (111319.49 * Math.cos((LAT * Math.PI) / 180)) };
    const pa = groundToPixel(fa, p.lat, p.lng, 0)!, pb = groundToPixel(fbTrue, p.lat, p.lng, 0)!;
    const ca: [number, number, number] = [0, 0, 36];
    const cb: [number, number, number] = [0, 10, 36];
    const ray = (f: GeorefFrame, u: number, v: number) => {
      const g = pixelToGround(f, u, v)!;
      const o = toEnu({ lat: f.pose.lat, lng: f.pose.lng, altM: 0 }, { lat: LAT, lng: LNG, altM: 0 });
      return [g.eastM + o[0] - (f === fa ? 0 : 0), g.northM + o[1] - (f === fa ? 0 : 10), -36] as [number, number, number];
    };
    const good = triangulateRays(ca, ray(fa, pa.u, pa.v), cb, ray(fbTrue, pb.u, pb.v))!;
    const bad = triangulateRays(ca, ray(fa, pa.u, pa.v), cb, ray(fbWrong, pb.u, pb.v))!;
    expect(good.missM).toBeLessThan(1e-4);
    expect(bad.missM).toBeGreaterThan(0.05);
  });
});

describe("calibration from the flight's own overlap", () => {
  it("recovers a hidden camera tilt, spin and ground offset from patches seen on opposite legs", () => {
    // Small camera for speed: 800 x 534 px, f 540 px at 36 m (6.7 cm pixels). Two legs 20 m apart, flown NE and SW.
    const small: Intrinsics = { width: 800, height: 534, fx: 540, fy: 540, cx: 400, cy: 267, distortion: null, basis: "test" };
    const mPerLat = 111319.49, mPerLng = 111319.49 * Math.cos((LAT * Math.PI) / 180);
    const at = (e: number, n: number) => ({ lat: LAT + n / mPerLat, lng: LNG + e / mPerLng });
    const truth = { ...NO_CALIBRATION, tiltAcrossDeg: 1.5, spinDeg: -0.4, groundOffsetM: 0.3 };
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const pts = Array.from({ length: 260 }, () => at(-30 + 60 * rnd(), -30 + 60 * rnd()));
    const legs: [number, number, number][] = [];
    for (const k of [-1, 0, 1]) {
      // NE leg through (-7, -7)...; SW leg 20 m to the south-east.
      legs.push([45, -7 + 7 * k, -7 + 7 * k]);
      legs.push([225, 7 + 7 * k, -21 + 7 * k]);
    }
    const input = legs.map(([yaw, e, n], i) => {
      const p = at(e, n);
      const f = frame(yaw, -90, 0, { name: `f${i}`, intrinsics: small, lat: p.lat, lng: p.lng });
      const real = applyCalibration(f, { ...truth, origin: null }, "truth");
      const objects: PixelObject[] = [];
      pts.forEach((q, j) => {
        const px = groundToPixel(real, q.lat, q.lng, 0.3);
        if (!px || px.u < 5 || px.v < 5 || px.u > 795 || px.v > 529) return;
        objects.push({ id: j + 1, u: px.u, v: px.v, hull: [], cells: 3, areaPx: 20, touchesEdge: false });
      });
      return { frame: f, objects };
    });
    const r = calibrateFromOverlap(input, { tiltRangeDeg: 2, spinRangeDeg: 1, groundRangeM: 1 });
    expect(r.agreeingAfter).toBeGreaterThan(r.agreeingBefore);
    expect(r.calibration.tiltAcrossDeg).toBeCloseTo(1.5, 1);
    expect(Math.abs(r.calibration.spinDeg + 0.4)).toBeLessThan(0.1);
    expect(Math.abs(r.calibration.groundOffsetM - 0.3)).toBeLessThan(0.15);
    expect(Math.abs(r.calibration.tiltAlongDeg)).toBeLessThan(0.1);
  });

  it("the boresight angles act in the camera frame: a tilt across shifts opposite legs in opposite directions", () => {
    const tilt = boresightOf({ ...NO_CALIBRATION, tiltAcrossDeg: 1 }, "t");
    const ne = frame(45), sw = frame(225);
    ne.pose.boresight = tilt; sw.pose.boresight = tilt;
    const a = pixelToGround(ne, 2736, 1824)!, b = pixelToGround(sw, 2736, 1824)!;
    expect(a.eastM).toBeCloseTo(-b.eastM, 9);
    expect(a.northM).toBeCloseTo(-b.northM, 9);
    expect(Math.hypot(a.eastM, a.northM)).toBeCloseTo(36 * Math.tan(Math.PI / 180), 6);
  });
});
