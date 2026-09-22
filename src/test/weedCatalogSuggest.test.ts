// When a name may appear next to a candidate, how the list is ordered, and
// what the notes say about presence and legal status.
import { describe, expect, it } from "vitest";
import { cropContextFor, fieldRegion } from "@/lib/weedCatalog/region";
import {
  SHORTLIST_LIMIT, cropShortlist, entriesNamed, evidenceLabel, narrowCatalog, presenceNote, recentLabels,
  regulatoryNote, searchRanked, suggestionsFor,
} from "@/lib/weedCatalog/suggest";
import type { CatalogEntry } from "@/lib/weedCatalog/types";
import type { Candidate, Feedback, FeedbackRow } from "@/lib/weedScout/types";

const entry = (over: Partial<CatalogEntry>): CatalogEntry => ({
  catalog_id: "VT-0", state: "VA", catalog_version: "0.1.0", as_of: "2026-09-22",
  common_name: "test", scientific_name_as_source: "Testus", plant_type: "broadleaf", vt_profile_url: "https://weedid.cals.vt.edu/profile/0/",
  usda_status: "matched", usda_symbol: "TE", usda_candidate_symbols: ["TE"], usda_match_method: "binomial_candidate",
  crop_evidence: [], crop_contexts: [], regulatory_tier: null, regulatory_scientific_name: null, regulatory_source_id: null,
  catalog_status: "source_index_only", aerial_identification_validated: false, source_ids: ["VT_WEEDID", "USDA_VA"],
  habitat_flags: [], habitat_profile_checked: true, habitat_where_found_present: false, habitat_mentions_state: false,
  source_hash: "x", review_status: "unreviewed", review_notes: null, reviewed_at: null, resolved_scientific_name: null, pending_source_update: null,
  ...over,
});

const ragweed = entry({
  catalog_id: "VT-10", common_name: "common ragweed", scientific_name_as_source: "Ambrosia artemisiifolia",
  crop_evidence: [{ crop: "corn", source_id: "VT_PMG_2026", locator: "Table 5.12" }, { crop: "soybean", source_id: "VT_PMG_2026", locator: "Table 5.47" }],
  crop_contexts: ["corn", "soybean"], catalog_status: "crop_context_sourced", source_ids: ["VT_WEEDID", "USDA_VA", "VT_PMG_2026"],
});
const salvinia = entry({
  catalog_id: "VAC-1", common_name: "Giant salvinia", scientific_name_as_source: "Salvinia molesta", vt_profile_url: null,
  usda_status: "not_crosswalked", usda_symbol: null, usda_candidate_symbols: [], regulatory_tier: "Tier 1",
  regulatory_scientific_name: "Salvinia molesta", regulatory_source_id: "VA_NOXIOUS_2026", catalog_status: "regulatory_only",
  source_ids: ["VA_NOXIOUS_2026"], habitat_profile_checked: false,
});
const absinthe = entry({ catalog_id: "VT-2", common_name: "absinthe", scientific_name_as_source: "Artemisia absinthium", usda_status: "unmatched_requires_review", usda_symbol: null, habitat_flags: ["pasture_forage"] });
const orchid = entry({ catalog_id: "VT-281", common_name: "Adam and Eve orchid", scientific_name_as_source: "Aplectrum hyemale" });
const excluded = entry({ catalog_id: "VT-999", common_name: "common ragweed", scientific_name_as_source: "Duplicatus", review_status: "excluded" });
const pasture = entry({ catalog_id: "VT-50", common_name: "buttercup", crop_evidence: [{ crop: "pasture_hay", source_id: "VT_PMG_2026", locator: "Table 5.81" }], crop_contexts: ["pasture_hay"], catalog_status: "crop_context_sourced" });
const CATALOG = [orchid, absinthe, salvinia, ragweed, excluded, pasture];

