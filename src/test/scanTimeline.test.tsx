// The scan panel: where "not analyzed", "analyzed clean" and "failed" must
// never render alike.
//
// The bug this guards against shipped once already: every scan showed
// "0 zones found · 0.00 ac stressed · Pending" whether analysis had run,
// failed, or never been attempted — three different truths behind one number
// that looked measured and wasn't.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { authGetSession, onAuthStateChange, fromMock, writeAttempt } = vi.hoisted(() => ({
  authGetSession: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  fromMock: vi.fn(),
  writeAttempt: vi.fn(() => { throw new Error("scan panel attempted a database write"); }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: authGetSession, onAuthStateChange }, from: fromMock },
}));

vi.mock("@/components/app/Timelapse", () => ({ default: () => <div data-testid="timelapse" /> }));

import { ScanPanel, useFieldScans, type FieldScan } from "@/components/app/workspace/ScanTimeline";

const scan = (id: string, iso: string, over: Partial<FieldScan> = {}): FieldScan => ({
  id, odm_uuid: `uuid-${id}`, status: "completed", created_at: iso,
  image_count: 40, ai_analysis: null, ai_analysis_at: null, tiles_baked: true,
  ...over,
});

// ~1 ha zone, so the stressed acreage is a visible non-zero number.
const RING = [
  { lat: 45.0, lng: -93.0 },
  { lat: 45.000904, lng: -93.0 },
  { lat: 45.000904, lng: -92.99873 },
  { lat: 45.0, lng: -92.99873 },
];

const SCANS: FieldScan[] = [
  scan("s1", "2026-03-10T09:00:00Z", {
    ai_analysis: { zones: [{ id: "z1", ring: RING, severity: "high" }], last_run: { status: "completed", at: "2026-03-10T10:00:00Z" } },
    ai_analysis_at: "2026-03-10T10:00:00Z",
  }),
  scan("s2", "2026-04-20T09:00:00Z", {
    ai_analysis: { zones: [], last_run: { status: "completed", at: "2026-04-20T10:00:00Z" } },
    ai_analysis_at: "2026-04-20T10:00:00Z",
  }),
  scan("s3", "2026-06-01T09:00:00Z"),
  scan("s4", "2026-07-01T09:00:00Z", {
    ai_analysis: { last_run: { status: "failed", at: "2026-07-01T10:00:00Z", error: "AI provider returned 500" } },
  }),
  scan("s5", "2026-08-01T09:00:00Z", { tiles_baked: false }),
];

const BOUNDARY = [RING];

function renderPanel(over: Partial<React.ComponentProps<typeof ScanPanel>> = {}) {
  const onAnalyze = vi.fn();
  const onPick = vi.fn();
  const onOpenScan = vi.fn();
  const utils = render(
    <ScanPanel
      open
      onClose={vi.fn()}
      fieldName="Testing Field"
      scans={SCANS}
      flownIds={new Set(["s1"])}
      loading={false}
      currentTaskId="s3"
      boundary={BOUNDARY}
      token="jwt"
      analyzingId={null}
      onAnalyze={onAnalyze}
      onOpenScan={onOpenScan}
      compareOn={false}
      onToggleCompare={vi.fn()}
      picked={[]}
      onPick={onPick}
      aId={null}
      bId={null}
      onTilesRebaked={vi.fn()}
      {...over}
    />,
  );
  return { onAnalyze, onPick, onOpenScan, ...utils };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The per-card band info probe; irrelevant to these assertions.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});

const card = (label: string) =>
  screen.getByText(label).closest("div[class*='rounded-sm']")?.parentElement?.closest("div[class*='border']") as HTMLElement
  ?? (screen.getByText(label).closest(".rounded-sm") as HTMLElement);

const cardOf = (dateText: string): HTMLElement => {
  const el = screen.getByText(dateText);
  let node: HTMLElement | null = el;
  while (node && !(node.dataset && node.className.includes("bg-[#111]"))) {
    node = node.parentElement;
  }
  if (!node) throw new Error(`no card for ${dateText}`);
  return node;
};

