// DJI WPML route export — a .kmz containing `wpmz/template.kml` and
// `wpmz/waylines.wpml`, for camera drones that fly ordered waypoints and have
// no spray payload.
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ EXPERIMENTAL — NOT REGISTERED AS A USER-FACING EXPORT.                     │
// │                                                                           │
// │ Deliberately kept, deliberately parked. See src/lib/exporters.ts, where    │
// │ this is marked `status: "experimental"` and therefore never reaches the    │
// │ export menu. Do not re-register it without hardware evidence.              │
// │                                                                           │
// │ Why parked: DJI Fly — the app consumer aircraft use (Air 3S, Mini,         │
// │ non-enterprise Mavic) — ships no route-import function at all. The known   │
// │ workarounds sideload a .kmz into the app's private storage, which Android  │
// │ 11+ scoped storage blocks. So there is no confirmed path by which a        │
// │ consumer pilot could load this file even though the file itself matches    │
// │ DJI's published spec.                                                     │
// │                                                                           │
// │ Also note WPML is the wrong shape for Agras entirely: an Agras is handed a │
// │ FIELD (boundary + optional Rx map) and plans its own lines on the          │
// │ aircraft. It is not handed a route. See djiAgras.ts, the shipping path.    │
// └───────────────────────────────────────────────────────────────────────────┘
//
// SPEC PROVENANCE: namespaces, element names and allowed values below are taken
// from DJI's published WPML reference (dji-sdk/Cloud-API-Doc,
// docs/en/60.api-reference/00.dji-wpml/). Two details are worth stating because
// they are easy to get wrong and fail silently:
//
//   1. The namespaces are `http://www.opengis.net/kml/2.2` and
//      `http://www.dji.com/wpmz/1.0.2` — NOT the bare `opengis.net`/`dji.com`
//      forms that circulate in third-party blog posts.
//   2. It is `wpml:missionConfig` / `flyToWaylineMode` / `exitOnRCLost` /
//      `globalTransitionalSpeed`, not `MissionConfig` / `flyToMode` /
//      `exitOnGpsLost` / `executeRtkSpeed`.
//
// NO SPRAY VOCABULARY HERE, DELIBERATELY. Both of DJI's published WPML examples
// are camera/survey missions — gimbal rotation and takePhoto actions on an
// M30-class airframe. Neither page documents a single agriculture actuator: no
// pump rate, no spray on/off, no spreader. So this module emits pure navigation
// and nothing payload-shaped. Inventing plausible `wpml:` spray tags would
// produce a file that looks right and does nothing. On Agras the rate travels in
// the prescription raster (see djiAgras.ts), which is consistent with that
// silence. If Agras spray routes ever do need actuator actions, the vocabulary
// has to come from a real Agras-generated .kmz, not from us.
//
// SPRAY ACTUATOR INTEGRATION POINT: if you are here to add spray actions, stop.
// The actuator vocabulary is UNCONFIRMED — do not add without a verified source.
// See docs/agras-export-notes.md, "Whether Agras spray missions need a route
// .kmz". A test asserts no spray-shaped tag appears in our output.
//
// UNVERIFIED: we could not confirm that consumer DJI Fly aircraft (Mini / Air /
// non-enterprise Mavic) ingest .kmz waypoint files at all. WPML is documented as
// a DJI Pilot 2 / enterprise pathway. Treat this exporter as confirmed-correct
// against the spec but unconfirmed against consumer hardware.
import type { LatLng2 } from "./geo";
import { distM } from "./geo";
import type { Mission } from "./mission";
import { unzipSync, zipSync } from "fflate";

/**
 * Consumer airframes cannot hold an unbounded route. Exceeding this is a hard
 * failure rather than a silent truncation — a route that quietly loses its last
 * N waypoints flies a partial job the operator believes was complete.
 */
export const MAX_CONSUMER_WAYPOINTS = 200;

export type WpmlWaypoint = { lat: number; lng: number; alt: number; speed: number };

