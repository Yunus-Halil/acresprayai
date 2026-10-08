// The field read says what was found, in the grower's units, and never how.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FieldRead } from "@/components/app/workspace/FieldRead";
import type { Candidate, Region, ScoutResult } from "@/lib/weedScout/types";

const result = (over: Partial<ScoutResult>): ScoutResult => ({
  tileM: 3, rowsUsed: "fitted", canopyClosed: false, tiles: [], samples: [], scores: [], flags: [], regions: [], rows: null, pattern: null,
  candidates: [], gsdM: 0.05, sweep: { ran: false, windows: 0, gsdM: null, backedOff: 0, failed: 0, rowWindows: 0 }, missingTiles: 0,
  baselineTiles: 0, blobCount: 0, smallestMeasurableM: 0.15, notes: [], startedAt: "", finishedAt: "",
  ...over,
} as ScoutResult);

const spot = (kind: Candidate["kind"], areaM2: number): Candidate => ({
  id: `c-${kind}-${areaM2}`, tileId: "t", centroid: { lat: 0, lng: 0 }, kind, score: 0.5, distanceToRowM: null, rowConfidence: null,
  anomalyZ: null, anomalyFeature: null, blobZ: null, blobZFeature: null, blob: { id: "b" } as Candidate["blob"], region: null, areaM2,
  feedback: null, estimate: null, chip: null, chipSpanM: null, chipGsdM: null,
});

describe("the field read", () => {
  it("says the pattern, the weeds and the ground, in the operator's units, without a word of method", () => {
    const r = result({
      pattern: {
        z: 21, gsdM: 0.059, windowM: 60, origin: { lat: 0, lng: 0 }, windows: [], plants: [], lines: [], notes: [],
        summary: {
          windows: 12, windowsWithRows: 11, fitWindows: 300, usableFitWindows: 280, blocks: 2, rowSpacingM: 5.1, bearingDeg: 100,
          plantSpacingM: 3.2, plantDiameterM: 1.8, plantCount: 1240, offPatternCount: 300, seedAgreement: 0.8, squareGrid: false, missingTiles: 0,
        },
      },
      regions: [{ klass: "bare or dry ground", areaM2: 1200 } as Region, { klass: "thin stand", areaM2: 400 } as Region, { klass: "greener than the field", areaM2: 50 } as Region],
    });
    const candidates = [spot("off-row vegetation", 0.3), spot("between plants", 0.1), spot("off-row and outlier", 0.5)];
    render(<FieldRead result={r} candidates={candidates} treatAreaM2={2000} fieldAreaM2={100_000} units="metric" />);
    const text = screen.getByTestId("field-read").textContent ?? "";
    // The numbers, whatever decimals the unit formatter chooses.
    expect(text).toMatch(/rows 510(\.0)? cm apart, running E-W, plants 320(\.0)? cm apart, about 180(\.0)? cm across: 1,240 crop plants in 2 plantings\./);
    expect(text).toMatch(/3 plants off the pattern, 1 of them under the row/);
    expect(text).toMatch(/2(\.0)?% of the field to treat/);
    expect(text).toMatch(/bare or dry [\d.,]+ (ha|m²) in 1 patch, thin stand [\d.,]+ (ha|m²) in 1 patch\./);
    expect(text).not.toMatch(/autocorrelation|projection|algorithm|brightness|signal|threshold/i);
  });

  it("says so when there is no pattern, when the canopy is closed, and when nothing is off the pattern", () => {
    const none = render(<FieldRead result={result({ rowsUsed: "not found" })} candidates={[]} treatAreaM2={0} fieldAreaM2={null} units="imperial" />);
    const t1 = none.getByTestId("field-read").textContent ?? "";
    expect(t1).toMatch(/No row pattern was read/);
    expect(t1).toMatch(/No plants were found off the pattern\./);
    expect(t1).toMatch(/No bare, thin or wet ground/);
    none.unmount();
    const closed = render(<FieldRead result={result({ canopyClosed: true })} candidates={[]} treatAreaM2={0} fieldAreaM2={null} units="metric" />);
    expect(closed.getByTestId("field-read").textContent).toMatch(/canopy is closed/);
  });
});
