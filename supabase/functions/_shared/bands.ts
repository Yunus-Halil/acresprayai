// Working out what an orthomosaic's bands actually are.
//
// Two traps live here, and both produce a plausible-looking index from the
// wrong arithmetic.
//
// TRAP 1 - counting bands is not detecting NIR.
// OpenDroneMap writes `odm_orthophoto.tif` as RGBA for ordinary RGB imagery, so
// a naive `count >= 4` reports "multispectral" for a plain camera drone. NDVI
// then evaluates (alpha - red)/(alpha + red); alpha is a constant 255 inside the
// footprint, so the result is a smooth function of red painted with a
// red-yellow-green colormap. It looks like NDVI and means nothing.
//
// TRAP 2 - band ORDER is not standardised.
//   Generic RGB+NIR    R, G, B, NIR          -> red b1, nir b4
//   DJI Mavic 3M       G, R, RedEdge, NIR    -> red b2, nir b4
//   MicaSense RedEdge  B, G, R, NIR, RedEdge -> red b3, nir b4
//   Parrot Sequoia     G, R, RedEdge, NIR    -> red b2, nir b4
// Hardcoding (b4-b1)/(b4+b1) yields GNDVI on a Mavic 3M and nonsense on a
// MicaSense - in both cases labelled "NDVI".
//
// The same gate decides what the vision model may claim to a farmer choosing
// what to spray, so when band roles cannot be established this module
// deliberately under-claims. A VARI labelled VARI is honest. An NDVI computed
// from the wrong bands is not.

export type BandRoles = {
  /** 1-based band indices, as TiTiler expressions use them. */
  red?: number;
  green?: number;
  blue?: number;
  nir?: number;
};

export type BandAnalysis = BandRoles & {
  /** Every band in the file, alpha included. */
  total: number;
  /** Bands carrying spectral information (alpha excluded). */
  spectral: number;
  hasAlpha: boolean;
  /** True only when a real NIR band has been positively identified. */
  hasNDVI: boolean;
  /** True when more than RGB is present but the roles could not be resolved. */
  ambiguousMultispectral: boolean;
  /** Human-readable justification, surfaced in the UI and the logs. */
  reason: string;
};

type CogInfo = {
  count?: unknown;
  colorinterp?: unknown;
  band_descriptions?: unknown;
};

/** TiTiler reports band_descriptions as [name, description] pairs. */
function bandNames(info: CogInfo | null | undefined): string[] {
  const raw = info?.band_descriptions;
  if (!Array.isArray(raw)) return [];
  return raw.map(entry => {
    if (Array.isArray(entry)) {
      // Prefer the description, falling back to the name. GDAL puts a real
      // label ("Red", "NIR") in whichever the writer populated.
      const [name, desc] = entry as unknown[];
      const pick = String(desc ?? "").trim() || String(name ?? "").trim();
      return pick.toLowerCase();
    }
    return String(entry ?? "").trim().toLowerCase();
  });
}

const isRed = (s: string) => /^red$|^r$|(^|[^a-z])red([^a-z]|$)/.test(s) && !/edge/.test(s);
const isGreen = (s: string) => /^green$|^g$|(^|[^a-z])green([^a-z]|$)/.test(s);
const isBlue = (s: string) => /^blue$|^b$|(^|[^a-z])blue([^a-z]|$)/.test(s);
const isNir = (s: string) => /nir|near.?infra/.test(s) && !/edge/.test(s);
/** Generic placeholders GDAL emits when nothing was labelled: b1, band 2, ... */
const isGeneric = (s: string) => !s || /^b\d+$/.test(s) || /^band[\s_]?\d+$/.test(s);

/**
 * Classify an orthomosaic's bands from a TiTiler `/cog/info` response.
 *
 * Resolution order:
 *   1. Band descriptions, when the writer labelled them. Most reliable, and
 *      what ODM produces for multispectral input.
 *   2. `colorinterp` for the RGB roles, plus the RGB+NIR convention when there
 *      is exactly one unlabelled spectral band beyond RGB.
 *   3. Otherwise: no NDVI claim.
 */