export type WpmlOptions = {
  author?: string;
  /** Epoch ms stamped into createTime/updateTime. Injectable for deterministic tests. */
  createTimeMs: number;
  /** Cruise speed between waypoints, m/s. DJI accepts [0, 15]. */
  transitSpeed: number;
  /** Route speed, m/s. */
  autoFlightSpeed: number;
  /** Climb-out altitude before the route starts, m. DJI accepts [1.2, 1500]. */
  takeOffSecurityHeightM: number;
  finishAction?: "goHome" | "noAction" | "autoLand" | "gotoFirstWaypoint";
  exitOnRCLost?: "goContinue" | "executeLostAction";
  executeRCLostAction?: "goBack" | "landing" | "hover";
  /**
   * Aircraft identity. DJI's own examples carry `droneInfo` in both files, but
   * the enum values are per-airframe and we have no authoritative table for
   * consumer models, so it is emitted only when the caller supplies it rather
   * than guessed at. A wrong enum is worse than an absent one.
   */
  drone?: { enumValue: number; subEnumValue: number };
  /** Payload identity, same reasoning as `drone`. */
  payload?: { enumValue: number; positionIndex: number };
  /**
   * Auxiliary files placed under `wpmz/res/` — DJI's example use is AI
   * Spot-Check reference photos. The folder is optional and we generate no
   * resources of our own, so it is omitted entirely unless a caller passes
   * something rather than being emitted empty.
   */
  resources?: Record<string, Uint8Array>;
};

export class WaypointLimitError extends Error {
  constructor(readonly needed: number, readonly limit = MAX_CONSUMER_WAYPOINTS) {
    super(
      `This mission needs ${needed} waypoints. Consumer drone export supports up to ` +
      `${limit}, widen the row spacing to reduce passes, cut the pass count, or ` +
      `export for DJI Agras instead.`,
    );
    this.name = "WaypointLimitError";
  }
}

/**
 * Reduce a spray mission to the ordered 3D points a camera drone can fly.
 *
 * Everything payload-shaped is dropped: SPRAY_ON/OFF are pump commands, and
 * SPEED_CHANGE/ALTITUDE_CHANGE are zero-length markers that sit on top of the
 * waypoint that follows them. Consecutive points at the same place and height
 * then collapse, because a route with duplicate vertices makes the aircraft
 * stop twice for no reason.
 */
export function missionToWpmlWaypoints(m: Mission): WpmlWaypoint[] {
  const out: WpmlWaypoint[] = [];
  for (const w of m.waypoints) {
    if (w.action !== "TRANSIT" && w.action !== "SPRAY_WP" && w.action !== "RTH") continue;
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.alt - w.alt) < 0.01 && distM(prev, w) < 0.5) continue;
    out.push({ lat: w.lat, lng: w.lng, alt: w.alt, speed: w.speed });
  }
  return out;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const KML_NS = "http://www.opengis.net/kml/2.2";
const WPML_NS = "http://www.dji.com/wpmz/1.0.2";

