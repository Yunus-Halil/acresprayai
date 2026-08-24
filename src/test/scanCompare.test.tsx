// The compare view itself, rendered.
//
// compareSync.test.ts proves the view-lock logic against faithful fakes, and
// scanLayers.test.ts proves the vocabulary. What neither can prove is that
// ScanCompare actually wires them to two maps: that a pan on one pane reaches
// the other through SyncBinding, that the menu a pane shows is built from that
// scan's own bands, that the legend's honesty caveat travels with the proxy
// index, and that opening and using the view never writes anywhere. That is
// what this file renders and checks.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

type Handler = () => void;
type FakeMap = {
  state: { lat: number; lng: number; zoom: number };
  setViewCalls: { lat: number; lng: number; zoom: number }[];
  getCenter: () => { lat: number; lng: number };
  getZoom: () => number;
  getBounds: () => {
    getNorth: () => number; getSouth: () => number;
    getEast: () => number; getWest: () => number;
  };
  setView: (c: [number, number], zoom: number, opts?: unknown) => FakeMap;
  on: (ev: string, fn: Handler) => FakeMap;
  off: (ev: string, fn: Handler) => FakeMap;
  invalidateSize: () => void;
  /** A user gesture: moves the map and fires events, without being a setView. */
  userPan: (lat: number, lng: number, zoom: number) => void;
};

const { maps } = vi.hoisted(() => ({ maps: [] as FakeMap[] }));

// A map that echoes the way Leaflet does: setView synchronously fires "move",
// which SyncBinding reports straight back into the sync. If the loop guard were
// broken this mock would recurse until the stack blew, which is the point.
vi.mock("react-leaflet", async () => {
  const React = await import("react");
  const Ctx = React.createContext<FakeMap | null>(null);

  function createFakeMap(): FakeMap {
    const handlers: Record<string, Set<Handler>> = {};
    const fire = (ev: string) => { for (const h of [...(handlers[ev] ?? [])]) h(); };
    const fireAll = () => { fire("move"); fire("zoom"); fire("moveend"); fire("zoomend"); };
    const map: FakeMap = {
      state: { lat: 45.005, lng: -93.005, zoom: 16 },
      setViewCalls: [],
      getCenter: () => ({ lat: map.state.lat, lng: map.state.lng }),
      getZoom: () => map.state.zoom,
      // A small viewport around wherever the map is, so coverage is a
      // function of the scan bounds each test serves from ortho-url.
      getBounds: () => ({
        getNorth: () => map.state.lat + 0.003,
        getSouth: () => map.state.lat - 0.003,
        getEast: () => map.state.lng + 0.003,
        getWest: () => map.state.lng - 0.003,
      }),
      setView: ([lat, lng], zoom) => {
        map.setViewCalls.push({ lat, lng, zoom });
        map.state = { lat, lng, zoom };
        fireAll();                       // the synchronous echo
        return map;
      },
      on: (ev, fn) => { (handlers[ev] ??= new Set()).add(fn); return map; },
      off: (ev, fn) => { handlers[ev]?.delete(fn); return map; },
      invalidateSize: () => {},
      userPan: (lat, lng, zoom) => {
        map.state = { lat, lng, zoom };
        fireAll();
      },
    };
    return map;
  }

  return {
    MapContainer: ({ children }: { children?: React.ReactNode }) => {
      const ref = React.useRef<FakeMap | null>(null);
      if (!ref.current) { ref.current = createFakeMap(); maps.push(ref.current); }
      return (
        <Ctx.Provider value={ref.current}>
          <div data-testid="map">{children}</div>
        </Ctx.Provider>
      );
    },
    TileLayer: ({ url }: { url: string }) => <div data-testid="tile-layer" data-url={url} />,
    useMap: () => {
      const m = React.useContext(Ctx);
      if (!m) throw new Error("useMap outside MapContainer");
      return m;
    },
  };
});

// The basemap is a separate concern with its own network probe; here it would
// only add noise under the imagery layers this test asserts on.
vi.mock("@/components/app/workspace/layers", () => ({
  BasemapLayer: () => null,
  BasemapToggle: () => null,
  loadBasemap: () => "satellite" as const,
  saveBasemap: () => {},
}));

