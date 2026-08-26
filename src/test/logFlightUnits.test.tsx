// The Log Flight dialog speaks the operator's units, and stores canonical.
//
// The bug: the volume field was hardcoded "(L)" and stored the typed number as
// litres regardless of the unit preference. An imperial operator typed 4.4 —
// into a box the rest of their app had trained them to read as gallons — and
// the report read it back as 1.16 gal. A number nobody entered, on a document
// kept as a legal application record.
//
// The invariant: what is SHOWN and TYPED follows the preference; what is
// STORED is always litres and acres.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { L_PER_US_GAL } from "@/lib/units";

const { getUser, fromMock, insertSpy } = vi.hoisted(() => ({
  getUser: vi.fn(),
  fromMock: vi.fn(),
  insertSpy: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser }, from: fromMock },
}));

// SettingsTab drags in leaflet-geoman, which reads the Leaflet global at
// module init — so Leaflet must be on globalThis BEFORE the import runs.
import L from "leaflet";
(globalThis as { L?: typeof L }).L = L;
const { LogFlightModal } = await import("@/components/app/workspace/SettingsTab");
import { setUnitSystem } from "@/hooks/useUnitSystem";

const ZONES = [
  { id: "z1", label: "Zone 1", issue: "Weed pressure", acres: 2.0 },
  { id: "z2", label: "Zone 2", issue: null, acres: 1.1 },
];

function renderModal() {
  const onSaved = vi.fn();
  render(
    <LogFlightModal
      open
      onOpenChange={vi.fn()}
      fieldId="field-1"
      scanId="scan-1"
      droneId={null}
      droneName={null}
      batteryStart={100}
      zones={ZONES}
      totalAcres={3.1}
      estLiters={20}
      recordDefaults={null}
      baselineRateLha={25}
      onSaved={onSaved}
    />,
  );
  return { onSaved };
}

/** The insert payload the dialog sent to flight_logs. */
const savedRow = () => insertSpy.mock.calls[0]?.[0] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  insertSpy.mockImplementation(() => ({
    select: () => ({ single: () => Promise.resolve({ data: null, error: { message: "no row" } }) }),
  }));
  fromMock.mockImplementation(() => {
    const builder: Record<string, unknown> = {
      insert: insertSpy,
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      select: () => builder,
      eq: () => builder,
    };
    return builder;
  });
});

describe("imperial operator", () => {
  beforeEach(() => setUnitSystem("imperial"));

  it("labels the volume field in gallons, not litres", () => {
    renderModal();
    expect(screen.getByText(/Volume applied \(gal\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/Volume applied \(L\)/)).toBeNull();
  });

  it("stores a typed gallon figure as litres, so the report reads back what was entered", async () => {
    const { onSaved } = renderModal();
    const input = screen.getByPlaceholderText(/plan estimated|e\.g\./i);
    fireEvent.change(input, { target: { value: "4.4" } });
    fireEvent.click(screen.getByRole("button", { name: /save flight log/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // 4.4 gal → 16.66 L stored. Read back through the report's gallon
    // formatting, that is 4.4 gal again — the round trip the bug broke.
    const stored = savedRow().liters_applied as number;
    expect(stored).toBeCloseTo(4.4 * L_PER_US_GAL, 2);
    expect(stored / L_PER_US_GAL).toBeCloseTo(4.4, 2);
    // The old behaviour stored the raw 4.4 and displayed 1.16 gal.
    expect(stored).not.toBeCloseTo(4.4, 2);
  });

  it("shows the plan's estimate in gallons too", () => {
    renderModal();
    // estLiters 20 over the full 3.1 ac at 0 refills ≈ 20 L ≈ 5.3 gal.
    const input = screen.getByPlaceholderText(/plan estimated/i) as HTMLInputElement;
    expect(input.placeholder).toMatch(/gal/);
    expect(input.placeholder).not.toMatch(/\bL\b/);
  });

  it("still stores treated area in acres, the canonical unit", async () => {
    const { onSaved } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /save flight log/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(savedRow().acres_treated).toBeCloseTo(3.1, 2);
  });
});

describe("metric operator", () => {
  beforeEach(() => setUnitSystem("metric"));

  it("labels the volume field in litres and stores the number unchanged", async () => {
    expect(screen.queryByText(/Volume applied/)).toBeNull();
    const { onSaved } = renderModal();
    expect(screen.getByText(/Volume applied \(L\)/)).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/plan estimated|e\.g\./i);
    fireEvent.change(input, { target: { value: "12.5" } });
    fireEvent.click(screen.getByRole("button", { name: /save flight log/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(savedRow().liters_applied).toBeCloseTo(12.5, 2);
  });

  it("shows zone and treated areas in hectares, never acres", () => {
    renderModal();
    expect(screen.queryByText(/\bac\b/)).toBeNull();
    expect(screen.getAllByText(/ha\b/).length).toBeGreaterThan(0);
  });
});

describe("impossible input warns at entry, in the operator's units", () => {
  beforeEach(() => setUnitSystem("imperial"));

  it("a volume far above the plan's estimate is challenged while typing, not at report time", async () => {
    renderModal();
    const input = screen.getByPlaceholderText(/plan estimated/i);
    // Plan ≈ 20 L (~5.3 gal); type 40 gal — 7.6× plan.
    fireEvent.change(input, { target: { value: "40" } });

    expect(await screen.findByText(/check before saving/i)).toBeInTheDocument();
    expect(screen.getByText(/ABOVE the planned/)).toBeInTheDocument();
    // And it also cannot fit the tank: 20 L per fill, 0 refills.
    expect(screen.getByText(/exceeds what 1 tank load/)).toBeInTheDocument();
    // Never blocked: the save button stays enabled.
    expect(screen.getByRole("button", { name: /save flight log/i })).toBeEnabled();
  });

  it("an end time before the start time is caught as it is entered", async () => {
    renderModal();
    const times = document.querySelectorAll('input[type="time"]');
    fireEvent.change(times[0], { target: { value: "16:00" } });
    fireEvent.change(times[1], { target: { value: "15:30" } });
    expect(await screen.findByText(/before its start time/)).toBeInTheDocument();
  });

  it("conditions past typical limits are flagged without judging compliance", async () => {
    renderModal();
    const wind = document.querySelector('input[step="0.5"]') as HTMLInputElement;
    fireEvent.change(wind, { target: { value: "11" } });
    const note = await screen.findByText(/outside typical application conditions/i);
    expect(note.textContent).toMatch(/verify against the product label/i);
  });
});

describe("an empty volume field stays empty", () => {
  beforeEach(() => setUnitSystem("imperial"));

  it("stores null rather than a zero or the plan's estimate", async () => {
    const { onSaved } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /save flight log/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(savedRow().liters_applied).toBeNull();
  });
});
