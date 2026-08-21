// What a scan may be shown as, and what it may be called while being shown.
//
// The failure mode this file exists for is a picture that is wrong in a way
// that looks right: a red-yellow-green overlay labelled NDVI, computed from an
// alpha channel because something counted four bands and called it
// multispectral. bands.test.ts covers the band resolution itself; this covers
// the layer in front of it — that the menu only offers what the file supports,
// that the refusals come with reasons, and that "NDVI" never appears over
// anything derived from ordinary RGB.
import { describe, expect, it } from "vitest";
import {
  type ComparableScan, type ScanBounds, type ScanIndexInfo,
  INDEX_RAMP, INDEX_SHORT_LABEL,
  boundsFromTileJson, boundsOverlap, compareSelectionError, coverageOf,
  defaultIndexFor, indexDetail, indexOptions, indexRampCss, indexTileUrl,
  isCalibratedIndex, isComparable, legendEnds, notComparableReason, rgbTileUrl,
} from "@/lib/scanLayers";
import { analyseBands } from "../../supabase/functions/_shared/bands";

const SCAN: ComparableScan = {
  id: "11111111-1111-1111-1111-111111111111",
  odm_uuid: "uuid-abc",
  status: "completed",
  created_at: "2026-05-01T10:00:00Z",
  tiles_baked: true,
};

/** The `/info` payload a scan of this shape would produce, from the real analyser. */
const infoFor = (cog: unknown, camera?: string): ScanIndexInfo => {
  const b = analyseBands(cog as never, camera);
  return {
    available: b.available,
    hasNDVI: b.hasNDVI,
    ambiguousMultispectral: b.ambiguousMultispectral,
    spectralBands: b.spectral,
    bands: b.total,
    method: b.method,
    reason: b.reason,
    fingerprint: b.fingerprint,
  };
};

// An ordinary RGB drone photo, as ODM writes it: three colours plus alpha.
const RGB_ALPHA = infoFor({
  count: 4,
  colorinterp: ["red", "green", "blue", "alpha"],
  band_descriptions: [["b1", ""], ["b2", ""], ["b3", ""], ["b4", ""]],
});

// A multispectral scan whose bands are actually labelled.
const MULTISPECTRAL = infoFor({
  count: 5,
  colorinterp: ["blue", "green", "red", "undefined", "undefined"],
  band_descriptions: [["b1", "blue"], ["b2", "green"], ["b3", "red"], ["b4", "nir"], ["b5", "red edge"]],
});

describe("what an ordinary RGB scan may be shown as", () => {
  it("does not offer NDVI, because there is no near-infrared band", () => {
    const ndvi = indexOptions(RGB_ALPHA).find(o => o.index === "ndvi")!;
    expect(ndvi.enabled).toBe(false);
    expect(ndvi.reason).toMatch(/near-infrared/i);
  });

  it("offers VARI, named as the RGB proxy it is", () => {
    const vari = indexOptions(RGB_ALPHA).find(o => o.index === "vari")!;
    expect(vari.enabled).toBe(true);
    expect(vari.label).toBe("VARI (RGB)");
    expect(vari.label).not.toMatch(/ndvi/i);
  });

  it("defaults to the proxy rather than to nothing", () => {
    expect(defaultIndexFor(RGB_ALPHA)).toBe("vari");
  });

  it("never calls a visible-band index calibrated", () => {
    expect(isCalibratedIndex("vari")).toBe(false);
    expect(isCalibratedIndex("ndvi")).toBe(true);
    expect(isCalibratedIndex("ndre")).toBe(true);
  });

  it("carries the caveat in the index's own detail line", () => {
    expect(indexDetail("vari")).toMatch(/not ndvi/i);
  });

  it("hedges the legend's wording for a proxy", () => {
    // "Stressed" is a claim about a plant. A visible-band ratio only supports a
    // claim about the picture.
    expect(legendEnds("vari")).toEqual({ low: "Less green", high: "More green" });
    expect(legendEnds("ndvi")).toEqual({ low: "Stressed", high: "Healthy" });
  });
});