const candidate = (feedback: Feedback | null): Candidate => ({
  id: "c", tileId: "t", centroid: { lat: 38, lng: -77 }, kind: "off-row vegetation", score: 0.7,
  distanceToRowM: 0.3, rowConfidence: 0.8, anomalyZ: null, anomalyFeature: null, blobZ: null, blobZFeature: null,
  blob: null, region: null, areaM2: 0.01, feedback, estimate: null, chip: null, chipSpanM: null, chipGsdM: null,
});

describe("suggestionsFor: only from the operator's own confirmed verdicts", () => {
  it("offers nothing without feedback, with dismissing feedback, or with unnamed confirmations", () => {
    expect(suggestionsFor(candidate(null), CATALOG)).toEqual([]);
    expect(suggestionsFor(candidate({ confirmed: 1, dismissed: 5, species: ["common ragweed"], factor: 0.4 }), CATALOG)).toEqual([]);
    expect(suggestionsFor(candidate({ confirmed: 4, dismissed: 0, species: [], factor: 1.25 }), CATALOG)).toEqual([]);
  });
  it("offers a catalog match to the name the operator wrote, with the basis stated", () => {
    const s = suggestionsFor(candidate({ confirmed: 4, dismissed: 1, species: ["Common Ragweed"], factor: 1.25 }), CATALOG);
    expect(s.length).toBe(1);
    expect(s[0].entry.catalog_id).toBe("VT-10");
    expect(s[0].matchedOn).toBe("common name");
    expect(s[0].basis).toMatch(/your own past verdicts/i);
    expect(s[0].basis).toMatch(/4 of the 5/);
    expect(s[0].basis).toMatch(/not a visual identification/i);
    expect(s[0].basis).not.toMatch(/looks like/i);
  });
  it("matches scientific and reviewer-resolved names, never an excluded entry", () => {
    const sci = suggestionsFor(candidate({ confirmed: 3, dismissed: 0, species: ["ambrosia artemisiifolia"], factor: 1.25 }), CATALOG);
    expect(sci[0]?.matchedOn).toBe("scientific name");
    const resolved = entriesNamed("Fixed name", [entry({ resolved_scientific_name: "Fixed name" })]);
    expect(resolved[0]?.on).toBe("reviewed name");
    const dup = suggestionsFor(candidate({ confirmed: 3, dismissed: 0, species: ["common ragweed"], factor: 1.25 }), [excluded]);
    expect(dup).toEqual([]);
  });
  it("offers nothing when the name is not in the catalog", () => {
    expect(suggestionsFor(candidate({ confirmed: 3, dismissed: 0, species: ["a grass I do not know"], factor: 1.25 }), CATALOG)).toEqual([]);
  });
});

describe("narrowCatalog: an ordering, never a filter on presence", () => {
  const region = fieldRegion();
  it("keeps every non-excluded entry and puts the field's crop first", () => {
    const { ranked, note } = narrowCatalog(CATALOG, { region, crop: "corn" });
    expect(ranked.length).toBe(CATALOG.length - 1);
    expect(ranked.map(r => r.entry.catalog_id)).not.toContain("VT-999");
    expect(ranked[0].entry.catalog_id).toBe("VT-10");
    expect(ranked[0].rank).toBe(0);
    expect(ranked.find(r => r.entry.catalog_id === "VT-50")!.rank).toBe(1);
    expect(ranked.find(r => r.entry.catalog_id === "VT-2")!.rank).toBe(2);
    expect(ranked.find(r => r.entry.catalog_id === "VAC-1")!.rank).toBe(3);
    expect(note).toMatch(/Virginia \(assumed for testing\) and corn/);
    expect(note).toMatch(/not evidence/);
  });
  it("without a crop, crop-guide entries still lead, by name", () => {
    const { ranked } = narrowCatalog(CATALOG, { region, crop: null });
    expect(ranked.slice(0, 2).map(r => r.entry.common_name)).toEqual(["buttercup", "common ragweed"]);
    expect(ranked.slice(0, 2).every(r => r.rank === 1)).toBe(true);
  });
  it("searches by any token across names, symbol and id", () => {
    const { ranked } = narrowCatalog(CATALOG, { region, crop: null });
    expect(searchRanked(ranked, "ragweed").map(r => r.entry.catalog_id)).toEqual(["VT-10"]);
    expect(searchRanked(ranked, "artemis").map(r => r.entry.catalog_id).sort()).toEqual(["VT-10", "VT-2"]);
    expect(searchRanked(ranked, "vac-1").map(r => r.entry.catalog_id)).toEqual(["VAC-1"]);
    expect(searchRanked(ranked, "").length).toBe(ranked.length);
  });
});