describe("the three analysis states", () => {
  it("an analyzed scan shows its real zone count and acreage", () => {
    renderPanel();
    const c = cardOf("March 10, 2026");
    expect(within(c).getByText("1")).toBeInTheDocument();
    expect(within(c).getByText(/ac/)).toBeInTheDocument();
    expect(within(c).getByText(/zone/)).toBeInTheDocument();
  });

  it("an analyzed-clean scan says so in words, not as an ambiguous zero", () => {
    renderPanel();
    const c = cardOf("April 20, 2026");
    expect(within(c).getByText(/Analyzed · no stressed areas found/)).toBeInTheDocument();
    expect(within(c).queryByText(/0\.00 ac/)).toBeNull();
  });

  it("a never-analyzed scan says 'Not analyzed yet' and shows NO numbers", () => {
    renderPanel();
    const c = cardOf("June 1, 2026");
    expect(within(c).getByText("Not analyzed yet")).toBeInTheDocument();
    expect(within(c).queryByText(/0 zones/)).toBeNull();
    expect(within(c).queryByText(/0\.00 ac/)).toBeNull();
  });

  it("a failed analysis surfaces as FAILED with the stored reason, never as Pending", () => {
    renderPanel();
    const c = cardOf("July 1, 2026");
    expect(within(c).getByText("Analysis failed")).toBeInTheDocument();
    expect(within(c).getByText(/AI provider returned 500/)).toBeInTheDocument();
    expect(within(c).queryByText(/^Pending$/)).toBeNull();
    expect(within(c).getByRole("button", { name: /retry analysis/i })).toBeInTheDocument();
  });

  it("the flight-log badge says what it means instead of 'Pending'", () => {
    renderPanel();
    expect(screen.queryByText(/^Pending$/)).toBeNull();
    expect(screen.getAllByText("No mission logged").length).toBeGreaterThan(0);
    const flown = cardOf("March 10, 2026");
    expect(within(flown).getByText("Mission flown")).toBeInTheDocument();
  });
});

describe("actions", () => {
  it("analyze asks for that scan's id", () => {
    const { onAnalyze } = renderPanel();
    const c = cardOf("June 1, 2026");
    fireEvent.click(within(c).getByRole("button", { name: /^analyze$/i }));
    expect(onAnalyze).toHaveBeenCalledWith("s3");
  });

  it("refuses to offer analysis without a field boundary, and says why", () => {
    renderPanel({ boundary: null });
    const c = cardOf("June 1, 2026");
    const btn = within(c).getByRole("button", { name: /^analyze$/i });
    expect(btn).toBeDisabled();
    expect(btn.title).toMatch(/boundary/i);
  });

  it("a scan whose tiles never baked says so and cannot be analyzed", () => {
    renderPanel();
    const c = cardOf("August 1, 2026");
    expect(within(c).getByText(/tiles have not finished baking/)).toBeInTheDocument();
    expect(within(c).getByRole("button", { name: /^analyze$/i })).toBeDisabled();
  });

  it("every card offers a tile re-render with an explanation of what it fixes", () => {
    renderPanel();
    const c = cardOf("March 10, 2026");
    const btn = within(c).getByRole("button", { name: /re-render map tiles/i });
    expect(btn.title).toMatch(/black borders|wrong colours/i);
  });

  it("in compare mode, clicking a card picks that scan", () => {
    const { onPick } = renderPanel({ compareOn: true, picked: [] });
    fireEvent.click(cardOf("March 10, 2026"));
    expect(onPick).toHaveBeenCalledWith("s1");
  });

  it("shows A on the older pick and B on the newer", () => {
    renderPanel({ compareOn: true, picked: ["s2", "s1"], aId: "s1", bId: "s2" });
    expect(within(cardOf("March 10, 2026")).getByText("A")).toBeInTheDocument();
    expect(within(cardOf("April 20, 2026")).getByText("B")).toBeInTheDocument();
  });
});

describe("what the panel reads and never writes", () => {
  it("useFieldScans reads scans and flight logs, and nothing gets written", async () => {
    const rows: Record<string, unknown[]> = {
      odm_tasks: SCANS as unknown as unknown[],
      flight_logs: [{ scan_id: "s1" }],
    };
    fromMock.mockImplementation((table: string) => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        in: () => builder,
        update: writeAttempt, insert: writeAttempt, delete: writeAttempt, upsert: writeAttempt,
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: rows[table] ?? [], error: null }).then(res),
      };
      return builder;
    });

    function Probe() {
      const { scans, flownIds, loading } = useFieldScans("field-1", 0);
      if (loading) return <div>loading</div>;
      return <div data-testid="probe">{scans.length}:{flownIds.has("s1") ? "flown" : "no"}</div>;
    }
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("5:flown"));

    expect(new Set(fromMock.mock.calls.map(c => c[0]))).toEqual(new Set(["odm_tasks", "flight_logs"]));
    expect(writeAttempt).not.toHaveBeenCalled();
  });
});
