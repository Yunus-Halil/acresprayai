// What a scan can be shown as, and what it may honestly be called.
//
// ONE SOURCE FOR THE INDEX VOCABULARY. The decision of which vegetation index a
// scan supports is not made here and must not be: it is made in
// supabase/functions/_shared/bands.ts, from the band roles actually resolved out
// of the file, and served by `ndvi-tile/info`. This module imports that module's
// definitions rather than restating them, because a second list of indices is a
// second list that can disagree with the tiles being rendered — and the way it
// would disagree is by calling something NDVI that isn't.
//
// WHY THERE IS NO PIXEL PIPELINE HERE. Computing an index client-side would mean
// deciding client-side which band is near-infrared, which is exactly the guess
// bands.ts exists to refuse. The index tiles come from the same endpoint the
// Field View uses, which resolves bands from the file and labels the result
// accordingly. lib/orthoRaster.ts stays what it is: the sampler for the cell
// matcher, which needs numbers rather than a picture.
import { NDVI_BASE, TILE_BASE } from "@/components/app/workspace/constants";
import {
  type VegetationIndex, INDEX_DEFS,
} from "../../supabase/functions/_shared/bands";

export type { VegetationIndex };

/** What a pane is currently showing. */
export type ScanLayerId = "rgb" | "index";

/** The subset of `ndvi-tile/info` this module needs. */
export type ScanIndexInfo = {
  /** Indices computable from the resolved band roles, best first. */
  available?: VegetationIndex[];
  /** True only when a real near-infrared band was positively identified. */
  hasNDVI?: boolean;
  ambiguousMultispectral?: boolean;
  spectralBands?: number;
  bands?: number;
  /** Which physical band each role resolved to, as reported by the server. */
  roles?: Partial<Record<"red" | "green" | "blue" | "nir" | "rededge", number>>;
  method?: string;
  /** Human-readable justification for the band mapping. */
  reason?: string;
  /** Identifies the resolved mapping; embedded in tile URLs to defeat caching. */
  fingerprint?: string;
  /**
   * How the baked RGB tiles were rendered, when known. Absent for scans whose
   * tiles were baked before band-aware rendering — which is what lets the UI
   * label those tiles as the composite they actually are.
   */
  render?: { dtype: string | null; bidx: number[] | null; rescale: [number, number][] } | null;
};

/** A scan as this feature needs it. Mirrors the odm_tasks columns it reads. */
export type ComparableScan = {
  id: string;
  odm_uuid: string | null;
  status: string;
  created_at: string;
  tiles_baked: boolean | null;
};

/** Geographic extent of a scan's imagery, WGS84. */
export type ScanBounds = { north: number; south: number; east: number; west: number };

// ---------------------------------------------------------------------------
// Tile sources
// ---------------------------------------------------------------------------

/**
 * The RGB orthomosaic, from the pre-baked tiles.
 *
 * Keyed on the ODM uuid rather than the scan id because that is how the `tile`
 * function addresses the bucket, and the token rides in the query string
 * because Leaflet loads tiles as plain <img> elements and cannot set headers.
 */
export function rgbTileUrl(scan: ComparableScan, token: string | null): string | null {
  if (!scan.odm_uuid || !token) return null;
  return `${TILE_BASE}/${scan.odm_uuid}/{z}/{x}/{y}.png?token=${token}`;
}

/**
 * The vegetation index, rendered server-side from the resolved bands.
 *
 * The fingerprint identifies the band mapping the tiles were rendered with. It
 * is in the URL because tiles are cached for a day: without it, correcting a
 * mapping leaves the browser serving yesterday's wrong index indefinitely.
 */
export function indexTileUrl(
  scan: ComparableScan,
  token: string | null,
  index: VegetationIndex,
  info?: ScanIndexInfo | null,
): string | null {
  if (!scan.odm_uuid || !token) return null;
  const v = info?.fingerprint ? `&v=${encodeURIComponent(info.fingerprint)}` : "";
  return `${NDVI_BASE}/${scan.id}/{z}/{x}/{y}.png?token=${token}&index=${index}${v}`;
}

// ---------------------------------------------------------------------------
// Naming, and refusing to misname
// ---------------------------------------------------------------------------

/**
 * Short names for a control. Keyed by the shared union, so adding an index to
 * bands.ts is a compile error here rather than a silently unlabelled option.
 *
 * VARI carries "(RGB)" in its own name on purpose. It is computed from an
 * ordinary photograph's visible bands and approximates canopy vigour; it is not
 * NDVI, is not calibrated, and the one place a person reads what they are
 * looking at is this string.
 */
