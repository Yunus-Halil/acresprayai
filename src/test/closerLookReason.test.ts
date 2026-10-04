// The closer look says why there is no photo, in the operator's terms.
import { describe, expect, it } from "vitest";
import { noPhotoReason } from "@/components/app/workspace/CloserLook";
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
