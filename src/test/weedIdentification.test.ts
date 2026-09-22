// An identification is the operator's statement. A suggestion is not one, and
// nothing between the scout and the report may turn one into the other.
import { describe, expect, it } from "vitest";
import {
  REJECTED, UNIDENTIFIED, identificationCaveat, identificationFromEntry, identificationFromText, identificationLine,
  isStatedFinding, summariseIdentifications, type IdentificationRow,
} from "@/lib/weedCatalog/identification";
import type { CatalogEntry } from "@/lib/weedCatalog/types";
import { annotationFromCandidate } from "@/lib/weedScout/applyToField";
import { identificationColumns } from "@/lib/weedScout/observations";
import type { Candidate } from "@/lib/weedScout/types";
import { userPolyIdentificationText } from "@/components/app/workspace/layers";

const ragweed: CatalogEntry = {
  catalog_id: "VT-10", state: "VA", catalog_version: "0.1.0", as_of: "2026-09-22",
  common_name: "common ragweed", scientific_name_as_source: "Ambrosia artemisiifolia", plant_type: "broadleaf",
  vt_profile_url: "https://weedid.cals.vt.edu/profile/10/", usda_status: "matched", usda_symbol: "AMAR2", usda_candidate_symbols: ["AMAR2"],
  usda_match_method: "binomial_candidate", crop_evidence: [{ crop: "corn", source_id: "VT_PMG_2026", locator: "Table 5.12" }],
  crop_contexts: ["corn"], regulatory_tier: null, regulatory_scientific_name: null, regulatory_source_id: null,
  catalog_status: "crop_context_sourced", aerial_identification_validated: false, source_ids: ["VT_WEEDID", "USDA_VA", "VT_PMG_2026"],
  habitat_flags: [], habitat_profile_checked: true, habitat_where_found_present: true, habitat_mentions_state: false,
  source_hash: "h", review_status: "unreviewed", review_notes: null, reviewed_at: null, resolved_scientific_name: null, pending_source_update: null,
};
const suggestion = { catalogId: "VT-10", basis: "From your own past verdicts: 3 of the 4 ..." };

const plant: Candidate = {
  id: "c-1", tileId: "t1", centroid: { lat: 38.95, lng: -77.45 }, kind: "off-row vegetation", score: 0.8,
  distanceToRowM: 0.3, rowConfidence: 0.9, anomalyZ: null, anomalyFeature: null, blobZ: null, blobZFeature: null,
  blob: {
    id: "b1", tileId: "t1", centroid: { lat: 38.95, lng: -77.45 }, areaM2: 0.02, equivDiameterM: 0.16, widthM: 0.16, heightM: 0.16,
    extent: 0.7, chromaR: 0.3, chromaG: 0.5, chromaB: 0.2, exgMean: 0.2, brightness: 90, gsdM: 0.02, touchesBorder: false,
  },
  region: null, areaM2: 0.02, feedback: { confirmed: 3, dismissed: 1, species: ["common ragweed"], factor: 1.25 },
  estimate: {
    model: "swathwise-inhouse-v1", summary: "A small plant between the fitted rows.", sizeClass: "small", habit: null, colourNote: null,
    positionNote: "Sits well outside the row.", seasonNote: "Captured in summer.", whatWouldConfirm: [], caveats: [],
  },
  chip: null, chipSpanM: null, chipGsdM: null,
};

describe("identificationColumns: what the archive row says", () => {
  it("a suggestion on screen is stored as a suggestion, never as the label", () => {
    const c = identificationColumns({ species: null, suggestion, identification: UNIDENTIFIED });
    expect(c.suggested_catalog_id).toBe("VT-10");
    expect(c.identification_status).toBe("unidentified");
    expect(c.catalog_id).toBeNull();
    expect(c.species).toBeNull();
    expect(c.identified_at).toBeNull();
  });
  it("a confirmation carries the suggested id and the entry's name", () => {
    const id = identificationFromEntry(ragweed, "confirmed", suggestion.basis);
    const c = identificationColumns({ species: null, suggestion, identification: id });
    expect(c.identification_status).toBe("confirmed");
    expect(c.catalog_id).toBe(c.suggested_catalog_id);
    expect(c.species).toBe("common ragweed");
    expect(c.identification_source).toMatch(/VT-10/);
    expect(c.identification_source).toMatch(/VT_PMG_2026/);
    expect(c.identified_at).not.toBeNull();
  });
  it("a typed name is the operator's own, with no catalog id", () => {
    const c = identificationColumns({ species: null, suggestion, identification: identificationFromText("  some grass ") });
    expect(c.identification_status).toBe("edited");
    expect(c.catalog_id).toBeNull();
    expect(c.species).toBe("some grass");
    expect(c.identification_source).toBe("operator free text");
  });
  it("a rejection keeps the suggestion on record and states nothing", () => {
    const c = identificationColumns({ species: null, suggestion, identification: REJECTED });
    expect(c.identification_status).toBe("rejected");
    expect(c.suggested_catalog_id).toBe("VT-10");
    expect(c.catalog_id).toBeNull();
    expect(c.species).toBeNull();
  });
  it("a stated status with an empty label is not a finding", () => {
    const bogus = { status: "confirmed" as const, catalogId: "VT-10", label: "  ", source: null, basis: null };
    expect(isStatedFinding(bogus)).toBe(false);
    const c = identificationColumns({ species: "legacy text", suggestion: null, identification: bogus });
    expect(c.identification_status).toBe("unidentified");
    expect(c.catalog_id).toBeNull();
    expect(c.species).toBe("legacy text");
  });
  it("blank free text is unidentified", () => {
    expect(identificationFromText("   ")).toEqual(UNIDENTIFIED);
  });
});

