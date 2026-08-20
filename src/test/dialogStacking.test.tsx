// Dialogs must outrank the map.
//
// This is a regression guard for a bug with no visible symptom in a test and a
// total one in the browser: a dialog opened over a Leaflet map rendered BEHIND
// it, so clicking the button appeared to do nothing at all. The dialog mounted,
// focus moved into it, and the user saw the map.
//
// Leaflet puts panes at z-index 400-700 and controls at 1000, and
// `.leaflet-container` sets `position: relative` with no z-index — so it opens
// no stacking context and those panes compete directly with anything portalled
// to <body>. Radix ships z-50. The map wins.
//
// jsdom does no layout, so nothing here can observe the stacking directly. What
// it CAN do is assert the class survives, which is what stops someone
// "tidying" it back to the stock z-50 and silently restoring the bug.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/** The highest z-index Leaflet's own stylesheet assigns. */
const LEAFLET_MAX_Z = 1000;

const zOf = (el: Element): number => {
  const cls = Array.from(el.classList).find(c => /^z-\[\d+\]$/.test(c));
  return cls ? Number(cls.slice(3, -1)) : NaN;
};

describe("dialog stacking over a map", () => {
  it("renders content above every Leaflet layer", () => {
    render(
      <Dialog open>
        <DialogContent><DialogTitle>Schedule this mission</DialogTitle></DialogContent>
      </Dialog>,
    );
    const content = screen.getByRole("dialog");
    expect(zOf(content)).toBeGreaterThan(LEAFLET_MAX_Z);
  });

  it("puts the overlay above the map too, not just the panel", () => {
    // An overlay left at z-50 would sit behind the map while the panel floated
    // above it — the dimming would vanish and map clicks would still land.
    const { baseElement } = render(
      <Dialog open>
        <DialogContent><DialogTitle>Schedule this mission</DialogTitle></DialogContent>
      </Dialog>,
    );
    const overlay = baseElement.querySelector<HTMLElement>(".fixed.inset-0");
    expect(overlay).not.toBeNull();
    expect(zOf(overlay!)).toBeGreaterThan(LEAFLET_MAX_Z);
  });

  it("still shows the dialog's own content", () => {
    render(
      <Dialog open>
        <DialogContent><DialogTitle>Schedule this mission</DialogTitle></DialogContent>
      </Dialog>,
    );
    expect(screen.getByText("Schedule this mission")).toBeInTheDocument();
  });
});