/** Shared missionConfig block — identical in template.kml and waylines.wpml. */
function missionConfig(o: WpmlOptions): string {
  const exitOnRCLost = o.exitOnRCLost ?? "executeLostAction";
  const lines = [
    `    <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>`,
    `    <wpml:finishAction>${o.finishAction ?? "goHome"}</wpml:finishAction>`,
    `    <wpml:exitOnRCLost>${exitOnRCLost}</wpml:exitOnRCLost>`,
  ];
  // executeRCLostAction is required only when the aircraft is told to act on
  // signal loss; emitting it alongside goContinue is contradictory.
  if (exitOnRCLost === "executeLostAction") {
    lines.push(`    <wpml:executeRCLostAction>${o.executeRCLostAction ?? "goBack"}</wpml:executeRCLostAction>`);
  }
  lines.push(
    `    <wpml:takeOffSecurityHeight>${clamp(o.takeOffSecurityHeightM, 1.2, 1500).toFixed(1)}</wpml:takeOffSecurityHeight>`,
    `    <wpml:globalTransitionalSpeed>${clamp(o.transitSpeed, 0, 15).toFixed(1)}</wpml:globalTransitionalSpeed>`,
  );
  if (o.drone) {
    lines.push(
      `    <wpml:droneInfo>`,
      `      <wpml:droneEnumValue>${o.drone.enumValue}</wpml:droneEnumValue>`,
      `      <wpml:droneSubEnumValue>${o.drone.subEnumValue}</wpml:droneSubEnumValue>`,
      `    </wpml:droneInfo>`,
    );
  }
  if (o.payload) {
    lines.push(
      `    <wpml:payloadInfo>`,
      `      <wpml:payloadEnumValue>${o.payload.enumValue}</wpml:payloadEnumValue>`,
      `      <wpml:payloadPositionIndex>${o.payload.positionIndex}</wpml:payloadPositionIndex>`,
      `    </wpml:payloadInfo>`,
    );
  }
  return `  <wpml:missionConfig>\n${lines.join("\n")}\n  </wpml:missionConfig>`;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * template.kml — the editable "business attributes" document. DJI requires it
 * alongside waylines.wpml even though the latter carries the executable route;
 * it is a sibling document with its own templateType and coordinate-system
 * block, not a copy of the wayline file.
 */
export function buildTemplateKml(wps: WpmlWaypoint[], o: WpmlOptions): string {
  const placemarks = wps.map((w, i) => [
    `    <Placemark>`,
    `      <Point><coordinates>${w.lng.toFixed(8)},${w.lat.toFixed(8)}</coordinates></Point>`,
    `      <wpml:index>${i}</wpml:index>`,
    `      <wpml:height>${w.alt.toFixed(2)}</wpml:height>`,
    `      <wpml:useGlobalHeight>0</wpml:useGlobalHeight>`,
    `      <wpml:useGlobalSpeed>1</wpml:useGlobalSpeed>`,
    `      <wpml:useGlobalHeadingParam>1</wpml:useGlobalHeadingParam>`,
    `      <wpml:useGlobalTurnParam>1</wpml:useGlobalTurnParam>`,
    `      <wpml:gimbalPitchAngle>0</wpml:gimbalPitchAngle>`,
    `    </Placemark>`,
  ].join("\n")).join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<kml xmlns="${KML_NS}" xmlns:wpml="${WPML_NS}">`,
    `<Document>`,
    `  <wpml:author>${esc(o.author ?? "SwathWise")}</wpml:author>`,
    `  <wpml:createTime>${o.createTimeMs}</wpml:createTime>`,
    `  <wpml:updateTime>${o.createTimeMs}</wpml:updateTime>`,
    missionConfig(o),
    `  <Folder>`,
    `    <wpml:templateType>waypoint</wpml:templateType>`,
    `    <wpml:templateId>0</wpml:templateId>`,
    `    <wpml:waylineCoordinateSysParam>`,
    `      <wpml:coordinateMode>WGS84</wpml:coordinateMode>`,
    // Our planner works in altitude above the launch point, so the route must
    // declare the same reference. EGM96 here would fly the mission at the
    // aircraft's height above the geoid instead — hundreds of metres out.
    `      <wpml:heightMode>relativeToStartPoint</wpml:heightMode>`,
    `      <wpml:positioningType>GPS</wpml:positioningType>`,
    `    </wpml:waylineCoordinateSysParam>`,
    `    <wpml:autoFlightSpeed>${clamp(o.autoFlightSpeed, 0, 15).toFixed(1)}</wpml:autoFlightSpeed>`,
    `    <wpml:globalWaypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:globalWaypointTurnMode>`,
    `    <wpml:globalUseStraightLine>1</wpml:globalUseStraightLine>`,
    placemarks,
    `  </Folder>`,
    `</Document>`,
    `</kml>`,
  ].join("\n") + "\n";
}

/** waylines.wpml — the executable route. */
export function buildWaylinesWpml(wps: WpmlWaypoint[], o: WpmlOptions): string {
  const placemarks = wps.map((w, i) => [
    `    <Placemark>`,
    `      <Point><coordinates>${w.lng.toFixed(8)},${w.lat.toFixed(8)}</coordinates></Point>`,
    `      <wpml:index>${i}</wpml:index>`,
    `      <wpml:executeHeight>${w.alt.toFixed(2)}</wpml:executeHeight>`,
    `      <wpml:waypointSpeed>${clamp(w.speed, 0, 15).toFixed(1)}</wpml:waypointSpeed>`,
    `      <wpml:waypointHeadingParam>`,
    `        <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>`,
    `      </wpml:waypointHeadingParam>`,
    `      <wpml:waypointTurnParam>`,
    `        <wpml:waypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode>`,
    `        <wpml:waypointTurnDampingDist>0</wpml:waypointTurnDampingDist>`,
    `      </wpml:waypointTurnParam>`,
    // No useStraightLine here. It is documented as required only for certain
    // turn modes, and DJI's own waylines example omits it alongside exactly this
    // mode — the aircraft stops at each point, so there is no curve to
    // straighten. Matching the published example beats adding a defensible tag.
    `    </Placemark>`,
  ].join("\n")).join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<kml xmlns="${KML_NS}" xmlns:wpml="${WPML_NS}">`,
    `<Document>`,
    // No author/createTime/updateTime here. DJI's published waylines example
    // carries only missionConfig and Folder under Document — the file-creation
    // block belongs to template.kml, which is the document a human edits.
    missionConfig(o),
    `  <Folder>`,
    // Element order follows DJI's example exactly: templateId, then
    // executeHeightMode, then waylineId, then autoFlightSpeed. XML schema
    // validation can be order-sensitive and we have no reason to reorder it.
    `    <wpml:templateId>0</wpml:templateId>`,
    `    <wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>`,
    `    <wpml:waylineId>0</wpml:waylineId>`,
    `    <wpml:autoFlightSpeed>${clamp(o.autoFlightSpeed, 0, 15).toFixed(1)}</wpml:autoFlightSpeed>`,
    placemarks,
    `  </Folder>`,
    `</Document>`,
    `</kml>`,
  ].join("\n") + "\n";
}