export function analyseBands(info: CogInfo | null | undefined): BandAnalysis {
  const total = typeof info?.count === "number" && info.count > 0 ? info.count : 3;

  const colorinterp = Array.isArray(info?.colorinterp)
    ? (info.colorinterp as unknown[]).map(c => String(c).toLowerCase())
    : [];
  const alphaCount = colorinterp.filter(c => c === "alpha").length;
  const hasAlpha = alphaCount > 0;
  const spectral = Math.max(0, total - alphaCount);

  const names = bandNames(info);
  const roles: BandRoles = {};

  // --- 1. Named bands -------------------------------------------------------
  names.forEach((n, i) => {
    const idx = i + 1;
    if (roles.nir === undefined && isNir(n)) roles.nir = idx;
    else if (roles.red === undefined && isRed(n)) roles.red = idx;
    else if (roles.green === undefined && isGreen(n)) roles.green = idx;
    else if (roles.blue === undefined && isBlue(n)) roles.blue = idx;
  });

  // --- 2. colorinterp for RGB ----------------------------------------------
  colorinterp.forEach((c, i) => {
    const idx = i + 1;
    if (roles.red === undefined && c === "red") roles.red = idx;
    if (roles.green === undefined && c === "green") roles.green = idx;
    if (roles.blue === undefined && c === "blue") roles.blue = idx;
  });

  const namesAreGeneric = names.length === 0 || names.every(isGeneric);

  // The RGB+NIR convention: colorinterp names R/G/B and exactly one further
  // spectral band exists. That extra band is conventionally NIR.
  if (
    roles.nir === undefined &&
    roles.red !== undefined && roles.green !== undefined && roles.blue !== undefined &&
    spectral === 4
  ) {
    const claimed = new Set([roles.red, roles.green, roles.blue]);
    for (let i = 1; i <= total; i++) {
      const isAlphaBand = colorinterp[i - 1] === "alpha";
      if (!claimed.has(i) && !isAlphaBand) { roles.nir = i; break; }
    }
  }

  const hasNDVI = roles.nir !== undefined && roles.red !== undefined;
  const ambiguousMultispectral = !hasNDVI && spectral >= 4;

  let reason: string;
  if (hasNDVI) {
    reason = `${spectral} spectral bands${hasAlpha ? " + alpha" : ""} — NIR at b${roles.nir}, red at b${roles.red}`;
  } else if (ambiguousMultispectral) {
    reason = namesAreGeneric
      ? `${spectral} spectral bands but none are labelled — cannot tell which is near-infrared, so falling back to a visible-light index`
      : `${spectral} spectral bands, but red and/or near-infrared could not be identified from ${names.filter(Boolean).join(", ")}`;
  } else if (hasAlpha) {
    reason = `${spectral} spectral bands + alpha mask — no near-infrared, so no true NDVI`;
  } else {
    reason = `${spectral} spectral bands — no near-infrared, so no true NDVI`;
  }

  return { total, spectral, hasAlpha, hasNDVI, ambiguousMultispectral, reason, ...roles };
}

/**
 * The index expression to hand TiTiler, built from the resolved band indices
 * rather than assumed positions.
 */
export function expressionFor(bands: BandAnalysis): {
  expression: string;
  index: "ndvi" | "vari";
  label: string;
} {
  if (bands.hasNDVI && bands.nir && bands.red) {
    const { nir, red } = bands;
    return {
      expression: `(b${nir}-b${red})/(b${nir}+b${red})`,
      index: "ndvi",
      label: "NDVI (NIR−Red)/(NIR+Red)",
    };
  }
  // VARI needs red, green and blue. Fall back to the conventional positions
  // only when colorinterp did not name them.
  const r = bands.red ?? 1;
  const g = bands.green ?? 2;
  const b = bands.blue ?? 3;
  return {
    expression: `(b${g}-b${r})/(b${g}+b${r}-b${b})`,
    index: "vari",
    label: "VARI (G−R)/(G+R−B) · visible-light proxy, not NDVI",
  };
}

/**
 * Band indices for a true-colour preview.
 *
 * TiTiler otherwise renders the first three bands, which on a MicaSense
 * (blue, green, red, …) produces a false-colour image. The vision model is told
 * it is looking at an aerial photograph of a field, so handing it inverted
 * colours would corrupt every visual judgement it makes.
 *
 * Returns null when the roles are unknown and TiTiler's default is as good a
 * guess as any.
 */
export function previewBands(bands: BandAnalysis): [number, number, number] | null {
  if (bands.red && bands.green && bands.blue) {
    return [bands.red, bands.green, bands.blue];
  }
  return null;
}