export const INDEX_SHORT_LABEL: Record<VegetationIndex, string> = {
  ndvi: "NDVI",
  ndre: "NDRE",
  vari: "VARI (RGB)",
};

/** The formula and caveat, from the same table the server builds expressions from. */
export const indexDetail = (index: VegetationIndex): string => INDEX_DEFS[index].label;

/**
 * True when this index is a real measurement from a near-infrared band, rather
 * than a visible-light approximation of one. Drives the "approximate" note.
 */
export const isCalibratedIndex = (index: VegetationIndex): boolean =>
  index === "ndvi" || index === "ndre";

/**
 * What the baked "RGB" tiles may honestly be called, per scan.
 *
 * A plain camera's tiles are an RGB photograph. A multispectral file is only a
 * true-colour photograph when the baked tiles selected the red/green/blue
 * bands — tiles baked before band-aware rendering show whatever the first
 * three bands are, and on a sensor that stores green or blue first that is a
 * false-colour composite. The label follows the tiles, not the wish.
 */
export function rgbLayerLabel(
  info: ScanIndexInfo | null | undefined,
): { label: string; caveat: string | null; needsRebake: boolean } {
  const spectral = info?.spectralBands ?? info?.bands ?? 3;
  if (!info || spectral <= 3) {
    return { label: "RGB orthomosaic", caveat: null, needsRebake: false };
  }
  const rolesResolved = !!(info.roles?.red && info.roles?.green && info.roles?.blue);
  const bakedWithBands = !!info.render?.bidx;
  if (rolesResolved && bakedWithBands) {
    return { label: "True colour (multispectral)", caveat: null, needsRebake: false };
  }
  if (rolesResolved) {
    return {
      label: "Multispectral · bands 1–3 shown",
      caveat: "These map tiles were rendered before band-aware rendering, so colours may look wrong. Re-render the tiles to show true colour.",
      needsRebake: true,
    };
  }
  return {
    label: "Multispectral composite (bands 1–3)",
    caveat: "This file's band roles could not be identified, so the first three bands are shown as-is. Colours may not be natural.",
    needsRebake: false,
  };
}

export type IndexOption = {
  index: VegetationIndex;
  label: string;
  detail: string;
  enabled: boolean;
  /** Present only when disabled: why this scan cannot show it. */
  reason?: string;
};

/**
 * Every index, with the ones this scan cannot support disabled and explained.
 *
 * Disabled rather than hidden. An operator who has been told a scan can show
 * NDVI, and finds no NDVI option on a different scan, is owed the reason — that
 * the flight was flown on an RGB camera — rather than being left to conclude the
 * feature is broken. Rendering it anyway is the one thing that is not on offer:
 * an NDVI computed from bands nobody identified is a picture of nothing,
 * coloured to look like a diagnosis.
 */
export function indexOptions(info: ScanIndexInfo | null | undefined): IndexOption[] {
  const available = info?.available ?? [];
  const known = !!info;
  return (Object.keys(INDEX_DEFS) as VegetationIndex[]).map(index => {
    const enabled = known && available.includes(index);
    return {
      index,
      label: INDEX_SHORT_LABEL[index],
      detail: indexDetail(index),
      enabled,
      reason: enabled ? undefined : disabledReason(index, info),
    };
  });
}

function disabledReason(index: VegetationIndex, info: ScanIndexInfo | null | undefined): string {
  if (!info) return "Still checking what this scan's imagery contains.";
  if (index === "ndvi" || index === "ndre") {
    const band = index === "ndvi" ? "near-infrared" : "near-infrared and red-edge";
    if (info.ambiguousMultispectral) {
      return `This scan has extra bands but nothing identifies which is ${band}, so a true ${INDEX_SHORT_LABEL[index]} cannot be computed from it.`;
    }
    return `This scan is ordinary RGB imagery. ${INDEX_SHORT_LABEL[index]} needs a ${band} band the camera did not record.`;
  }
  return "This scan does not carry the visible bands this index needs.";
}

/**
 * Which index to offer first for a scan.
 *
 * The server's own preference order, deferred to rather than recomputed: real
 * NDVI when the bands are there, otherwise the best thing that is. Null when
 * the scan supports none, which the caller must show as an unavailable layer
 * rather than falling back to something it can draw.
 */
