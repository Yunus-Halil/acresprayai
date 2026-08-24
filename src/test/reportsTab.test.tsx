// The Reports tab, rendered: the states a person sees before the PDF exists.
//
// The pure banner/missing/validation rules live in reportRecord.test.ts; this
// verifies the tab actually obeys them on screen — zones come from the
// TREATMENT GRID's per-scan assessment (fetched off the scan row), an
// unassessed scan claims nothing, a legacy vision result is marked and never
// styled as a grid assessment, a future mission date refuses to generate, and
// a mission logged against a DIFFERENT scan never leaks its volume in.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { getUser, fromMock } = vi.hoisted(() => ({
  getUser: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser },
    from: fromMock,
    storage: { from: () => ({ upload: vi.fn(), createSignedUrl: vi.fn() }) },
  },
}));

import ReportsTab from "@/components/app/ReportsTab";
import { DEFAULT_FARMER_SETTINGS } from "@/lib/farmerSettings";

const FIELD = { id: "field-1", name: "Testing Field 2", boundary_area_hectares: 4.4797 }; // ≈11.07 ac
const TASK = { id: "scan-1", created_at: "2026-08-20T10:00:00Z" };

const RING = [
  { lat: 45.0, lng: -93.0 },
  { lat: 45.000904, lng: -93.0 },
  { lat: 45.000904, lng: -92.99873 },
  { lat: 45.0, lng: -92.99873 },
];

const gridSnapshot = (over: Record<string, unknown> = {}) => ({
  source: "treatment-grid",
  zones: [] as unknown[],
  reference: { treated: 3, skipped: 3 },
  detection: null,
  computed_at: "2026-08-24T10:00:00Z",
  last_run: { status: "completed", at: "2026-08-24T10:00:00Z" },
  ...over,
});

function tableStub(rows: Record<string, unknown[]>) {
  return (table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows[table] ?? [], error: null }).then(res),
    };
    return builder;
  };
}

/** Seed the scan row the tab fetches its assessment from. */
function seedAssessment(aiAnalysis: unknown, at: string | null) {
  fromMock.mockImplementation(tableStub({
    odm_tasks: [{ ai_analysis: aiAnalysis, ai_analysis_at: at }],
    flight_logs: [],
    field_reports: [],
  }));
}

function renderTab(over: Partial<React.ComponentProps<typeof ReportsTab>> = {}) {
  return render(
    <ReportsTab
      field={FIELD}
      task={TASK}
      settings={DEFAULT_FARMER_SETTINGS}
      activeDrone={null}
      lastLog={null}
      setActiveTab={vi.fn()}
      prepareMapCapture={vi.fn()}
      restoreMapCapture={vi.fn()}
      {...over}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  seedAssessment(null, null);
});

describe("an unassessed scan claims nothing", () => {
  it("shows 'Not determined', never a percentage or an acreage", async () => {
    renderTab();
    expect(await screen.findByText("Not determined")).toBeInTheDocument();
    expect(screen.getByText(/no grid assessment/i)).toBeInTheDocument();
    expect(screen.queryByText(/unsprayed/i)).toBeNull();
  });

  it("lists the grid assessment among the draft's missing fields", async () => {
    renderTab();
    const notice = await screen.findByText(/DRAFT — INCOMPLETE/i);
    expect(notice.parentElement?.textContent).toMatch(/Treatment grid assessment/);
    expect(screen.getByRole("button", { name: /download draft report/i })).toBeInTheDocument();
  });
});

describe("an assessed-clean scan says so in words", () => {
  it("renders 'Nothing marked' as a result, not an absence", async () => {
    seedAssessment(gridSnapshot(), "2026-08-24T10:00:00Z");
    renderTab();
    expect(await screen.findByText("Nothing marked")).toBeInTheDocument();
    expect(screen.queryByText("Not determined")).toBeNull();
  });
});

describe("a grid assessment's numbers are the grid's own", () => {
  it("shows targeted acres from the snapshot's clipped cell areas", async () => {
    seedAssessment(gridSnapshot({
      zones: [{ id: "grid:g:0:0", ring: RING, areaM2: 10_000, rateLha: 25, cellCount: 4 }],
    }), "2026-08-24T10:00:00Z");
    renderTab();
    // 10 000 m² = 2.47 ac, from areaM2 — not from re-measuring the ring.
    expect(await screen.findByText("2.47 ac")).toBeInTheDocument();
  });
});

describe("a legacy vision result is marked, never dressed as a grid assessment", () => {
  it("labels the result and keeps the draft state (grid assessment still missing)", async () => {
    seedAssessment(
      { zones: [{ id: "ai-0", ring: RING }], health_score: 70 },
      "2026-08-10T10:00:00Z",
    );
    renderTab();
    expect(await screen.findByText("Legacy result")).toBeInTheDocument();
    expect(screen.getByText(/re-assess with the grid/i)).toBeInTheDocument();
    const notice = await screen.findByText(/DRAFT — INCOMPLETE/i);
    expect(notice.parentElement?.textContent).toMatch(/Treatment grid assessment/);
  });
});

describe("mission logs from other scans stay out", () => {
  it("does not adopt a field-level log flown against a different scan", async () => {
    const foreignLog = {
      id: "log-other", source: "flight_logs" as const,
      field_id: "field-1", scan_id: "scan-OTHER", drone_id: null,
      date_flown: "2026-08-01", battery_start: 100, battery_end: 40,
      tank_refills: 1, zones_completed: [], acres_treated: 2.5,
      liters_applied: 12.5, notes: null, created_at: "2026-08-01T12:00:00Z",
    };
    renderTab({ lastLog: foreignLog });

    // The volume input must NOT be prefilled with the other mission's 12.5 L —
    // that leak is how "Volume applied 3.3 gal" appeared beside "Zones flown 0/0".
    await waitFor(() => {
      const vol = screen.getByPlaceholderText(/e\.g\. 3\.3/) as HTMLInputElement;
      expect(vol.value).toBe("");
    });
  });
});

describe("mission date validation", () => {
  it("flags a future mission date and disables generation", async () => {
    const { container } = renderTab();
    const date = container.querySelector('input[type="date"]') as HTMLInputElement;
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(date, { target: { value: "2027-04-24" } });

    expect(await screen.findByText(/after the report date/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download draft report/i })).toBeDisabled();
  });
});