describe("what a multispectral scan may be shown as", () => {
  it("offers real NDVI when a near-infrared band was identified", () => {
    const ndvi = indexOptions(MULTISPECTRAL).find(o => o.index === "ndvi")!;
    expect(ndvi.enabled).toBe(true);
    expect(ndvi.label).toBe("NDVI");
  });

  it("prefers NDVI over the proxy", () => {
    expect(defaultIndexFor(MULTISPECTRAL)).toBe("ndvi");
  });

  it("offers NDRE too when a red-edge band is present", () => {
    const ndre = indexOptions(MULTISPECTRAL).find(o => o.index === "ndre")!;
    expect(ndre.enabled).toBe(true);
  });
});

describe("when the bands cannot be resolved", () => {
  // Extra bands, none of them labelled, no sensor profile matching the count:
  // the case that used to produce a confident NDVI out of an alpha channel.
  const AMBIGUOUS = infoFor({
    count: 6,
    colorinterp: ["undefined", "undefined", "undefined", "undefined", "undefined", "undefined"],
    band_descriptions: [["b1", ""], ["b2", ""], ["b3", ""], ["b4", ""], ["b5", ""], ["b6", ""]],
  });

  it("still refuses NDVI, and says why in the operator's terms", () => {
    const ndvi = indexOptions(AMBIGUOUS).find(o => o.index === "ndvi")!;
    expect(ndvi.enabled).toBe(false);
    expect(ndvi.reason).toMatch(/nothing identifies which/i);
  });

  it("disables rather than hides, so the absence is explained", () => {
    // Every index is always listed; the unavailable ones carry a reason.
    const opts = indexOptions(AMBIGUOUS);
    expect(opts).toHaveLength(3);
    for (const o of opts.filter(x => !x.enabled)) expect(o.reason).toBeTruthy();
  });

  it("makes no claim at all before the bands have been read", () => {
    const opts = indexOptions(null);
    expect(opts.every(o => !o.enabled)).toBe(true);
    expect(opts[0].reason).toMatch(/still checking/i);
    expect(defaultIndexFor(null)).toBeNull();
  });
});

describe("tile sources", () => {
  it("asks for the index the pane is actually showing", () => {
    const url = indexTileUrl(SCAN, "tok", "vari", RGB_ALPHA)!;
    expect(url).toContain("index=vari");
    expect(url).toContain(`/${SCAN.id}/`);
  });

  it("embeds the band fingerprint, so a corrected mapping is not cached over", () => {
    const url = indexTileUrl(SCAN, "tok", "ndvi", MULTISPECTRAL)!;
    expect(url).toContain(`v=${encodeURIComponent(MULTISPECTRAL.fingerprint!)}`);
  });

  it("addresses the RGB tiles by the ODM uuid, as the tile function does", () => {
    expect(rgbTileUrl(SCAN, "tok")).toContain(`/${SCAN.odm_uuid}/`);
  });

  it("produces nothing without a session token, rather than an unauthorised URL", () => {
    expect(rgbTileUrl(SCAN, null)).toBeNull();
    expect(indexTileUrl(SCAN, null, "vari", RGB_ALPHA)).toBeNull();
    expect(rgbTileUrl({ ...SCAN, odm_uuid: null }, "tok")).toBeNull();
  });

  it("keeps the legend ramp and the tiles on the same colours", () => {
    // The tiles are coloured server-side by rdylgn; this is only the key to
    // them. Red at the low end and green at the high end is the part that must
    // not silently invert.
    expect(INDEX_RAMP[0]).toBe("#a50026");
    expect(INDEX_RAMP[INDEX_RAMP.length - 1]).toBe("#006837");
    expect(indexRampCss()).toContain("linear-gradient");
  });
});

