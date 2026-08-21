// The dashboard weather screen, rendered.
//
// The libs underneath are tested separately. What is pinned here is that the
// page ACTUALLY SHOWS their answers: that a field you can spray says so by
// name, that a scheduled mission flying into a gust raises a visible warning,
// and that the operator's unit choice reaches the words on screen.
//
// This exists because three features in a row on this project were built,
// tested and reported as shipped while being unreachable in the running app.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WxDay, WxHour } from "@/lib/weather";

// --- the world outside this page -------------------------------------------

// Leaflet needs a real layout engine; jsdom has none. The map is scenery for
// these assertions, so it is replaced with a chainable no-op.
vi.mock("leaflet", () => {
  // Every method returns the proxy itself, so any chain the page builds works.
  const chain: unknown = new Proxy({}, { get: () => () => chain });
  const L = {
    map: () => ({
      remove: () => {}, flyTo: () => {}, removeLayer: () => {}, addLayer: () => {},
    }),
    tileLayer: () => chain,
    marker: () => chain,
    divIcon: (o: unknown) => o,
    Icon: { Default: { prototype: {}, mergeOptions: () => {} } },
  };
  return { default: L, ...L };
});
vi.mock("leaflet/dist/leaflet.css", () => ({}));

const listMissions = vi.fn();
vi.mock("@/lib/schedule", () => ({ listMissions: (...a: unknown[]) => listMissions(...a) }));

const fetchWeather = vi.fn();
vi.mock("@/lib/weather", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchWeather: (...a: unknown[]) => fetchWeather(...a),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    // No fields come back, so the pins under test are the ones seeded into
    // localStorage below and nothing races them.
    from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }),
  },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import Weather from "@/pages/app/Weather";
import { storageKey } from "@/lib/storage";
import { setUnitSystem } from "@/hooks/useUnitSystem";

// --- fixtures ---------------------------------------------------------------

const HOUR = 3600;
/** Anchored to "now" so the page's own Date.now() lands inside the series. */
const T0 = Math.floor(Date.now() / 1000);

const hour = (over: Partial<WxHour>, i: number): WxHour => ({
  time: T0 + i * HOUR,
  temp_c: 20, feels_c: 20, humidity: 55, wind_kmh: 8, gust_kmh: 12, wind_dir: 180,
  precip_mm: 0, precip_prob: 0, clouds: 10, code: 800, icon: "01d", desc: "Clear",
  ...over,
} as WxHour);

const hours = (n: number, f: (i: number) => Partial<WxHour> = () => ({})) =>
  Array.from({ length: n }, (_, i) => hour(f(i), i));

const day = (i: number): WxDay => ({
  time: T0 + i * 86400, tmin_c: 12, tmax_c: 26, humidity: 55,
  wind_kmh: 9, gust_kmh: 14, precip_mm: 0, precip_prob: 5,
  code: 800, icon: "01d", desc: "Clear",
} as WxDay);

const forecast = (h: WxHour[]) => ({
  savedAt: Date.now(),
  data: { current: h[0], hourly: h, daily: Array.from({ length: 7 }, (_, i) => day(i)) },
});

const CALM = "Calm Acres";
const GUSTY = "Gusty Ridge";

/**
 * Two pinned sites: one flyable, one blown out for the next two days.
 *
 * Stored with the UNFLYABLE one first, deliberately. If the fixture were
 * already in the right order, the ordering test below would pass against a page
 * that does no sorting at all.
 */
function seedFarms() {
  localStorage.setItem(storageKey("farms"), JSON.stringify([
    { id: "field:gusty", name: GUSTY, address: "B", lat: 41, lng: -96, source: "field" },
    { id: "field:calm", name: CALM, address: "A", lat: 40, lng: -95, source: "field" },
  ]));
}

beforeEach(() => {
  localStorage.clear();
  seedFarms();
  // The hook caches the preference in a module variable read at import time, so
  // it has to be moved through its own setter rather than through localStorage.
  setUnitSystem("imperial");
  listMissions.mockResolvedValue([]);
  fetchWeather.mockImplementation(async (lat: number) =>
    lat === 40 ? forecast(hours(48)) : forecast(hours(48, () => ({ gust_kmh: 45, wind_kmh: 38 }))));
});
afterEach(() => { vi.clearAllMocks(); localStorage.clear(); });

// --- the board --------------------------------------------------------------

