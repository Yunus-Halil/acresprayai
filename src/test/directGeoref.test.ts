import { describe, expect, it } from "vitest";
import {
  type GeorefFrame, type Intrinsics, GeorefError, TAKEOFF_DATUM, UNCALIBRATED_BORESIGHT, applyHomography, bilinear, clusterMatches, frameCorners,
  frameFootprint, frameFromDji, groundSampleAt, groundToPixel, homographyFrom4, matchPair, objectsToGround, parseDewarpData, parseDjiHeader,
  pixelToGround, rotationOf, enuFromCamera, takeoffPlane, triangulateRays, vegetationObjects, type DjiPhotoMeta, type GroundObject, type P2,
} from "@/lib/directGeoref";
import { adjust, applyCalibration, boresightOf, calibrateFromOverlap, emptyModel, evaluateTies, frameUnder, NO_CALIBRATION, phaseCorrelate, type BaseFrame, type PixelObject, type SoilTie } from "@/lib/directGeoref";
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

  it("caches the camera rotation per pose object and gives a new pose its own", () => {
    const f = frame(37);
    const r1 = rotationOf(f.pose), r2 = rotationOf(f.pose);
    expect(r2).toBe(r1);
    expect(Array.from(r1)).toEqual(Array.from(enuFromCamera(f.pose.attitude, f.pose.boresight)));
    const g = { ...f, pose: { ...f.pose, attitude: { ...f.pose.attitude, yawDeg: f.pose.attitude.yawDeg + 10 } } };
    const r3 = rotationOf(g.pose);
    expect(r3).not.toBe(r1);
    expect(Array.from(r3)).toEqual(Array.from(enuFromCamera(g.pose.attitude, g.pose.boresight)));
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

describe("phase correlation", () => {
  it("finds a sub-cell shift with the documented sign: b(x + dx, y + dy) ~ a(x, y)", () => {
    const n = 64, src = new Float64Array(96 * 96);
    let seed = 3;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let k = 0; k < src.length; k++) src[k] = rnd();
    // Smooth a little so bilinear resampling is faithful.
    const sm = new Float64Array(src.length);
    for (let y = 1; y < 95; y++) for (let x = 1; x < 95; x++) { let t = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) t += src[(y + dy) * 96 + x + dx]; sm[y * 96 + x] = t / 9; }
    const at = (x: number, y: number) => { const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0; return sm[y0 * 96 + x0] * (1 - fx) * (1 - fy) + sm[y0 * 96 + x0 + 1] * fx * (1 - fy) + sm[(y0 + 1) * 96 + x0] * (1 - fx) * fy + sm[(y0 + 1) * 96 + x0 + 1] * fx * fy; };
    const a = new Float64Array(n * n), b = new Float64Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { a[y * n + x] = at(x + 16, y + 16); b[y * n + x] = at(x + 16 - 3.4, y + 16 + 2.2); }
    const r = phaseCorrelate(a, b, n);
    expect(r.dx).toBeCloseTo(3.4, 0);
    expect(r.dy).toBeCloseTo(-2.2, 0);
    expect(Math.abs(r.dx - 3.4)).toBeLessThan(0.25);
    expect(r.peak).toBeGreaterThan(0.3);
  });

  it("a spectrum computed once correlates against many windows with the one-shot result, to the bit, and is not written into", async () => {
    const { spectrum, correlate } = await import("@/lib/directGeoref");
    const n = 32, a = new Float64Array(n * n), b = new Float64Array(n * n), c = new Float64Array(n * n);
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let k = 0; k < a.length; k++) { a[k] = rnd(); b[k] = rnd(); c[k] = rnd(); }
    const A = spectrum(a, n), re0 = Float64Array.from(A.re), im0 = Float64Array.from(A.im);
    expect(correlate(A, spectrum(b, n))).toEqual(phaseCorrelate(a, b, n));
    expect(correlate(A, spectrum(c, n))).toEqual(phaseCorrelate(a, c, n));
    expect(Array.from(A.re)).toEqual(Array.from(re0)); expect(Array.from(A.im)).toEqual(Array.from(im0));
  });
});

