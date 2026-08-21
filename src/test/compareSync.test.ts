// Two panes, one view, and the loop that must not happen.
//
// The failure this guards against does not look like a crash. Wire two maps
// together without a guard and each one's move re-triggers the other's; what
// the operator sees is a map that judders under the mouse, or one that creeps a
// few metres per gesture as float error accumulates through the round trips.
// Both read as flaky rendering. So the guard is tested here, directly, against
// panes that echo exactly the way Leaflet does.
import { describe, expect, it, vi } from "vitest";
import { type MapView, createViewSync, sameView } from "@/lib/compareSync";

const view = (lat: number, lng: number, zoom = 16): MapView => ({ lat, lng, zoom });

/**
 * A pane that echoes, like the real thing.
 *
 * Leaflet's `setView` synchronously fires `move`, and our binding reports every
 * `move` back to the sync. So a faithful fake calls `report` from inside its own
 * `apply`. If the guard is wrong, this is what turns it into infinite recursion.
 */
function echoingPane(id: string, sync: ReturnType<typeof createViewSync>) {
  const applied: MapView[] = [];
  sync.attach(id, v => {
    applied.push(v);
    sync.report(id, v);     // the echo
  });
  return {
    applied,
    /** A genuine user gesture on this pane. */
    move: (v: MapView) => sync.report(id, v),
  };
}

describe("sharing one view between panes", () => {
  it("moves the other pane when one is panned", () => {
    const sync = createViewSync();
    const a = echoingPane("a", sync);
    const b = echoingPane("b", sync);

    a.move(view(41.5, -89.5, 17));

    expect(b.applied).toEqual([view(41.5, -89.5, 17)]);
    // The pane the user is holding is never moved by code under their hand.
    expect(a.applied).toEqual([]);
  });

  it("does not bounce the echo back into the pane that moved", () => {
    const sync = createViewSync();
    const a = echoingPane("a", sync);
    const b = echoingPane("b", sync);

    a.move(view(41, -89, 15));

    // B applied once. If the echo had escaped the guard, A would have been
    // moved by B's report, then B by A's, and so on.
    expect(b.applied).toHaveLength(1);
    expect(a.applied).toHaveLength(0);
  });

  it("survives panes that echo each other, without recursion", () => {
    const sync = createViewSync();
    const a = echoingPane("a", sync);
    const b = echoingPane("b", sync);
    const c = echoingPane("c", sync);

    // Would blow the stack if each echo started a new round.
    expect(() => a.move(view(40, -88, 14))).not.toThrow();
    expect(b.applied).toHaveLength(1);
    expect(c.applied).toHaveLength(1);
  });

  it("releases the guard, so the next real gesture still propagates", () => {
    // The bug on the other side of the loop guard: a flag that latches leaves
    // the panes frozen, which is just as broken and much quieter.
    const sync = createViewSync();
    const a = echoingPane("a", sync);
    const b = echoingPane("b", sync);

    a.move(view(41, -89, 15));
    b.move(view(42, -90, 16));      // now the user drags the OTHER pane
    a.move(view(43, -91, 17));

    expect(a.applied).toEqual([view(42, -90, 16)]);
    expect(b.applied).toEqual([view(41, -89, 15), view(43, -91, 17)]);
  });

  it("keeps the other panes following when one throws", () => {
    // A pane whose map was torn down mid-gesture throws from its own setView.
    // The pane after it in the fan-out must still be moved: two panes showing
    // different ground is the exact failure this module prevents, and a
    // half-applied update is how you would get there.
    const sync = createViewSync();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    sync.attach("broken", () => { throw new Error("map is gone"); });
    const b = echoingPane("b", sync);

    expect(() => sync.report("a", view(41, -89, 15))).not.toThrow();
    expect(b.applied).toContainEqual(view(41, -89, 15));

    // And the group is not wedged for the next gesture either.
    sync.report("a", view(42, -90, 16));
    expect(b.applied).toContainEqual(view(42, -90, 16));

    // Still surfaced, not swallowed.
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("ignores a move that changes nothing", () => {
    const sync = createViewSync();
    const a = echoingPane("a", sync);
    const b = echoingPane("b", sync);

    a.move(view(41, -89, 15));
    a.move(view(41, -89, 15));                       // a click Leaflet calls a drag
    a.move(view(41 + 1e-9, -89 - 1e-9, 15));         // float noise from a round trip

    expect(b.applied).toHaveLength(1);
  });

  it("gives a pane that mounts late the view the group is already on", () => {
    // Otherwise the second pane opens on its own framing and drags the first
    // one to it, which reads as the compare view jumping on open.
    const sync = createViewSync();
    const a = echoingPane("a", sync);
    a.move(view(45, -93, 18));

    expect(sync.current()).toEqual(view(45, -93, 18));

    const late = echoingPane("late", sync);
    expect(late.applied).toHaveLength(0);   // attaching is not a move
    a.move(view(45.1, -93.1, 18));
    expect(late.applied).toEqual([view(45.1, -93.1, 18)]);
  });

  it("stops moving a pane once it detaches", () => {
    const sync = createViewSync();
    const applied: MapView[] = [];
    const detach = sync.attach("b", v => applied.push(v));

    sync.report("a", view(41, -89, 15));
    expect(applied).toHaveLength(1);

    detach();
    sync.report("a", view(42, -90, 16));
    expect(applied).toHaveLength(1);
    expect(sync.panes()).toEqual([]);
  });

  it("syncs zoom as well as centre", () => {
    const sync = createViewSync();
    const b = echoingPane("b", sync);
    sync.report("a", view(41, -89, 15));
    sync.report("a", view(41, -89, 19));      // same ground, zoomed in
    expect(b.applied.map(v => v.zoom)).toEqual([15, 19]);
  });

  it("carries coordinates, never pixels", () => {
    // The contract that keeps two scans of different extents aligned: what
    // crosses between panes is a place, not an offset into an image.
    const sync = createViewSync();
    const seen: MapView[] = [];
    sync.attach("b", v => seen.push(v));
    sync.report("a", view(41.234567, -89.765432, 18));
    expect(seen[0]).toEqual({ lat: 41.234567, lng: -89.765432, zoom: 18 });
  });
});

describe("sameView", () => {
  it("treats sub-centimetre differences as the same place", () => {
    expect(sameView(view(41, -89), view(41 + 1e-9, -89))).toBe(true);
  });

  it("treats a real pan as a different place", () => {
    // 1e-5 degrees is about a metre.
    expect(sameView(view(41, -89), view(41.00001, -89))).toBe(false);
  });

  it("does not confuse two zooms of the same centre", () => {
    expect(sameView(view(41, -89, 15), view(41, -89, 16))).toBe(false);
  });

  it("handles nulls without pretending they match", () => {
    expect(sameView(null, null)).toBe(true);
    expect(sameView(null, view(41, -89))).toBe(false);
  });
});

describe("what the sync does not do", () => {
  it("never writes anything", () => {
    // The compare view is read-only, and the sync is the only stateful thing in
    // it. It holds a view and a flag; there is nothing here to persist and no
    // way for this module to reach a repository.
    const sync = createViewSync();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const a = echoingPane("a", sync);
    a.move(view(41, -89, 15));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