describe("the notes keep presence, evidence and legal status apart", () => {
  it("a Tier 1 listing is a legal status, stated as not known present", () => {
    const n = regulatoryNote(salvinia)!;
    expect(n).toMatch(/Tier 1/);
    expect(n).toMatch(/NOT known present in Virginia/);
    expect(n).toMatch(/not evidence/i);
    expect(n).not.toMatch(/detect/i);
    expect(regulatoryNote(ragweed)).toBeNull();
  });
  it("presence notes never claim a plant is in the field", () => {
    for (const e of CATALOG) {
      const p = presenceNote(e);
      expect(p).toMatch(/not (proof|an occurrence claim)/i);
      expect(p).not.toMatch(/present in this field/i);
    }
  });
  it("evidence labels say where the name came from", () => {
    expect(evidenceLabel(ragweed)).toBe("Crop guide: corn, soybean");
    expect(evidenceLabel(salvinia)).toBe("Law listing only");
    expect(evidenceLabel(absinthe)).toBe("Identification index only");
  });
});

describe("cropContextFor maps the field's crop setting to a guide table, or to nothing", () => {
  it("covers the tables the guide has and admits the ones it does not", () => {
    expect(cropContextFor("Corn")).toBe("corn");
    expect(cropContextFor("Soybeans")).toBe("soybean");
    expect(cropContextFor("Wheat")).toBe("small_grains");
    expect(cropContextFor("Barley")).toBe("small_grains");
    expect(cropContextFor("Cotton")).toBeNull();
    expect(cropContextFor("Rice")).toBeNull();
    expect(cropContextFor("")).toBeNull();
    expect(cropContextFor(undefined)).toBeNull();
  });
});

