// A failed grid LOAD must never present as an empty grid.
//
// The bug this pins: a network blip while opening the Treatment Grid rendered
// a blank grid with no error; the operator's first "repair" stroke armed the
// debounced autosave, which overwrote the stored grid with the blank one — an
// unrelated failure silently destroying saved work. Now a failed load is its
// own locked state: no grid, no painting, an explicit retry, and an explicit
// consent step for going on without the stored grid.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { loadMock, saveMock } = vi.hoisted(() => ({
  loadMock: vi.fn(),
  saveMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/treatmentGridRepo", () => ({
  SupabaseTreatmentGridRepository: class {
    load = loadMock;
    save = saveMock;
  },
  GridStoreTooLargeError: class GridStoreTooLargeError extends Error {},
}));

vi.mock("@/lib/scanAssessment", () => ({
  snapshotGridAssessment: vi.fn(() => Promise.resolve({ ok: true })),
  snapshotGridAssessmentFromStore: vi.fn(() => Promise.resolve({ ok: true })),
  recordGridRunFailure: vi.fn(() => Promise.resolve()),
  announceGridChanged: vi.fn(),
  GRID_CHANGED_EVENT: "swathwise:grid-changed",
}));

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn(), on: vi.fn(), off: vi.fn() }),
  useMapEvents: () => ({}),
}));
vi.mock("@/components/app/workspace/TreatmentGridLayer", () => ({
  default: () => <div data-testid="grid-layer" />,
}));
vi.mock("@/components/app/workspace/layers", () => ({
  BasemapLayer: () => null,
  BasemapToggle: () => null,
  FitBounds: () => null,
  USER_POLY_ISSUES: ["Weed pressure"],
  loadBasemap: () => "esri",
  saveBasemap: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: vi.fn() }, from: vi.fn() },
}));

import { TreatmentTab } from "@/components/app/workspace/TreatmentTab";
import { DEFAULT_FARMER_SETTINGS } from "@/lib/farmerSettings";

// ~60 m square: a handful of 5 m cells, comfortably under every limit.
const RING = [
  { lat: 45.0, lng: -93.0 },
  { lat: 45.00055, lng: -93.0 },
  { lat: 45.00055, lng: -92.99925 },
  { lat: 45.0, lng: -92.99925 },
];

function renderTab() {
  return render(
    <TreatmentTab
      boundary={[RING]}
      tileUrl=""
      bounds={null}
      maxNative={20}
      fieldId="field-1"
      taskId="task-1"
      scanCreatedAt="2026-08-01T10:00:00Z"
      spec={{ swath_m: 5 } as never}
      settings={DEFAULT_FARMER_SETTINGS}
      setActiveTab={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("a failed grid load locks the tab instead of faking an empty grid", () => {
  it("shows the failure, renders no paintable grid, and never autosaves", async () => {
    loadMock.mockRejectedValue(new Error("Failed to fetch"));
    renderTab();

    expect(await screen.findByText(/Couldn.t load your saved grid/i)).toBeInTheDocument();
    expect(screen.getByText(/Painting is locked/i)).toBeInTheDocument();
    // No grid layer mounts, so there is nothing to paint...
    expect(screen.queryByTestId("grid-layer")).toBeNull();
    // ...and nothing to save over the stored grid.
    await new Promise(r => setTimeout(r, 900));
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("retry re-runs the load and unlocks once it succeeds", async () => {
    loadMock.mockRejectedValueOnce(new Error("Failed to fetch"));
    loadMock.mockResolvedValue(null); // second attempt: no stored grid, honest empty
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: /retry loading/i }));

    await waitFor(() => expect(screen.queryByText(/Couldn.t load your saved grid/i)).toBeNull());
    expect(await screen.findByTestId("grid-layer")).toBeInTheDocument();
    // The genuinely-empty grid teaches the first stroke.
    expect(screen.getByText(/Start by painting/i)).toBeInTheDocument();
  });

  it("going on without the stored grid requires explicit consent", async () => {
    loadMock.mockRejectedValue(new Error("Failed to fetch"));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: /start without it/i }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/will be overwritten/i));
    await waitFor(() => expect(screen.queryByText(/Couldn.t load your saved grid/i)).toBeNull());
    expect(await screen.findByTestId("grid-layer")).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("declining the consent keeps the lock in place", async () => {
    loadMock.mockRejectedValue(new Error("Failed to fetch"));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: /start without it/i }));

    expect(screen.getByText(/Couldn.t load your saved grid/i)).toBeInTheDocument();
    expect(screen.queryByTestId("grid-layer")).toBeNull();
    confirmSpy.mockRestore();
  });
});