describe("block adjustment over pixel ties", () => {
  // Two legs flown NE and SW at 3.5 m/s, a small camera for speed.
  const small: Intrinsics = { width: 800, height: 534, fx: 540, fy: 540, cx: 400, cy: 267, distortion: null, basis: "test" };
  const mPerLat = 111319.49, mPerLng = 111319.49 * Math.cos((LAT * Math.PI) / 180);
  const at = (e: number, n: number) => ({ lat: LAT + n / mPerLat, lng: LNG + e / mPerLng });
  const legs: [number, number, number][] = [];
  for (const k of [-1, 0, 1, 2]) { legs.push([45, -7 + 7 * k, -7 + 7 * k]); legs.push([225, 7 + 7 * k, -21 + 7 * k]); }
  const speed = 3.5 / Math.SQRT2;
  const bases: BaseFrame[] = legs.map(([yaw, e, n], i) => {
    const p = at(e, n);
    return { frame: frame(yaw, -90, 0, { name: `f${i}`, intrinsics: small, lat: p.lat, lng: p.lng }), velocity: yaw === 45 ? [speed, speed] : [-speed, -speed] };
  });
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const ground = Array.from({ length: 400 }, () => at(-35 + 70 * rnd(), -35 + 70 * rnd()));
  const tiesUnder = (truth: ReturnType<typeof emptyModel>): SoilTie[] => {
    const fs = bases.map(b => frameUnder(b, truth));
    const out: SoilTie[] = [];
    for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) for (const g of ground) {
      const pa = groundToPixel(fs[i], g.lat, g.lng, truth.globals.groundOffsetM), pb = groundToPixel(fs[j], g.lat, g.lng, truth.globals.groundOffsetM);
      if (!pa?.inside || !pb?.inside) continue;
      out.push({ a: fs[i].name, b: fs[j].name, ua: pa.u, va: pa.v, ub: pb.u, vb: pb.v, lat: g.lat, lng: g.lng, peak: 1 });
    }
    return out;
  };

  it("recovers a shutter delay, a camera tilt and the ground height; held-out ties agree to millimetres", () => {
    const spec = { name: "global", globals: ["tiltAcrossDeg", "spinDeg", "groundOffsetM", "timingS"] as const };
    const truth = emptyModel({ ...spec, globals: [...spec.globals] }, bases);
    Object.assign(truth.globals, { tiltAcrossDeg: 1.2, spinDeg: -0.3, groundOffsetM: 0.4, timingS: 0.1 });
    const ties = tiesUnder(truth);
    const train = ties.filter((_, i) => i % 3), test = ties.filter((_, i) => i % 3 === 0);
    const r = adjust(bases, train, { ...spec, globals: [...spec.globals] });
    expect(r.model.globals.timingS).toBeCloseTo(0.1, 2);
    expect(r.model.globals.tiltAcrossDeg).toBeCloseTo(1.2, 2);
    expect(r.model.globals.groundOffsetM).toBeCloseTo(0.4, 1);
    const before = evaluateTies(new Map(bases.map(b => [b.frame.name, b])), emptyModel({ ...spec, globals: [...spec.globals] }, bases), test);
    const after = evaluateTies(new Map(bases.map(b => [b.frame.name, b])), r.model, test);
    expect(before.median).toBeGreaterThan(0.3);
    expect(after.median).toBeLessThan(0.01);
  });

  it("per-photo corrections move one displaced photo back, and the prior keeps the others home", () => {
    const spec = { name: "photo", globals: [] as never[], perPhoto: { keys: ["dE", "dN"] as ("dE" | "dN")[], sigma: { dE: 1, dN: 1 } } };
    const truth = emptyModel(spec, bases);
    truth.photo.get("f3")!.dE = 0.8;
    truth.photo.get("f3")!.dN = -0.5;
    const r = adjust(bases, tiesUnder(truth), spec);
    // Ties see only RELATIVE positions: f3 relative to the others is recovered exactly; how the correction is shared
    // between f3 and the block is the priors' call (equal priors: f3 moves 7/8 of it, the others 1/8 the other way).
    const others = [...r.model.photo].filter(([k]) => k !== "f3").map(([, v]) => v);
    const mean = (k: "dE" | "dN") => others.reduce((s2, v) => s2 + v[k], 0) / others.length;
    expect(r.model.photo.get("f3")!.dE - mean("dE")).toBeCloseTo(0.8, 2);
    expect(r.model.photo.get("f3")!.dN - mean("dN")).toBeCloseTo(-0.5, 2);
    for (const v of others) expect(Math.hypot(v.dE - mean("dE"), v.dN - mean("dN"))).toBeLessThan(0.02);
  });
});

