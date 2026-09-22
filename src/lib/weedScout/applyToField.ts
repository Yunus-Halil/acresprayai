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
import { chipSpanM } from "./candidates";
import type { Candidate, RegionClass } from "./types";

export type AppliedAnnotation = {
  name: string;
  /** One of USER_POLY_ISSUES (layers.tsx) - the same vocabulary a hand-drawn polygon uses. */
  issue_type: string;
  color: string;
  notes: string;
  ring: LatLng2[];
  areaHa: number;
};

/** A small square around a point candidate's centroid, sized like its own chip. */
function squareRing(centre: LatLng2, spanM: number): LatLng2[] {
  const half = Math.max(0.5, spanM) / 2;
  const dLat = half / M_PER_DEG_LAT;
  const dLng = half / mPerDegLng(centre.lat);
  return [
    { lat: centre.lat + dLat, lng: centre.lng - dLng },
    { lat: centre.lat + dLat, lng: centre.lng + dLng },
    { lat: centre.lat - dLat, lng: centre.lng + dLng },
    { lat: centre.lat - dLat, lng: centre.lng - dLng },
  ];
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
  if (c.kind === "off-row vegetation" || c.kind === "vegetation outlier" || c.kind === "off-row and outlier") {
    return "Weed pressure";
  }
  return "Other";
}

function nameFor(c: Candidate): string {
  return `Weed Scout: ${c.region ? c.region.klass : c.kind}`;
}

/** What the Field View popup answers on a click - the "what is this" the operator asked for. */
function notesFor(c: Candidate): string {
  const e = c.estimate;
  const body = e ? [e.summary, e.positionNote].filter(Boolean).join(" ") : "Flagged by Weed Scout.";
  return `${body} (Weed Scout, experimental - verify on the ground before treating.)`.slice(0, 480);
}

/**
 * Build the row `saveUserPolygon`'s insert path expects, from a candidate.
 *
 * A region candidate's own outer ring is used as-is (a hole, on the rare
 * donut-shaped region, is dropped - `user_annotations.ring` is a single ring,
 * the same limitation the hand-drawn tool already has). A point candidate
 * gets a small square around its centroid, sized like the chip already
 * rendered for it, so the shape on the map is roughly what the chip showed.
 */
export function annotationFromCandidate(c: Candidate): AppliedAnnotation {
  const ring = c.region && c.region.rings[0]?.length >= 3
    ? c.region.rings[0]
    : squareRing(c.centroid, chipSpanM(c));
  const areaM2 = c.region ? c.areaM2 : polygonAreaM2(ring);
  return {
    name: nameFor(c),
    issue_type: issueTypeFor(c),
    color: "orange",
    notes: notesFor(c),
    ring,
    areaHa: m2ToHectares(areaM2),
  };
}
