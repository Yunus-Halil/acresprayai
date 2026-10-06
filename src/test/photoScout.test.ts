// Photo Scout: the planting pattern of one photo, on a rendered stand.
//
// The scene is drawn in the photo's own frame (x right, y up, metres from
// the top-left corner, exactly as pattern.ts reads it): soil, plant discs on
// rows at a known angle, pitch and seed spacing, then the faults the pass
// must find: a stretch of missing plants (skips), a plant beside another
// (double), a plant midway between two planted ones (between plants) and
// greens between the rows (off-row).
import piexif from "piexifjs";
import { describe, expect, it } from "vitest";
import { estimateGsd, parsePhotoHeader } from "@/lib/photoScout/exif";
import { analysePhoto, placeOnRows, planWindows, rowSegmentsPx, type PhotoPixels } from "@/lib/photoScout/pattern";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

type Stand = {
  widthPx: number; heightPx: number; gsdM: number;
  angleDeg: number; pitchM: number; seedM: number; plantRadiusM: number;
  /** Along-row stretches with no plants, by row index. */
  skips?: { row: number; from: number; to: number }[];
  /** Extra plants at (row, along). */
  extra?: { row: number; along: number }[];
  /** Greens between rows at (row + 0.5, along). */
  weeds?: { row: number; along: number; r: number }[];
  seed?: number;
};

function renderStand(s: Stand): { px: PhotoPixels; plants: number } {
  const { widthPx: W, heightPx: H, gsdM: g } = s;
  const rgba = new Uint8ClampedArray(W * H * 4);
  const rand = rng(s.seed ?? 3);
  const th = (s.angleDeg * Math.PI) / 180;
  const cx = (W / 2) * g, cy = -(H / 2) * g;
  const tx = Math.cos(th), ty = Math.sin(th), nx = -Math.sin(th), ny = Math.cos(th);
  const toGround = (row: number, along: number) => ({ x: cx + along * tx + row * s.pitchM * nx, y: cy + along * ty + row * s.pitchM * ny });
  const discs: { x: number; y: number; r: number }[] = [];
  const span = Math.hypot(W, H) * g;
  const kMax = Math.ceil(span / s.pitchM);
  let plants = 0;
  for (let k = -kMax; k <= kMax; k++) {
    for (let a = -span; a <= span; a += s.seedM) {
      if ((s.skips ?? []).some(sk => sk.row === k && a > sk.from && a < sk.to)) continue;
      const p = toGround(k, a);
      if (p.x < 0 || p.x > W * g || p.y > 0 || p.y < -H * g) continue;
      discs.push({ ...p, r: s.plantRadiusM });
      plants++;
    }
  }
  for (const e of s.extra ?? []) discs.push({ ...toGround(e.row, e.along), r: s.plantRadiusM });
  for (const w of s.weeds ?? []) discs.push({ ...toGround(w.row + 0.5, w.along), r: w.r });
  // Rasterise: a cell grid keyed by pixel keeps this O(pixels + discs).
  const green = new Uint8Array(W * H);
  for (const d of discs) {
    const px = d.x / g, py = -d.y / g, rp = d.r / g;
    for (let j = Math.max(0, Math.floor(py - rp)); j <= Math.min(H - 1, Math.ceil(py + rp)); j++) {
      for (let i = Math.max(0, Math.floor(px - rp)); i <= Math.min(W - 1, Math.ceil(px + rp)); i++) {
        if ((i + 0.5 - px) ** 2 + (j + 0.5 - py) ** 2 <= rp * rp) green[j * W + i] = 1;
      }
    }
  }
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    if (green[i]) { rgba[o] = 58; rgba[o + 1] = 128; rgba[o + 2] = 40; }
    else { rgba[o] = 118 + (rand() - 0.5) * 16; rgba[o + 1] = 92 + (rand() - 0.5) * 16; rgba[o + 2] = 66 + (rand() - 0.5) * 16; }
    rgba[o + 3] = 255;
  }
  return { px: { width: W, height: H, rgba }, plants };
}

const norm180 = (a: number) => ((a % 180) + 180) % 180;
const angleDiff = (a: number, b: number) => { const d = Math.abs(norm180(a) - norm180(b)); return Math.min(d, 180 - d); };