describe("soil ties end to end", () => {
  it("finds soil ties between two rendered photographs and the adjustment recovers the hidden camera tilt", async () => {
    const { findSoilTies, greyRaster } = await import("@/lib/directGeoref");
    const small: Intrinsics = { width: 640, height: 480, fx: 900, fy: 900, cx: 320, cy: 240, distortion: null, basis: "test" };
    const mPerLat = 111319.49, mPerLng = 111319.49 * Math.cos((LAT * Math.PI) / 180);
    const at = (e: number, n: number) => ({ lat: LAT + n / mPerLat, lng: LNG + e / mPerLng });
    // Procedural soil: hashed value noise on 8 cm cells, two octaves, bilinear.
    const hash = (i: number, j: number) => { let h = (i * 374761393 + j * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    const noise = (x: number, y: number) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j; return hash(i, j) * (1 - fx) * (1 - fy) + hash(i + 1, j) * fx * (1 - fy) + hash(i, j + 1) * (1 - fx) * fy + hash(i + 1, j + 1) * fx * fy; };
    const soil = (e: number, n: number) => 90 + 70 * noise(e / 0.08, n / 0.08) + 40 * noise(e / 0.3 + 17, n / 0.3 - 5);
    const truthCal = { ...NO_CALIBRATION, tiltAcrossDeg: 1.5 };
    const legs: [number, number, number][] = [[45, 0, 0], [225, 4, -4]];
    const bases: BaseFrame[] = legs.map(([yaw, e, n], i) => { const p = at(e, n); return { frame: frame(yaw, -90, 0, { name: `s${i}`, intrinsics: small, lat: p.lat, lng: p.lng }), velocity: [0, 0] }; });
    const render = (f: GeorefFrame) => {
      const real = applyCalibration(f, truthCal, "truth");
      const rgba = new Uint8ClampedArray(640 * 480 * 4);
      for (let v = 0; v < 480; v++) for (let u = 0; u < 640; u++) {
        const g = pixelToGround(real, u + 0.5, v + 0.5)!;
        const en = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, { lat: LAT, lng: LNG, altM: 0 });
        const val = soil(en[0], en[1]);
        rgba.set([val, val * 0.95, val * 0.85, 255], (v * 640 + u) * 4);
      }
      return greyRaster({ width: 640, height: 480, rgba }, 1);
    };
    const ra = render(bases[0].frame), rb = render(bases[1].frame);
    const tieOpts = { fineRes: 0.04, fineN: 32, coarseRes: 0.08, coarseN: 128, stepM: 1.2, maxPerPair: 60, minPeak: 0.1 };
    const r = findSoilTies(bases[0].frame, ra, bases[1].frame, rb, tieOpts);
    expect(r.coarseShiftM).not.toBeNull();
    expect(r.ties.length).toBeGreaterThan(15);
    // The first photograph's windows kept across its pairs: the same ties, to the bit, from the memo.
    const { windowCacheFor } = await import("@/lib/directGeoref");
    const memo = windowCacheFor(bases[0].frame.name, tieOpts.fineRes, tieOpts.fineN);
    const r1 = findSoilTies(bases[0].frame, ra, bases[1].frame, rb, tieOpts, memo);
    expect(memo.windows.size).toBeGreaterThan(0);
    const r2 = findSoilTies(bases[0].frame, ra, bases[1].frame, rb, tieOpts, memo);
    expect(r1.ties).toEqual(r.ties); expect(r2.ties).toEqual(r.ties); expect(r2.rejected).toEqual(r.rejected);
    const fit = adjust(bases, r.ties, { name: "tilt", globals: ["tiltAcrossDeg"] });
    expect(fit.model.globals.tiltAcrossDeg).toBeCloseTo(1.5, 1);
    expect(fit.train.median).toBeLessThan(0.02);
  }, 30000);
});

