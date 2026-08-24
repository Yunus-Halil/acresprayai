// How a scan's RGB tiles must be rendered, decided from the file itself.
//
// Three properties of the source raster silently ruin baked tiles when
// ignored, and each has shown up in production imagery:
//
//   1. BAND ORDER. TiTiler's default is "first three bands as RGB". On a
//      sensor that stores green first (Mavic 3M: G,R,RE,NIR) or blue first
//      (MicaSense: B,G,R,NIR,RE) that is a false-colour image — blue fields,
//      magenta roads — labelled as if it were a photograph. The fix is the
//      same `previewBands` resolution the index endpoint and the vision
//      preview already use: never a second, disagreeing pipeline.
//
//   2. BIT DEPTH. A uint16/float reflectance product rendered without a
//      display stretch clips to near-black. The stretch comes from the file's
//      own 2–98 percentile statistics, not a guessed constant.
//
//   3. NODATA. An ODM orthophoto is a rectangle with the flight footprint in
//      the middle and zeroes around it; without `nodata=0` the collar bakes
//      as opaque black over the basemap. (A genuinely pure-black pixel inside
//      the footprint goes transparent too — accepted: near-nonexistent on
//      crop imagery, and far cheaper than burying the basemap.)
//
// The resolved plan is persisted on the scan row (band_mapping.render), so
// every bake pass — and every rebake — renders identically. `authoritative`
// is false when a probe failed; the caller then renders this pass with the
// fallback but must NOT persist it, so the next pass re-probes instead of
// freezing a guess.

import { type BandAnalysis, analyseBands, previewBands } from "./bands.ts";

export type RenderPlan = {
  /** GDAL dtype reported by /cog/info, e.g. "uint8", "uint16", "float32". */
  dtype: string | null;
  /** 1-based band indices rendered as R,G,B. Null = TiTiler's default order. */
  bidx: [number, number, number] | null;
  /** Per rendered band [low, high] display stretch. Empty for 8-bit files. */
  rescale: [number, number][];
};

export const FALLBACK_PLAN: RenderPlan = { dtype: null, bidx: null, rescale: [] };

/** Query-string suffix (leading "&") the plan translates to on a tile URL. */
export function renderTileQuery(plan: RenderPlan): string {
  let qs = "&nodata=0";
  if (plan.bidx) qs += plan.bidx.map(b => `&bidx=${b}`).join("");
  for (const [lo, hi] of plan.rescale) qs += `&rescale=${lo},${hi}`;
  return qs;
}

type CogInfoJson = {
  dtype?: unknown;
  count?: unknown;
  colorinterp?: unknown;
  band_descriptions?: unknown;
};

/**
 * Resolve the render plan for one COG.
 *
 * `priorBands` is a band analysis someone already persisted (the index
 * endpoint resolves and stores one); its roles are reused rather than
 * re-derived so the two pipelines cannot disagree about which band is red.
 */
export async function resolveRenderPlan(
  titiler: string,
  cogUrl: string,
  priorBands?: BandAnalysis | null,
): Promise<{ bands: BandAnalysis; plan: RenderPlan; authoritative: boolean }> {
  let info: CogInfoJson | null = null;
  try {
    const r = await fetch(`${titiler}/cog/info?url=${encodeURIComponent(cogUrl)}`);
    if (r.ok) info = await r.json();
  } catch { /* probed below as unavailable */ }

  if (!info) {
    // Nothing knowable this pass. Render conservatively, persist nothing.
    return { bands: priorBands ?? analyseBands(null), plan: FALLBACK_PLAN, authoritative: false };
  }

  const bands = priorBands?.fingerprint && priorBands.fingerprint !== "none"
    ? priorBands
    : analyseBands(info);
  const dtype = typeof info.dtype === "string" ? info.dtype : null;
  const bidx = previewBands(bands);

  if (!dtype || dtype === "uint8") {
    return { bands, plan: { dtype, bidx, rescale: [] }, authoritative: true };
  }

  // Deeper than 8 bits: a display stretch is required, from the file's own
  // statistics. Without it the caller renders the conservative fallback and
  // retries, rather than baking a scan that renders differently per pass.
  const targets = bidx ?? ([1, 2, 3].slice(0, Math.max(1, Math.min(3, bands.spectral || bands.total))) as number[]);
  try {
    const su = new URL(`${titiler}/cog/statistics`);
    su.searchParams.set("url", cogUrl);
    for (const b of targets) su.searchParams.append("bidx", String(b));
    const r = await fetch(su.toString());
    if (!r.ok) throw new Error(`statistics ${r.status}`);
    const stats = await r.json() as Record<string, { percentile_2?: number; percentile_98?: number; min?: number; max?: number }>;
    const rescale: [number, number][] = [];
    for (const b of targets) {
      const s = stats[`b${b}`];
      if (!s) throw new Error(`no statistics for band ${b}`);
      let lo = typeof s.percentile_2 === "number" ? s.percentile_2 : s.min;
      let hi = typeof s.percentile_98 === "number" ? s.percentile_98 : s.max;
      if (typeof lo !== "number" || typeof hi !== "number") throw new Error(`no range for band ${b}`);
      if (hi <= lo) { lo = s.min ?? lo; hi = s.max ?? hi; }
      if (hi <= lo) hi = lo + 1;
      rescale.push([lo, hi]);
    }
    return { bands, plan: { dtype, bidx, rescale }, authoritative: true };
  } catch {
    return { bands, plan: FALLBACK_PLAN, authoritative: false };
  }
}
