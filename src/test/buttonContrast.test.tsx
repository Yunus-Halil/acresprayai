// Every button variant that paints its own background must also state its own
// text colour.
//
// The one that did not - `outline` - inherited from whatever surface it landed
// on. Inside the orthomosaic workspace, whose root sets `color: #f0f0f0` for
// the dark chrome, that produced white text on a cream button: invisible, and
// invisible identically for the History tab's existing buttons and the
// timelapse controls. Inheritance is fine for `ghost` and `link`, which are
// transparent and are meant to take the surrounding colour.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button, buttonVariants } from "@/components/ui/button";

const PAINTS_A_BACKGROUND = ["default", "destructive", "outline", "secondary"] as const;

describe("button variants", () => {
  it.each(PAINTS_A_BACKGROUND)("%s sets a text colour rather than inheriting one", (variant) => {
    expect(buttonVariants({ variant })).toMatch(/(^|\s)text-[a-z-]+/);
  });

  it("renders a legible label inside a surface that has set its own colour", () => {
    render(
      <div style={{ color: "#f0f0f0" }}>
        <Button variant="outline">Pause</Button>
      </div>,
    );
    // The class is what wins over the inherited colour; without it the label
    // takes the #f0f0f0 above and disappears into the cream background.
    expect(screen.getByRole("button", { name: "Pause" }).className).toContain("text-foreground");
  });
});
