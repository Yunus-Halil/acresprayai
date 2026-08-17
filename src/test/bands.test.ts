// @vitest-environment node
//
// The band check decides two things: whether the map overlay is a real
// vegetation index, and whether the vision model may make NDVI-backed claims
// to a farmer choosing what to spray.
//
// Two ways to get it wrong, both producing a plausible-looking wrong answer:
//   1. Treating an ODM RGBA ortho as multispectral -> NDVI from an alpha channel
//   2. Assuming band ORDER -> NDVI computed from green, or from blue
import { describe, expect, it } from "vitest";
import { analyseBands, expressionFor, previewBands } from "../../supabase/functions/_shared/bands";

/** TiTiler reports band_descriptions as [name, description] pairs. */
const desc = (...names: string[]) => names.map((n, i) => [`b${i + 1}`, n]);

// --- real-world band layouts ------------------------------------------------
const odmRgba = {
  count: 4,
  colorinterp: ["red", "green", "blue", "alpha"],
  band_descriptions: desc("", "", "", ""),
};
const plainRgb = { count: 3, colorinterp: ["red", "green", "blue"] };
const rgbNir = {
  count: 4,
  colorinterp: ["red", "green", "blue", "undefined"],
  band_descriptions: desc("b1", "b2", "b3", "b4"),
};
const mavic3m = {
  count: 4,
  colorinterp: ["undefined", "undefined", "undefined", "undefined"],
  band_descriptions: desc("Green", "Red", "Red edge", "NIR"),
};
const micasense = {
  count: 5,
  colorinterp: ["undefined", "undefined", "undefined", "undefined", "undefined"],
  band_descriptions: desc("Blue", "Green", "Red", "NIR", "Red edge"),
};
const sequoia = {
  count: 4,
  colorinterp: ["undefined", "undefined", "undefined", "undefined"],
  band_descriptions: desc("Green", "Red", "Red edge", "Near infrared"),
};

describe("analyseBands · RGB imagery", () => {
  it("does NOT mistake an ODM RGBA ortho for multispectral", () => {
    // The original bug: a bare count of 4 read as "has NIR", producing
    // (alpha − red)/(alpha + red) — a green wash dressed up as NDVI.
    const b = analyseBands(odmRgba);
    expect(b.spectral).toBe(3);
    expect(b.hasAlpha).toBe(true);
    expect(b.hasNDVI).toBe(false);
    expect(b.nir).toBeUndefined();
  });

  it("recognises plain RGB", () => {
    const b = analyseBands(plainRgb);
    expect(b.spectral).toBe(3);
    expect(b.hasNDVI).toBe(false);
  });
});

describe("analyseBands · multispectral band ORDER", () => {
  it("finds red at b2 on a DJI Mavic 3M", () => {
    // Assuming b1 = red here yields (NIR − Green)/(NIR + Green), which is
    // GNDVI: a different index, silently mislabelled NDVI.
    const b = analyseBands(mavic3m);
    expect(b.hasNDVI).toBe(true);
    expect(b.red).toBe(2);
    expect(b.nir).toBe(4);
    expect(b.green).toBe(1);
    expect(expressionFor(b).expression).toBe("(b4-b2)/(b4+b2)");
  });

  it("finds red at b3 on a MicaSense RedEdge", () => {
    const b = analyseBands(micasense);
    expect(b.hasNDVI).toBe(true);
    expect(b.blue).toBe(1);
    expect(b.green).toBe(2);
    expect(b.red).toBe(3);
    expect(b.nir).toBe(4);
    expect(expressionFor(b).expression).toBe("(b4-b3)/(b4+b3)");
  });

  it("handles 'Near infrared' spelled out, as on a Parrot Sequoia", () => {
    const b = analyseBands(sequoia);
    expect(b.hasNDVI).toBe(true);
    expect(b.red).toBe(2);
    expect(b.nir).toBe(4);
  });

  it("never mistakes 'Red edge' for red or for NIR", () => {
    // Red edge sits between red and NIR and is a genuinely different band.
    const b = analyseBands(micasense);
    expect(b.red).not.toBe(5);
    expect(b.nir).not.toBe(5);
  });

  it("applies the RGB+NIR convention when colorinterp names R/G/B and one band is left over", () => {
    const b = analyseBands(rgbNir);
    expect(b.hasNDVI).toBe(true);
    expect(b.red).toBe(1);
    expect(b.nir).toBe(4);
    expect(expressionFor(b).expression).toBe("(b4-b1)/(b4+b1)");
  });
});

describe("analyseBands · under-claiming when unsure", () => {
  it("refuses to guess when extra bands exist but nothing is labelled", () => {
    // Could be RGB+NIR, could be anything. Guessing wrong yields a confident,
    // wrong NDVI - worse than an honest VARI.
    const b = analyseBands({ count: 5 });
    expect(b.hasNDVI).toBe(false);
    expect(b.ambiguousMultispectral).toBe(true);
    expect(b.reason).toMatch(/cannot tell which is near-infrared/i);
  });

  it("flags ambiguity so the UI can explain rather than silently degrade", () => {
    const b = analyseBands({ count: 4, band_descriptions: desc("chan1", "chan2", "chan3", "chan4") });
    expect(b.hasNDVI).toBe(false);
    expect(b.ambiguousMultispectral).toBe(true);
  });

  it("defaults to RGB when the probe returned nothing", () => {
    for (const input of [null, undefined, {}, { count: "weird" }]) {
      const b = analyseBands(input as never);
      expect(b.hasNDVI).toBe(false);
      expect(b.spectral).toBe(3);
      expect(b.ambiguousMultispectral).toBe(false);
    }
  });
});

describe("expressionFor", () => {
  it("never labels a VARI overlay as NDVI", () => {
    for (const input of [plainRgb, odmRgba, { count: 4 }, {}]) {
      const e = expressionFor(analyseBands(input as never));
      expect(e.index).toBe("vari");
      expect(e.label).toMatch(/not NDVI/i);
    }
  });

  it("builds VARI from the resolved RGB indices, not fixed positions", () => {
    // MicaSense is B,G,R — VARI from b1/b2/b3 positionally would be wrong.
    const b = analyseBands({
      count: 3,
      band_descriptions: desc("Blue", "Green", "Red"),
    });
    const e = expressionFor(b);
    expect(e.index).toBe("vari");
    expect(e.expression).toBe("(b2-b3)/(b2+b3-b1)");
  });
});

describe("previewBands", () => {
  it("orders a true-colour composite for a MicaSense", () => {
    // Without this TiTiler renders bands 1-3 = Blue,Green,Red: a false-colour
    // image handed to a vision model told it is looking at an aerial photo.
    expect(previewBands(analyseBands(micasense))).toEqual([3, 2, 1]);
  });

  it("orders a true-colour composite for a Mavic 3M even with no blue band", () => {
    // Mavic 3M multispectral has no blue; roles stay partial and we do not
    // pretend otherwise.
    expect(previewBands(analyseBands(mavic3m))).toBeNull();
  });

  it("leaves an ordinary RGB ortho to TiTiler's default", () => {
    expect(previewBands(analyseBands(plainRgb))).toEqual([1, 2, 3]);
  });

  it("returns null when roles are unknown", () => {
    expect(previewBands(analyseBands({ count: 5 }))).toBeNull();
  });
});
