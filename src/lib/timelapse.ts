// Timeline maths for the History tab's scan timelapse.
//
// Kept out of the component so the thing that actually matters - which two
// scans are visible and at what opacity - can be tested without a map.
//
// Scope note: this is a plain opacity crossfade between whichever tile layers
// exist. There is no re-registration, no alignment scoring and no cropping to a
// common extent. Two scans flown at different altitudes or covering slightly
// different ground will visibly disagree at the edges, and that is the honest
// picture rather than a defect to hide.

/** Seconds of wall clock for one scan-to-scan transition at 1x. */
export const TRANSITION_MS = 2500;

export type Crossfade = {
  /** Index of the older scan of the visible pair. */
  lower: number;
  /** Index of the newer scan. Equals `lower` once the timeline is at the end. */
  upper: number;
  lowerOpacity: number;
  upperOpacity: number;
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Which two scans straddle `position`, and how much of each to show.
 *
 * `position` is a float in scan-index space: 2.0 is exactly the third scan,
 * 2.5 is halfway between the third and fourth.
 */
export function crossfade(position: number, count: number): Crossfade {
  if (count <= 0) return { lower: 0, upper: 0, lowerOpacity: 0, upperOpacity: 0 };

  const p = clamp(position, 0, count - 1);
  const lower = clamp(Math.floor(p), 0, count - 1);
  const upper = Math.min(lower + 1, count - 1);
  const frac = p - lower;

  return {
    lower,
    upper,
    // Deliberately a straight split, per spec: at 30% of the way across, the
    // older scan is at 70% and the newer at 30%. Note both layers are partly
    // transparent mid-transition, so the dark map background shows through and
    // the image dims slightly at the midpoint. Holding the lower layer at 1 and
    // fading only the upper would avoid that, at the cost of this being a
    // simple, symmetric split.
    lowerOpacity: 1 - frac,
    upperOpacity: frac,
  };
}

/**
 * Opacity for every scan layer at `position` - the crossfading pair get their
 * share and everything else is fully transparent.
 */
export function layerOpacities(position: number, count: number): number[] {
  const out = new Array(count).fill(0);
  if (count <= 0) return out;
  const { lower, upper, lowerOpacity, upperOpacity } = crossfade(position, count);
  out[lower] = lowerOpacity;
  // At the end of the timeline upper === lower; adding would double it.
  if (upper !== lower) out[upper] = upperOpacity;
  return out;
}

/**
 * Advance the playhead. Stops dead at the last scan - playback runs once and
 * does not loop, so leaving it playing does not restart the field's history
 * behind the farmer's back.
 */
export function advance(position: number, count: number, elapsedMs: number, speed: number): number {
  if (count <= 1) return 0;
  const next = position + (elapsedMs / TRANSITION_MS) * speed;
  return clamp(next, 0, count - 1);
}

/** True once the playhead has nothing left to play. */
export const atEnd = (position: number, count: number) => count <= 1 || position >= count - 1;

/**
 * Whether a scan can be a frame in the timelapse.
 *
 * Three things have to hold: it finished, its tiles finished baking, and it has
 * an odm_uuid to build a tile URL from. A scan missing any of them would fade
 * to an empty frame, which reads as a broken player rather than as a scan that
 * is not ready.
 */
export function isPlayable(scan: {
  status?: string | null;
  tiles_baked?: boolean | null;
  odm_uuid?: string | null;
}): boolean {
  return scan.status === "completed" && scan.tiles_baked === true && !!scan.odm_uuid;
}
