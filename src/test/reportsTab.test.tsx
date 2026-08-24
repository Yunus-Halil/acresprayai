// The Reports tab, rendered: the states a person sees before the PDF exists.
//
// The pure banner/missing/validation rules live in reportRecord.test.ts; this
// verifies the tab actually obeys them on screen — no fabricated number for an
// unanalyzed scan, the draft warning naming its gaps, a future mission date
// refusing to generate, and a mission logged against a DIFFERENT scan never
// leaking its volume into this one's report.
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

function renderTab(over: Partial<React.ComponentProps<typeof ReportsTab>> = {}) {
  return render(
    <ReportsTab
      field={FIELD}
      task={TASK}
      analysis={null}
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
  fromMock.mockImplementation(tableStub({ flight_logs: [], field_reports: [] }));
});

describe("an unanalyzed scan claims nothing", () => {
  it("shows 'Not determined', never a percentage or an acreage", async () => {
    renderTab({ analysis: null });
    expect(await screen.findByText("Not determined")).toBeInTheDocument();
    expect(screen.getByText(/no analysis run/i)).toBeInTheDocument();
    expect(screen.queryByText(/unsprayed/i)).toBeNull();
    expect(screen.queryByText(/% /)).toBeNull();
  });

  it("warns the report will state treatment areas were not determined", async () => {
    renderTab({ analysis: null });
    expect(await screen.findByText(/treatment areas were not determined/i)).toBeInTheDocument();
  });

  it("lists 'Imagery analysis' among the draft's missing fields", async () => {
    renderTab({ analysis: null });
    const notice = await screen.findByText(/DRAFT — INCOMPLETE/i);
    expect(notice.parentElement?.textContent).toMatch(/Imagery analysis/);
    expect(screen.getByRole("button", { name: /download draft report/i })).toBeInTheDocument();
  });
});

describe("an analyzed-clean scan says so in words", () => {
  it("renders 'No zones found' as a result, not an absence", async () => {
    renderTab({ analysis: { health_score: 92, zones: [] } });
    expect(await screen.findByText("No zones found")).toBeInTheDocument();
    expect(screen.queryByText("Not determined")).toBeNull();
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