describe("reconciling observations into objects", () => {
  it("one object per plant, at its own height, never two sightings from one photo, coverage counted", async () => {
    const { reconcile } = await import("@/lib/directGeoref");
    const mPerLat = 111319.49, mPerLng = 111319.49 * Math.cos((LAT * Math.PI) / 180);
    const at = (e: number, n: number) => ({ lat: LAT + n / mPerLat, lng: LNG + e / mPerLng });
    const cams = [[0, 0, 45], [7, 7, 45], [14, -14, 225], [21, -7, 225]].map(([e, n, yaw], i) => { const p = at(e, n); return frame(yaw, -90, 0, { name: `p${i}`, lat: p.lat, lng: p.lng }); });
    const frames = new Map(cams.map(f => [f.name, f]));
    // A 1.2 m tree 1.5 m tall, two small weeds 0.15 m apart on the soil, one weed only one camera's detector saw.
    const plants = [
      { key: "tree", e: 10, n: 0, h: 1.5, size: 1.2, seenBy: ["p0", "p1", "p2", "p3"] },
      { key: "w1", e: 8, n: -3, h: 0, size: 0.08, seenBy: ["p0", "p1", "p2", "p3"] },
      { key: "w2", e: 8.15, n: -3, h: 0, size: 0.08, seenBy: ["p0", "p1", "p2", "p3"] },
      { key: "w3", e: 6, n: 2, h: 0, size: 0.1, seenBy: ["p1"] },
    ];
    const obs = cams.flatMap(f => plants.filter(p => p.seenBy.includes(f.name)).map((p, i) => {
      const g = at(p.e, p.n), px = groundToPixel(f, g.lat, g.lng, p.h)!;
      return { frame: f.name, id: i + 1, u: px.u, v: px.v, sizeM: p.size, areaM2: (Math.PI * p.size * p.size) / 4, touchesEdge: !px.inside, data: { key: p.key } };
    }));
    const out = reconcile(obs, frames);
    const byKey = (k: string) => out.filter(o => o.members.some(m => m.data?.key === k));
    expect(byKey("tree")).toHaveLength(1);
    const tree = byKey("tree")[0];
    expect(tree.seenBy).toBe(4);
    expect(tree.heightM!).toBeCloseTo(1.5, 2);
    expect(tree.viewSpreadM).toBeLessThan(0.01);
    const t = toEnu({ lat: tree.lat, lng: tree.lng, altM: 0 }, { lat: LAT, lng: LNG, altM: 0 });
    expect(Math.hypot(t[0] - 10, t[1])).toBeLessThan(0.01);
    // The two close weeds stay two objects, each seen four times; no object holds one photo twice.
    expect(byKey("w1")).toHaveLength(1);
    expect(byKey("w2")).toHaveLength(1);
    expect(byKey("w1")[0]).not.toBe(byKey("w2")[0]);
    for (const o of out) expect(new Set(o.members.map(m => m.frame)).size).toBe(o.members.length);
    // The weed one detector saw: one view, but more photographs covered it.
    const w3 = byKey("w3")[0];
    expect(w3.seenBy).toBe(1);
    expect(w3.coveredBy).toBeGreaterThan(1);
  });
});
