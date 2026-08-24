// Smoke test for the workspace shell.
//
// Phase 4 split ~4,900 lines of OrthomosaicViewer into per-tab modules. This
// asserts the shell still wires together and drives its load sequence: resolve
// the scan, fetch the signed orthomosaic URL, drive the tile bake to completion,
// then render the tab bar. It is deliberately shallow — the tabs themselves are
// stubbed, because what regressed in a mechanical file split is composition,
// not tab internals.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { getSession, onAuthStateChange, fromMock } = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  fromMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession, onAuthStateChange },
    from: fromMock,
    storage: { from: () => ({ createSignedUrl: vi.fn() }) },
  },
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ taskId: "task-1" }),
}));

// Leaflet needs real layout; the map is not what this test is about.
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn(), on: vi.fn(), off: vi.fn() }),
  useMapEvents: () => ({}),
}));

// Stub the tabs: their internals are covered elsewhere, and mounting the planner
// pulls in the whole simulator.
vi.mock("@/components/app/workspace/FieldViewTab", () => ({ default: () => <div data-testid="tab-field" /> }));
vi.mock("@/components/app/workspace/AiTab", () => ({ default: () => <div data-testid="tab-ai" /> }));
vi.mock("@/components/app/workspace/PlannerTab", () => ({ default: () => <div data-testid="tab-planner" /> }));
vi.mock("@/components/app/workspace/WeatherTab", () => ({
  default: () => <div data-testid="tab-weather" />,
  HeaderWeather: () => <div data-testid="header-weather" />,
}));
vi.mock("@/components/app/workspace/SettingsTab", () => ({ default: () => <div data-testid="tab-settings" /> }));
vi.mock("@/components/app/ReportsTab", () => ({ default: () => <div data-testid="tab-reports" /> }));

import OrthomosaicViewer from "@/pages/app/OrthomosaicViewer";

const TASK = {
  odm_uuid: "uuid-1",
  field_id: "field-1",
  created_at: "2026-05-01T10:00:00Z",
  ai_analysis: null,
  ai_analysis_at: null,
};
const FIELD = {
  id: "field-1", name: "North Vineyard",
  boundary: null, boundary_area_hectares: null, settings: null,
};

/** Minimal chainable stub for the two selects the shell performs. */
function tableStub(rows: Record<string, unknown>) {
  return (table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      update: () => builder,
      maybeSingle: () => Promise.resolve({ data: rows[table] ?? null, error: null }),
      then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
    };
    return builder;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({
    data: { session: { access_token: "jwt", user: { id: "user-1" } } },
  });
  fromMock.mockImplementation(tableStub({ odm_tasks: TASK, fields: FIELD }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("workspace shell", () => {
  it("loads a completed scan and renders the tab bar", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("ortho-url")) {
        return new Response(JSON.stringify({
          url: "https://signed/ortho.tif",
          tilejson: { bounds: [-93.01, 45.0, -93.0, 45.01], maxzoom: 18 },
        }), { status: 200 });
      }
      if (String(url).includes("bake-tiles")) {
        return new Response(JSON.stringify({ done: true, completed: 12, total: 12 }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }));

    render(<OrthomosaicViewer />);

    await waitFor(() => expect(screen.getByText("Field View")).toBeInTheDocument());

    // Tabs open on demand: only Field View is open initially, and only its
    // component is mounted. That lazy mounting IS the per-tab state isolation —
    // if the split had collapsed it, every tab would render at once.
    expect(screen.getByTestId("tab-field")).toBeInTheDocument();
    for (const id of ["tab-weather", "tab-ai", "tab-planner", "tab-reports", "tab-settings"]) {
      expect(screen.queryByTestId(id), `${id} should not be mounted`).toBeNull();
    }
    for (const label of ["Weather", "AI Analysis", "Flight Planner", "Settings"]) {
      expect(screen.queryByText(label), `${label} tab should not be open`).toBeNull();
    }
  });

  it("shows progress while the scan is still processing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("ortho-url")) {
        return new Response(JSON.stringify({ status: "processing", progress: 42 }), { status: 409 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }));

    render(<OrthomosaicViewer />);

    await waitFor(() => expect(screen.getByText(/Processing… 42%/)).toBeInTheDocument());
  });

  it("offers a retry rather than dead-ending on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("ortho-url")) {
        return new Response(JSON.stringify({ error: "Processing completed but the orthomosaic file is missing." }), { status: 422 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }));

    render(<OrthomosaicViewer />);

    await waitFor(() => expect(screen.getByText(/orthomosaic file is missing/)).toBeInTheDocument());
    // No failure state in the workspace is a dead end.
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("reports tile-bake progress while baking", async () => {
    let bakeCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("ortho-url")) {
        return new Response(JSON.stringify({
          url: "https://signed/ortho.tif",
          tilejson: { bounds: [-93.01, 45.0, -93.0, 45.01], maxzoom: 18 },
        }), { status: 200 });
      }
      if (String(url).includes("bake-tiles")) {
        bakeCalls++;
        return new Response(JSON.stringify({
          done: bakeCalls > 2, completed: bakeCalls * 10, total: 30,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }));

    render(<OrthomosaicViewer />);

    // Bake is driven to completion across multiple passes, then the shell renders.
    await waitFor(() => expect(screen.getByText("Field View")).toBeInTheDocument(), { timeout: 5000 });
    expect(bakeCalls).toBeGreaterThan(1);
  });

  it("rejects an orthomosaic that is not in WGS84", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("ortho-url")) {
        return new Response(JSON.stringify({
          url: "https://signed/ortho.tif",
          // Projected (UTM) coordinates rather than lat/lng.
          tilejson: { bounds: [500000, 4900000, 510000, 4910000], maxzoom: 18 },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }));

    render(<OrthomosaicViewer />);

    await waitFor(() => expect(screen.getByText(/not in WGS84|projected coordinates/i)).toBeInTheDocument());
  });
});
