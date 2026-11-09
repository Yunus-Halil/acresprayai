// @vitest-environment node
// The photograph check: every photograph left out is counted with a plain reason, the build gets only the ones
// that pass, and a pick that cannot make a twin is stopped before anything runs.
import { describe, expect, it } from "vitest";
import type { DjiPhotoMeta } from "@/lib/directGeoref/metadata";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { type CheckInput, PILOT_LIMITS, assessPhotographs, jpegPixelSize, readForCheck } from "@/lib/fieldTwin/preflight";

/** A Phantom 4 RTK frame at 36 m, straight down: about 1 cm of ground per pixel. */
function meta(over: Partial<DjiPhotoMeta> = {}): DjiPhotoMeta {
  return {
    make: "DJI", model: "FC6310R", width: 5472, height: 3648, focalMm: 8.8, focal35Mm: 24, capturedAt: "2026:06:01 10:00:00",
    lat: 38.9, lng: -76.9, positionSource: "xmp", absoluteAltitudeM: 80, relativeAltitudeM: 36, gimbalYawDeg: 0, gimbalPitchDeg: -90,
    gimbalRollDeg: 0, flightYawDeg: 0, flightPitchDeg: 0, flightRollDeg: 0, speedNorthMs: 0, speedEastMs: 0, speedDownMs: 0,
    calibratedFocalPx: 3666, opticalCenterX: 2736, opticalCenterY: 1824, dewarpFlag: 1, dewarpData: null,
    rtkFlag: 50, rtkStdLonM: 0.01, rtkStdLatM: 0.01, rtkStdHgtM: 0.02, ...over,
  };
}
/** A serpentine grid of `n` photographs 15 m apart. */
function flight(n: number, over: (k: number) => Partial<DjiPhotoMeta> = () => ({})): CheckInput[] {
  return Array.from({ length: n }, (_, k) => {
    const name = `DJI_${String(k + 1).padStart(4, "0")}.JPG`;
    return { name, path: `100MEDIA/${name}`, size: 8e6, meta: meta({ lat: 38.9 + Math.floor(k / 10) * 0.000135, lng: -76.9 + (k % 10) * 0.000173, ...over(k) }) };
  });
}

