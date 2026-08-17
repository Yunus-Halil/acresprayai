// @vitest-environment node
//
// Band resolution decides whether the overlay is a real vegetation index, and
// whether the vision model may make NDVI-backed claims to a farmer choosing
// what to spray. Every failure mode here produces a plausible-looking wrong
// answer rather than an error, which is why it is tested this heavily.
import { describe, expect, it } from "vitest";
import {
  INDEX_DEFS, SENSOR_PROFILES,
  analyseBands, expressionFor, previewBands,
} from "../../supabase/functions/_shared/bands";

/** TiTiler reports band_descriptions as [name, description] pairs. */
const desc = (...names: string[]) => names.map((n, i) => [`b${i + 1}`, n]);

// --- the real thing ---------------------------------------------------------
// Verbatim /cog/info from the Mavic 3M orthophoto that rendered inverted.
const REAL_M3M_ORTHO = {
  count: 3,
  dtype: "uint16",
  colorinterp: ["red", "gray", "alpha"],
  nodata_type: "Alpha",
  band_descriptions: [["b1", "Red"], ["b2", "NIR"], ["b3", "b3"]],
};

const odmRgba = { count: 4, colorinterp: ["red", "green", "blue", "alpha"], band_descriptions: desc("", "", "", "") };
const plainRgb = { count: 3, colorinterp: ["red", "green", "blue"] };
const rgbNir = { count: 4, colorinterp: ["red", "green", "blue", "undefined"], band_descriptions: desc("b1", "b2", "b3", "b4") };
const micasense = {
  count: 5,
  colorinterp: ["undefined", "undefined", "undefined", "undefined", "undefined"],
  band_descriptions: desc("Blue", "Green", "Red", "NIR", "Red edge"),
};
const mavic3mFull = {
  count: 4,
  colorinterp: ["undefined", "undefined", "undefined", "undefined"],
  band_descriptions: desc("Green", "Red", "Red edge", "NIR"),
};

describe("the actual orthophoto that rendered wrong", () => {
  const b = analyseBands(REAL_M3M_ORTHO);

  it("resolves 2 spectral bands plus an alpha mask, not 3 colour bands", () => {
    expect(b.total).toBe(3);
    expect(b.spectral).toBe(2);
    expect(b.hasAlpha).toBe(true);
  });

  it("maps red to b1 and NIR to b2 from the band descriptions", () => {
    expect(b.roles.red).toBe(1);
    expect(b.roles.nir).toBe(2);
    expect(b.method).toBe("descriptions");
  });

  it("never assigns a role to the alpha band", () => {
    expect(Object.values(b.roles)).not.toContain(3);
  });

  it("builds the corrected NDVI expression", () => {
    const e = expressionFor(b);
    expect(e.index).toBe("ndvi");
    expect(e.expression).toBe("(b2-b1)/(b2+b1)");
  });

  it("cannot offer VARI, because there is no green or blue band", () => {
    expect(b.available).toEqual(["ndvi"]);
  });
});

describe("resolution from band descriptions", () => {
  it("finds red at b3 on a MicaSense RedEdge", () => {
    const b = analyseBands(micasense);
    expect(b.roles).toMatchObject({ blue: 1, green: 2, red: 3, nir: 4, rededge: 5 });
    expect(expressionFor(b).expression).toBe("(b4-b3)/(b4+b3)");
    expect(b.method).toBe("descriptions");
  });

  it("finds red at b2 on a full 4-band Mavic 3M ortho", () => {
    // Assuming b1 = red here yields (NIR − Green)/(NIR + Green): GNDVI, a
    // different index, silently mislabelled NDVI.
    const b = analyseBands(mavic3mFull);
    expect(b.roles.red).toBe(2);
    expect(b.roles.nir).toBe(4);
    expect(b.roles.rededge).toBe(3);
    expect(expressionFor(b).expression).toBe("(b4-b2)/(b4+b2)");
  });

  it("never matches 'Red edge' as red or as NIR", () => {
    const b = analyseBands(micasense);
    expect(b.roles.red).not.toBe(5);
    expect(b.roles.nir).not.toBe(5);
    expect(b.roles.rededge).toBe(5);
  });
});

