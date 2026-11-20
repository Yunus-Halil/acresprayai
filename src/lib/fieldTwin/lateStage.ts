// Late corn (2026-11-19): telling a photograph whose canopy has closed, and a flight made mostly of them.
//
// One signal, used in three places so they agree:
//   - the read's guard (rowCrop/cornV1.ts readCornV1, `lateGuard`): a late photograph gives no plant count, as the
//     emergence guard already withholds it past its cut;
//   - the twin: how many of the flight's photographs read late, for the banner on the twin;
//   - the photograph check before a build: a sample of the flight read the same way, for a warning (never a stop).
//
// The signal is the share of a photograph's assessment cells (rowCrop/assess.ts) in the states "canopy" (the leaves
// nearly meet between the rows) or "closed" (nothing between the rows can be seen). The emergence guard measures green
// along the rows instead, and at a coarse pixel it can fall just under its cut on a closed canopy: on the late flight
// of 2026-11-19 (94 m, 2.5 cm a pixel) it read 0.635 and 0.595 against 0.642, and the reads counted 12,244 and 6,843
// "plants" on the canopy. The cut below is set from every photograph of the stored flights (crop-views LATE-1.md).
import type { FieldAssessment } from "../rowCrop/assess";

export const LATE_STAGE = {
  /** A photograph reads late at or over this share of its cells in canopy or closed. */
  photoCut: 0.5,
  /** A flight reads late when at least this share of the photographs looked at read late. */
  flightShare: 0.5,
  /** Photographs the check before a build looks at, spread through the flight. */
  sample: 8,
  /** The check before a build reads each photograph reduced, but never so far that a corn row is under this many
   * pixels from the next (76 cm rows), and never by more than `maxDown`. */
  rowSpacingM: 0.76, minRowPx: 24, maxDown: 4,
  /** What a withheld read says (the emergence guard says CORN_COUNT_GUARD.message). */
  message: "the canopy has closed: too late for a per-plant count",
};

/** The share of a photograph's assessment cells in canopy or closed (0 with no cell). */
export function lateShareOf(a: Pick<FieldAssessment, "cells">): number {
  if (!a.cells.length) return 0;
  let n = 0;
  for (const c of a.cells) if (c.state === "canopy" || c.state === "closed") n++;
  return n / a.cells.length;
}

export const isLatePhoto = (share: number | null | undefined, o = LATE_STAGE) => share != null && share >= o.photoCut;

export type FlightStage = {
  /** Photographs looked at, and how many of them read late. */
  looked: number; late: number;
  /** "late" when at least `flightShare` of them read late; "ok" otherwise; null with nothing looked at. */
  verdict: "late" | "ok" | null;
};

export function flightStageOf(shares: (number | null)[], o = LATE_STAGE): FlightStage {
  const looked = shares.filter(s => s != null).length, late = shares.filter(s => isLatePhoto(s, o)).length;
  return { looked, late, verdict: looked ? (late / looked >= o.flightShare ? "late" : "ok") : null };
}

/** `n` items spread evenly through a list (all of them when it holds no more). */
export function spreadPick<T>(list: readonly T[], n: number): T[] {
  if (list.length <= n) return [...list];
  return Array.from({ length: n }, (_, i) => list[Math.floor(((i + 0.5) * list.length) / n)]);
}

/** How far the check before a build reduces a photograph of this pixel size (metres), 1 to `maxDown`. */
export function checkDownFor(gsdM: number | null, o = LATE_STAGE): number {
  if (!gsdM || !(gsdM > 0)) return o.maxDown;
  return Math.max(1, Math.min(o.maxDown, Math.floor(o.rowSpacingM / (o.minRowPx * gsdM))));
}
