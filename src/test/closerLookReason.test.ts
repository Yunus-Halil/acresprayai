// The closer look says why there is no photo, in the operator's terms.
import { describe, expect, it } from "vitest";
import { detectionLine, noPhotoReason } from "@/components/app/workspace/CloserLook";
import type { ModelResult } from "@/lib/sourceFrames/benchTypes";
import type { SpotSources } from "@/lib/sourceFrames/spot";

const spot = (over: Partial<SpotSources>): SpotSources => ({
  unavailable: null, views: [], chosen: [], nearestOnly: false, lookable: [], originalsKept: false,
  nativeScale: null, orthoGsdM: null, nativeGsdM: null, outline: [], ...over,
});
const view = { filename: "a.JPG" } as unknown as SpotSources["chosen"][number];

describe("noPhotoReason", () => {
  it("names the missing piece", () => {
    expect(noPhotoReason(null)).toBe("No photo to show.");
    expect(noPhotoReason(spot({ unavailable: "no reconstruction" }))).toMatch(/No camera positions/);
    expect(noPhotoReason(spot({ unavailable: "no ground height" }))).toMatch(/ground sample distance/);
    expect(noPhotoReason(spot({ unavailable: "not seen by any photo" }))).toBe("No photo holds this area.");
    expect(noPhotoReason(spot({ chosen: [view], originalsKept: false }))).toMatch(/were not kept for this scan.*Keep original photos/);
    expect(noPhotoReason(spot({ chosen: [view], originalsKept: true }))).toBe("1 photo hold this area, but its original was not kept.");
    expect(noPhotoReason(spot({ chosen: [view, view], originalsKept: true }))).toBe("2 photos hold this area, but their originals were not kept.");
  });
});

describe("detectionLine", () => {
  const base: Omit<ModelResult, "status"> = { modelId: "weeds-nxe1w/1", count: 0, maxConfidence: null, meanConfidence: null, detections: [], imageWidth: null, imageHeight: null, elapsedMs: null, error: null };
  it("says what the detector did, and that it is not a verdict", () => {
    expect(detectionLine({ ...base, status: "SUCCESS_NO_DETECTIONS" })).toMatch(/drew no boxes.*not a verdict/);
    expect(detectionLine({ ...base, status: "SUCCESS", count: 2, maxConfidence: 0.91 })).toMatch(/drew 2 boxes, highest confidence 0\.91.*your call stands/);
    expect(detectionLine({ ...base, status: "API_ERROR", error: "ROBOFLOW_API_KEY is not set on the server" })).toMatch(/could not be asked: ROBOFLOW_API_KEY is not set/);
    expect(detectionLine({ ...base, status: "MODEL_SKIPPED" })).toBe("No detector is configured.");
  });
});