describe("photograph check", () => {
  it("a good flight: all usable, camera, ground resolution, area, RTK, buildable", () => {
    const c = assessPhotographs(flight(30), "corn");
    expect(c.usable).toHaveLength(30);
    expect(c.canBuild).toBe(true);
    expect(c.camera).toBe("DJI FC6310R");
    expect(c.gsdCm).toBeCloseTo(0.98, 1);
    expect(c.areaHa).toBeGreaterThan(0.3);
    expect(c.areaHa).toBeLessThan(2);
    expect(c.rtk).toBe("all");
    expect(c.findings.filter(f => f.level !== "note")).toEqual([]);
  });

  it("nothing is built before the crop is chosen", () => {
    expect(assessPhotographs(flight(30), null).canBuild).toBe(false);
  });

  it("every photograph left out is counted with its reason, and the rest still build", () => {
    const c = assessPhotographs(flight(20, k => (k < 3 ? { lat: null, lng: null } : k < 5 ? { relativeAltitudeM: null } : k === 5 ? { gimbalPitchDeg: -45 } : k === 6 ? { calibratedFocalPx: null, focalMm: null } : {})), "corn");
    expect(c.usable).toHaveLength(13);
    expect(c.canBuild).toBe(true);
    const text = c.findings.map(f => f.text).join("\n");
    expect(text).toMatch(/3 photographs left out: they have no position in the file/);
    expect(text).toMatch(/2 photographs left out: they lack the drone's height and camera angle/);
    expect(text).toMatch(/1 photograph left out: taken with the camera tilted/);
    expect(text).toMatch(/1 photograph left out: it carries no lens information/);
    expect(13 + 3 + 2 + 1 + 1).toBe(20);
  });

  it("photographs from another make of drone are refused in plain words, and the pick stops", () => {
    const c = assessPhotographs(flight(12, () => ({ make: "Autel", model: "EVO II", relativeAltitudeM: null, gimbalPitchDeg: null, gimbalYawDeg: null })), "orchard");
    expect(c.usable).toEqual([]);
    expect(c.canBuild).toBe(false);
    expect(c.findings.find(f => f.level === "stop")!.text).toMatch(/None of these photographs can be used/);
    expect(c.findings.map(f => f.text).join(" ")).toMatch(/not from a DJI drone/);
  });

  it("the same file name in two folders stops the build: two flights or two card folders", () => {
    const a = flight(10), b = flight(10).map(i => ({ ...i, path: `101MEDIA/${i.name}` }));
    const c = assessPhotographs([...a, ...b], "corn");
    expect(c.canBuild).toBe(false);
    expect(c.usable).toEqual([]);
    expect(c.findings[0]).toMatchObject({ level: "stop", text: expect.stringMatching(/more than one folder.*Pick one flight's folder/) });
  });

  it("a participant's oversized flight is stopped; the founder's is only warned", () => {
    const n = PILOT_LIMITS.maxPhotographs + 1;
    expect(assessPhotographs(flight(n), "corn", "participant").canBuild).toBe(false);
    const f = assessPhotographs(flight(n), "corn", "founder");
    expect(f.canBuild).toBe(true);
    expect(f.findings.some(x => x.level === "warning" && /one block/.test(x.text))).toBe(true);
  });

  it("a flight bigger than any tried so far is said, not refused", () => {
    const c = assessPhotographs(flight(PILOT_LIMITS.testedPhotographs + 20), "orchard");
    expect(c.canBuild).toBe(true);
    expect(c.findings.some(f => f.level === "note" && /more than Swardus has been tried on/.test(f.text))).toBe(true);
  });

  it("corn flown too high is warned about, with what it means", () => {
    const c = assessPhotographs(flight(20, () => ({ relativeAltitudeM: 120 })), "corn");
    expect(c.gsdCm).toBeGreaterThan(3);
    expect(c.canBuild).toBe(true);
    expect(c.findings.find(f => f.level === "warning")!.text).toMatch(/reading corn plants needs about 1 cm/);
  });

  it("mixed cameras, two flights hours apart and a far-away photograph are each said", () => {
    const c = assessPhotographs(flight(20, k => (k === 0 ? { model: "FC3411" } : k === 1 ? { capturedAt: "2026:06:01 19:30:00" } : k === 2 ? { lat: 39.0 } : {})), "orchard");
    const text = c.findings.map(f => f.text).join("\n");
    expect(text).toMatch(/come from 2 cameras/);
    expect(text).toMatch(/more than six hours apart/);
    expect(text).toMatch(/more than 3 km from the others/);
  });

  it("without RTK, the map offset is said", () => {
    const c = assessPhotographs(flight(10, () => ({ rtkFlag: 16 })), "orchard");
    expect(c.rtk).toBe("none");
    expect(c.findings.some(f => /without RTK/.test(f.text))).toBe(true);
  });

  it("TIFF files: left out for a participant with the reason, kept for the founder", () => {
    const tiffs = flight(10).map(i => ({ ...i, name: i.name.replace(".JPG", ".TIF"), path: i.path.replace(".JPG", ".TIF") }));
    const p = assessPhotographs(tiffs, "orchard", "participant");
    expect(p.usable).toEqual([]);
    expect(p.findings.some(f => /TIFF file.*Pick the \.JPG files/.test(f.text))).toBe(true);
    expect(assessPhotographs(tiffs, "orchard", "founder").usable).toHaveLength(10);
  });

  it("other files in the folder are counted, not silently ignored", () => {
    const c = assessPhotographs(flight(10), "corn", "participant", 3);
    expect(c.totalFiles).toBe(13);
    expect(c.findings[0].text).toMatch(/3 files skipped because they are not a JPEG photograph/);
  });

  it("reads headers in the browser and counts what is not a photograph", async () => {
    const files = [new File([new Uint8Array([1, 2, 3])], "DJI_0001.JPG"), new File(["x"], "DJI_0001.MP4"), new File(["x"], "notes.txt")];
    const r = await readForCheck(files);
    expect(r.otherFiles).toBe(2);
    expect(r.inputs).toHaveLength(1);
    const c = assessPhotographs(r.inputs, "corn", "participant", r.otherFiles);
    expect(c.canBuild).toBe(false);
    expect(c.findings.map(f => f.text).join(" ")).toMatch(/left out/);
  });

  it("reads the pixel size from the JPEG frame header when EXIF has none", () => {
    // SOI, an APP1 segment of 6 bytes, then SOF0: precision 8, height 3000, width 4000.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x06, 1, 2, 3, 4, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x0b, 0xb8, 0x0f, 0xa0, 0x03]);
    expect(jpegPixelSize(jpeg)).toEqual({ width: 4000, height: 3000 });
    expect(jpegPixelSize(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
    expect(jpegPixelSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  const FLIGHT = "D:/swardus-research/cornflight/Day023_Corn1-n40";
  it.skipIf(!existsSync(FLIGHT))("accepts the corn test flight, whose headers carry no EXIF image size", async () => {
    const names = readdirSync(FLIGHT).filter(n => /\.jpe?g$/i.test(n));
    const files = names.map(n => new File([readFileSync(`${FLIGHT}/${n}`)], n));
    const r = await readForCheck(files);
    const c = assessPhotographs(r.inputs, "corn", "participant", r.otherFiles);
    expect(c.findings.map(f => f.text).join(" ")).not.toMatch(/image size/);
    expect(c.usable.length).toBe(names.length);
  }, 60_000);
});
