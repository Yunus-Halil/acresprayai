// Zones share a treatment decision by what the operator said they are. A
// suggestion the operator never confirmed makes no weed group.
import { describe, expect, it } from "vitest";
import { GRID_GROUP, HAND_DRAWN_GROUP, UNIDENTIFIED_GROUP, groupFor, groupZonesForTreatment } from "@/lib/treatment/groups";

const polys = [
  { id: "a1", name: "common ragweed (operator-identified)", issue_type: "Weed pressure", weed_label: "common ragweed", weed_catalog_id: "VT-10" },
  { id: "a2", name: "common ragweed (operator-identified)", issue_type: "Weed pressure", weed_label: "common ragweed", weed_catalog_id: "VT-10" },
  { id: "a3", name: "foxtail (operator-identified)", issue_type: "Weed pressure", weed_label: "Foxtail", weed_catalog_id: null },
  { id: "a4", name: "Weed Scout: off-row vegetation", issue_type: "Weed pressure", weed_label: null, weed_catalog_id: null },
  { id: "a5", name: "Wet corner", issue_type: "Waterlogging", weed_label: null, weed_catalog_id: null },
  { id: "a6", name: "Thistles by the gate", issue_type: "Weed pressure", weed_label: null, weed_catalog_id: null },
];

describe("groupFor", () => {
  it("keys identified weeds by catalog id, typed labels by text, and the rest by what they are", () => {
    expect(groupFor(polys[0])).toEqual({ key: "catalog:VT-10", label: "common ragweed" });
    expect(groupFor(polys[2])).toEqual({ key: "label:foxtail", label: "Foxtail" });
    expect(groupFor(polys[3]).key).toBe(UNIDENTIFIED_GROUP);
    expect(groupFor(polys[4]).key).toBe(HAND_DRAWN_GROUP);
    expect(groupFor(polys[5]).key).toBe(UNIDENTIFIED_GROUP);
  });
});

describe("groupZonesForTreatment", () => {
  it("sums area per group, identified first, and never invents a group from a suggestion", () => {
    const zones = [
      { id: "user:a1", source: "user" as const, areaM2: 100 },
      { id: "user:a2", source: "user" as const, areaM2: 50 },
      { id: "user:a3", source: "user" as const, areaM2: 10 },
      { id: "user:a4", source: "user" as const, areaM2: 5 },
      { id: "user:a5", source: "user" as const, areaM2: 7 },
      { id: "grid:1", source: "grid" as const, areaM2: 300 },
      { id: "user:missing", source: "user" as const, areaM2: 1 },
    ];
    const g = groupZonesForTreatment(zones, polys);
    expect(g.map(x => x.key)).toEqual(["catalog:VT-10", "label:foxtail", UNIDENTIFIED_GROUP, HAND_DRAWN_GROUP, GRID_GROUP]);
    expect(g[0]).toMatchObject({ label: "common ragweed", areaM2: 150, zoneCount: 2 });
    expect(g.find(x => x.key === HAND_DRAWN_GROUP)!.areaM2).toBe(8);
    expect(g.find(x => x.key === GRID_GROUP)!.areaM2).toBe(300);
  });
  it("is empty when there are no zones", () => {
    expect(groupZonesForTreatment([], polys)).toEqual([]);
  });
});
