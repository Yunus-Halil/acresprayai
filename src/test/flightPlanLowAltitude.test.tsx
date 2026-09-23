// Flying low is allowed. Flying low by accident is not.
//
// Yunus almost hit a tree testing at 10 m. The planner had nothing to say about
// it, and it could not have: it draws straight lines across a polygon from an
// aerial outline, with no terrain model, no obstacle data and no forward
// sensing. At 100 m that ignorance is harmless. At 10 m the aircraft is below
// the top of the trees that line most field edges and the ignorance is the
// whole problem.
//
// So this is a confirmation, not a block. A low pass is a legitimate plan and
// refusing it would be the planner overruling the person who can see the field.
// What it must not be is a default someone inherits without noticing.
//
// The tests that matter here are the ones that would catch the warning becoming
// decorative: that the save and the export DO NOT HAPPEN until the operator
// answers, and that cancelling really cancels.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DEFAULT_FLIGHT_PLAN_PARAMS, LOW_ALTITUDE_M, isLowAltitude, lowAltitudeCaution, resolveFlightPlan,
} from "@/lib/flightPlan/generateKmz";
import { type LatLng2, M_PER_DEG_LAT, mPerDegLng } from "@/lib/geo";
import { setUnitSystem } from "@/hooks/useUnitSystem";

const LAT0 = 38.95, LNG0 = -77.45;

const square = (sideM: number): LatLng2[][] => {
  const dLat = sideM / M_PER_DEG_LAT, dLng = sideM / mPerDegLng(LAT0);
  return [[
    { lat: LAT0, lng: LNG0 },
    { lat: LAT0, lng: LNG0 + dLng },
    { lat: LAT0 + dLat, lng: LNG0 + dLng },
    { lat: LAT0 + dLat, lng: LNG0 },
  ]];
};

describe("the low-altitude threshold", () => {
  it("is 20 m, which is roughly 65 ft", () => {
    // Named as a constant because it is a judgement, not a regulation, and a
    // magic 20 buried in a comparison is a judgement nobody can find later.
    expect(LOW_ALTITUDE_M).toBe(20);
    expect(LOW_ALTITUDE_M / 0.3048).toBeCloseTo(65.6, 1);
  });

  it("catches the altitude that nearly hit a tree and leaves normal ones alone", () => {
    expect(isLowAltitude(10)).toBe(true);
    expect(isLowAltitude(19.9)).toBe(true);
    expect(isLowAltitude(20)).toBe(false);
    expect(isLowAltitude(30.48)).toBe(false);
    expect(isLowAltitude(100)).toBe(false);
  });

  it("does not fire on nonsense, which would make it noise", () => {
    // A zero or a half-typed field is not a low flight, and a caution that
    // appears while someone is still typing gets dismissed without reading.
    expect(isLowAltitude(0)).toBe(false);
    expect(isLowAltitude(-5)).toBe(false);
    expect(isLowAltitude(Number.NaN)).toBe(false);
  });

  it("rides on the resolved plan, so every surface reads the same flag", () => {
    const low = resolveFlightPlan(square(200), { ...DEFAULT_FLIGHT_PLAN_PARAMS, altitudeM: 10 });
    const normal = resolveFlightPlan(square(200), { ...DEFAULT_FLIGHT_PLAN_PARAMS, altitudeM: 100 });
    expect(low.lowAltitude).toBe(true);
    expect(normal.lowAltitude).toBe(false);
  });

  it("is a caution and not a blocker", () => {
    // The distinction the whole feature rests on. A blocker disables the
    // button; this does not. If a future change folds one into the other,
    // either low flights become impossible or the warning becomes a label.
    const low = resolveFlightPlan(square(30), { ...DEFAULT_FLIGHT_PLAN_PARAMS, altitudeM: 10 });
    expect(low.lowAltitude).toBe(true);
    expect(low.blocker).toBeNull();
    expect(low.grid.waypoints.length).toBeGreaterThan(0);
  });

  it("still blocks a low plan that is too big to fly, for the other reason", () => {
    // Worth stating, because it is why the area below is a lot and not a
    // field: at 10 m the spacing is 3.75 m, so a 200 m square needs thousands
    // of waypoints and the aircraft accepts 200. The caution and the ceiling
    // are independent, and a low plan can hit both.
    const big = resolveFlightPlan(square(200), { ...DEFAULT_FLIGHT_PLAN_PARAMS, altitudeM: 10 });
    expect(big.lowAltitude).toBe(true);
    expect(big.blocker).toMatch(/waypoints/);
  });

  it("names the hazards and admits what the planner cannot see", () => {
    const text = lowAltitudeCaution("33 ft", "66 ft");
    expect(text).toContain("33 ft");
    expect(text).toContain("66 ft");
    for (const hazard of ["trees", "poles", "wires"]) expect(text).toContain(hazard);
    expect(text).toMatch(/no terrain model/);
    // Decision support, not a prescription: it must not tell them what height
    // to fly instead, which this planner has no basis for.
    expect(text).not.toMatch(/fly at \d/i);
  });
});