// Compare must never touch the database. Nothing in its import graph should
// even reach for the client; if something does, fail loudly rather than
// letting a read-only view grow a write path unnoticed.
const { dbTouched } = vi.hoisted(() => ({
  dbTouched: vi.fn(() => { throw new Error("ScanCompare reached the supabase client"); }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: new Proxy({}, { get: () => dbTouched }),
}));

import ScanCompare from "@/components/app/ScanCompare";

const LEFT = {
  id: "scan-a", odm_uuid: "uuid-a", status: "completed",
  created_at: "2026-05-01T10:00:00Z", tiles_baked: true,
};
const RIGHT = {
  id: "scan-b", odm_uuid: "uuid-b", status: "completed",
  created_at: "2026-06-15T14:30:00Z", tiles_baked: true,
};

/** Left is plain RGB; right carries a genuine near-infrared band. */
const INFO: Record<string, unknown> = {
  "scan-a": {
    available: ["vari"], hasNDVI: false, spectralBands: 3,
    reason: "3 spectral bands — no near-infrared, so no true NDVI",
    fingerprint: "vari:2-1-3",
  },
  "scan-b": {
    available: ["ndvi", "vari"], hasNDVI: true, spectralBands: 4,
    reason: "4 spectral bands — NIR b4, red b1 (via band descriptions)",
    fingerprint: "ndvi:4-1",
  },
};

/** Left covers the view; right was flown over different ground entirely. */
const BOUNDS: Record<string, [number, number, number, number]> = {
  "scan-a": [-93.01, 45.0, -93.0, 45.01],
  "scan-b": [-92.51, 44.5, -92.5, 44.51],
};

let requests: { url: string; method: string }[] = [];

beforeEach(() => {
  maps.length = 0;
  requests = [];
  dbTouched.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    requests.push({ url: u, method: init?.method ?? "GET" });
    const id = /task_id=([\w-]+)/.exec(u)?.[1];
    if (u.includes("/info?") && id) {
      return new Response(JSON.stringify(INFO[id] ?? {}), { status: 200 });
    }
    if (u.includes("ortho-url") && id) {
      return new Response(JSON.stringify({
        tilejson: { bounds: BOUNDS[id], maxzoom: 18 },
      }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

function renderCompare(onExit = vi.fn()) {
  const utils = render(
    <ScanCompare left={LEFT} right={RIGHT} boundary={null} token="jwt" onExit={onExit} />,
  );
  return { onExit, ...utils };
}

const settle = async () => {
  await waitFor(() => expect(screen.queryByText(/Loading both scans/)).toBeNull());
  await waitFor(() => expect(screen.queryByText(/Reading this scan's bands/)).toBeNull());
};

/** The two ComparePane roots, in left/right order. */
const paneRoots = () => screen.getAllByTestId("map").map(m => m.parentElement as HTMLElement);

describe("what the operator is looking at", () => {
  it("labels each pane with its scan's date, and the header with both", async () => {
    renderCompare();
    await settle();

    const [left, right] = paneRoots();
    expect(within(left).getByText(/Left ·/)).toBeInTheDocument();
    expect(within(left).getByText("May 1, 2026")).toBeInTheDocument();
    expect(within(right).getByText(/Right ·/)).toBeInTheDocument();
    expect(within(right).getByText("Jun 15, 2026")).toBeInTheDocument();
    expect(screen.getByText("Comparing")).toBeInTheDocument();
  });

  it("exits back to history without ceremony", async () => {
    const { onExit } = renderCompare();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /back to history/i }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe("the two panes move as one", () => {
  it("carries a pan on one pane to the other, without bouncing back", async () => {
    renderCompare();
    await settle();
    expect(maps).toHaveLength(2);
    const [left, right] = maps;
    left.setViewCalls.length = 0;
    right.setViewCalls.length = 0;

    // The operator drags the left pane. The fake fires "move" synchronously,
    // and the right pane's own setView echoes straight back into the sync —
    // exactly the loop the guard exists for.
    act(() => left.userPan(45.02, -93.03, 17));

    expect(right.setViewCalls).toEqual([{ lat: 45.02, lng: -93.03, zoom: 17 }]);
    // The pane under the operator's hand is never moved by code.
    expect(left.setViewCalls).toEqual([]);
  });

  it("keeps following in both directions, zoom included", async () => {
    renderCompare();
    await settle();
    const [left, right] = maps;
    left.setViewCalls.length = 0;
    right.setViewCalls.length = 0;

    act(() => left.userPan(45.02, -93.03, 17));
    act(() => right.userPan(45.02, -93.03, 19));   // now the OTHER pane, zooming
    act(() => left.userPan(45.05, -93.06, 19));

    // The guard released after each gesture: every real move propagated.
    expect(left.setViewCalls).toEqual([{ lat: 45.02, lng: -93.03, zoom: 19 }]);
    expect(right.setViewCalls).toEqual([
      { lat: 45.02, lng: -93.03, zoom: 17 },
      { lat: 45.05, lng: -93.06, zoom: 19 },
    ]);
  });
});

describe("layers, honestly labelled", () => {
  it("offers an RGB scan only what its bands support, with the reason for the rest", async () => {
    renderCompare();
    await settle();
    const [left] = paneRoots();

    fireEvent.click(within(left).getByRole("button", { name: /rgb/i }));

    const vari = within(left).getByRole("button", { name: /VARI \(RGB\)/ });
    expect(vari).toBeEnabled();
    const ndvi = within(left).getByRole("button", { name: /^NDVI/ });
    expect(ndvi).toBeDisabled();
    expect(ndvi.textContent).toMatch(/near-infrared band the camera did not record/);
  });

  it("switches one pane to the proxy index, caveat attached, leaving the other on RGB", async () => {
    renderCompare();
    await settle();
    const [left, right] = paneRoots();

    fireEvent.click(within(left).getByRole("button", { name: /rgb/i }));
    fireEvent.click(within(left).getByRole("button", { name: /VARI \(RGB\)/ }));

    // The left pane now renders the index tiles, never called NDVI...
    const leftTiles = within(left).getByTestId("tile-layer");
    expect(leftTiles.dataset.url).toContain("index=vari");
    // ...with the legend saying what a visible-band ratio can honestly say.
    expect(within(left).getByText(/Visible-light proxy from ordinary RGB imagery/)).toBeInTheDocument();
    expect(within(left).getByText("Less green")).toBeInTheDocument();
    expect(within(left).getByText("More green")).toBeInTheDocument();

    // The right pane kept its own choice: the photograph, from the RGB tiles.
    expect(within(right).getByTestId("tile-layer").dataset.url).toContain("uuid-b");
    expect(within(right).getByTestId("tile-layer").dataset.url).not.toContain("index=");
    expect(within(right).getByRole("button", { name: /rgb/i })).toBeInTheDocument();
  });

  it("calls real NDVI NDVI, without the proxy caveat, on the scan that earned it", async () => {
    renderCompare();
    await settle();
    const [, right] = paneRoots();

    fireEvent.click(within(right).getByRole("button", { name: /rgb/i }));
    fireEvent.click(within(right).getByRole("button", { name: /^NDVI/ }));

    expect(within(right).getByTestId("tile-layer").dataset.url).toContain("index=ndvi");
    expect(within(right).getByText("Healthy")).toBeInTheDocument();
    expect(within(right).getByText("Stressed")).toBeInTheDocument();
    // A calibrated index needs no apology.
    expect(within(right).queryByText(/Visible-light proxy/)).toBeNull();
  });
});

describe("when a flight did not cover the view", () => {
  it("says so, in that pane, naming the flight", async () => {
    renderCompare();
    await settle();
    const [left, right] = paneRoots();

    // The right scan's extent is disjoint from the shared view; the left covers it.
    await waitFor(() =>
      expect(within(right).getByText("No imagery here")).toBeInTheDocument());
    expect(within(right).getByText(/The Jun 15, 2026 flight did not cover/)).toBeInTheDocument();
    expect(within(left).queryByText("No imagery here")).toBeNull();
  });
});

describe("what compare must never do", () => {
  it("only ever reads: GET requests, and no path to the database at all", async () => {
    renderCompare();
    await settle();
    const [left, right] = paneRoots();

    // Use the view the way an operator would.
    act(() => maps[0].userPan(45.02, -93.03, 17));
    fireEvent.click(within(left).getByRole("button", { name: /rgb/i }));
    fireEvent.click(within(left).getByRole("button", { name: /VARI \(RGB\)/ }));
    fireEvent.click(within(right).getByRole("button", { name: /rgb/i }));
    fireEvent.click(within(right).getByRole("button", { name: /^NDVI/ }));
    fireEvent.click(screen.getByRole("button", { name: /swipe/i }));

    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) expect(r.method).toBe("GET");
    expect(dbTouched).not.toHaveBeenCalled();
  });
});
