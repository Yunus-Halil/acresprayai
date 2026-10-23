// The live site has no weed-model service (it sits behind the dev-server proxy): no panel there may ask the operator
// to run a terminal command, and the weed-pressure grade stays usable because it reads the map's own pixels.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PressurePanel } from "@/components/app/weedVision/PressurePanel";
import { weedModelAvailable } from "@/lib/weedVision/flag";
import { setFrameRunMap } from "@/lib/weedVision/frameRunStore";

describe("the weed model on the live site", () => {
  it("is available in a development build only", () => {
    expect(weedModelAvailable({ DEV: true })).toBe(true);
    expect(weedModelAvailable({ DEV: false })).toBe(false);
    expect(weedModelAvailable({})).toBe(false);
  });

  it("the pressure panel never asks the service, keeps its grade button, and says the grade reads the map", async () => {
    const f = vi.fn(async () => { throw new Error("must not be called"); });
    setFrameRunMap("gate-1", { tile: () => "", maxNative: 23, lat: 37.6, lng: -78.4 });
    render(<PressurePanel taskId="gate-1" sources={null} crop="apricot" fetchImpl={f as unknown as typeof fetch} modelAvailable={false} />);
    expect(await screen.findByTestId("pressure-hint")).toHaveTextContent(/field map's own pixels/);
    expect((screen.getByTestId("pressure-grade") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("pressure-panel")).not.toHaveTextContent(/terminal|Find weeds|not running/);
    expect(f).not.toHaveBeenCalled();
  });

  it("on a map too coarse for the grade it says so instead of leaving the button dead", async () => {
    render(<PressurePanel taskId="gate-2" sources={null} crop="apricot" modelAvailable={false} />);
    expect(await screen.findByTestId("pressure-hint")).toHaveTextContent(/too coarse/);
    expect((screen.getByTestId("pressure-grade") as HTMLButtonElement).disabled).toBe(true);
  });
});