// ---------------------------------------------------------------------------
// The gate itself
// ---------------------------------------------------------------------------

const { saveFlightPlan, markExported, listFlightPlans } = vi.hoisted(() => ({
  saveFlightPlan: vi.fn(async () => ({ id: "plan-1" })),
  markExported: vi.fn(async () => {}),
  listFlightPlans: vi.fn(async () => []),
}));
vi.mock("@/lib/flightPlan/repo", () => ({ saveFlightPlan, markExported, listFlightPlans }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// react-leaflet renders a real map into jsdom, which has no layout engine and
// no canvas. The map is not what is under test; the gate is.
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TileLayer: () => null,
  Polygon: () => null,
  Polyline: () => null,
  CircleMarker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Marker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({ setView: vi.fn() }),
}));
vi.mock("@geoman-io/leaflet-geoman-free", () => ({}));

import L from "leaflet";
(globalThis as { L?: typeof L }).L = L;
const { default: FlightPlanModal } = await import("@/components/app/FlightPlanModal");

// A lot, not a field: at 10 m a field-sized boundary exceeds the waypoint
// ceiling and the Download button is disabled for that reason instead, which
// would test nothing about the confirmation.
const BOUNDARY = square(30);
const clicks = { anchor: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  setUnitSystem("metric");
  clicks.anchor = 0;
  // The download is an <a> click, which jsdom will not perform. Counting the
  // clicks is how we see whether a file would have reached the operator.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    clicks.anchor += 1;
  });
  globalThis.URL.createObjectURL = vi.fn(() => "blob:x");
  globalThis.URL.revokeObjectURL = vi.fn();
});

function open(altitudeM: number) {
  return render(
    <FlightPlanModal
      open
      onOpenChange={vi.fn()}
      fieldId="f1"
      fieldName="North vineyard"
      fieldBoundary={BOUNDARY}
      existing={{
        id: "plan-1", fieldId: "f1", name: null, boundary: BOUNDARY,
        params: { ...DEFAULT_FLIGHT_PLAN_PARAMS, altitudeM },
        createdAt: new Date().toISOString(), lastExportedAt: null,
      } as never}
      onSaved={vi.fn()}
    />,
  );
}

describe("the confirmation the operator has to answer", () => {
  it("says nothing at a normal altitude, and saves on the first click", async () => {
    open(100);
    expect(screen.queryByText(/Low altitude/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    await waitFor(() => expect(saveFlightPlan).toHaveBeenCalledTimes(1));
  });

  it("warns on the panel while the operator is still adjusting", () => {
    open(10);
    expect(screen.getByText(/Low altitude/i)).toBeInTheDocument();
    expect(screen.getByText(/This plan flies at 10 m/)).toBeInTheDocument();
  });

  it("speaks the operator's units, like every other figure on the panel", () => {
    // The unit bug that produced the 100 ft / 100 m confusion was in this same
    // panel. A warning that reports metres to someone reading feet is the same
    // failure wearing a hazard colour.
    setUnitSystem("imperial");
    open(10);
    expect(screen.getByText(/This plan flies at 33 ft/)).toBeInTheDocument();
    expect(screen.getByText(/Below about 66 ft/)).toBeInTheDocument();
  });

  it("does not save until the confirmation is answered", async () => {
    open(10);
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    // The thing that matters: nothing has been written yet.
    expect(saveFlightPlan).not.toHaveBeenCalled();
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /I have checked the route, save it/i }));
    await waitFor(() => expect(saveFlightPlan).toHaveBeenCalledTimes(1));
  });

  it("does not build a file until the confirmation is answered", async () => {
    open(10);
    fireEvent.click(screen.getByRole("button", { name: /Download KMZ/i }));
    expect(clicks.anchor).toBe(0);
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /I have checked the route, download it/i }));
    await waitFor(() => expect(clicks.anchor).toBe(1));
  });

  it("cancelling leaves the plan unsaved and unexported", async () => {
    open(10);
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Change the altitude/i }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(saveFlightPlan).not.toHaveBeenCalled();
    expect(clicks.anchor).toBe(0);
  });

  it("asks again for the export after the save was confirmed", async () => {
    // Two different commitments. An acknowledgement of a saved plan is not an
    // acknowledgement of a file somebody is about to fly.
    open(10);
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    fireEvent.click(await screen.findByRole("button", { name: /I have checked the route, save it/i }));
    await waitFor(() => expect(saveFlightPlan).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /Download KMZ/i }));
    expect(clicks.anchor).toBe(0);
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("states the altitude in the confirmation, in the operator's units", async () => {
    open(10);
    fireEvent.click(screen.getByRole("button", { name: /Download KMZ/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Fly at 10 m?");
    expect(dialog).toHaveTextContent(/trees, poles, wires/);
  });
});
