// Working out which physical band is which in an orthomosaic.
//
// Three ways to get this wrong, each producing a plausible-looking wrong index.
//
// 1. COUNTING IS NOT DETECTING. ODM writes `odm_orthophoto.tif` as RGBA for
//    ordinary RGB imagery, so `count >= 4` reports "multispectral" for a plain
//    camera drone. NDVI then evaluates (alpha - red)/(alpha + red): alpha is
//    constant inside the footprint, so the result is a smooth function of red
//    painted with a red-yellow-green colormap.
//
// 2. ORDER IS NOT STANDARDISED. Sensors disagree, and so does ODM's output
//    depending on what it was fed:
//      Red+NIR pair        Red, NIR                  -> red b1, nir b2
//      Generic RGB+NIR     R, G, B, NIR              -> red b1, nir b4
//      DJI Mavic 3M        G, R, RedEdge, NIR        -> red b2, nir b4
//      MicaSense RedEdge   B, G, R, NIR, RedEdge     -> red b3, nir b4
//    A hardcoded (b4-b1)/(b4+b1) gives GNDVI on an M3M and nonsense elsewhere.
//
// 3. RED EDGE IS NOT RED, AND NOT NIR. It sits between them at ~730 nm and is
//    its own band. Matching it as either silently changes the index.
//
// The same resolution gates what the vision model may claim to a farmer
// choosing what to spray, so when band roles cannot be established this module
// refuses to guess. A VARI labelled VARI is honest. An NDVI computed from the
// wrong bands is not.

export type BandRole = "red" | "green" | "blue" | "nir" | "rededge";
export type BandRoles = Partial<Record<BandRole, number>>;

/** How the mapping was arrived at, reported so it can be audited. */
export type ResolutionMethod =
  | "descriptions"   // GDAL band descriptions named the bands. Most reliable.
  | "colorinterp"    // GDAL colour interpretation named the RGB roles.
  | "convention"     // RGB named + exactly one spare spectral band = NIR.
  | "profile"        // Matched a known sensor arrangement by band count.
  | "unresolved";    // Could not be established. No index claim is made.

export type VegetationIndex = "ndvi" | "ndre" | "vari";

export type BandAnalysis = {
  /** Every band in the file, alpha included. */
  total: number;
  /** Bands carrying spectral information (alpha excluded). */
  spectral: number;
  hasAlpha: boolean;
  roles: BandRoles;
  method: ResolutionMethod;
  /** Indices computable from the resolved roles, best first. */
  available: VegetationIndex[];
  /** True only when a real NIR band has been positively identified. */
  hasNDVI: boolean;
  /** More than RGB is present but the roles could not be resolved. */
  ambiguousMultispectral: boolean;
  /**
   * Short stable string identifying this mapping. Tile URLs embed it so a
   * corrected mapping produces a different URL — otherwise browsers keep
   * serving day-old tiles rendered with the old expression and the fix never
   * reaches the person looking at the map.
   */
  fingerprint: string;
  /** Human-readable justification, surfaced in the UI and the logs. */
  reason: string;
};

type CogInfo = {
  count?: unknown;
  colorinterp?: unknown;
  band_descriptions?: unknown;
};

// ---------------------------------------------------------------------------
// Index definitions. Adding NDRE to the UI later is a new entry here plus a
// selector, not a parallel code path.
// ---------------------------------------------------------------------------
export const INDEX_DEFS: Record<VegetationIndex, {
  requires: BandRole[];
  label: string;
  build: (r: BandRoles) => string;
}> = {
  ndvi: {
    requires: ["nir", "red"],
    label: "NDVI (NIR−Red)/(NIR+Red)",
    build: r => `(b${r.nir}-b${r.red})/(b${r.nir}+b${r.red})`,
  },
  // Holds discrimination in dense canopy, where NDVI saturates.
  ndre: {
    requires: ["nir", "rededge"],
    label: "NDRE (NIR−RedEdge)/(NIR+RedEdge)",
    build: r => `(b${r.nir}-b${r.rededge})/(b${r.nir}+b${r.rededge})`,
  },
  vari: {
    requires: ["green", "red", "blue"],
    label: "VARI (G−R)/(G+R−B) · visible-light proxy, not NDVI",
    build: r => `(b${r.green}-b${r.red})/(b${r.green}+b${r.red}-b${r.blue})`,
  },
};

// ---------------------------------------------------------------------------
// Sensor profiles, as data. Adding a sensor is a row, not a branch.
//
// Applied ONLY when band descriptions and colorinterp both fail, and only when
// the band count matches exactly one profile — a count of 4 is shared by
// generic RGB+NIR and the M3M arrangement, so without a camera hint that stays
// unresolved rather than being guessed.
// ---------------------------------------------------------------------------
export type SensorProfile = {
  name: string;
  spectral: number;
  /** Matched against a camera hint when one is available. */
  camera?: RegExp;
  roles: BandRoles;
};