describe("resolution by sensor profile when descriptions are absent", () => {
  it("resolves a 2-band Red+NIR file by profile", () => {
    const b = analyseBands({ count: 2 });
    expect(b.method).toBe("profile");
    expect(b.roles).toMatchObject({ red: 1, nir: 2 });
    expect(expressionFor(b).expression).toBe("(b2-b1)/(b2+b1)");
  });

  it("resolves a 5-band file by profile", () => {
    const b = analyseBands({ count: 5 });
    expect(b.method).toBe("profile");
    expect(b.roles.red).toBe(3);
    expect(b.roles.nir).toBe(4);
  });

  it("refuses a 4-band file without a camera hint, because two profiles share that count", () => {
    // Generic RGB+NIR and the M3M arrangement both have 4 spectral bands and
    // put red in different places. Guessing gives a confident wrong NDVI.
    const b = analyseBands({ count: 4 });
    expect(b.hasNDVI).toBe(false);
    expect(b.ambiguousMultispectral).toBe(true);
    expect(b.method).toBe("unresolved");
  });

  it("uses a camera hint to disambiguate a shared band count", () => {
    const b = analyseBands({ count: 4 }, "DJI Mavic 3M");
    expect(b.method).toBe("profile");
    expect(b.roles.red).toBe(2);
    expect(b.roles.nir).toBe(4);
  });

  it("does not let a profile override real band descriptions", () => {
    const b = analyseBands(mavic3mFull, "MicaSense RedEdge");
    expect(b.method).toBe("descriptions");
    expect(b.roles.red).toBe(2);
  });

  it("keeps sensor profiles as data, so adding one is a table entry", () => {
    expect(SENSOR_PROFILES.length).toBeGreaterThan(3);
    for (const p of SENSOR_PROFILES) {
      expect(p.name).toBeTruthy();
      expect(p.spectral).toBeGreaterThan(1);
      expect(Object.keys(p.roles).length).toBeGreaterThan(1);
    }
  });
});

describe("honest degradation", () => {
  it("does not mistake an ODM RGBA ortho for multispectral", () => {
    const b = analyseBands(odmRgba);
    expect(b.spectral).toBe(3);
    expect(b.hasNDVI).toBe(false);
    expect(expressionFor(b).index).toBe("vari");
  });

  it("falls back to VARI and labels it, rather than emitting a wrong NDVI", () => {
    for (const input of [plainRgb, odmRgba, { count: 4 }, {}]) {
      const e = expressionFor(analyseBands(input as never));
      expect(e.index).toBe("vari");
      expect(e.label).toMatch(/not NDVI/i);
    }
  });

  it("builds VARI from resolved indices, not fixed positions", () => {
    const b = analyseBands({ count: 3, band_descriptions: desc("Blue", "Green", "Red") });
    expect(expressionFor(b).expression).toBe("(b2-b3)/(b2+b3-b1)");
  });

  it("defaults to RGB when the probe returned nothing", () => {
    for (const input of [null, undefined, {}, { count: "weird" }]) {
      const b = analyseBands(input as never);
      expect(b.hasNDVI).toBe(false);
      expect(b.spectral).toBe(3);
    }
  });
});

describe("NDRE readiness", () => {
  it("is a second expression over the same mapping, not a parallel path", () => {
    const b = analyseBands(micasense);
    expect(b.available).toContain("ndre");
    const e = expressionFor(b, "ndre");
    expect(e.index).toBe("ndre");
    expect(e.expression).toBe("(b4-b5)/(b4+b5)");
  });

  it("is not offered when there is no red edge band", () => {
    expect(analyseBands(REAL_M3M_ORTHO).available).not.toContain("ndre");
    expect(analyseBands(rgbNir).available).not.toContain("ndre");
  });

  it("falls back to NDVI when NDRE is requested but unavailable", () => {
    expect(expressionFor(analyseBands(rgbNir), "ndre").index).toBe("ndvi");
  });

  it("declares each index's band requirements as data", () => {
    expect(INDEX_DEFS.ndvi.requires).toEqual(["nir", "red"]);
    expect(INDEX_DEFS.ndre.requires).toEqual(["nir", "rededge"]);
  });
});

describe("fingerprint (cache busting)", () => {
  it("changes when the resolved mapping changes", () => {
    // Tile URLs embed this. Without it, a corrected expression keeps serving
    // day-old tiles from the browser cache and the fix never lands.
    const wrong = analyseBands({ count: 4 }, "DJI Mavic 3M").fingerprint;
    const right = analyseBands(REAL_M3M_ORTHO).fingerprint;
    expect(wrong).not.toBe(right);
  });

  it("is stable for the same mapping", () => {
    expect(analyseBands(REAL_M3M_ORTHO).fingerprint)
      .toBe(analyseBands(REAL_M3M_ORTHO).fingerprint);
  });

  it("encodes the index and the bands it used", () => {
    expect(analyseBands(REAL_M3M_ORTHO).fingerprint).toBe("ndvi:2-1");
  });
});

describe("previewBands", () => {
  it("orders a true-colour composite for a MicaSense", () => {
    expect(previewBands(analyseBands(micasense))).toEqual([3, 2, 1]);
  });

  it("returns null when the sensor has no blue band", () => {
    expect(previewBands(analyseBands(mavic3mFull))).toBeNull();
    expect(previewBands(analyseBands(REAL_M3M_ORTHO))).toBeNull();
  });

  it("leaves an ordinary RGB ortho at its natural order", () => {
    expect(previewBands(analyseBands(plainRgb))).toEqual([1, 2, 3]);
  });
});
