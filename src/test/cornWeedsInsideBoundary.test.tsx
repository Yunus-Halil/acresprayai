// Weeds are a field's own only inside its boundary (2026-11-23): green that is not corn outside the boundary in use
// makes no weed patch and is not shown; the panel says how many marks were left out.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CornFieldPanel } from "@/components/app/fieldTwin/CornPanels";
import { greenInside, weedPatches } from "@/lib/fieldTwin/cornPatches";
import { plotContext } from "@/lib/fieldTwin/plots";
import { localFrame } from "@/lib/fieldTwin/rowEdits";
import { DEFAULT_LAYERS } from "@/lib/fieldTwin/style";
import { FIELD_TWIN_FORMAT, type LatLngPair, type TwinBundle, type TwinCornRow } from "@/lib/fieldTwin/types";

const LAT = 31.58, LNG = -83.586, S = 0.76;
const f = localFrame(LAT, LNG), at = (e: number, n: number) => f.toLL(e, n);
const rect = (e0: number, n0: number, e1: number, n1: number): LatLngPair[] => [at(e0, n0), at(e1, n0), at(e1, n1), at(e0, n1)];

/** Four 10 m rows of corn; a thick stand of green that is not corn between rows 2 and 3 (inside the field), and a
 * thicker one on the verge, 6 to 9 m south of the first row. */
function twin(): TwinBundle {
  const points: LatLngPair[] = [], certainty: number[] = [], rows: TwinCornRow[] = [];
  for (let row = 1; row <= 4; row++) {
    for (let i = 0; i <= 50; i++) { points.push(at(i * 0.2, row * S)); certainty.push(0); }
    rows.push({ id: row, status: "corn", line: [at(0, row * S), at(10, row * S)], lengthM: 10, seenBy: 0, cornBy: 0, coveredBy: 0, why: `Plants seen along it (row ${row}: 51 plants, 51 seen by most photographs over them, 5.0 a metre).`, row, plants: 51 });
  }
  for (let i = 0; i < 30; i++) { points.push(at(4 + (i % 10) * 0.2, 2.5 * S + (Math.floor(i / 10) - 1) * 0.1)); certainty.push(2); }
  for (let i = 0; i < 80; i++) { points.push(at(2 + (i % 20) * 0.2, -6 - Math.floor(i / 20) * 0.5)); certainty.push(2); }
  return {
    format: FIELD_TWIN_FORMAT, id: "edge", name: "Edge", builtAt: "test",
    source: { photographs: 4, camera: "test", capturedAt: null, groundPixelCm: 0.6, method: "test", weedModel: "none", treeModel: "none" },
    origin: { lat: LAT, lng: LNG }, bounds: [at(-5, -12), at(15, 8)], field: { rowDirectionDeg: 0, rowSpacingM: S, plantSpacingM: 0.2 },
    footprints: [], rows: [], trees: [], inferredTrees: [], weeds: [], vegetation: [], atlases: [], stats: {},
    corn: {
      version: 1, engine: "test", enteredCrop: "corn", rowSpacingM: S, rowDirectionDeg: 0, rowAgreementM: 0.01,
      photographs: { read: 4, withRows: 4, failed: [] }, rows, weeds: [], gaps: [],
      plants: { points, certainty, photos: points.map(() => 2), note: "test", summary: { plants: points.length, certain: 204, probable: 0, onNoRow: 110, betweenRows: 0, confirmedM: 40, notConfirmedM: 0, doubles: 0 } },
      summary: { cornRows: 4, unconfirmedRows: 0, cornRowLengthM: 40, offLatticeDropped: 0, weeds: { confirmed: 0, unconfirmed: 0, contested: 0 }, gaps: { confirmed: 0, withheld: 0, confirmedLengthM: 0 }, perPhoto: { weedCandidates: 0, standGaps: 0, rows: 0 } },
      notes: ["Review-only."],
    },
  };
}
/** The field's boundary: half a spacing round the rows. */
const BOUNDARY = rect(-0.4, 0.5 * S, 10.4, 4.5 * S);

describe("weed patches and the field boundary", () => {
  it("with no boundary, every thick stand of green is a patch, the verge's too", () => {
    const P = weedPatches(plotContext(twin())!);
    expect(P).toHaveLength(2);
    expect(P[0].marks).toBe(80);
  });
  it("with a boundary, only the green inside it makes a patch", () => {
    const ctx = plotContext(twin())!, P = weedPatches(ctx, undefined, BOUNDARY);
    expect(P).toHaveLength(1);
    expect(P[0].marks).toBe(30);
    expect(f.toEN(P[0].lat, P[0].lng)[1]).toBeGreaterThan(0);
    expect(greenInside(ctx, BOUNDARY).outside).toBe(80);
    expect(greenInside(ctx, null)).toEqual({ keep: null, outside: 0 });
  });
  it("follows the boundary: drawn round the verge too, the verge's green is the field's again", () => {
    const ctx = plotContext(twin())!;
    expect(weedPatches(ctx, undefined, rect(-0.4, -9, 10.4, 4.5 * S))).toHaveLength(2);
    // The counted plants are never touched by it.
    expect(ctx.pE.length).toBe(204);
  });
});

describe("the corn panel, with green left out beyond the boundary", () => {
  it("says how many marks outside the field boundary are not shown, and nothing when there are none", () => {
    const t = twin(), ctx = plotContext(t)!;
    const a = render(<CornFieldPanel twin={t} corn={t.corn!} layers={DEFAULT_LAYERS} setLayers={() => {}} onSelect={() => {}} units="imperial" view="simple" plotCtx={ctx} patches={weedPatches(ctx, undefined, BOUNDARY)} weedsOutside={greenInside(ctx, BOUNDARY).outside} />);
    expect(screen.getByText(/Inside the field boundary only: 80 green marks outside it are not shown\./)).toBeTruthy();
    a.unmount();
    render(<CornFieldPanel twin={t} corn={t.corn!} layers={DEFAULT_LAYERS} setLayers={() => {}} onSelect={() => {}} units="imperial" view="simple" plotCtx={ctx} patches={weedPatches(ctx)} />);
    expect(screen.queryByText(/Inside the field boundary only/)).toBeNull();
  });
});
