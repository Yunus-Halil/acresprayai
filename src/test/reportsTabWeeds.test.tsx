// The Reports tab prints operator-stated weed identifications and treatment
// choices, and prints an unidentified spot as a count, never as a name.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { getUser, fromMock } = vi.hoisted(() => ({ getUser: vi.fn(), fromMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser },
    from: fromMock,
    storage: { from: () => ({ upload: vi.fn(), createSignedUrl: vi.fn() }) },
  },
}));

import ReportsTab from "@/components/app/ReportsTab";
import { DEFAULT_FARMER_SETTINGS } from "@/lib/farmerSettings";

const FIELD = { id: "field-1", name: "Testing Field 2", boundary_area_hectares: 4.4797 };
const TASK = { id: "scan-1", created_at: "2026-08-20T10:00:00Z" };

function tableStub(rows: Record<string, unknown[]>) {
  return (table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder, eq: () => builder, order: () => builder, limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(res),
    };
    return builder;
  };
}

const obs = (over: Record<string, unknown>) => ({
  candidate_id: "spot-plant-1", kind: "off-row vegetation", verdict: "weed", species: null, identification_status: "unidentified",
  catalog_id: null, identification_source: null, suggested_catalog_id: null, area_m2: 0.02, lat: 38.9, lng: -77.4, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

describe("weed identifications on the report", () => {
  it("names only what the operator stated and counts the rest", async () => {
    fromMock.mockImplementation(tableStub({
      odm_tasks: [{ ai_analysis: null, ai_analysis_at: null }],
      flight_logs: [], field_reports: [], treatment_choices: [],
      weed_observations: [
        obs({ candidate_id: "a", identification_status: "confirmed", species: "common ragweed", catalog_id: "VT-10", suggested_catalog_id: "VT-10", identification_source: "VA weed catalog 0.1.0, VT-10" }),
        obs({ candidate_id: "b", identification_status: "unidentified", suggested_catalog_id: "VT-2" }),
        obs({ candidate_id: "c", identification_status: "rejected", suggested_catalog_id: "VT-2" }),
      ],
    }));
    render(<ReportsTab field={FIELD} task={TASK} settings={DEFAULT_FARMER_SETTINGS} activeDrone={null} lastLog={null} center={null}
      setActiveTab={vi.fn()} prepareMapCapture={vi.fn()} restoreMapCapture={vi.fn()} />);
    const block = await screen.findByTestId("weed-identifications");
    expect(block.textContent).toMatch(/common ragweed/);
    expect(block.textContent).toMatch(/confirmed from a suggestion/);
    expect(block.textContent).toMatch(/1 saved candidate was not identified/);
    expect(block.textContent).toMatch(/1 suggested name was rejected/);
    // The suggested-but-unconfirmed entry's id never appears as a finding.
    expect(block.textContent).not.toMatch(/VT-2/);
  });

  it("shows nothing about weeds when the scan has no saved observations", async () => {
    fromMock.mockImplementation(tableStub({
      odm_tasks: [{ ai_analysis: null, ai_analysis_at: null }], flight_logs: [], field_reports: [], weed_observations: [], treatment_choices: [],
    }));
    render(<ReportsTab field={FIELD} task={TASK} settings={DEFAULT_FARMER_SETTINGS} activeDrone={null} lastLog={null} center={null}
      setActiveTab={vi.fn()} prepareMapCapture={vi.fn()} restoreMapCapture={vi.fn()} />);
    await screen.findByText("Not determined");
    expect(screen.queryByTestId("weed-identifications")).toBeNull();
    expect(screen.queryByTestId("treatment-choices")).toBeNull();
  });
});

describe("treatment choices on the report", () => {
  it("prints the operator's product with its label provenance, and flags an unverified label", async () => {
    fromMock.mockImplementation(tableStub({
      odm_tasks: [{ ai_analysis: null, ai_analysis_at: null }], flight_logs: [], field_reports: [], weed_observations: [],
      treatment_choices: [
        { id: "t1", weed_catalog_id: "VT-10", weed_label: "common ragweed", product_name: "Example Herbicide", epa_reg_no: "000-000",
          label_source: "https://example.org/label.pdf", label_checked_on: "2026-09-20", label_crop: "Corn", application_method: "aerial",
          restrictions: null, rate_value: 2, rate_unit: "L/ha", carrier_volume_value: null, carrier_unit: null, label_verified: true, notes: null },
        { id: "t2", weed_catalog_id: null, weed_label: null, product_name: "Unchecked Product", epa_reg_no: null, label_source: null,
          label_checked_on: null, label_crop: null, application_method: null, restrictions: null, rate_value: null, rate_unit: null,
          carrier_volume_value: null, carrier_unit: null, label_verified: false, notes: null },
      ],
    }));
    const settings = {
      ...DEFAULT_FARMER_SETTINGS,
      treatment_assignments: { "catalog:VT-10": { choice_id: "t1", label: "common ragweed" }, unidentified: { choice_id: "t2", label: "Unidentified weed spots" } },
    };
    render(<ReportsTab field={FIELD} task={TASK} settings={settings} activeDrone={null} lastLog={null} center={null}
      setActiveTab={vi.fn()} prepareMapCapture={vi.fn()} restoreMapCapture={vi.fn()} />);
    const block = await screen.findByTestId("treatment-choices");
    expect(block.textContent).toMatch(/common ragweed: Example Herbicide, EPA Reg\. No\. 000-000, 2 L\/ha/);
    expect(block.textContent).toMatch(/Label checked 2026-09-20 for Corn/);
    expect(block.textContent).toMatch(/Unidentified weed spots: Unchecked Product, no rate recorded/);
    expect(block.textContent).toMatch(/Label not marked as verified/);
    expect(block.textContent).toMatch(/recommends no product or rate/);
  });
});