describe("Photo Scout on a rendered stand at 1 cm/px", () => {
  const stand: Stand = {
    widthPx: 1200, heightPx: 900, gsdM: 0.01,
    angleDeg: 20, pitchM: 0.762, seedM: 0.2, plantRadiusM: 0.04,
    skips: [{ row: 1, from: 1.0, to: 2.2 }],
    extra: [{ row: 2, along: 0.08 }, { row: -2, along: 0.5 }],
    weeds: [
      { row: 0, along: -1, r: 0.05 }, { row: 1, along: 2.5, r: 0.06 }, { row: -1, along: 0.3, r: 0.04 },
      { row: 3, along: -2, r: 0.05 }, { row: -3, along: 1.4, r: 0.07 }, { row: 2, along: -0.7, r: 0.05 },
    ],
  };

  it("finds the row direction, the row spacing and the seed spacing", async () => {
    const { px } = renderStand(stand);
    const r = await analysePhoto(px, { gsdM: 0.01, rowSpacingM: 0.762 }, { yieldBetweenWindows: false });
    expect(r.summary.usableWindows).toBeGreaterThan(0);
    expect(angleDiff(r.summary.medianAngleDeg!, 20)).toBeLessThan(1.5);
    expect(Math.abs(r.summary.medianPitchM! - 0.762) / 0.762).toBeLessThan(0.05);
    expect(r.summary.seedSpacingM).not.toBeNull();
    expect(Math.abs(r.summary.seedSpacingM! - 0.2) / 0.2).toBeLessThan(0.1);
    expect(r.summary.seedAgreement!).toBeGreaterThan(0.8);
  });

  it("puts the planted plants on pattern and the faults in their own classes", async () => {
    const { px, plants } = renderStand(stand);
    const r = await analysePhoto(px, { gsdM: 0.01, rowSpacingM: 0.762 }, { yieldBetweenWindows: false });
    const s = r.summary;
    // Every planted plant that is not cut by the edge is a blob; nearly all are on pattern.
    expect(s.onPattern).toBeGreaterThan(plants * 0.85);
    expect(s.offRow).toBeGreaterThanOrEqual(5);
    expect(s.offRow).toBeLessThanOrEqual(7);
    expect(s.doubles).toBeGreaterThanOrEqual(1);
    expect(s.betweenPlants).toBeGreaterThanOrEqual(1);
    // 1.2 m with no plants at 0.2 m spacing is a gap of six spacings: five missing.
    expect(s.skips).toBeGreaterThanOrEqual(4);
    expect(s.skips).toBeLessThanOrEqual(7);
    // The classes the UI colours are the only ones that exist, and none is a verdict.
    for (const b of r.blobs) expect(["on pattern", "double", "between plants", "off-row", "unplaced"]).toContain(b.cls);
    expect(JSON.stringify(r.notes).toLowerCase()).not.toContain("weed");
  });

  it("draws row segments through every usable window", async () => {
    const { px } = renderStand(stand);
    const r = await analysePhoto(px, { gsdM: 0.01, rowSpacingM: 0.762 }, { yieldBetweenWindows: false });
    for (const w of r.windows.filter(w => w.usable)) {
      const segs = rowSegmentsPx(w, r.gsdM);
      expect(segs.length).toBeGreaterThan(2);
      // Each segment runs along the fitted direction in pixel space (y flipped).
      const seg = segs[0];
      const a = (Math.atan2(-(seg.y2 - seg.y1), seg.x2 - seg.x1) * 180) / Math.PI;
      expect(angleDiff(a, w.fit.angleDeg)).toBeLessThan(0.01);
    }
  });

  it("says so when there is no row pattern", async () => {
    const rand = rng(11);
    const W = 600, H = 400;
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { const o = i * 4; rgba[o] = 118; rgba[o + 1] = 92; rgba[o + 2] = 66; rgba[o + 3] = 255; }
    for (let n = 0; n < 150; n++) {
      const x = Math.floor(rand() * W), y = Math.floor(rand() * H);
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H || dx * dx + dy * dy > 9) continue;
        const o = (yy * W + xx) * 4; rgba[o] = 58; rgba[o + 1] = 128; rgba[o + 2] = 40;
      }
    }
    const r = await analysePhoto({ width: W, height: H, rgba }, { gsdM: 0.01, rowSpacingM: 0.762 }, { yieldBetweenWindows: false });
    expect(r.summary.usableWindows).toBe(0);
    expect(r.blobs.every(b => b.cls === "unplaced")).toBe(true);
    expect(r.notes.join(" ")).toMatch(/No window of this photo showed a row pattern/);
  });

  it("refuses without a pixel size or a row spacing", async () => {
    const px: PhotoPixels = { width: 8, height: 8, rgba: new Uint8ClampedArray(8 * 8 * 4) };
    await expect(analysePhoto(px, { gsdM: 0, rowSpacingM: 0.762 })).rejects.toThrow(/pixel size/);
    await expect(analysePhoto(px, { gsdM: 0.01, rowSpacingM: 0 })).rejects.toThrow(/row spacing/);
  });
});

