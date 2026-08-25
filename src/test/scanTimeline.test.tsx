// The scan panel: where "no assessment", "assessed clean", "failed" and
// "legacy result" must never render alike.
//
// The bug this guards against shipped once already: every scan showed
// "0 zones found · 0.00 ac stressed · Pending" whether an assessment existed,
// failed, or was never attempted — different truths behind one number that
// looked measured and wasn't. Assessment is the TREATMENT GRID's; results left
// by the removed legacy vision path must be visibly marked as legacy.
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

// ~1 ha zone, so the marked acreage is a visible non-zero number.
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

const SCANS: FieldScan[] = [
  // Assessed, one zone with the grid's own clipped area carried along.
  scan("s1", "2026-03-10T09:00:00Z", {
    ai_analysis: gridSnapshot({
      zones: [{ id: "grid:g:0:0", ring: RING, areaM2: 10_000, rateLha: 25, cellCount: 4 }],
    }),
    ai_analysis_at: "2026-08-24T10:00:00Z",
  }),
  // Assessed with reference points, nothing marked — a real clean result.
  scan("s2", "2026-04-20T09:00:00Z", {
    ai_analysis: gridSnapshot(),
    ai_analysis_at: "2026-08-24T10:00:00Z",
  }),
  // Never assessed.
  scan("s3", "2026-06-01T09:00:00Z"),
  // A grid run that failed, reason stored, stamped as the grid's own.
  scan("s4", "2026-07-01T09:00:00Z", {
    ai_analysis: {
      last_run: {
        status: "failed", at: "2026-07-01T10:00:00Z",
        error: "The imagery is too coarse to measure these cells",
        source: "treatment-grid",
      },
    },
  }),
  // Tiles never baked.
  scan("s5", "2026-08-01T09:00:00Z", { tiles_baked: false }),
  // A result left behind by the removed vision path.
  scan("s6", "2026-08-10T09:00:00Z", {
    ai_analysis: { zones: [{ id: "ai-0", ring: RING }], health_score: 70 },
    ai_analysis_at: "2026-08-10T10:00:00Z",
  }),
  // A FAILURE left behind by the removed vision path — the fossil that made a
  // scan report "Grid run failed · AI is not configured (missing AI_API_KEY)".
  scan("s7", "2026-08-15T09:00:00Z", {
    ai_analysis: {
      last_run: {
        status: "failed", at: "2026-08-23T09:00:00Z",
        error: "AI is not configured (missing AI_API_KEY)",
      },
    },
  }),
];

const BOUNDARY = [RING];

function renderPanel(over: Partial<React.ComponentProps<typeof ScanPanel>> = {}) {
  const onOpenGrid = vi.fn();
  const onPick = vi.fn();
  const onOpenScan = vi.fn();
  const onScansChanged = vi.fn();
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
      onOpenGrid={onOpenGrid}
      onScansChanged={onScansChanged}
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
  return { onOpenGrid, onPick, onOpenScan, onScansChanged, ...utils };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The per-card band info probe; irrelevant to these assertions.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});

const cardOf = (dateText: string): HTMLElement => {
  const el = screen.getByText(dateText);
  let node: HTMLElement | null = el;
  while (node && !(node.dataset && node.className.includes("bg-[#111]"))) {
    node = node.parentElement;
  }
  if (!node) throw new Error(`no card for ${dateText}`);
  return node;
};

describe("the assessment states", () => {
  it("an assessed scan shows its real zone count and the grid's own acreage", () => {
    renderPanel();
    const c = cardOf("March 10, 2026");
    expect(within(c).getByText("1")).toBeInTheDocument();
    // areaM2 10 000 m² = 2.47 ac — the clipped cell arithmetic, not the ring.
    expect(within(c).getByText(/2\.47 ac/)).toBeInTheDocument();
    expect(within(c).getByText(/marked/)).toBeInTheDocument();
  });

  it("assessed-clean says so in words, not as an ambiguous zero", () => {
    renderPanel();
    const c = cardOf("April 20, 2026");
    expect(within(c).getByText(/Assessed · nothing marked for treatment/)).toBeInTheDocument();
    expect(within(c).queryByText(/0\.00 ac/)).toBeNull();
  });

  it("a never-assessed scan says 'No grid assessment yet' and shows NO numbers", () => {
    renderPanel();
    const c = cardOf("June 1, 2026");
    expect(within(c).getByText("No grid assessment yet")).toBeInTheDocument();
    expect(within(c).queryByText(/0 zones/)).toBeNull();
    expect(within(c).queryByText(/0\.00 ac/)).toBeNull();
  });

  it("a failed grid run surfaces as FAILED with the stored reason, never as Pending", () => {
    renderPanel();
    const c = cardOf("July 1, 2026");
    expect(within(c).getByText("Grid run failed")).toBeInTheDocument();
    expect(within(c).getByText(/too coarse/)).toBeInTheDocument();
    expect(within(c).queryByText(/^Pending$/)).toBeNull();
    expect(within(c).getByRole("button", { name: /retry in grid/i })).toBeInTheDocument();
  });

  it("a legacy vision result is visibly marked and offers a deliberate clear", () => {
    renderPanel();
    const c = cardOf("August 10, 2026");
    expect(within(c).getByText("Legacy vision")).toBeInTheDocument();
    expect(within(c).getByRole("button", { name: /clear legacy result/i })).toBeInTheDocument();
  });

  // The regression, at the surface it appeared on: a stale failure from the
  // deleted vision path must never be attributed to the treatment grid.
  it("a legacy FAILURE is never reported as a grid failure", () => {
    renderPanel();
    const c = cardOf("August 15, 2026");

    expect(within(c).queryByText("Grid run failed")).toBeNull();
    // The scan simply has no grid assessment...
    expect(within(c).getByText("No grid assessment yet")).toBeInTheDocument();
    // ...and the fossil is disclosed as the retired system's, not dropped.
    expect(within(c).getByText(/retired vision system failed here/i)).toBeInTheDocument();
    expect(within(c).getByText(/AI is not configured/)).toBeInTheDocument();
    expect(within(c).getByText(/nothing the grid needs/i)).toBeInTheDocument();
    expect(within(c).getByRole("button", { name: /clear legacy failure record/i })).toBeInTheDocument();
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
  it("the current scan's card opens the Treatment Grid — assessment is a human gesture", () => {
    const { onOpenGrid } = renderPanel();
    const c = cardOf("June 1, 2026");
    fireEvent.click(within(c).getByRole("button", { name: /treatment grid/i }));
    expect(onOpenGrid).toHaveBeenCalled();
  });

  it("another scan's card opens that scan's workspace instead", () => {
    const { onOpenGrid, onOpenScan } = renderPanel();
    const c = cardOf("March 10, 2026");
    fireEvent.click(within(c).getByRole("button", { name: /re-assess/i }));
    expect(onOpenScan).toHaveBeenCalledWith("s1");
    expect(onOpenGrid).not.toHaveBeenCalled();
  });

  it("a scan whose tiles never baked says so and cannot be assessed from here", () => {
    renderPanel();
    const c = cardOf("August 1, 2026");
    expect(within(c).getByText(/tiles have not finished baking/)).toBeInTheDocument();
    expect(within(c).getByRole("button", { name: /treatment grid/i })).toBeDisabled();
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

describe("what the panel reads and never writes on its own", () => {
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
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("7:flown"));

    expect(new Set(fromMock.mock.calls.map(c => c[0]))).toEqual(new Set(["odm_tasks", "flight_logs"]));
    expect(writeAttempt).not.toHaveBeenCalled();
  });
});
