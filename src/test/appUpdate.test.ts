// @vitest-environment node
//
// A new version of the app reloads the page to run, but never through a Field Twin build or save
// (src/lib/appUpdate.ts): the build lives in the tab, and a reload in the middle of it would throw it away.
import { describe, expect, it, vi } from "vitest";
import { SETTLE_AFTER_WORK_MS, reloadWhenFree } from "@/lib/appUpdate";

function harness(busy: boolean) {
  const state = { busy };
  const listeners = new Set<() => void>();
  const timers: { cb: () => void; ms: number }[] = [];
  const reload = vi.fn();
  const owed = reloadWhenFree({ busy: () => state.busy, onChange: cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, reload, setTimer: (cb, ms) => { timers.push({ cb, ms }); } });
  return { state, reload, owed, listeners, timers, change: (b: boolean) => { state.busy = b; for (const l of [...listeners]) l(); }, tick: () => { const t = timers.shift(); t?.cb(); return t?.ms; } };
}

describe("reloading for a new version", () => {
  it("happens at once when nothing is being built or saved", () => {
    const h = harness(false);
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.owed()).toBe(false);
    expect(h.listeners.size).toBe(0);
  });

  it("waits through a build and its save, then a moment more, then reloads once", () => {
    const h = harness(true);
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.owed()).toBe(true);
    // Still building: progress changes the session many times.
    h.change(true); h.change(true);
    expect(h.timers).toHaveLength(0);
    // Saved: the tab is free. Not yet: what follows a save (the analysis record's upload) gets a moment.
    h.change(false);
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.tick()).toBe(SETTLE_AFTER_WORK_MS);
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.owed()).toBe(false);
    // Nothing listens any more, and a later change does not reload again.
    expect(h.listeners.size).toBe(0);
    h.change(false);
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it("another build started in that moment is waited through as well", () => {
    const h = harness(true);
    h.change(false);
    h.change(true);
    h.tick();
    expect(h.reload).not.toHaveBeenCalled();
    h.change(false);
    h.tick();
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it("several changes while waiting set one timer, not many", () => {
    const h = harness(true);
    h.change(false); h.change(false); h.change(false);
    expect(h.timers).toHaveLength(1);
  });
});
