// Every finding has one name, said the same way on the map, in the popup, in
// the closer look and on the saved shape: what it is, and how big.
import { describe, expect, it } from "vitest";
import { findingTitle } from "@/lib/weedScout/candidates";
import type { Candidate } from "@/lib/weedScout/types";

const plant = (kind: Candidate["kind"], d = 0.4): Pick<Candidate, "kind" | "region" | "blob" | "areaM2"> => ({
  kind, region: null, areaM2: 0.1, blob: { equivDiameterM: d } as Candidate["blob"],
});

describe("the finding's title", () => {
  it("names a plant by where it sits and how big it is, and never calls it a weed outright", () => {
    expect(findingTitle(plant("off-row vegetation"))).toMatch(/^Likely weed, off the row · 40(\.0)? cm$/);
    expect(findingTitle(plant("between plants", 0.25))).toMatch(/^Likely weed, between plants · 25(\.0)? cm$/);
    expect(findingTitle(plant("vegetation outlier", 0.6))).toMatch(/^Plant unlike the crop · 60(\.0)? cm$/);
    expect(findingTitle(plant("off-row and outlier"))).toMatch(/^Likely weed, off the row and unlike the crop/);
    expect(findingTitle(plant("off-row vegetation"), "imperial")).toMatch(/ in$/);
  });

  it("names a region by its class and area", () => {
    const region = { kind: "not-average region" as const, blob: null, areaM2: 1200, region: { klass: "bare or dry ground" } as Candidate["region"] };
    expect(findingTitle(region)).toMatch(/^Bare or dry ground · /);
    expect(findingTitle({ ...region, region: { klass: "dark ground (wet, shadow or residue)" } as Candidate["region"] })).toMatch(/^Wet or dark ground · /);
  });

  it("names a tile with no plant as a patch", () => {
    expect(findingTitle({ kind: "field outlier", region: null, blob: null, areaM2: 9 })).toBe("Patch unlike the field");
  });
});
