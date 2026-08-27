// The Log Flight dialog may only claim what actually persisted.
//
// The bug this pins: the primary insert failed, the snapshot fallback ALSO
// failed (same dead connection), and the dialog still toasted "Mission saved
// to field" — a pilot standing in a no-signal field was told their compliance
// record saved while nothing persisted anywhere. Now: success only after a
// CONFIRMED write, an explicit "Not saved" state that keeps every typed value,
// an up-front offline check, and a local draft that survives a closed tab.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { getUser, fromMock, insertSpy, toastSuccess, toastError, toastWarning } = vi.hoisted(() => ({
  getUser: vi.fn(),
  fromMock: vi.fn(),
  insertSpy: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser }, from: fromMock },
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError, warning: toastWarning, info: vi.fn() },
}));

import L from "leaflet";
(globalThis as { L?: typeof L }).L = L;
const { LogFlightModal } = await import("@/components/app/workspace/SettingsTab");
import { setUnitSystem } from "@/hooks/useUnitSystem";

const ZONES = [
  { id: "z1", label: "Zone 1", issue: null, acres: 2.0 },
  { id: "z2", label: "Zone 2", issue: null, acres: 1.1 },
];

function renderModal(over: Partial<{ onSaved: ReturnType<typeof vi.fn>; open: boolean }> = {}) {
  const onSaved = over.onSaved ?? vi.fn();
  const onOpenChange = vi.fn();
  const view = render(
    <LogFlightModal
      open={over.open ?? true}
      onOpenChange={onOpenChange}
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
      center={null}
      conditionLimits={null}
      onSaved={onSaved}
    />,
  );
  return { onSaved, onOpenChange, view };
}

const volumeInput = () => screen.getByPlaceholderText(/plan estimated|e\.g\./i) as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: /save flight log/i });

const insertFails = () => insertSpy.mockImplementation(() => ({
  select: () => ({ single: () => Promise.resolve({ data: null, error: { message: "Failed to fetch" } }) }),
}));
const insertSucceeds = () => insertSpy.mockImplementation((row: Record<string, unknown>) => ({
  select: () => ({ single: () => Promise.resolve({ data: { ...row, id: "log-1", created_at: "2026-08-27T01:00:00Z" }, error: null }) }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  setUnitSystem("imperial");
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
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

describe("when nothing persists, nothing claims to", () => {
  it("insert fails AND the fallback fails: explicit Not saved, values kept, no success toast", async () => {
    insertFails();
    const onSaved = vi.fn().mockResolvedValue(false); // fallback write did NOT land
    const { onOpenChange } = renderModal({ onSaved });

    fireEvent.change(volumeInput(), { target: { value: "4.4" } });
    fireEvent.click(saveButton());

    expect(await screen.findByText(/Not saved/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing was saved/i)).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
    // The dialog stays open with every typed value in place — no retyping 17 fields.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(volumeInput().value).toBe("4.4");
  });

  it("insert fails but the fallback lands: success names the degraded path", async () => {
    insertFails();
    const onSaved = vi.fn().mockResolvedValue(true);
    const { onOpenChange } = renderModal({ onSaved });

    fireEvent.click(saveButton());

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastSuccess.mock.calls[0][0]).toMatch(/saved to field/i);
    expect(String(toastSuccess.mock.calls[0][1]?.description)).toMatch(/could not be written/i);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("insert succeeds but the field summary fails: logged, with the gap named", async () => {
    insertSucceeds();
    const onSaved = vi.fn().mockResolvedValue(false);
    renderModal({ onSaved });

    fireEvent.click(saveButton());

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastSuccess.mock.calls[0][0]).toMatch(/flight logged/i);
    expect(toastWarning).toHaveBeenCalled();
    expect(toastWarning.mock.calls[0][0]).toMatch(/field summary did not update/i);
  });

  it("offline is detected up front — no write attempted, failure said plainly", async () => {
    insertSucceeds();
    const spy = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    renderModal();

    fireEvent.click(saveButton());

    expect(await screen.findByText(/appear to be offline/i)).toBeInTheDocument();
    expect(insertSpy).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("the local draft survives a closed dialog", () => {
  it("typing writes a draft; reopening restores it and says so", async () => {
    const first = renderModal();
    fireEvent.change(volumeInput(), { target: { value: "7.2" } });
    await waitFor(() =>
      expect(localStorage.getItem("swathwise:flight-draft:scan-1")).not.toBeNull(),
    );
    first.view.unmount();

    renderModal();
    expect(await screen.findByText(/Restored your unsent entries/i)).toBeInTheDocument();
    expect(volumeInput().value).toBe("7.2");
  });

  it("a confirmed save clears the draft", async () => {
    insertSucceeds();
    const { onOpenChange } = renderModal();
    fireEvent.change(volumeInput(), { target: { value: "7.2" } });
    await waitFor(() =>
      expect(localStorage.getItem("swathwise:flight-draft:scan-1")).not.toBeNull(),
    );

    fireEvent.click(saveButton());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(localStorage.getItem("swathwise:flight-draft:scan-1")).toBeNull();
  });

  it("discarding the draft resets to honest defaults", async () => {
    localStorage.setItem("swathwise:flight-draft:scan-1", JSON.stringify({
      dateFlown: "2026-08-20", batteryEnd: 40, refills: 1,
      completed: ["z1"], notes: "wind picked up", volumeIn: "9.9",
      rec: {}, savedAt: "2026-08-20T20:00:00Z",
    }));
    renderModal();
    expect(await screen.findByText(/Restored your unsent entries/i)).toBeInTheDocument();
    expect(volumeInput().value).toBe("9.9");

    fireEvent.click(screen.getByRole("button", { name: /discard draft/i }));
    expect(volumeInput().value).toBe("");
    expect(localStorage.getItem("swathwise:flight-draft:scan-1")).toBeNull();
    expect(screen.queryByText(/Restored your unsent entries/i)).toBeNull();
  });

  it("a failed save leaves the draft in place for the retry", async () => {
    insertFails();
    const onSaved = vi.fn().mockResolvedValue(false);
    renderModal({ onSaved });
    fireEvent.change(volumeInput(), { target: { value: "4.4" } });
    fireEvent.click(saveButton());

    await screen.findByText(/Not saved/i);
    expect(localStorage.getItem("swathwise:flight-draft:scan-1")).not.toBeNull();
  });
});
