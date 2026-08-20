// Where a dropped panel lands, and what survives a reload.
import { describe, it, expect, beforeEach } from "vitest";
import {
  type PanelLayout, ANCHORS, PANEL_MARGIN, anchorFraction, clampSize, clearLayout,
  collisions, loadLayout, mergeLayout, nearestAnchor, positionFor, saveLayout,
} from "@/lib/panelLayout";

const RECT = { w: 1000, h: 600 };
const LIMITS = { min: { w: 200, h: 80 }, max: { w: 600, h: 400 } };

const DEFAULTS: PanelLayout = {
  tank: { anchor: "top-center", size: { w: 300, h: 120 }, visible: true, collapsed: false },
  sim: { anchor: "bottom-center", size: { w: 560, h: 190 }, visible: true, collapsed: false },
};

describe("anchors", () => {
  it("covers all nine sections of the map", () => {
    expect(ANCHORS).toHaveLength(9);
    expect(new Set(ANCHORS).size).toBe(9);
  });

  it("puts the corners at the corners and the centre in the middle", () => {
    expect(anchorFraction("top-left")).toEqual({ fx: 0, fy: 0 });
    expect(anchorFraction("bottom-right")).toEqual({ fx: 1, fy: 1 });
    expect(anchorFraction("center")).toEqual({ fx: 0.5, fy: 0.5 });
  });
});

describe("positioning", () => {
  it("insets from the edges rather than sitting flush", () => {
    const p = positionFor("top-left", { w: 300, h: 120 }, RECT);
    expect(p).toEqual({ left: PANEL_MARGIN, top: PANEL_MARGIN });
  });

  it("keeps a right-anchored panel fully on screen", () => {
    const size = { w: 300, h: 120 };
    const p = positionFor("bottom-right", size, RECT);
    expect(p.left + size.w).toBeLessThanOrEqual(RECT.w - PANEL_MARGIN);
    expect(p.top + size.h).toBeLessThanOrEqual(RECT.h - PANEL_MARGIN);
  });

  it("centres a centred panel", () => {
    const size = { w: 300, h: 120 };
    const p = positionFor("center", size, RECT);
    expect(p.left + size.w / 2).toBeCloseTo(RECT.w / 2, 0);
  });

  it("never places a panel off-screen even when it is wider than the map", () => {
    // A panel you cannot grab is a panel you cannot move back.
    const p = positionFor("bottom-right", { w: 2000, h: 2000 }, RECT);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.top).toBeGreaterThanOrEqual(0);
  });
});

describe("snapping", () => {
  it("snaps to the nearest section", () => {
    expect(nearestAnchor({ x: 10, y: 10 }, RECT)).toBe("top-left");
    expect(nearestAnchor({ x: 990, y: 590 }, RECT)).toBe("bottom-right");
    expect(nearestAnchor({ x: 500, y: 300 }, RECT)).toBe("center");
    expect(nearestAnchor({ x: 500, y: 5 }, RECT)).toBe("top-center");
  });

  it("decides the same way whatever the screen size", () => {
    // Fractional, not pixel: dropping a panel a third of the way across means
    // the same thing on a laptop and on a wall display.
    const small = { w: 800, h: 480 };
    const big = { w: 2400, h: 1440 };
    expect(nearestAnchor({ x: 800 * 0.8, y: 480 * 0.1 }, small))
      .toBe(nearestAnchor({ x: 2400 * 0.8, y: 1440 * 0.1 }, big));
  });

  it("always returns a real anchor, even for a degenerate map", () => {
    expect(ANCHORS).toContain(nearestAnchor({ x: 0, y: 0 }, { w: 0, h: 0 }));
  });
});

describe("resizing", () => {
  it("holds the panel between its own limits", () => {
    expect(clampSize({ w: 10, h: 10 }, LIMITS, RECT)).toEqual({ w: 200, h: 80 });
    expect(clampSize({ w: 9999, h: 9999 }, LIMITS, RECT)).toEqual({ w: 600, h: 400 });
  });

  it("will not let a panel outgrow the map", () => {
    const tiny = { w: 320, h: 200 };
    const s = clampSize({ w: 9999, h: 9999 }, LIMITS, tiny);
    expect(s.w).toBeLessThanOrEqual(tiny.w);
    expect(s.h).toBeLessThanOrEqual(tiny.h);
  });

  it("keeps the minimum even on a map too small to honour it", () => {
    // Better a panel that overflows a sliver than one collapsed to nothing.
    const s = clampSize({ w: 10, h: 10 }, LIMITS, { w: 50, h: 40 });
    expect(s.w).toBe(LIMITS.min.w);
  });
});

describe("collisions", () => {
  it("notices two visible panels sharing one anchor", () => {
    // The one arrangement snapping can produce that is worse than free
    // dragging: the lower panel is simply invisible.
    const clash: PanelLayout = {
      a: { ...DEFAULTS.tank, anchor: "center" },
      b: { ...DEFAULTS.sim, anchor: "center" },
    };
    expect(collisions(clash)).toHaveLength(1);
  });

  it("ignores a hidden panel", () => {
    const clash: PanelLayout = {
      a: { ...DEFAULTS.tank, anchor: "center" },
      b: { ...DEFAULTS.sim, anchor: "center", visible: false },
    };
    expect(collisions(clash)).toHaveLength(0);
  });

  it("is quiet when everything has its own corner", () => {
    expect(collisions(DEFAULTS)).toHaveLength(0);
  });
});

describe("persistence", () => {
  beforeEach(() => localStorage.clear());

  it("returns the defaults when nothing is stored", () => {
    expect(loadLayout(DEFAULTS)).toEqual(DEFAULTS);
  });

  it("round-trips an arrangement", () => {
    const moved: PanelLayout = {
      ...DEFAULTS,
      tank: { anchor: "mid-right", size: { w: 340, h: 150 }, visible: true, collapsed: true },
    };
    saveLayout(moved);
    expect(loadLayout(DEFAULTS).tank).toEqual(moved.tank);
  });

  it("fills in a panel the stored layout has never heard of", () => {
    // Adding a panel later must not need a migration, and must not leave it
    // invisible for everyone who already arranged their screen.
    saveLayout({ tank: DEFAULTS.tank });
    const loaded = loadLayout({ ...DEFAULTS, legend: { anchor: "top-left", size: { w: 180, h: 90 }, visible: true, collapsed: false } });
    expect(loaded.legend).toBeDefined();
    expect(loaded.legend.visible).toBe(true);
  });

  it("ignores a junk anchor rather than placing a panel nowhere", () => {
    const merged = mergeLayout(DEFAULTS, { tank: { anchor: "outer-space", visible: true } });
    expect(merged.tank.anchor).toBe(DEFAULTS.tank.anchor);
  });

  it("survives corrupt JSON in storage", () => {
    localStorage.setItem("swathwise.panels", "{not json");
    expect(loadLayout(DEFAULTS)).toEqual(DEFAULTS);
  });

  it("resets to defaults when cleared", () => {
    saveLayout({ ...DEFAULTS, tank: { ...DEFAULTS.tank, visible: false } });
    clearLayout();
    expect(loadLayout(DEFAULTS).tank.visible).toBe(true);
  });

  it("brings back a panel that was hidden, on reset", () => {
    // The escape hatch. Hiding every panel must never be a one-way door.
    saveLayout({
      tank: { ...DEFAULTS.tank, visible: false },
      sim: { ...DEFAULTS.sim, visible: false },
    });
    clearLayout();
    const restored = loadLayout(DEFAULTS);
    expect(Object.values(restored).every(p => p.visible)).toBe(true);
  });
});