describe("coverage, when two flights did not fly the same ground", () => {
  const scanBounds: ScanBounds = { west: -89.01, east: -88.99, south: 40.99, north: 41.01 };

  it("says nothing when the extent is not known yet", () => {
    // Absence of data is not evidence the drone did not fly here.
    expect(coverageOf({ west: -89, east: -88.995, south: 41, north: 41.005 }, null)).toBe("unknown");
    expect(coverageOf(null, scanBounds)).toBe("unknown");
  });

  it("reports full coverage when the view sits inside the flight", () => {
    expect(coverageOf({ west: -89, east: -88.995, south: 41, north: 41.005 }, scanBounds)).toBe("full");
  });

  it("reports partial coverage when the view runs off the edge", () => {
    expect(coverageOf({ west: -89.05, east: -88.995, south: 41, north: 41.005 }, scanBounds)).toBe("partial");
  });

  it("reports no coverage when the view is somewhere the scan never flew", () => {
    expect(coverageOf({ west: -80, east: -79.9, south: 35, north: 35.1 }, scanBounds)).toBe("none");
  });

  it("counts a shared edge as overlapping", () => {
    const touching: ScanBounds = { west: -88.99, east: -88.9, south: 40.99, north: 41.01 };
    expect(boundsOverlap(scanBounds, touching)).toBe(true);
  });
});

describe("reading a scan's extent", () => {
  it("takes tilejson's [west, south, east, north] order", () => {
    expect(boundsFromTileJson([-89.01, 40.99, -88.99, 41.01]))
      .toEqual({ west: -89.01, south: 40.99, east: -88.99, north: 41.01 });
  });

  it("refuses projected coordinates instead of flying the map into a void", () => {
    // UTM metres, not degrees — the viewer already refuses these on load.
    expect(boundsFromTileJson([448000, 4518000, 449000, 4519000])).toBeNull();
    expect(boundsFromTileJson(null)).toBeNull();
    expect(boundsFromTileJson([1, 2, 3])).toBeNull();
  });
});

describe("which scans can be compared", () => {
  it("accepts a completed scan with baked tiles", () => {
    expect(isComparable(SCAN)).toBe(true);
    expect(notComparableReason(SCAN)).toBeNull();
  });

  it("refuses one whose tiles are not baked, and says so", () => {
    const raw = { ...SCAN, tiles_baked: false };
    expect(isComparable(raw)).toBe(false);
    expect(notComparableReason(raw)).toMatch(/tiles have not finished baking/i);
  });

  it("refuses one that is still processing", () => {
    expect(notComparableReason({ ...SCAN, status: "processing" })).toMatch(/still processing/i);
  });

  it("refuses one with no orthomosaic at all", () => {
    expect(notComparableReason({ ...SCAN, odm_uuid: null })).toMatch(/no orthomosaic/i);
  });
});

describe("the two-scan guard", () => {
  it("explains what is missing rather than just refusing", () => {
    expect(compareSelectionError([])).toMatch(/select two scans/i);
    expect(compareSelectionError(["a"])).toMatch(/one more/i);
    expect(compareSelectionError(["a", "b", "c"])).toMatch(/exactly two.*3 are selected/i);
  });

  it("passes exactly two", () => {
    expect(compareSelectionError(["a", "b"])).toBeNull();
  });
});

describe("the vocabulary is the server's", () => {
  it("has a short label for every index the band analyser can produce", () => {
    // Keyed by the shared union: adding an index server-side is a type error
    // here rather than an unlabelled button.
    for (const index of MULTISPECTRAL.available!) {
      expect(INDEX_SHORT_LABEL[index]).toBeTruthy();
    }
  });

  it("never labels anything RGB-derived as NDVI", () => {
    const rgbOnly = indexOptions(RGB_ALPHA).filter(o => o.enabled);
    expect(rgbOnly.length).toBeGreaterThan(0);
    for (const o of rgbOnly) {
      expect(o.index).not.toBe("ndvi");
      expect(o.label).not.toMatch(/^NDVI$/);
    }
  });
});
