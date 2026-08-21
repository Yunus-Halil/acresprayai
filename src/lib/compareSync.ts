// Keeping two maps looking at the same ground.
//
// THE PROBLEM THIS SOLVES. Two Leaflet maps, each of which fires a `move` event
// whenever its view changes — including when the change was made by code. Wire
// them naively and pane A's move sets pane B, whose move event sets pane A,
// whose move event sets pane B. That loop does not always show up as a hang:
// more often it is a map that judders, or one that slowly drifts a few pixels
// per gesture because each round trip loses precision. Both look like flaky
// rendering rather than a feedback loop, which is why the guard lives here, in
// a module with no Leaflet in it, where it can be tested directly.
//
// GEOGRAPHIC, NOT PIXEL. The shared state is a centre coordinate and a zoom,
// never a pixel offset. Two scans of the same field can have different
// coverage — a flight that clipped the north edge, a later one that did not —
// and pixel-locked panes would show the same ground only while the extents
// happened to match. Latitude, longitude and zoom mean the same thing in both
// panes regardless of what either one actually has imagery for.

export type MapView = {
  lat: number;
  lng: number;
  zoom: number;
};

/**
 * How close two views must be to count as the same one.
 *
 * ~1e-7 degrees is about a centimetre — far below anything a person can pan to
 * deliberately, and comfortably above the float noise a projection round trip
 * introduces. This is the second line of defence: even if an echo arrives after
 * the guard has been released (an animated move that finishes late, say), it
 * carries a view we already hold and is dropped here instead of bouncing back.
 *
 * TUNABLE STARTING POINT, chosen for feel rather than measured.
 */
export const VIEW_EPSILON_DEG = 1e-7;
export const ZOOM_EPSILON = 1e-3;

export function sameView(a: MapView | null, b: MapView | null): boolean {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.lat - b.lat) < VIEW_EPSILON_DEG &&
    Math.abs(a.lng - b.lng) < VIEW_EPSILON_DEG &&
    Math.abs(a.zoom - b.zoom) < ZOOM_EPSILON
  );
}

export type ViewSync = {
  /**
   * Register a pane. `apply` is called when ANOTHER pane moves, never in
   * response to this pane's own report. Returns a detach function.
   */
  attach(paneId: string, apply: (view: MapView) => void): () => void;
  /** Tell the group this pane moved. Ignored if the move was one we caused. */
  report(paneId: string, view: MapView): void;
  /** The view the group is on, or null before anything has moved. */
  current(): MapView | null;
  /** Panes currently attached, in attach order. Exposed for tests. */
  panes(): string[];
};

/**
 * A view shared by any number of panes.
 *
 * The guard is a single flag rather than per-pane bookkeeping, and it is held
 * across the whole fan-out: while pane A's move is being applied to B and C,
 * every report is refused, whichever pane it comes from. That is deliberate.
 * Applying a view to B can synchronously make B report — that is the echo — and
 * so can a knock-on resize, and per-pane flags would have to anticipate which
 * pane the echo comes back on. This way nothing that happens during an apply
 * can start a second round, and the flag is cleared in a `finally` so a
 * throwing pane cannot wedge the group permanently.
 */
export function createViewSync(initial: MapView | null = null): ViewSync {
  const targets = new Map<string, (view: MapView) => void>();
  let view: MapView | null = initial;
  let applying = false;

  return {
    attach(paneId, apply) {
      targets.set(paneId, apply);
      return () => { targets.delete(paneId); };
    },

    report(paneId, next) {
      // An echo of our own programmatic move. Dropping it is the whole point.
      if (applying) return;
      // A move that changes nothing — including a genuine one, like a click
      // that Leaflet reports as a zero-distance drag.
      if (sameView(view, next)) return;

      view = next;
      applying = true;
      try {
        for (const [id, apply] of targets) {
          if (id === paneId) continue;   // never move the pane the user is on
          // Isolated per pane. A map torn down mid-gesture throws from its own
          // setView, and one dead pane must not stop the others from following
          // — a half-applied fan-out is two panes silently showing different
          // ground, which is the one thing this module exists to prevent.
          // Logged rather than swallowed: it is still a bug worth seeing.
          try {
            apply(next);
          } catch (e) {
            console.error(`[compareSync] pane "${id}" failed to follow`, e);
          }
        }
      } finally {
        applying = false;
      }
    },

    current: () => view,
    panes: () => [...targets.keys()],
  };
}
