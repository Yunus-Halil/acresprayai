// Default visibility of the vegetation-index layer.
//
// The distinction being defended: real NDVI comes from a NIR band identified by
// name and is worth showing a farmer unasked. VARI is an RGB proxy that is
// explicitly not NDVI, and presenting it as the default view of someone's field
// would overstate what we know about their crop.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ndviDefaultVisible, useNdviLayerDefault } from "@/lib/ndviLayer";

// Shapes as `ndvi-tile/info` actually reports them.
const REAL_NDVI = { index: "ndvi", hasNDVI: true, bands: 3, spectralBands: 2, method: "descriptions" };
const MULTISPECTRAL_5 = { index: "ndvi", hasNDVI: true, bands: 5, spectralBands: 5, method: "descriptions" };
const NDRE = { index: "ndre", hasNDVI: true, bands: 5, spectralBands: 5, method: "descriptions" };
const RGB_VARI = { index: "vari", hasNDVI: false, bands: 4, spectralBands: 3, method: "colorinterp" };
// Four spectral bands shared by two sensor profiles that disagree about where
// red sits, so the mapping stayed unresolved and the index fell back to VARI.
const UNRESOLVED_FALLBACK = { index: "vari", hasNDVI: false, bands: 4, spectralBands: 4, method: "unresolved", ambiguousMultispectral: true };

describe("the rule", () => {
  it("shows the layer for a scan serving real NDVI", () => {
    expect(ndviDefaultVisible(REAL_NDVI)).toBe(true);
    expect(ndviDefaultVisible(MULTISPECTRAL_5)).toBe(true);
  });

  it("shows the layer for NDRE, which also needs a positively identified band", () => {
    expect(ndviDefaultVisible(NDRE)).toBe(true);
  });

  it("hides it for an RGB scan falling back to the VARI proxy", () => {
    expect(ndviDefaultVisible(RGB_VARI)).toBe(false);
  });

  it("hides it when band resolution failed and VARI is a fallback, not a choice", () => {
    // Same treatment as native RGB: we could not identify a NIR band, so we do
    // not put an index on screen implying we did.
    expect(ndviDefaultVisible(UNRESOLVED_FALLBACK)).toBe(false);
  });

  it("hides it when there is no information yet", () => {
    expect(ndviDefaultVisible(null)).toBe(false);
    expect(ndviDefaultVisible(undefined)).toBe(false);
    expect(ndviDefaultVisible({})).toBe(false);
  });
});

/** Stands in for the workspace: an info payload arriving, and a manual toggle. */
function Harness({ taskId, info }: { taskId: string; info: object | null }) {
  const [ndvi, setNdvi] = useState(false);
  useNdviLayerDefault(taskId, info, setNdvi);
  return (
    <label>
      <input type="checkbox" checked={ndvi} onChange={(e) => setNdvi(e.target.checked)} />
      NDVI
    </label>
  );
}

const toggle = () => screen.getByRole("checkbox", { name: /ndvi/i }) as HTMLInputElement;

describe("applying it when a scan loads", () => {
  it("starts hidden before the info endpoint has answered", () => {
    render(<Harness taskId="task-1" info={null} />);
    expect(toggle().checked).toBe(false);
  });

  it("turns the layer on once the scan reports real NDVI", () => {
    const { rerender } = render(<Harness taskId="task-1" info={null} />);
    expect(toggle().checked).toBe(false);
    rerender(<Harness taskId="task-1" info={REAL_NDVI} />);
    expect(toggle().checked).toBe(true);
  });

  it("leaves it off for a VARI scan", () => {
    render(<Harness taskId="task-1" info={RGB_VARI} />);
    expect(toggle().checked).toBe(false);
  });
});

describe("it is only a default", () => {
  it("does not fight a farmer who turns a multispectral scan's layer off", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness taskId="task-1" info={REAL_NDVI} />);
    expect(toggle().checked).toBe(true);

    await user.click(toggle());
    expect(toggle().checked).toBe(false);

    // The info fetch re-runs while the scan is open - a re-applied default here
    // would undo the click and read as a broken toggle.
    rerender(<Harness taskId="task-1" info={{ ...REAL_NDVI }} />);
    expect(toggle().checked).toBe(false);
  });

  it("lets VARI be switched on manually and keeps it on", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness taskId="task-1" info={RGB_VARI} />);
    expect(toggle().checked).toBe(false);

    await user.click(toggle());
    expect(toggle().checked).toBe(true);

    rerender(<Harness taskId="task-1" info={{ ...RGB_VARI }} />);
    expect(toggle().checked).toBe(true);
  });

  it("applies the rule again for a different scan", () => {
    const { rerender } = render(<Harness taskId="task-1" info={RGB_VARI} />);
    expect(toggle().checked).toBe(false);

    rerender(<Harness taskId="task-2" info={REAL_NDVI} />);
    expect(toggle().checked).toBe(true);
  });
});
