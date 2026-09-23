// One spot's popup: the decision is already made, and naming is optional.
//
// The complaint this answers was that labelling thirty spots from a list felt
// like thirty tasks. The scout has already decided every one of them, so the
// popup opens on the decision and asks for nothing else. Naming sits behind a
// button, because an unidentified spot is a valid outcome with its own
// treatment group, and it must not read as an unfinished one.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SpotPopup, type SpotPopupProps } from "@/components/app/workspace/SpotPopup";
import { UNIDENTIFIED, identificationFromEntry } from "@/lib/weedCatalog/identification";
import { fieldRegion } from "@/lib/weedCatalog/region";
import type { CatalogEntry } from "@/lib/weedCatalog/types";
import type { Candidate, RegionClass } from "@/lib/weedScout/types";

const ragweed: CatalogEntry = {
  catalog_id: "VT-10", state: "VA", catalog_version: "0.1.0", as_of: "2026-09-22",
  common_name: "common ragweed", scientific_name_as_source: "Ambrosia artemisiifolia", plant_type: "broadleaf",
  vt_profile_url: null, usda_status: "matched", usda_symbol: "AMAR2", usda_candidate_symbols: ["AMAR2"],
  usda_match_method: "binomial_candidate", crop_evidence: [{ crop: "corn", source_id: "VT_PMG_2026", locator: "Table 5.12" }],
  crop_contexts: ["corn"], regulatory_tier: null, regulatory_scientific_name: null, regulatory_source_id: null,
  catalog_status: "crop_context_sourced", aerial_identification_validated: false, source_ids: ["VT_PMG_2026"],
  habitat_flags: [], habitat_profile_checked: true, habitat_where_found_present: true, habitat_mentions_state: false,
  source_hash: "h", review_status: "unreviewed", review_notes: null, reviewed_at: null,
  resolved_scientific_name: null, pending_source_update: null,
};

const region = (klass: RegionClass): Candidate["region"] => ({
  id: "r", tileIds: ["t"], rings: [[]], centroid: { lat: 38.95, lng: -77.45 },
  areaM2: 190, tileCount: 65, coreTiles: 40, meanStrength: 7.8, maxStrength: 9,
  meanFieldZ: [], drivers: [{ feature: "greenness variation", z: 7.8, scale: "field" }], klass,
});

const spot = (over: Partial<Candidate> = {}): Candidate => ({
  id: "spot-region-1", tileId: "t", centroid: { lat: 38.95, lng: -77.45 },
  kind: "not-average region", score: 0.7, distanceToRowM: null, rowConfidence: null,
  anomalyZ: 7.8, anomalyFeature: "greenness variation", blobZ: null, blobZFeature: null,
  blob: null, region: region("bare or dry ground"), areaM2: 190, feedback: null,
  estimate: {
    model: "swathwise-inhouse-v1", summary: "Bare or dry ground: greenness variation above the field by 7.8.",
    sizeClass: "large", habit: null, colourNote: null, positionNote: "Covers 65 touching tiles.",
    seasonNote: "Captured in summer.", whatWouldConfirm: ["Walk it."], caveats: [],
  },
  chip: null, chipSpanM: null, chipGsdM: null, ...over,
});

function renderPopup(over: Partial<SpotPopupProps> = {}) {
  const props: SpotPopupProps = {
    candidate: spot(), index: 0, total: 30, units: "imperial", areaM2: 189,
    verdict: "unsure", onVerdict: vi.fn(),
    identification: UNIDENTIFIED, suggestion: null,
    notes: "", onNotes: vi.fn(), saved: false, onField: false,
    shortlist: { entries: [], tooMany: false, note: "" },
    recent: [], searchResults: [], searchQuery: "", onSearchQuery: vi.fn(),
    freeText: "", onFreeText: vi.fn(),
    listNote: "Being on this list is not evidence that a plant is in this field.",
    region: fieldRegion(), catalogSize: 755, catalogError: null,
    onConfirmSuggestion: vi.fn(), onSetIdentification: vi.fn(),
    onPickEntry: vi.fn(), onPickRecent: vi.fn(),
    ...over,
  };
  return { ...render(<SpotPopup {...props} />), props };
}

describe("what the popup opens on", () => {
  it("leads with what the spot is, its place in the scan and its planned area", () => {
    renderPopup();
    expect(screen.getByText("bare or dry ground")).toBeInTheDocument();
    expect(screen.getByText(/Spot 1 of 30/)).toBeInTheDocument();
    expect(screen.getByText(/0\.05 ac|2,0\d\d ft²/)).toBeInTheDocument();
  });

  it("offers the decision immediately and reports the one already made", () => {
    const { props } = renderPopup({ verdict: "unsure" });
    fireEvent.click(screen.getByRole("button", { name: "Weed" }));
    expect(props.onVerdict).toHaveBeenCalledWith("weed");
  });

  it("uses the describer's own sentence rather than one of its own", () => {
    renderPopup();
    expect(screen.getByText("Bare or dry ground: greenness variation above the field by 7.8.")).toBeInTheDocument();
  });

  it("says when the planner would not carry the spot", () => {
    renderPopup({ areaM2: null });
    expect(screen.getByText(/centred outside the boundary, the planner will not carry it/)).toBeInTheDocument();
  });
});

describe("naming is optional and stays that way", () => {
  it("does not open the picker unasked, and says an unnamed spot is still a spot", () => {
    renderPopup();
    expect(screen.queryByText("What weed is it? (your call)")).toBeNull();
    const btn = screen.getByRole("button", { name: /Name it/ });
    expect(btn.textContent).toMatch(/it stays a weed spot without one/);
  });

  it("opens the picker on request, with its caveats", () => {
    renderPopup();
    fireEvent.click(screen.getByRole("button", { name: /Name it/ }));
    expect(screen.getByText("What weed is it? (your call)")).toBeInTheDocument();
    expect(screen.getByText(/Being on this list is not evidence/)).toBeInTheDocument();
  });

  it("shows a suggestion without being asked, since one is worth seeing", () => {
    renderPopup({
      suggestion: {
        entry: ragweed, matchedText: "common ragweed", matchedOn: "common name",
        confirmed: 4, considered: 5, basis: "From your own past verdicts: 4 of the 5 ...",
      },
    });
    expect(screen.getByText("What weed is it? (your call)")).toBeInTheDocument();
    expect(screen.getByText(/From your own past verdicts/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Name it/ })).toBeNull();
  });

  it("leads with the operator's own name once given, and keeps the panel open", () => {
    renderPopup({ identification: identificationFromEntry(ragweed, "edited", "picked") });
    expect(screen.getAllByText("common ragweed").length).toBeGreaterThan(0);
    expect(screen.getByText("What weed is it? (your call)")).toBeInTheDocument();
  });

  it("offers no naming at all for a spot the operator removed", () => {
    renderPopup({ verdict: "not_weed" });
    expect(screen.queryByRole("button", { name: /Name it/ })).toBeNull();
    expect(screen.queryByText("What weed is it? (your call)")).toBeNull();
  });
});

describe("state the operator can see at a glance", () => {
  it("marks a saved spot and one that is on the field", () => {
    renderPopup({ saved: true, onField: true });
    expect(screen.getByLabelText("saved")).toBeInTheDocument();
    expect(screen.getByLabelText("on the field")).toBeInTheDocument();
  });

  it("keeps the measurements out of the way but reachable", () => {
    renderPopup();
    expect(screen.getByText("Measurements")).toBeInTheDocument();
    expect(screen.getByText("spot-region-1")).toBeInTheDocument();
  });
});
