// The scan summary states only what another module already states.
//
// The acreage comes from lib/treatment/plannedArea.ts, the same function the
// Flight Planner prices its chemical with, so the figure here and the figure
// one tab over cannot disagree. What this covers is the refusals: a field with
// no recorded area produces a stated blank rather than a percentage, and the
// hand-off never implies a product or a rate.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScanSummary, type ScanSummaryProps } from "@/components/app/workspace/ScanSummary";

function renderSummary(over: Partial<ScanSummaryProps> = {}) {
  const props: ScanSummaryProps = {
    spots: 30, kept: 12, removed: 0, unsure: 18,
    treatAreaM2: 20_234,   // ~5 ac
    fieldAreaM2: 404_686,  // ~100 ac
    units: "imperial",
    onBuildMission: vi.fn(),
    building: null,
    buildError: null,
    canBuild: true,
    ...over,
  };
  return { ...render(<ScanSummary {...props} />), props };
}

describe("the three numbers", () => {
  it("shows the treated area against the field's own, and the share needing nothing", () => {
    renderSummary();
    expect(screen.getByText("Spots").parentElement?.textContent).toMatch(/30/);
    expect(screen.getByText("Spots").parentElement?.textContent).toMatch(/12 kept, 0 removed, 18 unsure/);
    expect(screen.getByText("To treat").parentElement?.textContent).toMatch(/5\.00 ac/);
    expect(screen.getByText("To treat").parentElement?.textContent).toMatch(/of 100\.0 ac/);
    expect(screen.getByText("Needs nothing").parentElement?.textContent).toMatch(/95%/);
  });

  it("refuses the percentage when no field area is on file, rather than inventing one", () => {
    renderSummary({ fieldAreaM2: null });
    const block = screen.getByText("Needs nothing").parentElement!;
    expect(block.textContent).toMatch(/Not known/);
    expect(block.textContent).toMatch(/no boundary area on file/);
    expect(block.textContent).not.toMatch(/%/);
    expect(screen.getByText("To treat").parentElement?.textContent).toMatch(/field area not on file/);
  });

  it("never reports more than the whole field as needing nothing", () => {
    renderSummary({ treatAreaM2: 0 });
    expect(screen.getByText("Needs nothing").parentElement?.textContent).toMatch(/100%/);
  });
});

describe("the hand-off", () => {
  it("says what it will do and claims no product or rate", () => {
    renderSummary();
    const btn = screen.getByRole("button", { name: /Save 30 spots and open the Flight Planner/ });
    expect(btn).toBeEnabled();
    const section = btn.closest("section")!;
    expect(section.textContent).toMatch(/applies your own rates, drone and tank settings/i);
    expect(section.textContent).toMatch(/No product or rate is chosen for you/);
  });

  it("points the operator at the map rather than a list", () => {
    renderSummary();
    expect(screen.getByText(/Click one on the map to change it; the colour is the decision/)).toBeInTheDocument();
  });

  it("reports its own progress and refuses when there is nobody to save as", () => {
    renderSummary({ building: { done: 3, total: 9 } });
    expect(screen.getByRole("button", { name: /Saving 3\/9/ })).toBeDisabled();
    renderSummary({ canBuild: false });
    expect(screen.getByText("Sign in to save.")).toBeInTheDocument();
  });

  it("offers nothing to build when the scan found nothing, and says that is a result", () => {
    renderSummary({ spots: 0, kept: 0, unsure: 0 });
    expect(screen.queryByRole("button", { name: /Flight Planner/ })).toBeNull();
    expect(screen.getByText(/That is a result, not an absence/)).toBeInTheDocument();
  });

  it("surfaces a failed save instead of implying everything landed", () => {
    renderSummary({ buildError: "2 spots could not be saved." });
    expect(screen.getByText("2 spots could not be saved.")).toBeInTheDocument();
  });
});
