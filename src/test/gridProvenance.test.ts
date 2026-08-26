// Grid provenance: which scan's imagery the reference points were judged on.
//
// The grid is field-keyed and carries forward to every new scan, but its
// reference cells were sampled from ONE orthomosaic's pixels. The stamp added
// here survives the full persistence cycle (pack → JSON → parse → reattach),
// degrades to "unknown, treat as carried over" on malformed data, and never
// invents a provenance a grid does not have.
import { describe, expect, it } from "vitest";
import { applyStored, packGrid, type StoredGrid } from "@/lib/treatmentGridStore";
import { parseStoredGrid } from "@/lib/treatmentGridRepo";
import {
  type CellRate, buildTreatmentGrid, gridDefinitionFor,
} from "@/lib/treatmentGrid";
import { renderVersion } from "@/lib/scanLayers";

const RING = [
  { lat: 45.0, lng: -93.0 },
  { lat: 45.0009, lng: -93.0 },
  { lat: 45.0009, lng: -92.9987 },
  { lat: 45.0, lng: -92.9987 },
];

const ASSESSED = {
  scanId: "scan-1",
  scanDate: "2026-08-20T10:00:00Z",
  at: "2026-08-25T09:00:00Z",
};

function liveGrid() {
  const def = gridDefinitionFor([RING], 10, 1);
  const grid = buildTreatmentGrid([RING], def);
  const treated: CellRate = { state: "treated", rateLha: 25, source: "operator" };
  return {
    ...grid,
    assessed: ASSESSED,
    cells: grid.cells.map((c, i) => (i < 2 ? { ...c, rate: treated } : c)),
  };
}

describe("provenance survives the persistence round trip", () => {
  it("pack → parse → reattach keeps the stamp intact", () => {
    const packed = packGrid(liveGrid());
    expect(packed.assessed).toEqual(ASSESSED);

    // Through JSON, exactly as the settings column holds it.
    const parsed = parseStoredGrid(JSON.parse(JSON.stringify(packed)));
    expect(parsed?.assessed).toEqual(ASSESSED);

    const def = gridDefinitionFor([RING], 10, 1);
    const reattached = applyStored(buildTreatmentGrid([RING], def), parsed as StoredGrid);
    expect(reattached.assessed).toEqual(ASSESSED);
  });

  it("a grid stored before provenance existed parses as carried-over-unknown", () => {
    const packed = packGrid(liveGrid());
    const legacyShape = JSON.parse(JSON.stringify(packed)) as Record<string, unknown>;
    delete legacyShape.assessed;
    const parsed = parseStoredGrid(legacyShape);
    expect(parsed).not.toBeNull();
    expect(parsed?.assessed).toBeNull();
    // Reattached, it still claims nothing.
    const def = gridDefinitionFor([RING], 10, 1);
    expect(applyStored(buildTreatmentGrid([RING], def), parsed as StoredGrid).assessed).toBeNull();
  });

  it("a malformed stamp degrades to unknown, never to a fabricated provenance", () => {
    const packed = JSON.parse(JSON.stringify(packGrid(liveGrid()))) as Record<string, unknown>;
    packed.assessed = { scanId: 42, at: null };
    expect(parseStoredGrid(packed)?.assessed).toBeNull();
  });

  it("a fresh build has no provenance until an operator supplies one", () => {
    const def = gridDefinitionFor([RING], 10, 1);
    expect(buildTreatmentGrid([RING], def).assessed).toBeUndefined();
  });
});

describe("the RGB tile version key", () => {
  it("derives from the render plan, so a rebake with a new plan changes the URL", () => {
    const a = renderVersion({
      bands: 4, index: "ndvi", label: "NDVI",
      render: { dtype: "uint16", bidx: [3, 2, 1], rescale: [[100, 9000], [120, 8800]] },
    } as Parameters<typeof renderVersion>[0]);
    const b = renderVersion({
      bands: 4, index: "ndvi", label: "NDVI",
      render: { dtype: "uint16", bidx: [1, 2, 3], rescale: [[100, 9000], [120, 8800]] },
    } as Parameters<typeof renderVersion>[0]);
    expect(a).not.toBe("");
    expect(a).not.toBe(b);
  });

  it("is empty — no fabricated version — when no plan is known", () => {
    expect(renderVersion(null)).toBe("");
    expect(renderVersion({ bands: 3, index: "vari", label: "VARI" } as Parameters<typeof renderVersion>[0])).toBe("");
  });
});
