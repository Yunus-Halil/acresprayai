// @vitest-environment node
// Outlines snapped onto their weed on the map: the shape slid over the green, inside-minus-ring, kept only when
// clearly better, worked through in the background with the view first.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => { throw new Error("not in this test"); } } }));

import type { GroundPlant } from "@/lib/weedVision/frames";
import { resetFrameRunStore, setFrameRunMap } from "@/lib/weedVision/frameRunStore";
import { snapShift, templateOf } from "@/lib/weedVision/snap";
import { requestSnaps, resetSnaps, setSnapper, snapOf, snapProgress, snapped } from "@/lib/weedVision/snapStore";

const W = 140, H = 140;
const disc = (green: Uint8Array, cx: number, cy: number, r: number) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) green[y * W + x] = 1; };
const ring = (cx: number, cy: number, r: number, n = 24): [number, number][] => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);

describe("snapShift", () => {
  it("slides the outline onto its weed", () => {
    const green = new Uint8Array(W * H);
    disc(green, 77, 66, 10);
    const s = snapShift(green, W, H, templateOf(ring(70, 70, 10), W, H, 4), 20)!;
    expect(s).not.toBeNull();
    expect(s.dx).toBe(7);
    expect(s.dy).toBe(-4);
    expect(s.score).toBeGreaterThan(0.8);
  });

  it("goes to the weed, not into the tree beside it", () => {
    const green = new Uint8Array(W * H);
    disc(green, 70, 118, 30); // a crown whose edge is 18 px below the outline's centre
    disc(green, 64, 72, 8); // the weed, 6 px left and 2 px down
    const s = snapShift(green, W, H, templateOf(ring(70, 70, 8), W, H, 4), 20)!;
    expect(s).not.toBeNull();
    expect(Math.abs(s.dx + 6)).toBeLessThanOrEqual(1);
    expect(Math.abs(s.dy - 2)).toBeLessThanOrEqual(1);
  });

  it("leaves an outline that is already on its weed, or that has nothing better near, where it is", () => {
    const on = new Uint8Array(W * H);
    disc(on, 70, 70, 10);
    expect(snapShift(on, W, H, templateOf(ring(70, 70, 10), W, H, 4), 20)).toBeNull();
    expect(snapShift(new Uint8Array(W * H), W, H, templateOf(ring(70, 70, 10), W, H, 4), 20)).toBeNull();
    const field = new Uint8Array(W * H).fill(1); // all green: inside and ring alike
    expect(snapShift(field, W, H, templateOf(ring(70, 70, 10), W, H, 4), 20)).toBeNull();
  });

  it("never moves further than its radius", () => {
    const green = new Uint8Array(W * H);
    disc(green, 110, 70, 10); // 40 px away
    expect(snapShift(green, W, H, templateOf(ring(70, 70, 10), W, H, 4), 20)).toBeNull();
  });
});

describe("snapStore", () => {
  beforeEach(() => { resetFrameRunStore(); resetSnaps(); });
  afterEach(() => { setSnapper(null); resetSnaps(); resetFrameRunStore(); });

  const plant = (id: string, lat: number): GroundPlant => ({ id, frame: "DJI_1.JPG", klass: "weed", centre: { lat, lng: -78.4 }, ring: [{ lat, lng: -78.4 }, { lat: lat + 1e-6, lng: -78.4 }, { lat, lng: -78.4 + 1e-6 }], seenIn: [], duplicates: 0 } as unknown as GroundPlant);

  it("snaps in the background, the view first, each plant once, and moves the plant by its snap", async () => {
    setFrameRunMap("scan-s", { tile: () => "", maxNative: 23, lat: 37.6, lng: -78.4 });
    const order: number[] = [];
    setSnapper(async ({ centre }) => { order.push(centre.lat); return centre.lat === 37.6003 ? null : { dLat: 1e-6, dLng: -2e-6, score: 0.9, shiftM: 0.2 }; });
    const all = [plant("a", 37.6001), plant("b", 37.6002), plant("c", 37.6003)];
    requestSnaps("scan-s", all);
    requestSnaps("scan-s", [all[2]], true); // c is in view
    await vi.waitFor(() => expect(snapProgress("scan-s").waiting).toBe(0));
    await vi.waitFor(() => expect(snapProgress("scan-s").done).toBe(3));
    expect(order).toHaveLength(3);
    expect(order[1]).toBe(37.6003); // a was already under way; c, in view, went next, before b
    expect(snapOf("scan-s", all[2])).toBeNull(); // stays where it is
    const moved = snapped("scan-s", all[0]);
    expect(moved.centre!.lat).toBeCloseTo(37.6001 + 1e-6, 9);
    expect(moved.ring![0].lng).toBeCloseTo(-78.4 - 2e-6, 9);
    expect(snapped("scan-s", all[2])).toBe(all[2]);
    requestSnaps("scan-s", all, true);
    await new Promise(r => setTimeout(r, 10));
    expect(order).toHaveLength(3); // never twice
  });
});