export function defaultIndexFor(info: ScanIndexInfo | null | undefined): VegetationIndex | null {
  return info?.available?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

/**
 * The colour ramp, mirroring the server's `colormap_name=rdylgn`.
 *
 * THESE TWO MUST CHANGE TOGETHER. The tiles are coloured by TiTiler; this is
 * only the key to them. A ramp here that does not match the one there produces
 * a legend that confidently mislabels the picture, which is worse than no
 * legend. Red-yellow-green is a ColorBrewer diverging ramp, ordered and
 * reasonably legible, and it is what the Field View's own vegetation legend
 * already uses — the same visual language, not a second one.
 *
 * TUNABLE STARTING POINT: the ramp is a choice, and a colour-vision-safe
 * alternative would be a defensible change. It needs changing in both places.
 */
export const INDEX_RAMP = [
  "#a50026", "#d73027", "#f46d43", "#fdae61", "#fee08b",
  "#d9ef8b", "#a6d96a", "#66bd63", "#1a9850", "#006837",
] as const;

export const indexRampCss = (): string =>
  `linear-gradient(to right, ${INDEX_RAMP.join(", ")})`;

/**
 * The range the ramp spans. The tile endpoint rescales every index to -1..1
 * before colouring, so the legend's ends are the same for all of them.
 */
export const INDEX_RANGE: [number, number] = [-1, 1];

/**
 * What the ends of the ramp mean in words.
 *
 * Deliberately vaguer for the visible-light proxy. "Bare or stressed" is a
 * claim about ground; for VARI the honest version is a claim about the picture,
 * because that is all a visible-band ratio measures.
 */
export function legendEnds(index: VegetationIndex): { low: string; high: string } {
  return isCalibratedIndex(index)
    ? { low: "Stressed", high: "Healthy" }
    : { low: "Less green", high: "More green" };
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

export type Coverage = "full" | "partial" | "none" | "unknown";

/** Do two extents share any ground at all? */
export function boundsOverlap(a: ScanBounds, b: ScanBounds): boolean {
  return !(a.west > b.east || a.east < b.west || a.south > b.north || a.north < b.south);
}

/** Is `inner` entirely within `outer`? */
export function boundsContain(outer: ScanBounds, inner: ScanBounds): boolean {
  return (
    outer.west <= inner.west && outer.east >= inner.east &&
    outer.south <= inner.south && outer.north >= inner.north
  );
}

/**
 * How much of what the operator is looking at this scan actually flew.
 *
 * The point of reporting this is the case the whole feature exists for: two
 * flights of the same field with different coverage. Where the older one has no
 * imagery, the pane shows the basemap, and an empty pane is ambiguous — it reads
 * equally as "nothing grew here" and "the drone never flew here". Only one of
 * those is true, and this is how the pane can say which.
 *
 * "unknown" when the scan's extent has not loaded yet: not a claim of absence.
 */
export function coverageOf(
  view: ScanBounds | null,
  scan: ScanBounds | null | undefined,
): Coverage {
  if (!view || !scan) return "unknown";
  if (!boundsOverlap(view, scan)) return "none";
  return boundsContain(scan, view) ? "full" : "partial";
}

/** TiTiler reports tilejson bounds as [west, south, east, north]. */
export function boundsFromTileJson(raw: unknown): ScanBounds | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const [west, south, east, north] = raw.map(Number);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  // Projected coordinates would send the map to a black void; the viewer
  // already refuses them on load and so does this.
  if (Math.abs(south) > 90 || Math.abs(north) > 90) return null;
  if (Math.abs(west) > 180 || Math.abs(east) > 180) return null;
  return { west, south, east, north };
}

// ---------------------------------------------------------------------------
// Which scans can be compared at all
// ---------------------------------------------------------------------------

/**
 * A scan can be compared once its tiles exist. The same rule the timelapse
 * uses, and for the same reason: a scan still processing has nothing to draw,
 * and offering it produces a blank pane rather than a comparison.
 */
export function isComparable(scan: ComparableScan): boolean {
  return scan.status === "completed" && scan.tiles_baked === true && !!scan.odm_uuid;
}

/** Why a scan cannot be selected, for the operator who is trying to select it. */
export function notComparableReason(scan: ComparableScan): string | null {
  if (isComparable(scan)) return null;
  if (!scan.odm_uuid) return "This scan has no orthomosaic.";
  if (scan.status !== "completed") return `This scan is still ${scan.status}.`;
  return "This scan's map tiles have not finished baking yet.";
}

