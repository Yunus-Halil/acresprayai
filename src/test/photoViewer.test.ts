// The viewer's arithmetic: opening on the spot at a scale that shows its
// window, and zooming so the point under the cursor stays put.
import { describe, expect, it } from "vitest";
import { VIEWER_MAX_SCALE, fitView, zoomAbout } from "@/components/app/workspace/PhotoViewer";

const photo = { width: 5472, height: 3648 };
const viewport = { width: 1000, height: 700 };

describe("fitView", () => {
  it("opens on the spot with its window filling the shorter side, never below the whole-photo fit", () => {
    const v = fitView(viewport, photo, { cx: 2736, cy: 1824, fitWidthPx: 700 });
    expect(v.s).toBeCloseTo(1, 6);
    // The spot sits at the viewport's centre.
    expect(v.tx + 2736 * v.s).toBeCloseTo(500, 6);
    expect(v.ty + 1824 * v.s).toBeCloseTo(350, 6);
    const whole = fitView(viewport, photo, { cx: 2736, cy: 1824, fitWidthPx: null });
    expect(whole.s).toBeCloseTo(Math.min(1000 / 5472, 700 / 3648), 9);
    // A tiny window would want more than the maximum: capped.
    expect(fitView(viewport, photo, { cx: 10, cy: 10, fitWidthPx: 20 }).s).toBe(VIEWER_MAX_SCALE);
    // A window wider than the photo's fit would want less than the whole photo: floored.
    expect(fitView(viewport, photo, { cx: 10, cy: 10, fitWidthPx: 50_000 }).s).toBe(whole.s);
  });
});

describe("zoomAbout", () => {
  it("keeps the photo point under the cursor under the cursor, within the limits", () => {
    const v = { tx: -1000, ty: -500, s: 1 };
    const px = 300, py = 200;
    const before = { x: (px - v.tx) / v.s, y: (py - v.ty) / v.s };
    const z = zoomAbout(v, 2, px, py, 0.1);
    expect(z.s).toBe(2);
    expect((px - z.tx) / z.s).toBeCloseTo(before.x, 9);
    expect((py - z.ty) / z.s).toBeCloseTo(before.y, 9);
    const out = zoomAbout(z, 0.25, px, py, 0.1);
    expect(out.s).toBe(0.5);
    expect((px - out.tx) / out.s).toBeCloseTo(before.x, 9);
    expect(zoomAbout(v, 100, px, py, 0.1).s).toBe(VIEWER_MAX_SCALE);
    expect(zoomAbout(v, 0.001, px, py, 0.1).s).toBe(0.1);
  });
});