describe("summariseIdentifications: what the report may print", () => {
  const row = (over: Partial<IdentificationRow>): IdentificationRow => ({
    candidate_id: "c", kind: "off-row vegetation", verdict: "weed", species: null, identification_status: "unidentified",
    catalog_id: null, identification_source: null, suggested_catalog_id: null, area_m2: 0.02, lat: 38, lng: -77, ...over,
  });
  it("prints confirmed and edited rows, counts the rest, and never names a suggestion", () => {
    const s = summariseIdentifications([
      row({ candidate_id: "a", identification_status: "confirmed", species: "common ragweed", catalog_id: "VT-10", suggested_catalog_id: "VT-10" }),
      row({ candidate_id: "b", identification_status: "edited", species: "foxtail" }),
      row({ candidate_id: "c", identification_status: "unidentified", suggested_catalog_id: "VT-10" }),
      row({ candidate_id: "d", identification_status: "rejected", suggested_catalog_id: "VT-10" }),
      row({ candidate_id: "e", identification_status: "unidentified" }),
    ]);
    expect(s.stated.map(x => x.label)).toEqual(["common ragweed", "foxtail"]);
    expect(s.unidentified).toBe(2);
    expect(s.suggestedOnly).toBe(1);
    expect(s.rejected).toBe(1);
    const text = identificationCaveat(s);
    expect(text).toMatch(/2 saved candidates were not identified/);
    expect(text).toMatch(/1 suggested name was rejected/);
    expect(text).toMatch(/none was produced by image analysis/);
  });
  it("legacy rows with species text but no status are not findings", () => {
    const s = summariseIdentifications([row({ identification_status: null, species: "typed long ago" })]);
    expect(s.stated).toEqual([]);
    expect(s.unidentified).toBe(1);
  });
  it("says so when there is nothing", () => {
    expect(identificationCaveat(summariseIdentifications([]))).toMatch(/No weed identifications were recorded/);
  });
});

describe("annotationFromCandidate carries only a stated identification", () => {
  it("unidentified: no label, and the notes say so, even with a suggestion in the feedback", () => {
    const a = annotationFromCandidate(plant);
    expect(a.weed_label).toBeNull();
    expect(a.weed_label_status).toBeNull();
    expect(a.weed_catalog_id).toBeNull();
    expect(a.name).toBe("Weed Scout: off-row vegetation");
    expect(a.notes).toMatch(/^Not identified by the operator/);
    expect(a.notes).not.toMatch(/ragweed/);
  });
  it("confirmed: label, status and source travel, and the name is the label", () => {
    const a = annotationFromCandidate(plant, identificationFromEntry(ragweed, "confirmed", "basis"));
    expect(a.weed_label).toBe("common ragweed");
    expect(a.weed_label_status).toBe("confirmed");
    expect(a.weed_catalog_id).toBe("VT-10");
    expect(a.weed_label_source).toMatch(/weedid\.cals\.vt\.edu/);
    expect(a.name).toBe("common ragweed (operator-identified)");
    expect(a.notes).toMatch(/confirmed by the operator/);
  });
  it("rejected: nothing travels", () => {
    const a = annotationFromCandidate(plant, REJECTED);
    expect(a.weed_label).toBeNull();
    expect(a.notes).toMatch(/rejected the suggested name/);
  });
});

describe("the Field View popup line", () => {
  it("names a label with how it was stated, marks an unlabelled scout shape, says nothing for hand-drawn", () => {
    expect(userPolyIdentificationText({ name: "common ragweed (operator-identified)", weed_label: "common ragweed", weed_label_status: "confirmed", weed_label_source: "src" }))
      .toBe("Identified as common ragweed (confirmed by the operator). Source: src");
    expect(userPolyIdentificationText({ name: "Weed Scout: off-row vegetation", weed_label: null, weed_label_status: null, weed_label_source: null }))
      .toMatch(/Not identified by the operator/);
    expect(userPolyIdentificationText({ name: "Wet corner", weed_label: null })).toBeNull();
  });
  it("identificationLine never names a plant the operator did not", () => {
    expect(identificationLine(UNIDENTIFIED)).not.toMatch(/ragweed/);
    expect(identificationLine(identificationFromEntry(ragweed, "edited", "b"))).toMatch(/^common ragweed: identified by the operator/);
  });
});
