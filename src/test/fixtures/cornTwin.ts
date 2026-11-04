// A small corn twin for the tests: two rows (corn, unconfirmed), two weed observations (confirmed, unconfirmed), a
// withheld gap, local placement.
import { FIELD_TWIN_FORMAT, type TwinBundle, type TwinCorn } from "@/lib/fieldTwin/types";

export const cornEvidence = (atlas = 0) => ({ photo: "746", atlas, x: 0, y: 0, size: 112, metresAcross: 0.6, poly: [[10, 10], [60, 12], [40, 70]] as [number, number][] });
export const CORN: TwinCorn = {
  version: 1, engine: "test", enteredCrop: "corn", rowSpacingM: 0.79, rowDirectionDeg: 90, rowAgreementM: 0.07,
  photographs: { read: 3, withRows: 3, failed: [] },
  rows: [
    { id: 1, status: "corn", line: [[40.0, -90.0], [40.0001, -90.0]], lengthM: 11, seenBy: 3, cornBy: 3, coveredBy: 3, why: "3 of 3 photographs call it corn" },
    { id: 2, status: "unconfirmed", line: [[40.0, -89.99999], [40.0001, -89.99999]], lengthM: 11, seenBy: 1, cornBy: 0, coveredBy: 3, why: "held by 1 of the 3 photographs covering it" },
  ],
  weeds: [
    { id: 1, status: "confirmed", lat: 40.00005, lng: -89.999995, areaM2: 0.004, votes: { weed: 3, crop: 0, unknown: 0 }, seenBy: 3, coveredBy: 3, photos: ["746", "747", "748"], why: "a weed candidate in 3 of the 3 photographs covering it", evidence: [cornEvidence()] },
    { id: 2, status: "unconfirmed", lat: 40.00007, lng: -89.999995, areaM2: 0.002, votes: { weed: 1, crop: 0, unknown: 1 }, seenBy: 2, coveredBy: 3, photos: ["747"], why: "a weed candidate in only 1 of the 3 photographs covering it (2 saw it at all)", evidence: [] },
  ],
  gaps: [
    { id: 1, status: "withheld", rowId: 1, a: [40.00002, -90.0], b: [40.00003, -90.0], lengthM: 1.1, reportedBy: ["746"], notReportedBy: [], plantSeenBy: ["747"], why: "a plant located inside it in 1 photograph(s)", evidence: [cornEvidence()] },
  ],
  summary: { cornRows: 1, unconfirmedRows: 1, cornRowLengthM: 11, offLatticeDropped: 0, weeds: { confirmed: 1, unconfirmed: 1, contested: 0 }, gaps: { confirmed: 0, withheld: 1, confirmedLengthM: 0 }, perPhoto: { weedCandidates: 4, standGaps: 1, rows: 30 } },
  notes: ["Review-only."],
};
export const CORN_TWIN: TwinBundle = {
  format: FIELD_TWIN_FORMAT, id: "corn-test", name: "Corn test", builtAt: "2026-11-04T00:00:00Z",
  source: { photographs: 3, camera: "", capturedAt: null, groundPixelCm: 0.17, method: "m", weedModel: "w", treeModel: "t", placement: { kind: "local", note: "test flight" } },
  origin: { lat: 40, lng: -90 }, bounds: [[39.9999, -90.0001], [40.0002, -89.9999]],
  field: { rowDirectionDeg: 90, rowSpacingM: 0.79, plantSpacingM: 0 },
  footprints: [{ photo: "746", ring: [[39.9999, -90.0001], [40.0002, -90.0001], [40.0002, -89.9999], [39.9999, -89.9999]] }],
  rows: [{ id: 1, kept: true, reason: null, line: [[40.0, -90.0], [40.0001, -90.0]], trees: 0, inferred: 0, photos: 3, lengthM: 11, straightnessSdM: 0 }],
  trees: [], inferredTrees: [], weeds: [], vegetation: [], atlases: [{ file: "atlas-0.jpg", width: 2016, height: 112 }], stats: { weedTier: "none", crop: "corn" },
  corn: CORN,
};

