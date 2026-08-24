// The History tab's side of compare: choosing the two scans.
//
// The rules under test live in the component, not the helpers — the rolling
// two-scan selection window, the refusal of scans with nothing to draw, the
// oldest-on-the-left ordering however the operator clicked, and the fact that
// browsing history and opening a comparison never writes. scanLayers.test.ts
// proves the guard sentences; this proves the tab actually obeys them.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { getSession, onAuthStateChange, fromMock, writeAttempt } = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  fromMock: vi.fn(),
  // History is a reading of what happened; nothing on this tab may change it.
  writeAttempt: vi.fn(() => { throw new Error("HistoryTab attempted a write"); }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession, onAuthStateChange }, from: fromMock },
}));

// The MiniMap builds a raw L.map per card; tiles are not what this test is about.
vi.mock("leaflet", () => {
  const layer = () => ({ addTo: vi.fn() });
  return {
    default: {
      map: vi.fn(() => ({ fitBounds: vi.fn(), setView: vi.fn(), remove: vi.fn() })),
      tileLayer: vi.fn(layer),
      polygon: vi.fn(layer),
    },
  };
});

// Compare's internals have their own test; here it only needs to show which
// scans it was handed and offer a way back.
vi.mock("@/components/app/ScanCompare", () => ({
  default: ({ left, right, onExit }: {
    left: { id: string }; right: { id: string }; onExit: () => void;
  }) => (
    <div data-testid="scan-compare" data-left={left.id} data-right={right.id}>
      <button onClick={onExit}>exit-compare</button>
    </div>
  ),
}));
vi.mock("@/components/app/Timelapse", () => ({ default: () => <div data-testid="timelapse" /> }));

import HistoryTab from "@/components/app/HistoryTab";

const scan = (id: string, iso: string, extra: Record<string, unknown> = {}) => ({
  id, odm_uuid: `uuid-${id}`, status: "completed", created_at: iso,
  image_count: 40, ai_analysis: null, tiles_baked: true, ...extra,
});

// Three comparable flights and one whose tiles never baked.
const TASKS = [
  scan("s1", "2026-03-10T09:00:00Z"),
  scan("s2", "2026-04-20T09:00:00Z"),
  scan("s3", "2026-06-01T09:00:00Z"),
  scan("s4", "2026-07-05T09:00:00Z", { tiles_baked: false }),
];

function tableStub(data: Record<string, unknown[]>) {
  return (table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      in: () => builder,
      update: writeAttempt, insert: writeAttempt, delete: writeAttempt, upsert: writeAttempt,
      then: (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: data[table] ?? [], error: null }).then(res),
    };
    return builder;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ data: { session: { access_token: "jwt" } } });
  fromMock.mockImplementation(tableStub({ odm_tasks: TASKS, flight_logs: [] }));
});

async function renderHistory() {
  render(
    <HistoryTab
      fieldId="field-1" fieldName="North Vineyard" boundary={null}
      currentTaskId="s3" openTask={vi.fn()}
    />,
  );
  await waitFor(() => expect(screen.getByText("March 10, 2026")).toBeInTheDocument());
}

const clickCard = (date: string) => fireEvent.click(screen.getByText(date));

describe("choosing two scans", () => {
  it("walks the guard from none, through one, to a ready pair", async () => {
    await renderHistory();
    const compare = () => screen.getByRole("button", { name: /^compare$/i });

    expect(screen.getByText("Select two scans to compare.")).toBeInTheDocument();
    expect(compare()).toBeDisabled();

    clickCard("March 10, 2026");
    expect(screen.getByText(/Select one more scan/)).toBeInTheDocument();
    expect(compare()).toBeDisabled();

    clickCard("April 20, 2026");
    expect(screen.getByText(/oldest on the left/)).toBeInTheDocument();
    expect(compare()).toBeEnabled();
  });

  it("keeps the newest two picks: a third click replaces the oldest, not the selection", async () => {
    await renderHistory();
    clickCard("March 10, 2026");
    clickCard("April 20, 2026");
    clickCard("June 1, 2026");   // rolling window: s1 drops out, s2+s3 remain

    fireEvent.click(screen.getByRole("button", { name: /^compare$/i }));
    const view = screen.getByTestId("scan-compare");
    expect(view.dataset.left).toBe("s2");
    expect(view.dataset.right).toBe("s3");
  });

  it("refuses a scan with nothing to draw, and says why on the card", async () => {
    await renderHistory();
    expect(
      screen.getByText("This scan's map tiles have not finished baking yet."),
    ).toBeInTheDocument();

    clickCard("July 5, 2026");   // the unbaked one
    // The click did not select it: the guard still asks for the first scan.
    expect(screen.getByText("Select two scans to compare.")).toBeInTheDocument();
  });
});

describe("opening and leaving the comparison", () => {
  it("hands compare the older scan as left whatever order was clicked, and exits back to the list", async () => {
    await renderHistory();
    clickCard("June 1, 2026");    // newer first
    clickCard("March 10, 2026");  // older second

    fireEvent.click(screen.getByRole("button", { name: /^compare$/i }));
    const view = screen.getByTestId("scan-compare");
    expect(view.dataset.left).toBe("s1");
    expect(view.dataset.right).toBe("s3");

    fireEvent.click(screen.getByText("exit-compare"));
    await waitFor(() => expect(screen.queryByTestId("scan-compare")).toBeNull());
    expect(screen.getByText("March 10, 2026")).toBeInTheDocument();
  });
});

describe("what history never does", () => {
  it("reads scans and flight logs, and writes nothing", async () => {
    await renderHistory();
    clickCard("March 10, 2026");
    clickCard("June 1, 2026");
    fireEvent.click(screen.getByRole("button", { name: /^compare$/i }));
    fireEvent.click(screen.getByText("exit-compare"));

    const tables = fromMock.mock.calls.map(c => c[0]);
    expect(new Set(tables)).toEqual(new Set(["odm_tasks", "flight_logs"]));
    expect(writeAttempt).not.toHaveBeenCalled();
  });
});