describe("cropShortlist: a list to read, not a ranking to trust", () => {
  const region = fieldRegion();

  it("says how many there are and refuses to favour one when there are too many", () => {
    // Virginia's guide names the same sixteen weeds for corn as for soybean,
    // so in the real catalog this state is permanent for every row crop.
    const many = narrowCatalog([...CATALOG, ...moreCornEntries(5)], { region, crop: "corn" });
    const s = cropShortlist(many.ranked, "corn", region);
    expect(s.entries.length).toBe(6);
    expect(s.tooMany).toBe(true);
    expect(s.note).toMatch(/^6 names are listed for corn in Virginia's crop guide\./);
    expect(s.note).toMatch(/Too many to narrow, so none is favoured\./);
  });

  it("keeps every crop-named entry in the list even when it refuses to favour one", () => {
    const many = narrowCatalog([...CATALOG, ...moreCornEntries(5)], { region, crop: "corn" });
    const s = cropShortlist(many.ranked, "corn", region);
    // The point of the list is that clicking beats typing. Nothing is hidden.
    expect(s.entries.every(r => r.rank === 0)).toBe(true);
    expect(s.entries.map(r => r.entry.catalog_id)).toContain("VT-10");
  });

  it("states the order is not evidence when the list is short enough to show plainly", () => {
    const { ranked } = narrowCatalog(CATALOG, { region, crop: "corn" });
    const s = cropShortlist(ranked, "corn", region);
    expect(s.entries.length).toBe(1);
    expect(s.tooMany).toBe(false);
    expect(s.note).toMatch(/1 name is listed for corn/);
    expect(s.note).toMatch(/The order is not evidence\./);
  });

  it("says so plainly when the guide names nothing for this crop", () => {
    const { ranked } = narrowCatalog(CATALOG, { region, crop: null });
    const s = cropShortlist(ranked, null, region);
    expect(s.entries).toEqual([]);
    expect(s.note).toMatch(/No entry in Virginia's crop guide is named for this crop\./);
  });

  it("never carries an entry the guide does not name for this crop", () => {
    const { ranked } = narrowCatalog(CATALOG, { region, crop: "corn" });
    const s = cropShortlist(ranked, "corn", region);
    // buttercup is pasture-only and salvinia is law-only: neither is corn.
    const ids = s.entries.map(r => r.entry.catalog_id);
    expect(ids).not.toContain("VT-50");
    expect(ids).not.toContain("VAC-1");
  });

  it("the limit is the documented one", () => {
    expect(SHORTLIST_LIMIT).toBe(4);
    const four = narrowCatalog([...CATALOG, ...moreCornEntries(3)], { region, crop: "corn" });
    expect(cropShortlist(four.ranked, "corn", region).tooMany).toBe(false);
    const five = narrowCatalog([...CATALOG, ...moreCornEntries(4)], { region, crop: "corn" });
    expect(cropShortlist(five.ranked, "corn", region).tooMany).toBe(true);
  });
});

describe("recentLabels: the operator's own vocabulary, handed back", () => {
  const row = (over: Partial<FeedbackRow>): FeedbackRow => ({
    kind: "off-row vegetation", verdict: "weed", species: "common ragweed",
    vector: [1], fieldId: "field-1", ...over,
  });

  it("counts only names the operator wrote on spots they confirmed as weeds", () => {
    const out = recentLabels([
      row({ species: "common ragweed" }),
      row({ species: "common ragweed" }),
      row({ species: "Johnsongrass" }),
      row({ verdict: "not_weed", species: "should not count" }),
      row({ verdict: "unsure", species: "should not count either" }),
      row({ verdict: "crop", species: "nor this" }),
      row({ species: null }),
      row({ species: "   " }),
    ], "field-1");
    expect(out.map(r => r.name)).toEqual(["common ragweed", "Johnsongrass"]);
    expect(out[0].count).toBe(2);
    expect(out.every(r => r.thisField)).toBe(true);
  });

  it("puts names used on this field ahead of names used elsewhere, however often", () => {
    const out = recentLabels([
      row({ species: "elsewhere", fieldId: "other", }),
      row({ species: "elsewhere", fieldId: "other" }),
      row({ species: "elsewhere", fieldId: "other" }),
      row({ species: "here", fieldId: "field-1" }),
    ], "field-1");
    expect(out.map(r => r.name)).toEqual(["here", "elsewhere"]);
    expect(out[0].thisField).toBe(true);
    expect(out[1].thisField).toBe(false);
  });

  it("treats differently-cased spellings as one name and keeps the first spelling seen", () => {
    const out = recentLabels([
      row({ species: "Common Ragweed" }),
      row({ species: "common ragweed" }),
    ], "field-1");
    expect(out.length).toBe(1);
    expect(out[0].name).toBe("Common Ragweed");
    expect(out[0].count).toBe(2);
  });

  it("is empty with no archive, and honours the limit", () => {
    expect(recentLabels([], "field-1")).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => row({ species: `weed ${i}` }));
    expect(recentLabels(many, "field-1").length).toBe(6);
    expect(recentLabels(many, "field-1", 2).length).toBe(2);
  });

  it("works with no field on the scan, marking nothing as this field's", () => {
    const out = recentLabels([row({ fieldId: "field-1" })], null);
    expect(out.length).toBe(1);
    expect(out[0].thisField).toBe(false);
  });
});

/** Extra corn-named entries, for sizing the shortlist's refusal. */
function moreCornEntries(n: number): CatalogEntry[] {
  return Array.from({ length: n }, (_, i) => entry({
    catalog_id: `VT-90${i}`, common_name: `corn weed ${i}`,
    crop_evidence: [{ crop: "corn", source_id: "VT_PMG_2026", locator: "Table 5.12" }],
    crop_contexts: ["corn"], catalog_status: "crop_context_sourced",
  }));
}