export const SENSOR_PROFILES: SensorProfile[] = [
  { name: "Red + NIR pair", spectral: 2, roles: { red: 1, nir: 2 } },
  { name: "Generic RGB + NIR", spectral: 4, camera: /rgb.?nir|sentera/i, roles: { red: 1, green: 2, blue: 3, nir: 4 } },
  { name: "DJI Mavic 3M / P4 Multispectral", spectral: 4, camera: /mavic\s*3\s*m|m3m|p4\s*multi|p4m/i, roles: { green: 1, red: 2, rededge: 3, nir: 4 } },
  { name: "MicaSense RedEdge / Altum", spectral: 5, camera: /micasense|rededge|altum/i, roles: { blue: 1, green: 2, red: 3, nir: 4, rededge: 5 } },
  { name: "Parrot Sequoia", spectral: 4, camera: /sequoia|parrot/i, roles: { green: 1, red: 2, rededge: 3, nir: 4 } },
];

/** TiTiler reports band_descriptions as [name, description] pairs. */
function bandNames(info: CogInfo | null | undefined): string[] {
  const raw = info?.band_descriptions;
  if (!Array.isArray(raw)) return [];
  return raw.map(entry => {
    if (Array.isArray(entry)) {
      // Prefer the description; GDAL puts the real label in whichever the
      // writer populated, and ODM writes it as the description.
      const [name, desc] = entry as unknown[];
      return (String(desc ?? "").trim() || String(name ?? "").trim()).toLowerCase();
    }
    return String(entry ?? "").trim().toLowerCase();
  });
}

// Red edge is excluded from both red and NIR: it is a distinct band at ~730 nm.
const isRedEdge = (s: string) => /red\s*[-_]?\s*edge|rededge|^re$/.test(s);
const isRed = (s: string) => !isRedEdge(s) && /^red$|^r$|(^|[^a-z])red([^a-z]|$)/.test(s);
const isNir = (s: string) => !isRedEdge(s) && /nir|near.?infra/.test(s);
const isGreen = (s: string) => /^green$|^g$|(^|[^a-z])green([^a-z]|$)/.test(s);
const isBlue = (s: string) => /^blue$|^b$|(^|[^a-z])blue([^a-z]|$)/.test(s);
/** Placeholders GDAL emits when nothing was labelled: b1, band 2, … */
const isGeneric = (s: string) => !s || /^b\d+$/.test(s) || /^band[\s_]?\d+$/.test(s);

function indicesFor(roles: BandRoles): VegetationIndex[] {
  const order: VegetationIndex[] = ["ndvi", "ndre", "vari"];
  return order.filter(k => INDEX_DEFS[k].requires.every(r => roles[r] !== undefined));
}

function fingerprintOf(index: VegetationIndex | null, roles: BandRoles): string {
  if (!index) return "none";
  const used = INDEX_DEFS[index].requires.map(r => roles[r]).join("-");
  return `${index}:${used}`;
}

/**
 * Classify an orthomosaic's bands from a TiTiler `/cog/info` response.
 *
 * `cameraHint` is optional and only used to disambiguate sensor profiles that
 * share a band count.
 */
