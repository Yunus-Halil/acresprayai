// @vitest-environment node
//
// The band check decides two things: whether the map overlay is a real
// vegetation index, and whether the vision model is allowed to make
// NDVI-backed claims to a farmer. A false positive produces a meaningless
// green wash presented as NDVI, and unlocks nutrient-stress claims computed
// from an alpha channel.
import { describe, expect, it } from "vitest";
import { analyseBands, expressionFor } from "../../supabase/functions/_shared/bands";

const rgba = { count: 4, colorinterp: ["red", "green", "blue", "alpha"] };
const rgb = { count: 3, colorinterp: ["red", "green", "blue"] };
const multispectral = { count: 5, colorinterp: ["red", "green", "blue", "undefined", "alpha"] };
const multispectralNoAlpha = { count: 4, colorinterp: ["red", "green", "blue", "undefined"] };

describe("analyseBands", () => {
  it("does NOT mistake an ODM RGBA ortho for multispectral", () => {
    // This is the regression. OpenDroneMap writes RGBA for ordinary RGB drone
    // imagery, so a bare count of 4 previously read as "has NIR" and produced
    // (alpha − red)/(alpha + red) — a green wash dressed up as NDVI.
    const b = analyseBands(rgba);
    expect(b.total).toBe(4);
    expect(b.spectral).toBe(3);
    expect(b.hasAlpha).toBe(true);
    expect(b.hasNDVI).toBe(false);
    expect(b.reason).toMatch(/no near-infrared/i);
  });

  it("recognises plain RGB", () => {
    const b = analyseBands(rgb);
    expect(b.spectral).toBe(3);
    expect(b.hasNDVI).toBe(false);
  });

  it("recognises genuine multispectral with an alpha band", () => {
    const b = analyseBands(multispectral);
    expect(b.spectral).toBe(4);
    expect(b.hasAlpha).toBe(true);
    expect(b.hasNDVI).toBe(true);
  });

  it("recognises genuine multispectral without an alpha band", () => {
    const b = analyseBands(multispectralNoAlpha);
    expect(b.spectral).toBe(4);
    expect(b.hasNDVI).toBe(true);
  });

  it("treats 'undefined' colour interpretation as spectral, not alpha", () => {
    // GDAL reports "undefined" for bands with no assigned interpretation, which
    // is what a real NIR band usually looks like. Excluding it would throw away
    // genuine multispectral data.
    const b = analyseBands({ count: 4, colorinterp: ["undefined", "undefined", "undefined", "undefined"] });
    expect(b.spectral).toBe(4);
    expect(b.hasNDVI).toBe(true);
  });
});

describe("analyseBands · ambiguous input", () => {
  it("under-claims when 4 bands arrive with no colour interpretation", () => {
    // RGB+alpha and RGB+NIR are indistinguishable here. A wrongly-labelled VARI
    // is honest about being a proxy; a wrongly-labelled NDVI is not.
    const b = analyseBands({ count: 4 });
    expect(b.hasNDVI).toBe(false);
    expect(b.reason).toMatch(/cannot tell NIR from an alpha mask/i);
  });

  it("accepts 5+ bands without colour interpretation as multispectral", () => {
    expect(analyseBands({ count: 6 }).hasNDVI).toBe(true);
  });

  it("defaults to RGB when the probe returned nothing at all", () => {
    for (const input of [null, undefined, {}, { count: "weird" }]) {
      const b = analyseBands(input as never);
      expect(b.hasNDVI).toBe(false);
      expect(b.spectral).toBe(3);
    }
  });
});

describe("expressionFor", () => {
  it("uses true NDVI only when NIR is present", () => {
    const e = expressionFor(analyseBands(multispectral));
    expect(e.index).toBe("ndvi");
    expect(e.expression).toBe("(b4-b1)/(b4+b1)");
  });

  it("falls back to VARI and says plainly that it is not NDVI", () => {
    const e = expressionFor(analyseBands(rgba));
    expect(e.index).toBe("vari");
    expect(e.expression).toBe("(b2-b1)/(b2+b1-b3)");
    // The label is what a farmer reads off the legend.
    expect(e.label).toMatch(/not NDVI/i);
  });

  it("never labels a VARI overlay as NDVI", () => {
    for (const input of [rgb, rgba, { count: 4 }, {}]) {
      const e = expressionFor(analyseBands(input as never));
      expect(e.index).toBe("vari");
      expect(e.label.startsWith("NDVI")).toBe(false);
    }
  });
});
