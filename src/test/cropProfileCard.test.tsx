// The crop profile card in Weed Scout: what it says with no crop, a crop with no profile, and corn.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CropProfileCard } from "@/components/app/weedVision/CropProfileCard";

const day = (planting: string, days: number) => new Date(Date.parse(`${planting}T12:00:00Z`) + days * 86_400_000);

describe("CropProfileCard", () => {
  it("asks for the crop when none is set", () => {
    render(<CropProfileCard crop={null} plantingDate={null} units="metric" observations={{ gsdM: 0.02, measuredRowSpacingM: null, rowsFound: null }} />);
    expect(screen.getByTestId("crop-profile-card").textContent).toMatch(/No crop set for this field/);
  });

  it("says plainly when the crop has no profile", () => {
    render(<CropProfileCard crop="Cotton" plantingDate={null} units="metric" observations={{ gsdM: 0.02, measuredRowSpacingM: null, rowsFound: null }} />);
    expect(screen.getByTestId("crop-profile-card").textContent).toMatch(/No crop profile for Cotton yet/);
  });

  it("for corn: the estimated stage, the spacing check, each analysis with its state, and the weed list as a reference", () => {
    render(<CropProfileCard crop="Corn" plantingDate="2026-05-01" units="metric" regionState="VA" on={day("2026-05-01", 21)}
      observations={{ gsdM: 0.02, measuredRowSpacingM: 0.765, rowsFound: true }} />);
    expect(screen.getByTestId("crop-profile-stage").textContent).toMatch(/21 days after planting\. Estimated from the planting date, not seen in the imagery/);
    expect(screen.getByTestId("crop-profile-spacing").textContent).toMatch(/consistent/);
    expect(screen.getByTestId("capability-row-detection").getAttribute("data-state")).toBe("enabled");
    expect(screen.getByTestId("capability-weed-measurement").getAttribute("data-state")).toBe("disabled"); // 2 cm is coarser than the 1 cm it needs
    expect(screen.getByTestId("capability-weed-pressure-grade").getAttribute("data-state")).toBe("enabled"); // experimental, on confirmed rows
    expect(screen.getByTestId("crop-profile-weeds").textContent).toMatch(/a reference list, not an identification/);
  });

  it("on the first corn map's own pixel (zoom 23 at 30.55 N, 1.61 cm) nothing is 'not known', and each analysis says what the pixel allows", () => {
    render(<CropProfileCard crop="Corn" plantingDate={null} units="metric" observations={{ gsdM: 0.0161, measuredRowSpacingM: null, rowsFound: null }} />);
    const card = screen.getByTestId("crop-profile-card").textContent ?? "";
    expect(card).not.toMatch(/pixel size is not known/);
    expect(screen.getByTestId("capability-between-row-weed-cover").getAttribute("data-state")).not.toBe("disabled");
    expect(screen.getByTestId("capability-weed-measurement").getAttribute("data-state")).toBe("disabled"); // needs 1 cm
  });

  it("flags a measured spacing corn is not planted at, and keeps the measurement", () => {
    render(<CropProfileCard crop="Corn" plantingDate={null} units="metric" observations={{ gsdM: 0.02, measuredRowSpacingM: 1.4, rowsFound: true }} />);
    expect(screen.getByTestId("crop-profile-spacing").textContent).toMatch(/not a spacing corn is planted at; the measurement stands/);
    expect(screen.getByTestId("crop-profile-stage").textContent).toMatch(/Stage unknown: No planting date on file/);
  });
});
