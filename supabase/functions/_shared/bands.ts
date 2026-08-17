// Deciding whether an orthomosaic actually carries near-infrared.
//
// This looks like a trivial `count >= 4` check. It is not, and getting it wrong
// is the difference between a real vegetation index and a decorative green wash.
//
// OpenDroneMap writes `odm_orthophoto.tif` as **RGBA** for ordinary RGB drone
// imagery: the fourth band is an alpha/nodata mask, not NIR. A naive band count
// therefore reports 4, concludes "multispectral", and computes
// (b4 - b1)/(b4 + b1) — which is (alpha - red)/(alpha + red). Alpha is a
// constant 255 inside the footprint, so that expression is just a smooth
// function of red, rescaled to -1..1 and painted with a red-yellow-green
// colormap. It looks like NDVI. It means nothing.
//
// Worse, the same check gates what the vision model is permitted to claim. A
// false positive there lets it quote NDVI values and name probable nutrient
// stress, derived from an alpha channel, to a farmer deciding what to spray.
//
// So: count only bands that carry spectral information, and when the evidence
// is ambiguous, under-claim. A wrongly-labelled VARI is honest about being a
// visible-light proxy; a wrongly-labelled NDVI is not.

export type BandAnalysis = {
  /** Every band in the file, alpha included. */
  total: number;
  /** Bands carrying spectral information (alpha excluded). */
  spectral: number;
  hasAlpha: boolean;
  /** True only when we are confident a real NIR band is present. */
  hasNDVI: boolean;
  /** Human-readable justification, surfaced in the UI and the logs. */
  reason: string;
};

type CogInfo = {
  count?: unknown;
  colorinterp?: unknown;
  band_descriptions?: unknown;
};

/**
 * Classify an orthomosaic's bands from a TiTiler `/cog/info` response.
 *
 * `colorinterp` is the reliable signal — GDAL reports e.g.
 * ["red","green","blue","alpha"] for an ODM RGB ortho. Note that "undefined" is
 * NOT treated as alpha: GDAL uses it for bands with no assigned interpretation,
 * which is exactly what a genuine NIR band usually looks like.
 */
export function analyseBands(info: CogInfo | null | undefined): BandAnalysis {
  const total = typeof info?.count === "number" && info.count > 0 ? info.count : 3;

  const colorinterp = Array.isArray(info?.colorinterp)
    ? (info.colorinterp as unknown[]).map(c => String(c).toLowerCase())
    : null;

  if (!colorinterp || colorinterp.length === 0) {
    // No band interpretation to go on. Four bands is genuinely ambiguous here:
    // RGB+alpha and RGB+NIR are indistinguishable. Under-claim.
    if (total >= 5) {
      return {
        total, spectral: total, hasAlpha: false, hasNDVI: true,
        reason: `${total} bands, no colour interpretation reported; treating as multispectral`,
      };
    }
    return {
      total, spectral: Math.min(total, 3), hasAlpha: false, hasNDVI: false,
      reason: total >= 4
        ? `${total} bands but no colour interpretation reported — cannot tell NIR from an alpha mask, so treating as RGB`
        : `${total} bands, RGB`,
    };
  }

  const alphaCount = colorinterp.filter(c => c === "alpha").length;
  const spectral = Math.max(0, total - alphaCount);
  const hasAlpha = alphaCount > 0;
  const hasNDVI = spectral >= 4;

  return {
    total,
    spectral,
    hasAlpha,
    hasNDVI,
    reason: hasNDVI
      ? `${spectral} spectral bands${hasAlpha ? " (+ alpha)" : ""} — near-infrared present`
      : hasAlpha
        ? `${spectral} spectral bands + alpha mask — no near-infrared, so no true NDVI`
        : `${spectral} spectral bands — no near-infrared, so no true NDVI`,
  };
}

/**
 * The index expression to hand TiTiler.
 *
 * NDVI uses b4 as NIR, which assumes alpha is written last — the convention
 * GDAL and ODM both follow. VARI is a visible-light approximation and is
 * labelled as such everywhere it surfaces, because it is not NDVI and must
 * never be presented as though it were.
 */
export function expressionFor(bands: BandAnalysis): {
  expression: string;
  index: "ndvi" | "vari";
  label: string;
} {
  if (bands.hasNDVI) {
    return {
      expression: "(b4-b1)/(b4+b1)",
      index: "ndvi",
      label: "NDVI (NIR−Red)/(NIR+Red)",
    };
  }
  return {
    expression: "(b2-b1)/(b2+b1-b3)",
    index: "vari",
    label: "VARI (G−R)/(G+R−B) · visible-light proxy, not NDVI",
  };
}