export function analyseBands(
  info: CogInfo | null | undefined,
  cameraHint?: string | null,
): BandAnalysis {
  const total = typeof info?.count === "number" && info.count > 0 ? info.count : 3;
  const colorinterp = Array.isArray(info?.colorinterp)
    ? (info.colorinterp as unknown[]).map(c => String(c).toLowerCase())
    : [];
  const alphaCount = colorinterp.filter(c => c === "alpha").length;
  const hasAlpha = alphaCount > 0;
  const spectral = Math.max(0, total - alphaCount);

  const names = bandNames(info);
  const roles: BandRoles = {};
  let method: ResolutionMethod = "unresolved";

  // --- 1. Band descriptions -------------------------------------------------
  names.forEach((n, i) => {
    const idx = i + 1;
    if (colorinterp[i] === "alpha") return;      // never assign a role to alpha
    if (roles.rededge === undefined && isRedEdge(n)) roles.rededge = idx;
    else if (roles.nir === undefined && isNir(n)) roles.nir = idx;
    else if (roles.red === undefined && isRed(n)) roles.red = idx;
    else if (roles.green === undefined && isGreen(n)) roles.green = idx;
    else if (roles.blue === undefined && isBlue(n)) roles.blue = idx;
  });
  if (Object.keys(roles).length > 0) method = "descriptions";

  // --- 2. colorinterp for the RGB roles ------------------------------------
  const beforeCi = Object.keys(roles).length;
  colorinterp.forEach((c, i) => {
    const idx = i + 1;
    if (roles.red === undefined && c === "red") roles.red = idx;
    if (roles.green === undefined && c === "green") roles.green = idx;
    if (roles.blue === undefined && c === "blue") roles.blue = idx;
  });
  if (method === "unresolved" && Object.keys(roles).length > beforeCi) method = "colorinterp";

  // --- 3. RGB + one spare spectral band = NIR ------------------------------
  if (
    roles.nir === undefined &&
    roles.red !== undefined && roles.green !== undefined && roles.blue !== undefined &&
    spectral === 4
  ) {
    const claimed = new Set(Object.values(roles));
    for (let i = 1; i <= total; i++) {
      if (colorinterp[i - 1] === "alpha") continue;
      if (!claimed.has(i)) { roles.nir = i; method = "convention"; break; }
    }
  }

  // --- 4. Sensor profile, only if nothing above resolved a usable pair -----
  const namesAreGeneric = names.length === 0 || names.every(isGeneric);
  if (roles.nir === undefined || roles.red === undefined) {
    const hint = (cameraHint ?? "").trim();
    const byCount = SENSOR_PROFILES.filter(p => p.spectral === spectral);
    const byCamera = hint ? byCount.filter(p => p.camera?.test(hint)) : [];
    // A camera hint disambiguates; otherwise the count must match exactly one
    // profile, or we decline. Two profiles share a count of 4.
    const chosen = byCamera.length === 1 ? byCamera[0]
      : byCount.length === 1 ? byCount[0]
      : null;
    if (chosen && namesAreGeneric) {
      Object.assign(roles, chosen.roles);
      method = "profile";
    }
  }

  const available = indicesFor(roles);
  const hasNDVI = available.includes("ndvi");
  const ambiguousMultispectral = !hasNDVI && spectral >= 4;
  const best: VegetationIndex | null = hasNDVI ? "ndvi" : available.includes("vari") ? "vari" : null;
  if (!hasNDVI && method !== "unresolved" && available.length === 0) method = "unresolved";

  let reason: string;
  if (hasNDVI) {
    const via = method === "descriptions" ? "band descriptions"
      : method === "profile" ? "sensor profile"
      : method === "convention" ? "RGB+NIR convention"
      : "colour interpretation";
    reason = `${spectral} spectral bands${hasAlpha ? " + alpha" : ""} — NIR b${roles.nir}, red b${roles.red} (via ${via})`;
  } else if (ambiguousMultispectral) {
    reason = namesAreGeneric
      ? `${spectral} spectral bands, none labelled and no matching sensor profile — cannot tell which is near-infrared, so falling back to a visible-light index`
      : `${spectral} spectral bands, but red and/or near-infrared could not be identified from: ${names.filter(Boolean).join(", ")}`;
  } else if (hasAlpha) {
    reason = `${spectral} spectral bands + alpha mask — no near-infrared, so no true NDVI`;
  } else {
    reason = `${spectral} spectral bands — no near-infrared, so no true NDVI`;
  }

  return {
    total, spectral, hasAlpha, roles, method, available,
    hasNDVI, ambiguousMultispectral,
    fingerprint: fingerprintOf(best, roles),
    reason,
  };
}

/** The index to render, and the TiTiler expression for it. */
export function expressionFor(
  bands: BandAnalysis,
  prefer: VegetationIndex = "ndvi",
): { expression: string; index: VegetationIndex; label: string } {
  const pick: VegetationIndex | undefined =
    bands.available.includes(prefer) ? prefer
    : bands.available.includes("ndvi") ? "ndvi"
    : bands.available.includes("vari") ? "vari"
    : undefined;

  if (pick) {
    return { expression: INDEX_DEFS[pick].build(bands.roles), index: pick, label: INDEX_DEFS[pick].label };
  }
  // Nothing resolved. Fall back to the conventional RGB positions so the
  // overlay still renders something, labelled honestly as a proxy.
  return {
    expression: "(b2-b1)/(b2+b1-b3)",
    index: "vari",
    label: INDEX_DEFS.vari.label,
  };
}

/**
 * Band indices for a true-colour preview.
 *
 * TiTiler otherwise renders the first three bands, which on a MicaSense
 * (blue, green, red, …) is a false-colour image. The vision model is told it is
 * looking at an aerial photograph, so inverted colours corrupt every visual
 * judgement it makes. Returns null when the roles are unknown, or when the
 * sensor simply has no blue band.
 */
export function previewBands(bands: BandAnalysis): [number, number, number] | null {
  const { red, green, blue } = bands.roles;
  return red && green && blue ? [red, green, blue] : null;
}