describe("placing a point on a window's rows", () => {
  const fit = { centre: { x: 5, y: -5 }, sizeM: 10, angleDeg: 0, pitchM: 0.8, phaseM: 0.1, confidence: 1, angleConfidence: 1, pitchConfidence: 1, vegetationFraction: 0.2, pitchFromGrower: false, recoveredPitchM: 0.8 };
  it("gives the row index, the signed offset across and the position along", () => {
    // Rows run along x at y = -5 + 0.1 + k * 0.8.
    const p = placeOnRows(fit, 7, -5 + 0.1 + 2 * 0.8 + 0.05);
    expect(p.rowIndex).toBe(2);
    expect(p.acrossM).toBeCloseTo(0.05, 6);
    expect(p.alongM).toBeCloseTo(2, 6);
  });
  it("tiles the photo so every pixel is in exactly one window", () => {
    const ws = planWindows(1000, 700, 0.01, 3);
    expect(ws.length).toBe(Math.round(1000 / 300) * Math.round(700 / 300));
    const covered = new Uint8Array(1000 * 700);
    for (const w of ws) for (let y = w.y0; y <= w.y1; y++) for (let x = w.x0; x <= w.x1; x++) covered[y * 1000 + x]++;
    expect(covered.every(c => c === 1)).toBe(true);
  });
});

/** A JPEG that is only its header: SOI, an EXIF APP1, a DJI XMP APP1, EOI. */
function headerJpeg(exif: Record<string, Record<number, unknown>>, xmp: string | null): Uint8Array {
  const seg = (payload: string) => {
    const len = payload.length + 2;
    return "\xff\xe1" + String.fromCharCode((len >> 8) & 0xff, len & 0xff) + payload;
  };
  let bin = "\xff\xd8" + seg(piexif.dump(exif));
  if (xmp) bin += seg("http://ns.adobe.com/xap/1.0/\0" + xmp);
  bin += "\xff\xd9";
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

describe("the pixel size from what the photo says about itself", () => {
  const p4 = {
    "0th": { [piexif.ImageIFD.Make]: "DJI", [piexif.ImageIFD.Model]: "FC6310" },
    Exif: {
      [piexif.ExifIFD.FocalLength]: [880, 100], [piexif.ExifIFD.FocalLengthIn35mmFilm]: 24,
      [piexif.ExifIFD.PixelXDimension]: 5472, [piexif.ExifIFD.PixelYDimension]: 3648,
      [piexif.ExifIFD.DateTimeOriginal]: "2026:10:06 09:30:00",
    },
    GPS: {
      [piexif.GPSIFD.GPSLatitudeRef]: "N", [piexif.GPSIFD.GPSLatitude]: [[37, 1], [30, 1], [0, 1]],
      [piexif.GPSIFD.GPSLongitudeRef]: "W", [piexif.GPSIFD.GPSLongitude]: [[78, 1], [0, 1], [0, 1]],
      [piexif.GPSIFD.GPSAltitudeRef]: 0, [piexif.GPSIFD.GPSAltitude]: [1234, 10],
    },
  };
  const xmp = '<x:xmpmeta><rdf:Description drone-dji:RelativeAltitude="+30.20" drone-dji:GimbalPitchDegree="-90.00"/></x:xmpmeta>';

  it("reads EXIF and the DJI height, and estimates about 0.8 cm/px for a Phantom 4 at 30 m", () => {
    const e = parsePhotoHeader(headerJpeg(p4, xmp));
    expect(e.make).toBe("DJI");
    expect(e.focalMm).toBeCloseTo(8.8, 6);
    expect(e.width).toBe(5472);
    expect(e.relativeAltitudeM).toBeCloseTo(30.2, 6);
    expect(e.gimbalPitchDeg).toBeCloseTo(-90, 6);
    expect(e.lat).toBeCloseTo(37.5, 6);
    expect(e.lng).toBeCloseTo(-78, 6);
    expect(e.gpsAltitudeM).toBeCloseTo(123.4, 6);
    const g = estimateGsd(e);
    // 30.2 m x 13.2 mm sensor / (8.8 mm x 5472 px)
    expect(g.gsdM).toBeCloseTo((30.2 * 13.2) / (8.8 * 5472), 4);
    expect(g.basis).toMatch(/height above take-off/);
  });

  it("has no pixel size without a height, and takes a typed one", () => {
    const e = parsePhotoHeader(headerJpeg(p4, null));
    expect(e.relativeAltitudeM).toBeNull();
    expect(estimateGsd(e).gsdM).toBeNull();
    const g = estimateGsd(e, { heightM: 60 });
    expect(g.gsdM).toBeCloseTo((60 * 13.2) / (8.8 * 5472), 4);
    expect(g.basis).toMatch(/height you typed/);
    // A copy drawn at half width has pixels twice the size.
    expect(estimateGsd(e, { heightM: 60, imageWidth: 2736 }).gsdM).toBeCloseTo(g.gsdM! * 2, 6);
  });

  it("survives bytes that are not a JPEG", () => {
    const e = parsePhotoHeader(new Uint8Array([1, 2, 3, 4]));
    expect(e.focalMm).toBeNull();
    expect(estimateGsd(e).gsdM).toBeNull();
  });
});
