// Weed size v1: the public face of the module. See types.ts for what a
// measurement is and segment.ts for how it is made.
export * from "./types";
export { segmentWeed, confidenceOf, type SegmentInput, type SegmentOutput } from "./segment";
export { measureSpotInPhoto, wantsMeasurement, openOriginal, cutterFromBitmap, squareWindow, expectedDiameterM, type MeasureSpotInput, type NativeCutter, type OpenedOriginal } from "./measure";
export { measurementLine, measurementRows, measurementCaveats, SIZE_CATEGORY_LABEL } from "./describe";