describe("the field board", () => {
  it("names every pinned field and says which one can be sprayed now", async () => {
    render(<Weather />);

    // The top-ranked field also appears in the detail panel, hence getAllByText.
    expect((await screen.findAllByText(CALM)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(GUSTY).length).toBeGreaterThan(0);

    // The whole point of the screen, in one sentence at the top.
    expect(await screen.findByText(/1 of 2 fields are sprayable right now/i)).toBeInTheDocument();
  });

  it("puts the flyable field above the one that is blown out", async () => {
    render(<Weather />);
    await screen.findByText(/1 of 2 fields/i);

    const items = screen.getAllByRole("listitem")
      .filter(li => within(li).queryByText(CALM) || within(li).queryByText(GUSTY));
    expect(within(items[0]).queryByText(CALM)).toBeTruthy();
  });

  it("says why the unflyable field is unflyable, in the operator's units", async () => {
    render(<Weather />);
    // Sustained wind of 38 km/h is 24 mph, against a 16 km/h (10 mph) limit.
    // An operator should never have to do that conversion themselves.
    expect(await screen.findByText(/24 mph.*10 mph limit/i)).toBeInTheDocument();
  });

  it("states the thresholds it judged against rather than just showing a tick", async () => {
    render(<Weather />);
    expect(await screen.findByText(/Sprayable means/i)).toBeInTheDocument();
    expect(screen.getByText(/not label law/i)).toBeInTheDocument();
  });

  it("tells a field with no window that it has none, rather than staying blank", async () => {
    render(<Weather />);
    expect(await screen.findByText(/No window in the next 3 days/i)).toBeInTheDocument();
  });
});

describe("when a forecast fails", () => {
  it("keeps the field on the board, marked unavailable", async () => {
    // A field that silently vanishes reads as "nothing to do here".
    fetchWeather.mockImplementation(async (lat: number) => {
      if (lat === 41) throw new Error("network down");
      return forecast(hours(48));
    });
    render(<Weather />);

    expect(await screen.findByText(GUSTY)).toBeInTheDocument();
    expect(await screen.findByText(/Forecast unavailable/i)).toBeInTheDocument();
  });
});

// --- scheduled work ---------------------------------------------------------

const scheduled = (over: Record<string, unknown> = {}) => ({
  id: "m1", fieldId: "gusty", scanId: null, flightPlanId: null,
  scheduledAt: new Date((T0 + 4 * HOUR) * 1000).toISOString(),
  location: null, droneId: null, status: "scheduled",
  chemical: null, notes: null, stats: null,
  createdAt: new Date().toISOString(),
  ...over,
});

describe("scheduled missions checked against the forecast", () => {
  it("warns about a mission booked into conditions it cannot fly", async () => {
    listMissions.mockResolvedValue([scheduled()]);
    render(<Weather />);

    expect(await screen.findByText(/1 scheduled mission runs into bad conditions/i)).toBeInTheDocument();
    // Named, so the operator knows which one to move.
    const panel = screen.getByText(/runs into bad conditions/i).closest("div")!;
    expect(within(panel.parentElement!).getAllByText(GUSTY).length).toBeGreaterThan(0);
  });

  it("offers the next clear window instead of only saying no", async () => {
    // Gusty for six hours, then calm: a mission at hour 4 has somewhere to go.
    fetchWeather.mockImplementation(async (lat: number) =>
      lat === 40 ? forecast(hours(48))
                 : forecast(hours(48, i => (i < 6 ? { gust_kmh: 45, wind_kmh: 38 } : {}))));
    listMissions.mockResolvedValue([scheduled()]);
    render(<Weather />);

    expect(await screen.findByText(/Next clear window/i)).toBeInTheDocument();
  });

  it("stays quiet when every scheduled mission is in clear air", async () => {
    // The panel's presence has to mean something, so it must be absent when
    // there is nothing wrong.
    listMissions.mockResolvedValue([scheduled({ fieldId: "calm" })]);
    render(<Weather />);

    await screen.findByText(/1 of 2 fields/i);
    expect(screen.queryByText(/runs into bad conditions/i)).not.toBeInTheDocument();
  });

  it("does not warn about a mission beyond the end of the forecast", async () => {
    // "We cannot know yet" must not be dressed up as either a pass or a fail.
    listMissions.mockResolvedValue([
      scheduled({ scheduledAt: new Date((T0 + 200 * HOUR) * 1000).toISOString() }),
    ]);
    render(<Weather />);

    await screen.findByText(/1 of 2 fields/i);
    expect(screen.queryByText(/runs into bad conditions/i)).not.toBeInTheDocument();
  });

  it("survives the calendar being unavailable", async () => {
    listMissions.mockRejectedValue(new Error("jobs table missing"));
    render(<Weather />);

    expect(await screen.findByText(/1 of 2 fields/i)).toBeInTheDocument();
    expect(screen.queryByText(/runs into bad conditions/i)).not.toBeInTheDocument();
  });
});

// --- units ------------------------------------------------------------------

describe("the unit toggle", () => {
  it("reaches the spray thresholds when the operator picks metric", async () => {
    setUnitSystem("metric");
    render(<Weather />);

    const line = await screen.findByText(/Sprayable means/i);
    expect(line.textContent).toMatch(/km\/h/);
    expect(line.textContent).not.toMatch(/mph/);
  });

  it("reaches them in imperial too", async () => {
    setUnitSystem("imperial");
    render(<Weather />);

    const line = await screen.findByText(/Sprayable means/i);
    expect(line.textContent).toMatch(/mph/);
    expect(line.textContent).not.toMatch(/km\/h/);
  });
});

// --- the radar is still there ----------------------------------------------

describe("the radar", () => {
  it("survived the rebuild, with its playback controls", async () => {
    render(<Weather />);
    expect(await screen.findByRole("button", { name: /pause|play/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/radar frame/i)).toBeInTheDocument();
  });

  it("still lets someone pin a location by hand", async () => {
    const user = userEvent.setup();
    render(<Weather />);

    await user.click(await screen.findByRole("button", { name: /pin a location/i }));
    expect(screen.getByPlaceholderText(/North Quadrant/i)).toBeInTheDocument();
  });
});
