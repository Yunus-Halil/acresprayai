// From a review's kind and id to the finding in the saved twin (reviewFocus.ts): the finding itself or nothing.
// Never a neighbour, never the nearest number, never a kind whose number is not an identity.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import type { TwinBundle } from "@/lib/fieldTwin/types";
import { reviewTargetOf } from "@/components/app/fieldTwin/ReviewBar";
import { LOCATABLE, focusParam, locateReviewed, parseFocus } from "@/components/app/fieldTwin/reviewFocus";
import { CORN_TWIN } from "./fixtures/cornTwin";

/** The corn fixture with a few orchard objects beside it, ids deliberately not in order and not from zero. */
const TWIN = {
  ...CORN_TWIN,
  weeds: [
    { id: 12, lat: 40.00004, lng: -89.99998, status: "verified", diameterM: 0.3, areaM2: 0.07 },
    { id: 3, lat: 40.00006, lng: -89.99997, status: "single view", diameterM: 0.2, areaM2: 0.03 },
  ],
  trees: [{ id: 5, lat: 40.00002, lng: -89.99996, crownRadiusM: 1.4 }],
  vegetation: [{ id: 8, lat: 40.00003, lng: -89.99995, areaM2: 2, seenBy: 2, ring: [] }],
} as unknown as TwinBundle;

describe("the address of a finding", () => {
  it("is a kind the saved twin holds by id and a whole number, or nothing", () => {
    expect(parseFocus("corn_weed:12")).toEqual({ kind: "corn_weed", id: "12" });
    expect(parseFocus("weed:007")).toEqual({ kind: "weed", id: "7" });
    for (const v of [null, undefined, "", "corn_weed", "corn_weed:", ":3", "corn_weed:3:4", "corn_weed:-3", "corn_weed:3.0", "corn_weed: 3", "CORN_WEED:3", "corn_weed:1e3", "corn_weed:12345678901", "region:2", "zone:1", "patch:4", "boundary:cultivated", "__proto__:1"]) expect(parseFocus(v)).toBeNull();
    expect(focusParam("corn_gap", "1")).toBe("corn_gap:1");
    expect(focusParam("region", "2")).toBeNull();
    expect(focusParam("boundary", "cultivated")).toBeNull();
    expect([...LOCATABLE].sort()).toEqual(["corn_gap", "corn_row", "corn_weed", "tree", "vegetation", "weed"]);
  });
});

describe("locating a reviewed finding", () => {
  it("finds each kind by its own id, at its own place, with what the twin calls it", () => {
    expect(locateReviewed({ kind: "corn_weed", id: "2" }, TWIN)).toMatchObject({ pick: { kind: "cornWeed", id: 2 }, lat: 40.00007, lng: -89.999995, status: "unconfirmed" });
    expect(locateReviewed({ kind: "corn_weed", id: "1" }, TWIN)).toMatchObject({ pick: { kind: "cornWeed", id: 1 }, lat: 40.00005, status: "confirmed" });
    expect(locateReviewed({ kind: "corn_row", id: "2" }, TWIN)).toMatchObject({ pick: { kind: "cornRow", id: 2 }, lng: -89.99999, status: "unconfirmed" });
    expect(locateReviewed({ kind: "corn_gap", id: "1" }, TWIN)).toMatchObject({ pick: { kind: "cornGap", id: 1 }, lng: -90, status: "withheld" });
    expect(locateReviewed({ kind: "weed", id: "12" }, TWIN)).toMatchObject({ pick: { kind: "weed", id: 12 }, lat: 40.00004, status: "verified" });
    expect(locateReviewed({ kind: "tree", id: "5" }, TWIN)).toMatchObject({ pick: { kind: "tree", id: 5 }, lat: 40.00002 });
    expect(locateReviewed({ kind: "vegetation", id: "8" }, TWIN)).toMatchObject({ pick: { kind: "vegetation", id: 8 }, lat: 40.00003 });
    // The row's middle, and enough ground to see it whole.
    const row = locateReviewed({ kind: "corn_row", id: "1" }, TWIN)!;
    expect(row.lat).toBeCloseTo(40.00005, 7);
    expect(row.metresAcross).toBeGreaterThanOrEqual(11);
  });

  it("is by id, not by position in the list: the second weed is id 3, and there is no weed 1 or 2", () => {
    expect(locateReviewed({ kind: "weed", id: "3" }, TWIN)).toMatchObject({ pick: { kind: "weed", id: 3 }, lat: 40.00006 });
    expect(locateReviewed({ kind: "weed", id: "1" }, TWIN)).toBeNull();
    expect(locateReviewed({ kind: "weed", id: "2" }, TWIN)).toBeNull();
    expect(locateReviewed({ kind: "weed", id: "0" }, TWIN)).toBeNull();
  });

  it("a finding the twin does not hold selects nothing, never the nearest", () => {
    for (const f of [{ kind: "corn_weed", id: "3" }, { kind: "corn_weed", id: "0" }, { kind: "corn_row", id: "9" }, { kind: "corn_gap", id: "2" }, { kind: "tree", id: "12" }, { kind: "vegetation", id: "5" }] as const) expect(locateReviewed(f, TWIN)).toBeNull();
    // The same number under another kind is another object.
    expect(locateReviewed({ kind: "weed", id: "5" }, TWIN)).toBeNull();
    // A corn finding asked of a twin with no corn section.
    expect(locateReviewed({ kind: "corn_weed", id: "1" }, { ...TWIN, corn: undefined } as TwinBundle)).toBeNull();
    // Not a whole number.
    for (const id of ["1.0", "01x", "", " 1", "-1", "1e0"]) expect(locateReviewed({ kind: "corn_weed", id }, TWIN)).toBeNull();
  });

  it("patches, regions, zones and the boundary are never selected from a review", () => {
    for (const kind of ["patch", "region", "zone", "boundary"] as const) expect(locateReviewed({ kind, id: "1" }, TWIN)).toBeNull();
  });

  it("whatever it returns reviews as exactly the kind and id asked for (the reviewer's own function, the other way)", () => {
    const asked = [["corn_weed", "1"], ["corn_weed", "2"], ["corn_row", "1"], ["corn_row", "2"], ["corn_gap", "1"], ["weed", "12"], ["weed", "3"], ["tree", "5"], ["vegetation", "8"]] as const;
    for (const [kind, id] of asked) {
      const at = locateReviewed({ kind, id }, TWIN)!;
      expect(reviewTargetOf(at.pick, TWIN, null)).toMatchObject({ kind, id });
    }
  });

  it("two objects sharing an id (a twin that should not exist) still returns the one the reviewer's bar would", () => {
    const twice = { ...TWIN, corn: { ...TWIN.corn!, weeds: [...TWIN.corn!.weeds, { ...TWIN.corn!.weeds[0], lat: 41, status: "contested" }] } } as TwinBundle;
    expect(locateReviewed({ kind: "corn_weed", id: "1" }, twice)).toMatchObject({ lat: 40.00005, status: "confirmed" });
  });
});