export type WpmlPackage = {
  kmz: Blob;
  files: Record<string, Uint8Array>;
  waypointCount: number;
  verification: WpmlVerification;
};

/**
 * Build the .kmz. The zip root holds `wpmz/` directly — no wrapping folder
 * named after the mission, which DJI Pilot will not look inside.
 */
export function buildWpmlKmz(m: Mission, o: WpmlOptions): WpmlPackage {
  const wps = missionToWpmlWaypoints(m);
  if (!wps.length) throw new Error("WPML export: mission produced no waypoints");
  if (wps.length > MAX_CONSUMER_WAYPOINTS) throw new WaypointLimitError(wps.length);

  const enc = new TextEncoder();
  const files: Record<string, Uint8Array> = {
    "wpmz/template.kml": enc.encode(buildTemplateKml(wps, o)),
    "wpmz/waylines.wpml": enc.encode(buildWaylinesWpml(wps, o)),
  };
  for (const [name, data] of Object.entries(o.resources ?? {})) {
    files[`wpmz/res/${name.replace(/^\/+/, "")}`] = data;
  }

  const verification = verifyWpmlKmz(files, wps);
  return {
    // Flat slash-separated keys, not a nested object: fflate's nested form adds
    // a standalone `wpmz/` directory entry to the archive, and the spec asks for
    // the two files at the zip root under wpmz/ with nothing else present.
    kmz: new Blob([zipSync(files) as unknown as BlobPart], {
      type: "application/vnd.google-earth.kmz",
    }),
    files,
    waypointCount: wps.length,
    verification,
  };
}

export type WpmlVerification = {
  waypointCount: number;
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  namespaceOk: boolean;
};

/**
 * Reparse the generated XML and confirm it describes the route we intended:
 * correct namespace, one indexed Placemark per source waypoint in order, and
 * coordinates matching the source bounding box.
 */
export function verifyWpmlKmz(
  files: Record<string, Uint8Array>,
  expected: WpmlWaypoint[],
): WpmlVerification {
  const xml = new TextDecoder().decode(files["wpmz/waylines.wpml"]);
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new Error("WPML export: generated waylines.wpml is not well-formed XML");
  }

  const root = doc.documentElement;
  const namespaceOk =
    root.namespaceURI === KML_NS && root.getAttribute("xmlns:wpml") === WPML_NS;
  if (!namespaceOk) throw new Error("WPML export: wrong KML/WPML namespace on the root element");

  const marks = Array.from(doc.getElementsByTagName("Placemark"));
  if (marks.length !== expected.length) {
    throw new Error(`WPML export: wrote ${expected.length} waypoints, read back ${marks.length}`);
  }

  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  marks.forEach((mark, i) => {
    const idx = mark.getElementsByTagNameNS(WPML_NS, "index")[0]?.textContent?.trim();
    if (idx !== String(i)) {
      throw new Error(`WPML export: placemark ${i} carries index ${idx}, expected ${i}`);
    }
    if (!mark.getElementsByTagNameNS(WPML_NS, "executeHeight").length) {
      throw new Error(`WPML export: placemark ${i} has no executeHeight`);
    }
    const coords = mark.getElementsByTagName("coordinates")[0]?.textContent?.trim() ?? "";
    const [lng, lat] = coords.split(",").map(Number);
    if (!isFinite(lat) || !isFinite(lng)) {
      throw new Error(`WPML export: placemark ${i} has unreadable coordinates "${coords}"`);
    }
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
  });

  // 1e-7 degrees is ~1 cm — the coordinates are written at 8 decimals, so
  // anything beyond this is a real drift rather than formatting.
  const srcLat = expected.map(w => w.lat), srcLng = expected.map(w => w.lng);
  const drift = Math.max(
    Math.abs(minLat - Math.min(...srcLat)), Math.abs(maxLat - Math.max(...srcLat)),
    Math.abs(minLng - Math.min(...srcLng)), Math.abs(maxLng - Math.max(...srcLng)),
  );
  if (drift > 1e-7) throw new Error(`WPML export: coordinate bbox drifted ${drift} degrees`);

  return { waypointCount: marks.length, bbox: { minLat, minLng, maxLat, maxLng }, namespaceOk };
}

/** Unzip a .kmz back to its entries — used by tests to check the archive layout. */
export function readKmzEntries(kmz: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(kmz) as Record<string, Uint8Array>;
}
