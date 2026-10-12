// The spot says its measured size, and says plainly why when it has none.
import { describe, expect, it } from "vitest";
import { sizeLineFor } from "@/components/app/workspace/SpotPopup";
import type { SpotSources } from "@/lib/sourceFrames/spot";
import { describeCandidate, findingTitle, measuredDiameterCm } from "@/lib/weedScout/candidates";
import { DEFAULT_SIZE_THRESHOLDS, type WeedMeasurement, unavailableMeasurement } from "@/lib/weedScout/sizing/types";
import type { Candidate } from "@/lib/weedScout/types";

const T = DEFAULT_SIZE_THRESHOLDS;
const blob = { id: "b1", tileId: "t", centroid: { lat: 0, lng: 0 }, areaM2: 0.05, equivDiameterM: 0.25, widthM: 0.3, heightM: 0.2, extent: 0.7, chromaR: 0.3, chromaG: 0.4, chromaB: 0.3, exgMean: 0.2, brightness: 0.5, gsdM: 0.05, touchesBorder: false };
const spot = (over: Partial<Candidate> = {}): Candidate => ({
  id: "c-1", tileId: "t", centroid: { lat: 0, lng: 0 }, kind: "off-row vegetation", score: 0.7, distanceToRowM: 0.5, rowConfidence: 0.8,
  anomalyZ: null, anomalyFeature: null, blobZ: null, blobZFeature: null, blob, region: null, areaM2: 0.05, feedback: null, estimate: null,
  chip: null, chipSpanM: null, chipGsdM: null, ...over,
});
const measured: WeedMeasurement = {
  ...unavailableMeasurement("", T), status: "measured", reason: null, method: "native-photo-mask-v1", confidence: 0.82,
  canopyDiameterCm: 14.2, canopyAreaCm2: 158, maxExtentCm: 19, boxWidthCm: 17, boxHeightCm: 15, sizeCategory: "medium", gsdCmPx: 0.99, sourceFrame: "DJI_0303.JPG",
  quality: { pixelsAcross: 14.3, maskContrast: 0.6, darkShare: 0, touchingNeighbours: 0, touchesCrop: false, cropContext: "known", sizeVsExpected: 1.1, centreOffsetM: 0.02, thresholdSource: "context", touchesWindowEdge: false, touchesPhotoEdge: false },
};
const sources = (over: Partial<SpotSources>): SpotSources => ({
  unavailable: null, views: [], chosen: [], nearestOnly: false, lookable: [], originalsKept: false, nativeScale: null, orthoGsdM: null, nativeGsdM: null, outline: [], ...over,
});
const view = { filename: "a.JPG" } as unknown as SpotSources["chosen"][number];

describe("the size line on a spot", () => {
  it("says the measured size with its class and confidence, in the operator's units", () => {
    expect(sizeLineFor(spot({ measurement: measured }), false, null, "metric")).toBe("Canopy 14.2 cm across, 158 cm², medium (measured in the photo; confidence 0.82).");
    expect(sizeLineFor(spot({ measurement: measured }), false, null, "imperial")).toBe("Canopy 5.6 in across, 24.5 in², medium (measured in the photo; confidence 0.82).");
  });

  it("says why there is no size, from what is known so far", () => {
    const c = spot();
    expect(sizeLineFor(c, true, null, "metric")).toBe("Measuring the size in the photo.");
    expect(sizeLineFor(c, false, null, "metric")).toMatch(/looking up the original photos/);
    expect(sizeLineFor(c, false, sources({ unavailable: "no reconstruction" }), "metric")).toMatch(/no camera positions/);
    expect(sizeLineFor(c, false, sources({ unavailable: "no ground height" }), "metric")).toMatch(/cannot be lined up/);
    expect(sizeLineFor(c, false, sources({ unavailable: "not seen by any photo" }), "metric")).toMatch(/no original photo shows/);
    expect(sizeLineFor(c, false, sources({ chosen: [view], originalsKept: false }), "metric")).toMatch(/were not kept for this scan/);
    expect(sizeLineFor(c, false, sources({ chosen: [view], originalsKept: true }), "metric")).toMatch(/photo of this spot was not kept/);
    expect(sizeLineFor(c, false, sources({ chosen: [view], lookable: [view], originalsKept: true }), "metric")).toMatch(/not measured yet/);
    // A stored unknown says the photo's reason; a stored unavailable gives way to a measurement under way.
    expect(sizeLineFor(spot({ measurement: { ...measured, status: "unknown", reason: "the plant is cut by the photo's edge", canopyDiameterCm: null } }), false, null, "metric")).toBe("Size not measured in the photo: the plant is cut by the photo's edge.");
    expect(sizeLineFor(spot({ measurement: unavailableMeasurement("no original photo was kept", T) }), false, null, "metric")).toBe("Size not measured: no original photo was kept.");
    expect(sizeLineFor(spot({ measurement: unavailableMeasurement("no original photo was kept", T) }), true, null, "metric")).toBe("Measuring the size in the photo.");
  });

  it("the title and the description carry the measured size over the map's, and the map's when there is none", () => {
    expect(measuredDiameterCm(spot())).toBeNull();
    expect(measuredDiameterCm(spot({ measurement: measured }))).toBe(14.2);
    expect(measuredDiameterCm(spot({ measurement: { ...measured, status: "unknown", canopyDiameterCm: null } }))).toBeNull();
    expect(findingTitle(spot(), "metric")).toBe("Likely weed, off the row · 25.0 cm");
    expect(findingTitle(spot({ measurement: measured }), "metric")).toBe("Likely weed, off the row · 14.2 cm");
    expect(findingTitle(spot({ measurement: measured }), "metric", { size: false })).toBe("Likely weed, off the row");
    expect(describeCandidate(spot(), "metric")).toMatch(/25\.0 cm across on the map$/);
    expect(describeCandidate(spot({ measurement: measured }), "metric")).toMatch(/14\.2 cm across, measured in its photo$/);
  });
});
