// The Layer 2 benchmark's record: one shape, wherever the benchmark runs.
//
// The terminal tool (scripts/bench) and the in-app panel (benchBrowser.ts)
// produce the same record and render the same page (benchReport.ts). The
// detector's result shape is the edge function's, imported as a type only, so
// nothing of the detector's client reaches the browser bundle.
import type { AreaWindow } from "./crop";
import type { Detection, ModelResult, ModelStatus } from "../../../supabase/functions/_shared/roboflow";

export type { Detection, ModelResult, ModelStatus };

/** The result when no detector was configured. */
export const SKIPPED: ModelResult = {
  status: "MODEL_SKIPPED", modelId: null, count: 0, maxConfidence: null, meanConfidence: null,
  detections: [], imageWidth: null, imageHeight: null, elapsedMs: null, error: null,
};

/** Why a finding's row in the report says what it says. One per finding. */
export type BenchStatus =
  | "SUCCESS"                    // native crop cut, detector ran, found something
  | "SUCCESS_NO_DETECTIONS"      // native crop cut, detector ran, found nothing
  | "MODEL_SKIPPED"              // native crop cut; no detector was configured
  | "RECONSTRUCTION_UNAVAILABLE" // no camera poses, or no ground height, for this scan
  | "PROJECTION_FAILED"          // poses exist; no photograph holds any of the shape
  | "NO_MANIFEST"                // a photograph holds it; the scan kept no frame list
  | "NO_NATIVE_SOURCE_FRAME"     // the frame list does not hold that photograph's original
  | "ORIGINAL_DOWNLOAD_FAILED"   // the manifest's key could not be read
  | "ORIGINAL_DECODE_FAILED"     // the bytes are not an image this tool can decode
  | "CROP_OUT_OF_BOUNDS"         // the window collapsed to nothing inside the frame
  | "API_ERROR";                 // the detector call failed on the native crop

export type FindingSource = "weed_observations" | "point" | "scout_run";
export type OriginalsSource = "retained-original" | "local-folder";

export type FindingResult = {
  findingId: string;
  rowId: string | null;
  source: FindingSource;
  kind: string;
  findingClass: string | null;
  /** Copied from the archive or the operator's unsaved choice, never written back. */
  operatorVerdict: { verdict: string | null; verdictSource: string | null; species: string | null };
  storedPrediction: { prediction: unknown; modelVersion: string | null } | null;
  status: BenchStatus;
  reason: string | null;
  /** Photographs that hold some of the shape. */
  candidateFrames: number;
  /** The fewest photographs that together hold the whole shape (the app's choice). */
  chosenFrames: string[];
  selectedFrame: string | null;
  matchedBy: string | null;
  originalPath: string | null;
  originalBytes: number | null;
  originalSha256: string | null;
  originalSource: OriginalsSource | null;
  /** Fraction of the outline the selected frame holds. */
  coverage: number | null;
  /** Ray angle from straight down at the shape, and the camera's own tilt, degrees. */
  viewAngleDeg: number | null;
  offNadirDeg: number | null;
  orthoGsdM: number | null;
  uploadedGsdM: number | null;
  nativeGsdM: number | null;
  /** Original width over uploaded width, measured from the decoded original; and what EXIF implied. */
  nativeScale: number | null;
  exifScale: number | null;
  originalWidth: number | null;
  originalHeight: number | null;
  cropWindow: AreaWindow | null;
  /** The finding's outline in the native crop's pixels, for drawing. */
  outlineCropPx: { x: number; y: number }[] | null;
  /** `file` is a path relative to the page on disk, or a data URL in the browser. */
  native: { file: string; width: number; height: number; model: ModelResult } | null;
  ortho: {
    status: "OK" | "NO_ORTHO_CHIP" | "CHIP_DOWNLOAD_FAILED" | "NOT_COMPARED";
    file: string | null; width: number | null; height: number | null;
    gsdM: number | null; spanM: number | null;
    outlinePx: { x: number; y: number }[] | null;
    model: ModelResult | null;
  };
};

export type BenchRun = {
  generatedAt: string;
  scan: {
    taskId: string | null;
    odmUuid: string | null;
    userId: string | null;
    fieldId: string | null;
    status: string | null;
    outputPath: string | null;
    imageCount: number | null;
    reconstruction: "stored" | "extracted" | "none" | "local-folder";
    groundAltM: number | null;
    posedFrames: number;
    framesKept: number | null;
    originalsSource: OriginalsSource;
    findingsSource: string;
  };
  model: { configured: boolean; id: string | null; settings: Record<string, string | number> | null };
  findings: FindingResult[];
  summary: {
    findings: number;
    byStatus: Record<string, number>;
    nativeDetections: number;
    orthoDetections: number;
    nativeWithDetections: number;
    orthoWithDetections: number;
    orthoScored: number;
  };
  notes: string[];
};

/** The finding's status once a native crop exists is the detector's word on it. */
export const statusFromModel = (m: ModelResult): BenchStatus => m.status;

export function summarize(results: FindingResult[]): BenchRun["summary"] {
  const byStatus: Record<string, number> = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  return {
    findings: results.length, byStatus,
    nativeDetections: results.reduce((n, r) => n + (r.native?.model.count ?? 0), 0),
    orthoDetections: results.reduce((n, r) => n + (r.ortho.model?.count ?? 0), 0),
    nativeWithDetections: results.filter(r => (r.native?.model.count ?? 0) > 0).length,
    orthoWithDetections: results.filter(r => (r.ortho.model?.count ?? 0) > 0).length,
    orthoScored: results.filter(r => r.ortho.model && r.ortho.model.status !== "MODEL_SKIPPED" && r.ortho.model.status !== "API_ERROR").length,
  };
}
