// Direct photo georeferencing, part 1: what a DJI photograph says about where the camera was and how it looked.
//
// Every number the projection needs comes from the photograph's own header, and each one carries the reason it can
// be trusted (or the assumption it stands on). Nothing is filled in silently: a field the file does not hold is null,
// and frameFromDji refuses to build a camera that would need it.
//
// Read from EXIF (piexif, through the Photo Scout reader): make, model, pixel size, focal length, GPS.
// Read from DJI's XMP block (drone-dji: namespace):
//   GpsLatitude / GpsLongtitude      the camera position, 8 decimals (EXIF GPS is rounded to ~10 cm); DJI spells
//                                    "Longtitude" with the extra t, and both spellings are accepted
//   AbsoluteAltitude                 camera height in the aircraft's vertical datum (sea level or ellipsoid, model
//                                    dependent; not used by the flat-ground model)
//   RelativeAltitude                 camera height above the take-off point
//   GimbalYaw/Pitch/RollDegree       the camera's attitude in the local north-east-down frame. Checked on the
//                                    Phantom 4 RTK flight in directtestimagery (2026-10-26): gimbal roll stays 0.0
//                                    while the aircraft rolls up to 23 degrees, and gimbal yaw follows flight yaw on
//                                    every straight leg, so the angles are world-referenced, not airframe-relative
//   FlightYaw/Pitch/RollDegree       the aircraft's attitude (recorded, not used: the gimbal is stabilised)
//   CalibratedFocalLength            focal length in pixels
//   CalibratedOpticalCenterX/Y       principal point in pixels
//   DewarpFlag / DewarpData          1 = the camera already removed lens distortion (no coefficients written);
//                                    0 with DewarpData = a raw frame plus its per-unit Brown coefficients
//   RtkFlag / RtkStdLon/Lat/Hgt      50 = RTK fixed solution; the standard deviations are metres
import { app1Segments, parsePhotoHeader } from "../photoScout/exif";

export type DewarpData = {
  /** Calibration date as written. */
  date: string | null;
  fx: number; fy: number;
  /** Principal point offsets from the image centre, pixels (DJI writes offsets, not absolute positions). */
  dcx: number; dcy: number;
  k1: number; k2: number; p1: number; p2: number; k3: number;
};

export type DjiPhotoMeta = {
  make: string | null;
  model: string | null;
  width: number | null;
  height: number | null;
  focalMm: number | null;
  focal35Mm: number | null;
  capturedAt: string | null;
  lat: number | null;
  lng: number | null;
  /** Where lat/lng came from. */
  positionSource: "xmp" | "exif" | null;
  absoluteAltitudeM: number | null;
  relativeAltitudeM: number | null;
  gimbalYawDeg: number | null;
  gimbalPitchDeg: number | null;
  gimbalRollDeg: number | null;
  flightYawDeg: number | null;
  flightPitchDeg: number | null;
  flightRollDeg: number | null;
  calibratedFocalPx: number | null;
  opticalCenterX: number | null;
  opticalCenterY: number | null;
  dewarpFlag: number | null;
  dewarpData: DewarpData | null;
  rtkFlag: number | null;
  rtkStdLonM: number | null;
  rtkStdLatM: number | null;
  rtkStdHgtM: number | null;
};

const xmpField = (xmp: string, name: string): string | null => {
  const m = new RegExp(`drone-dji:${name}(?:="([^"]*)"|>([^<]*)<)`).exec(xmp);
  return m ? (m[1] ?? m[2] ?? "").trim() : null;
};
const xmpNumber = (xmp: string, ...names: string[]): number | null => {
  for (const n of names) {
    const s = xmpField(xmp, n);
    if (s == null || s === "") continue;
    const v = Number(s);
    if (Number.isFinite(v)) return v;
  }
  return null;
};

/** "2018-09-04;fx,fy,dcx,dcy,k1,k2,p1,p2,k3" to numbers; null for anything else. */
export function parseDewarpData(s: string | null): DewarpData | null {
  if (!s) return null;
  const [maybeDate, rest] = s.includes(";") ? s.split(";", 2) : [null, s];
  const v = rest.split(",").map(x => Number(x.trim()));
  if (v.length !== 9 || v.some(x => !Number.isFinite(x)) || v[0] <= 0 || v[1] <= 0) return null;
  return { date: maybeDate ? maybeDate.trim() : null, fx: v[0], fy: v[1], dcx: v[2], dcy: v[3], k1: v[4], k2: v[5], p1: v[6], p2: v[7], k3: v[8] };
}

/** Parse the leading bytes of a DJI JPEG (1 MB is plenty: EXIF and XMP sit at the front). */
export function parseDjiHeader(bytes: Uint8Array): DjiPhotoMeta {
  const exif = parsePhotoHeader(bytes);
  const { xmp } = app1Segments(bytes);
  const x = xmp ?? "";
  const xmpLat = xmpNumber(x, "GpsLatitude", "GPSLatitude");
  const xmpLng = xmpNumber(x, "GpsLongtitude", "GpsLongitude", "GPSLongitude", "GPSLongtitude");
  const hasXmpPos = xmpLat != null && xmpLng != null && !(xmpLat === 0 && xmpLng === 0);
  const hasExifPos = exif.lat != null && exif.lng != null;
  return {
    make: exif.make, model: exif.model, width: exif.width, height: exif.height,
    focalMm: exif.focalMm, focal35Mm: exif.focal35Mm, capturedAt: exif.capturedAt,
    lat: hasXmpPos ? xmpLat : hasExifPos ? exif.lat : null,
    lng: hasXmpPos ? xmpLng : hasExifPos ? exif.lng : null,
    positionSource: hasXmpPos ? "xmp" : hasExifPos ? "exif" : null,
    absoluteAltitudeM: xmpNumber(x, "AbsoluteAltitude"),
    relativeAltitudeM: xmpNumber(x, "RelativeAltitude"),
    gimbalYawDeg: xmpNumber(x, "GimbalYawDegree"),
    gimbalPitchDeg: xmpNumber(x, "GimbalPitchDegree"),
    gimbalRollDeg: xmpNumber(x, "GimbalRollDegree"),
    flightYawDeg: xmpNumber(x, "FlightYawDegree"),
    flightPitchDeg: xmpNumber(x, "FlightPitchDegree"),
    flightRollDeg: xmpNumber(x, "FlightRollDegree"),
    calibratedFocalPx: xmpNumber(x, "CalibratedFocalLength"),
    opticalCenterX: xmpNumber(x, "CalibratedOpticalCenterX"),
    opticalCenterY: xmpNumber(x, "CalibratedOpticalCenterY"),
    dewarpFlag: xmpNumber(x, "DewarpFlag"),
    dewarpData: parseDewarpData(xmpField(x, "DewarpData")),
    rtkFlag: xmpNumber(x, "RtkFlag"),
    rtkStdLonM: xmpNumber(x, "RtkStdLon"),
    rtkStdLatM: xmpNumber(x, "RtkStdLat"),
    rtkStdHgtM: xmpNumber(x, "RtkStdHgt"),
  };
}
