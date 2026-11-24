// The Plots card with the account (2026-11-24): drawing waits while this device's plots and the account's are
// brought together, then the card says where the plots are kept; with no account record, the device only.
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { render, screen, waitFor } from "@testing-library/react";
import { PlotWorkbench } from "@/components/app/fieldTwin/PlotTools";
import { type AccountPlot, type PlotBackend } from "@/lib/fieldTwin/plotSync";
import { savePlots } from "@/lib/fieldTwin/plotStore";
import { plotContext } from "@/lib/fieldTwin/plots";
import { localFrame } from "@/lib/fieldTwin/rowEdits";
import { FIELD_TWIN_FORMAT, type LatLngPair, type TwinBundle, type TwinCornRow } from "@/lib/fieldTwin/types";

const LAT = 31.58, LNG = -83.586, S = 0.76, f = localFrame(LAT, LNG), at = (e: number, n: number) => f.toLL(e, n);
function twin(): TwinBundle {
  const points: LatLngPair[] = [], certainty: number[] = [], rows: TwinCornRow[] = [];
  for (let row = 1; row <= 3; row++) {
    for (let i = 0; i <= 50; i++) { points.push(at(i * 0.2, row * S)); certainty.push(0); }
    rows.push({ id: row, status: "corn", line: [at(0, row * S), at(10, row * S)], lengthM: 10, seenBy: 0, cornBy: 0, coveredBy: 0, why: "Plants seen along it.", row, plants: 51 });
  }
  return {
    format: FIELD_TWIN_FORMAT, id: "card", name: "Card", builtAt: "test",
    source: { photographs: 2, camera: "test", capturedAt: null, groundPixelCm: 0.6, method: "test", weedModel: "none", treeModel: "none" },
    origin: { lat: LAT, lng: LNG }, bounds: [at(-5, -5), at(15, 8)], field: { rowDirectionDeg: 0, rowSpacingM: S, plantSpacingM: 0.2 },
    footprints: [], rows: [], trees: [], inferredTrees: [], weeds: [], vegetation: [], atlases: [], stats: {},
    corn: {
      version: 1, engine: "test", enteredCrop: "corn", rowSpacingM: S, rowDirectionDeg: 0, rowAgreementM: 0.01,
      photographs: { read: 2, withRows: 2, failed: [] }, rows, weeds: [], gaps: [],
      plants: { points, certainty, photos: points.map(() => 2), note: "test", summary: { plants: points.length, certain: points.length, probable: 0, onNoRow: 0, betweenRows: 0, confirmedM: 30, notConfirmedM: 0 } },
      summary: { cornRows: 3, unconfirmedRows: 0, cornRowLengthM: 30, offLatticeDropped: 0, weeds: { confirmed: 0, unconfirmed: 0, contested: 0 }, gaps: { confirmed: 0, withheld: 0, confirmedLengthM: 0 }, perPhoto: { weedCandidates: 0, standGaps: 0, rows: 0 } },
      notes: ["Review-only."],
    },
  };
}
const ctx = plotContext(twin())!;
const ring: LatLngPair[] = [at(1, 0.5), at(5, 0.5), at(5, 2.5), at(1, 2.5)];
const inAccount: AccountPlot = { uid: "p1", number: 1, name: "UMD Plot", colour: "#ba68c8", ring, shape: { tool: "polygon" }, drawn_at: "2026-11-23T10:00:00Z", edited_at: "2026-11-23T10:00:00Z", deleted_at: null };

afterEach(() => localStorage.clear());

describe("the Plots card with the account", () => {
  it("waits while it loads, then lists the account's plots and says they are in the account", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>(r => { release = r; });
    const backend: PlotBackend = { list: async () => { await gate; return [inAccount]; }, put: async () => undefined };
    render(<PlotWorkbench map={null} ctx={ctx} twinId="card" onBusy={() => undefined} account="f0000000-1111-4000-8000-000000000001" backend={backend} />);
    expect(screen.getByRole("status").textContent).toMatch(/Loading your plots from your account/);
    for (const b of screen.getByRole("group", { name: "Draw a plot" }).querySelectorAll("button")) expect((b as HTMLButtonElement).disabled).toBe(true);
    release();
    await waitFor(() => expect(screen.getByText("UMD Plot")).toBeTruthy());
    expect(screen.getByText(/Saved in your account: the same plots on every device/)).toBeTruthy();
    for (const b of screen.getByRole("group", { name: "Draw a plot" }).querySelectorAll("button")) expect((b as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps showing this device's plots, and says why, when the account cannot be reached", async () => {
    savePlots("card", [{ uid: "d1", number: 1, name: "Wet corner", colour: "#81c784", ring, shape: { tool: "polygon" }, at: "2026-11-23T10:00:00Z", updatedAt: "2026-11-23T10:00:00Z" }]);
    const backend: PlotBackend = { list: async () => { throw new Error("Failed to fetch"); }, put: async () => undefined };
    render(<PlotWorkbench map={null} ctx={ctx} twinId="card" onBusy={() => undefined} account="f0000000-1111-4000-8000-000000000001" backend={backend} />);
    await waitFor(() => expect(screen.getByText(/Kept on this device: your account could not be reached/)).toBeTruthy());
    expect(screen.getByText("Wet corner")).toBeTruthy();
  });

  it("without the twin's record in the account, keeps plots on this device only and never calls the account", async () => {
    const list = vi.fn(async () => [inAccount]);
    render(<PlotWorkbench map={null} ctx={ctx} twinId="card" onBusy={() => undefined} backend={{ list, put: async () => undefined }} />);
    expect(screen.getByText(/Saved on this device, in ground coordinates/)).toBeTruthy();
    expect(list).not.toHaveBeenCalled();
  });
});
