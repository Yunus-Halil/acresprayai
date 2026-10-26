// Direct photo georeferencing, part 3: a camera built from a DJI photograph's own header.
//
// Every input carries its basis in words, so a result can always say what it stands on. Inputs the file cannot give
// (the ground's height, the camera-to-gimbal boresight) are declared by the caller or default to a declared
// assumption; frameFromDji refuses (returns the reason) rather than guess a number the file does not hold.
import type { DjiPhotoMeta } from "./metadata";
import { type Boresight, type GeorefFrame, type GroundModel, type Intrinsics, UNCALIBRATED_BORESIGHT } from "./projection";

/** The vertical datum of DJI's RelativeAltitude: metres above the take-off point. */
export const TAKEOFF_DATUM = "height above take-off";

/**
 * The declared flat-ground model for a frame with no terrain: a horizontal plane at the take-off height. Exact when
 * the field is level with the take-off point; a ground dh higher than that moves a point by (distance from the nadir
 * point) x dh / (flying height), outward from the nadir point (e.g. 25 m out, 1 m higher, 36 m up: 0.69 m).
 */
export function takeoffPlane(offsetM = 0): GroundModel {
  return {
    kind: "flat", altM: offsetM, datum: TAKEOFF_DATUM,
    basis: offsetM === 0
      ? "declared flat ground at the take-off height (no elevation model)"
      : `declared flat ground ${offsetM.toFixed(2)} m from the take-off height (no elevation model)`,
  };
}

export type FrameResult = { ok: true; frame: GeorefFrame; notes: string[] } | { ok: false; reason: string };

export type FrameOptions = {
  ground?: GroundModel;
  boresight?: Boresight;
  /** Decoded pixel size when it differs from the header's (a downsized copy): intrinsics are scaled to it. */
  imageWidth?: number;
  imageHeight?: number;
};

/** A georeferencing camera from a DJI header, or the reason one cannot be built. */
export function frameFromDji(name: string, m: DjiPhotoMeta, opts: FrameOptions = {}): FrameResult {
  const notes: string[] = [];
  if (m.lat == null || m.lng == null) return { ok: false, reason: "no camera position in the file" };
  if (m.relativeAltitudeM == null) return { ok: false, reason: "no RelativeAltitude: the camera's height above take-off is unknown" };
  if (m.gimbalYawDeg == null || m.gimbalPitchDeg == null) return { ok: false, reason: "no gimbal yaw/pitch: the camera's direction is unknown" };
  const W0 = m.width, H0 = m.height;
  if (!W0 || !H0) return { ok: false, reason: "no image size in the file" };
  const W = opts.imageWidth ?? W0, H = opts.imageHeight ?? H0;
  const s = W / W0;
  if (Math.abs(H / H0 - s) > 1e-3) return { ok: false, reason: "the decoded image is not a uniform rescale of the original (cropped?)" };

  let intrinsics: Intrinsics;
  if (m.dewarpData && m.dewarpFlag !== 1) {
    const d = m.dewarpData;
    intrinsics = {
      width: W, height: H, fx: d.fx * s, fy: d.fy * s, cx: (W0 / 2 + d.dcx) * s, cy: (H0 / 2 + d.dcy) * s,
      distortion: { k1: d.k1, k2: d.k2, k3: d.k3, p1: d.p1, p2: d.p2 },
      basis: `per-unit DJI calibration in XMP DewarpData (${d.date ?? "undated"}): raw frame, Brown distortion applied`,
    };
  } else if (m.calibratedFocalPx && m.opticalCenterX != null && m.opticalCenterY != null) {
    intrinsics = {
      width: W, height: H, fx: m.calibratedFocalPx * s, fy: m.calibratedFocalPx * s, cx: m.opticalCenterX * s, cy: m.opticalCenterY * s,
      distortion: null,
      basis: m.dewarpFlag === 1
        ? "XMP CalibratedFocalLength / CalibratedOpticalCenter; DewarpFlag 1 (distortion removed in camera, no coefficients written), so the frame is treated as a pinhole. The focal length equals the nominal 8.8 mm design value on the Phantom 4 RTK, not a per-unit calibration"
        : "XMP CalibratedFocalLength / CalibratedOpticalCenter; no DewarpData, lens distortion NOT modelled",
    };
    if (m.dewarpFlag !== 1) notes.push("lens distortion is not modelled: the file has neither DewarpFlag 1 nor DewarpData");
  } else if (m.focalMm && m.focal35Mm) {
    // 35 mm equivalence is by the diagonal (43.27 mm).
    const diagMm = (43.27 * m.focalMm) / m.focal35Mm;
    const pxPerMm = Math.hypot(W0, H0) / diagMm;
    const f = m.focalMm * pxPerMm * s;
    intrinsics = {
      width: W, height: H, fx: f, fy: f, cx: W / 2, cy: H / 2, distortion: null,
      basis: "EXIF focal length and 35 mm equivalent (sensor size inferred from the diagonal); principal point assumed at the image centre; lens distortion NOT modelled",
    };
    notes.push("intrinsics estimated from EXIF only: expect metre-level error at the frame edges");
  } else {
    return { ok: false, reason: "no focal length in pixels or millimetres" };
  }

  const ground = opts.ground ?? takeoffPlane();
  if (ground.datum !== TAKEOFF_DATUM && m.absoluteAltitudeM == null) return { ok: false, reason: `ground is in "${ground.datum}" but the file has no AbsoluteAltitude` };
  const altM = ground.datum === TAKEOFF_DATUM ? m.relativeAltitudeM : m.absoluteAltitudeM!;
  const datum = ground.datum === TAKEOFF_DATUM ? TAKEOFF_DATUM : ground.datum;
  const rtk = m.rtkFlag === 50 ? `RTK fixed (std ${[m.rtkStdLonM, m.rtkStdLatM, m.rtkStdHgtM].map(v => (v == null ? "?" : `${(v * 100).toFixed(1)} cm`)).join(" / ")} lon/lat/height)` : m.rtkFlag != null ? `RTK flag ${m.rtkFlag} (not a fixed solution)` : "GNSS without RTK flag (metre-level)";
  if (m.rtkFlag !== 50) notes.push("camera position is not an RTK fixed solution: absolute placement is metre-level");
  return {
    ok: true,
    notes,
    frame: {
      name, intrinsics, ground,
      pose: {
        lat: m.lat, lng: m.lng, altM, datum,
        attitude: {
          yawDeg: m.gimbalYawDeg, pitchDeg: m.gimbalPitchDeg, rollDeg: m.gimbalRollDeg ?? 0,
          basis: "XMP GimbalYaw/Pitch/RollDegree, world-referenced (north-east-down), DJI order yaw-pitch-roll",
        },
        boresight: opts.boresight ?? UNCALIBRATED_BORESIGHT,
        basis: `XMP camera position (${m.positionSource}); ${rtk}; height ${datum === TAKEOFF_DATUM ? "RelativeAltitude" : "AbsoluteAltitude"}`,
      },
    },
  };
}
