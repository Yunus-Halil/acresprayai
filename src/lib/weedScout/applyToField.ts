// Turn a Weed Scout candidate into a shape the rest of the app already
// understands: a hand-drawn anomaly polygon (`user_annotations`).
//
// NOT A FOURTH ZONE SYSTEM. Field View already draws two things — treatment
// grid zones and `user_annotations` rows — and the Flight Planner already
// routes over both with no "promotion" step (see gridAnomalies.ts). Weed
// Scout gets the same treatment: "Apply to Field View" writes an ordinary
// `user_annotations` row, shaped exactly like one the operator drew by hand.
// Nothing downstream needs to know it came from the scout. Field View draws
// it and answers a click with its own popup; the Planner prices it at the
// settings' default rate, exactly like any other hand-drawn zone.
//
// The row is metadata, never a decision made for the operator: `issue_type`
// is picked from the SAME vocabulary a human drawing a polygon by hand would
// pick from, `notes` carries the in-house description so the popup answers
// "what is this" without inventing anything new, and nothing here ever
// writes a rate. The word "weed" appears only where the operator's own
// verdict already put it (species text carried through describe.ts).
import { type LatLng2, M_PER_DEG_LAT, m2ToHectares, mPerDegLng, polygonAreaM2 } from "../geo";
import { type Identification, UNIDENTIFIED, identificationLine, isStatedFinding } from "../weedCatalog/identification";
import { findingTitle } from "./candidates";
import type { UnitSystem } from "../units";
import type { Candidate, RegionClass } from "./types";

export type AppliedAnnotation = {
  name: string;
  /** One of USER_POLY_ISSUES (layers.tsx) - the same vocabulary a hand-drawn polygon uses. */
  issue_type: string;
  color: string;
  notes: string;
  ring: LatLng2[];
  areaHa: number;
  /**
   * The operator's stated identification, or nulls. A suggestion the operator
   * never confirmed does not travel: the row then says "not identified" in its
   * notes and carries no label for Field View, the Planner or the report.
   */
  weed_label: string | null;
  weed_label_status: "confirmed" | "edited" | null;
  weed_catalog_id: string | null;
  weed_label_source: string | null;
};

/** The patch a saved plant covers: this many times its diameter across, never under SPOT_MIN_DIAMETER_M. */
export const SPOT_RING_SCALE = 1.5;
export const SPOT_MIN_DIAMETER_M = 0.6;
export const SPOT_RING_POINTS = 24;

/** A circle around a point candidate, sized to the plant itself, so the shape on the map is the circle the scout drew. */
export function circleRing(centre: LatLng2, diameterM: number): LatLng2[] {
  const r = Math.max(SPOT_MIN_DIAMETER_M, diameterM * SPOT_RING_SCALE) / 2;
  const dLat = r / M_PER_DEG_LAT, dLng = r / mPerDegLng(centre.lat);
  return Array.from({ length: SPOT_RING_POINTS }, (_, i) => {
    const a = (2 * Math.PI * i) / SPOT_RING_POINTS;
    return { lat: centre.lat + dLat * Math.sin(a), lng: centre.lng + dLng * Math.cos(a) };
  });
}

const ISSUE_FOR_REGION_CLASS: Record<RegionClass, string> = {
  "bare or dry ground": "Bare soil",
  "dark ground (wet, shadow or residue)": "Waterlogging",
  "thin stand": "Bare soil",
  "dense vegetation": "Other",
  "pale vegetation": "Other",
  "greener than the field": "Other",
  "different from the field": "Other",
};

function issueTypeFor(c: Candidate): string {
  if (c.region) return ISSUE_FOR_REGION_CLASS[c.region.klass];
  if (c.kind === "off-row vegetation" || c.kind === "vegetation outlier" || c.kind === "off-row and outlier" || c.kind === "between plants") {
    return "Weed pressure";
  }
  return "Other";
}

/**
 * The colour is the finding's class, as the scout drew it, and the operator's
 * own: a plant reaches here only once they kept it as a weed, so red is their
 * word, never the machine's. Ground is orange; anything else yellow.
 */
function colourFor(c: Candidate): string {
  if (c.region) return c.region.klass === "bare or dry ground" || c.region.klass === "dark ground (wet, shadow or residue)" || c.region.klass === "thin stand" ? "orange" : "yellow";
  if (c.kind === "off-row vegetation" || c.kind === "between plants" || c.kind === "off-row and outlier" || c.kind === "vegetation outlier") return "red";
  return "yellow";
}

function nameFor(c: Candidate, id: Identification, sys: UnitSystem): string {
  if (isStatedFinding(id)) return `${id.label} (operator-identified)`;
  return findingTitle(c, sys);
}

/** What the Field View popup answers on a click - the "what is this" the operator asked for. */
function notesFor(c: Candidate, id: Identification): string {
  const e = c.estimate;
  const body = e ? [e.summary, e.positionNote].filter(Boolean).join(" ") : "Flagged by Weed Scout.";
  return `${identificationLine(id)} ${body} (Weed Scout, experimental - verify on the ground before treating.)`.slice(0, 480);
}

/**
 * Build the row `saveUserPolygon`'s insert path expects, from a candidate.
 *
 * A region candidate's own outer ring is used as-is (a hole, on the rare
 * donut-shaped region, is dropped - `user_annotations.ring` is a single ring,
 * the same limitation the hand-drawn tool already has). A point candidate
 * gets a circle around its centroid sized to the plant itself, so the shape
 * on the map is the circle the scout drew, not a box many times its size.
 */
export function annotationFromCandidate(c: Candidate, identification: Identification = UNIDENTIFIED, sys: UnitSystem = "metric"): AppliedAnnotation {
  const ring = c.region && c.region.rings[0]?.length >= 3
    ? c.region.rings[0]
    : circleRing(c.centroid, c.blob?.equivDiameterM ?? SPOT_MIN_DIAMETER_M);
  const areaM2 = c.region ? c.areaM2 : polygonAreaM2(ring);
  const stated = isStatedFinding(identification);
  return {
    name: nameFor(c, identification, sys),
    issue_type: issueTypeFor(c),
    color: colourFor(c),
    notes: notesFor(c, identification),
    ring,
    areaHa: m2ToHectares(areaM2),
    weed_label: stated ? identification.label : null,
    weed_label_status: stated ? (identification.status as "confirmed" | "edited") : null,
    weed_catalog_id: stated ? identification.catalogId : null,
    weed_label_source: stated ? identification.source : null,
  };
}
