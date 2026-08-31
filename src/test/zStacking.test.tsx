// Stacking order, enforced.
//
// This has now been got wrong twice for one reason. Radix portals every overlay
// to <body>, so they are all siblings and the z-index decides. Leaflet puts map
// panes at 400-700 and controls at 1000 with no stacking context of its own, so
// the stock shadcn z-50 loses to an open map: the first round raised dialogs,
// alert dialogs and sheets to 2000 and stopped there.
//
// The transient layers were left behind. A Select inside a Dialog is z-50
// against z-2000, so every picker in every dialog in this app rendered UNDER
// the dialog that owned it. The aircraft picker on the fleet registration form
// is where it was finally noticed; it was never about that picker.
//
// The first test below is the real one: it opens a Select inside a Dialog and
// checks which of the two wins. The rest keep the tiers from drifting apart
// again.
import { describe, it, expect, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Z_FLOATING, Z_SURFACE } from "@/components/ui/z-index";

const UI_DIR = join(__dirname, "..", "components", "ui");

/** The number inside a `z-[1234]` class string. */
function zOf(cls: string): number {
  const m = /^z-\[(\d+)\]$/.exec(cls);
  expect(m, `not a z-[n] class: ${cls}`).not.toBeNull();
  return Number(m![1]);
}

/** The nearest ancestor (or self) carrying a z-[n] class. */
function zClassOf(el: Element | null): string | null {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const hit = [...n.classList].find(c => /^z-\[\d+\]$/.test(c));
    if (hit) return hit;
  }
  return null;
}

beforeAll(() => {
  // Radix Select drives itself off pointer capture and scrolls the active item
  // into view; jsdom implements neither.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
  Element.prototype.scrollIntoView = () => {};
});

describe("a picker inside a dialog renders above it", () => {
  it("puts the open Select above the DialogContent that owns it", async () => {
    const user = userEvent.setup();
    render(
      <Dialog defaultOpen>
        <DialogTrigger>open</DialogTrigger>
        <DialogContent>
          <DialogTitle>New drone</DialogTitle>
          <Select>
            <SelectTrigger aria-label="Aircraft"><SelectValue placeholder="Pick one" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="DJI Agras T40">Agras T40</SelectItem>
              <SelectItem value="XAG P150">P150</SelectItem>
            </SelectContent>
          </Select>
        </DialogContent>
      </Dialog>,
    );

    const dialogZ = zClassOf(screen.getByRole("dialog"));
    expect(dialogZ, "the dialog should carry a z-[n]").not.toBeNull();

    await user.click(screen.getByLabelText("Aircraft"));
    const option = await screen.findByText("Agras T40");
    const menuZ = zClassOf(option);
    expect(menuZ, "the open select should carry a z-[n]").not.toBeNull();

    // The whole bug, in one comparison. Before the fix this was 50 vs 2000.
    expect(
      zOf(menuZ!),
      `select (${menuZ}) must render above the dialog (${dialogZ})`,
    ).toBeGreaterThan(zOf(dialogZ!));
    cleanup();
  });
});

describe("the two tiers stay in order", () => {
  it("floats transient layers above modal surfaces", () => {
    expect(zOf(Z_FLOATING)).toBeGreaterThan(zOf(Z_SURFACE));
  });

  // Leaflet's controls sit at 1000 and its panes at 400-700, with no stacking
  // context of its own. Anything portalled has to clear that outright.
  it("clears Leaflet's controls, which sit at 1000", () => {
    expect(zOf(Z_SURFACE)).toBeGreaterThan(1000);
  });
});

describe("no primitive is left on the stock z-50", () => {
  const files = readdirSync(UI_DIR).filter(f => f.endsWith(".tsx"));

  it("has something to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("carries no z-50 in any class string", () => {
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(join(UI_DIR, f), "utf-8").split("\n").forEach((line, i) => {
        // Comments explain the history and are allowed to name the old value.
        if (line.trimStart().startsWith("//")) return;
        if (/\bz-50\b/.test(line)) offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 90)}`);
      });
    }
    expect(
      offenders,
      "z-50 renders behind an open Leaflet map and behind every dialog. Use " +
      "Z_SURFACE or Z_FLOATING from components/ui/z-index.ts:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  // Everything Radix portals to <body>. These are the ones that compete with
  // the map and with each other; navigation-menu's z-[1] is an in-flow
  // decoration and toast.tsx is an unused subsystem (every toast in this app
  // goes through sonner, which sets its own z-index far above all of this).
  const FLOATING = [
    "select.tsx", "popover.tsx", "dropdown-menu.tsx", "context-menu.tsx",
    "menubar.tsx", "hover-card.tsx", "tooltip.tsx",
  ];
  const SURFACES = ["dialog.tsx", "alert-dialog.tsx", "sheet.tsx", "drawer.tsx"];

  it("gives every portalled primitive one of the two tiers", () => {
    for (const f of FLOATING) {
      expect(readFileSync(join(UI_DIR, f), "utf-8"), f).toContain("Z_FLOATING");
    }
    for (const f of SURFACES) {
      expect(readFileSync(join(UI_DIR, f), "utf-8"), f).toContain("Z_SURFACE");
    }
  });

  // One source of truth, so raising a tier is one edit rather than eleven.
  it("takes that z from the shared constant rather than a literal", () => {
    const offenders: string[] = [];
    for (const f of [...FLOATING, ...SURFACES]) {
      readFileSync(join(UI_DIR, f), "utf-8").split("\n").forEach((line, i) => {
        if (line.trimStart().startsWith("//")) return;
        if (/z-\[\d+\]/.test(line)) offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 90)}`);
      });
    }
    expect(
      offenders,
      "hardcoded z-[n] in a portalled primitive, which is how the two tiers " +
      "drifted apart last time:\n" + offenders.join("\n"),
    ).toEqual([]);
  });
});
