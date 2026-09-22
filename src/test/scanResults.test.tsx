// The scan-results screen states only what another module already states.
//
// The three headline numbers and the per-row acreage all come from
// lib/treatment/plannedArea.ts, which is the same function the Flight Planner
// prices its chemical with. What this covers is the wiring and the refusals:
// a field with no recorded area produces a stated blank rather than a
// percentage, a spot the planner would drop says so rather than contributing,
// and the hand-off button never implies a product or a rate.
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ScanResults, type ScanResultsProps } from "@/components/app/workspace/ScanResults";
import { UNIDENTIFIED, identificationFromEntry } from "@/lib/weedCatalog/identification";
import { fieldRegion } from "@/lib/weedCatalog/region";
import type { CatalogEntry } from "@/lib/weedCatalog/types";
import type { Candidate } from "@/lib/weedScout/types";

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

const spot = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id, tileId: "t", centroid: { lat: 38.95, lng: -77.45 }, kind: "off-row vegetation", score: 0.8,
  distanceToRowM: 0.3, rowConfidence: 0.9, anomalyZ: null, anomalyFeature: null, blobZ: null, blobZFeature: null,
  blob: null, region: null, areaM2: 0.02, feedback: null,
  estimate: {
    model: "swathwise-inhouse-v1", summary: "A small plant between the fitted rows.", sizeClass: "small",
    habit: null, colourNote: null, positionNote: "Sits well outside the row.", seasonNote: "Captured in summer.",
    whatWouldConfirm: [], caveats: [],
  },
  chip: null, chipSpanM: null, chipGsdM: null, ...over,
});

function renderResults(over: Partial<ScanResultsProps> = {}) {
  const candidates = over.candidates ?? [spot("a"), spot("b")];
  const props: ScanResultsProps = {
    candidates,
    units: "imperial",
    treatAreaM2: 20_234,          // ~5 ac
    fieldAreaM2: 404_686,         // ~100 ac
    areaOf: () => 10_117,
    verdictOf: () => "weed",
    setVerdict: vi.fn(),
    identificationOf: () => UNIDENTIFIED,
    notesOf: () => "",
    setNotes: vi.fn(),
    suggestionOf: () => null,
    isSaved: () => false,
    isOnField: () => false,
    selectedId: null,
    onSelect: vi.fn(),
    shortlist: { entries: [], tooMany: false, note: "" },
    recent: [],
    searchResults: [],
    searchQuery: "",
    onSearchQuery: vi.fn(),
    freeText: "",
    onFreeText: vi.fn(),
    listNote: "Being on this list is not evidence that a plant is in this field.",
    region: fieldRegion(),
    catalogSize: 755,
    catalogError: null,
    onConfirmSuggestion: vi.fn(),
    onSetIdentification: vi.fn(),
    onPickEntry: vi.fn(),
    onPickRecent: vi.fn(),
    onShowMap: vi.fn(),
    onBuildMission: vi.fn(),
    building: null,
    buildError: null,
    canBuild: true,
    ...over,
  };
  return { ...render(<ScanResults {...props} />), props };
}

describe("the headline", () => {
  it("states the three numbers, with the treated area against the field's own", () => {
    renderResults();
    expect(screen.getByText("Spots found").parentElement?.textContent).toMatch(/2/);
    expect(screen.getByText("To treat").parentElement?.textContent).toMatch(/5\.00 ac/);
    expect(screen.getByText("To treat").parentElement?.textContent).toMatch(/of 100\.0 ac/);
    // 5 of 100 acres marked leaves 95% needing nothing.
    expect(screen.getByText("Needs nothing").parentElement?.textContent).toMatch(/95%/);
  });

  it("refuses the percentage when no field area is on file, rather than inventing one", () => {
    renderResults({ fieldAreaM2: null });
    const block = screen.getByText("Needs nothing").parentElement!;
    expect(block.textContent).toMatch(/Not known/);
    expect(block.textContent).toMatch(/no boundary area on file/);
    expect(block.textContent).not.toMatch(/%/);
    expect(screen.getByText("To treat").parentElement?.textContent).toMatch(/field area not on file/);
  });

  it("counts kept, removed and unsure separately", () => {
    const cs = [spot("a"), spot("b"), spot("c")];
    renderResults({
      candidates: cs,
      verdictOf: c => (c.id === "a" ? "weed" : c.id === "b" ? "not_weed" : "unsure"),
    });
    expect(screen.getByText("Spots found").parentElement?.textContent).toMatch(/1 kept, 1 removed, 1 unsure/);
  });
});

describe("a row", () => {
  it("shows the describer's own words, not a verdict of its own", () => {
    renderResults({ candidates: [spot("a")] });
    expect(screen.getByText("A small plant between the fitted rows.")).toBeInTheDocument();
  });

  it("says when the planner would not carry a spot, instead of counting it", () => {
    renderResults({ candidates: [spot("a")], areaOf: () => null });
    expect(screen.getByText("outside boundary")).toBeInTheDocument();
    expect(screen.getByText(/Centred outside the boundary, so the planner will not carry it/)).toBeInTheDocument();
  });

  it("leads with the operator's own name once they have given one", () => {
    renderResults({
      candidates: [spot("a")],
      identificationOf: () => identificationFromEntry(ragweed, "edited", "picked"),
    });
    expect(screen.getByText("common ragweed")).toBeInTheDocument();
    expect(screen.getByText("identified")).toBeInTheDocument();
  });

  it("offers keep, remove and unsure on every row without opening it", () => {
    renderResults({ candidates: [spot("a")] });
    expect(screen.getByRole("button", { name: "Weed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not a weed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unsure" })).toBeInTheDocument();
  });
});

describe("the hand-off", () => {
  it("says what it will do and claims no product or rate", () => {
    renderResults();
    const btn = screen.getByRole("button", { name: /Save 2 spots and open the Flight Planner/ });
    expect(btn).toBeEnabled();
    const foot = btn.parentElement!;
    expect(foot.textContent).toMatch(/applies your own rates, drone and tank settings/i);
    expect(foot.textContent).toMatch(/No product or rate is chosen for you/);
  });

  it("reports its own progress and refuses when there is nobody to save as", () => {
    renderResults({ building: { done: 3, total: 9 } });
    expect(screen.getByRole("button", { name: /Saving 3\/9/ })).toBeDisabled();
    renderResults({ canBuild: false });
    expect(screen.getByText("Sign in to save.")).toBeInTheDocument();
  });

  it("does not offer to build anything when the scan found nothing", () => {
    renderResults({ candidates: [] });
    expect(screen.queryByRole("button", { name: /Flight Planner/ })).toBeNull();
    expect(screen.getByText(/That is a result, not an absence/)).toBeInTheDocument();
  });
});

describe("the identification block only opens on the row being reviewed", () => {
  it("is absent until a row is expanded, and carries its caveats when it is", () => {
    const { rerender, props } = renderResults({ candidates: [spot("a")] });
    expect(screen.queryByText(/What weed is it/)).toBeNull();
    rerender(<ScanResults {...props} candidates={[spot("a")]} selectedId="a" />);
    expect(screen.getByText("What weed is it? (your call)")).toBeInTheDocument();
    const panel = screen.getByText("What weed is it? (your call)").parentElement!;
    expect(within(panel).getByText(/Being on this list is not evidence/)).toBeInTheDocument();
    expect(within(panel).getByText(/assumed for testing|treated as being in Virginia/i)).toBeInTheDocument();
  });
});
