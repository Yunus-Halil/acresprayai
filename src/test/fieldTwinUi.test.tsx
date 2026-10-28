import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FIELD_TWIN_FORMAT, type TwinBundle } from "@/lib/fieldTwin/types";
import TwinInspector from "@/components/app/fieldTwin/TwinInspector";
import { buildScene } from "@/lib/fieldTwin/scene";

// jsdom has no canvas; the twin draws on Leaflet's canvas renderer. A context that accepts every call is enough to
// prove the page builds its layers without throwing.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = function () {
    const store: Record<string | symbol, unknown> = {};
    return new Proxy(store, { get: (t, k) => (k in t ? t[k] : () => ({})), set: (t, k, v) => { t[k] = v; return true; } }) as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

const synthetic: TwinBundle = {
  format: FIELD_TWIN_FORMAT, id: "test-twin", name: "Test", builtAt: "2026-10-26T00:00:00Z",
  source: { photographs: 2, camera: "DJI FC6310R", capturedAt: null, groundPixelCm: 0.98, method: "m", weedModel: "w", treeModel: "t" },
  origin: { lat: 33.88, lng: -5.42 }, bounds: [[33.8799, -5.4201], [33.8801, -5.4199]],
  field: { rowDirectionDeg: 131, rowSpacingM: 5, plantSpacingM: 3.1 },
  footprints: [{ photo: "DJI_0301", ring: [[33.8799, -5.4201], [33.8801, -5.4201], [33.8801, -5.4199], [33.8799, -5.4199]] }],
  rows: [{ id: 1, kept: true, reason: null, line: [[33.8799, -5.42], [33.8801, -5.42]], trees: 5, inferred: 0, photos: 2, lengthM: 20, straightnessSdM: 0.2 }],
  trees: [{ id: 7, lat: 33.88, lng: -5.42, crownRadiusM: 0.9, heightM: 1.1, seenBy: 2, coveredBy: 2, viewSpreadM: 0.07, sizeCv: 0.05, rowId: 1, evidence: [] }],
  inferredTrees: [{ row: 1, lat: 33.88003, lng: -5.42 }],
  weeds: [{ id: 3, lat: 33.88001, lng: -5.41995, status: "verified", rowStatus: "between rows", diameterM: 0.2, areaM2: 0.03, spanM: 0.3, heightM: 0.03, seenBy: 4, coveredBy: 5, viewSpreadM: 0.04, sizeCv: 0.08, score: 0.8, treeId: null, ring: [[33.88001, -5.41995], [33.880012, -5.41995], [33.880012, -5.419948]], evidence: [{ photo: "DJI_0301", atlas: 0, x: 112, y: 0, size: 112, metresAcross: 0.6, poly: [[10, 10], [60, 12], [40, 70]] }] }],
  vegetation: [], atlases: [{ file: "atlas-0.jpg", width: 2016, height: 112 }], stats: {},
};

const scene = buildScene(synthetic);

describe("Field Twin inspector", () => {
  it("shows a weed's status, measurements and the crop of the photograph with its outline", async () => {
    const atlas = vi.fn(async () => "blob:atlas-0");
    const { container } = render(<TwinInspector twin={synthetic} scene={scene} selection={{ kind: "weed", id: 3 }} atlasUrl={atlas} onClose={() => undefined} />);
    expect(screen.getByText("Weed 3")).toBeInTheDocument();
    expect(screen.getByText("4 of 5 photographs that covered it")).toBeInTheDocument();
    expect(screen.getByText("Between the rows")).toBeInTheDocument();
    const img = await screen.findByAltText("Crop of DJI_0301");
    expect(img).toHaveAttribute("src", "blob:atlas-0");
    expect(atlas).toHaveBeenCalledWith(0);
    expect(container.querySelector("polygon")?.getAttribute("points")).toBe("10,10 60,12 40,70");
  });

  it("says plainly when a tree kept no crops, and when nothing is selected", () => {
    const { container } = render(<TwinInspector twin={synthetic} scene={scene} selection={{ kind: "tree", id: 7 }} atlasUrl={async () => ""} onClose={() => undefined} />);
    expect(screen.getByText("Tree 7")).toBeInTheDocument();
    expect(screen.getByText("No photograph crops were kept for this object.")).toBeInTheDocument();
    expect(container.querySelector("[aria-label='Close the inspector']")).not.toBeNull();
  });
});

// The page, signed in as the reviewer, with the account's storage mocked; `state.twin` is what the account holds.
// (The real 10,000-object bundle is checked by parseTwin in fieldTwin.test.ts: jsdom cannot hold its map in memory.)
const state: { twin: TwinBundle } = { twin: synthetic };

const reviewerUser = { id: "user-1", email: "yunushalilerdogan5@gmail.com" };
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: reviewerUser, signOut: () => undefined }) }));
vi.mock("@/lib/fieldTwin/store", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/fieldTwin/store")>()),
  listTwins: vi.fn(async () => [{ id: state.twin.id, updatedAt: null }]),
  loadTwin: vi.fn(async () => state.twin),
  loadAtlas: vi.fn(async () => "blob:atlas"),
}));

async function openPage() {
  const { default: FieldTwin } = await import("@/pages/app/FieldTwin");
  render(<MemoryRouter><FieldTwin /></MemoryRouter>);
  const select = await screen.findByRole("combobox", { name: "Saved twins" });
  await waitFor(() => expect(screen.getByRole("option", { name: state.twin.id })).toBeInTheDocument());
  await act(async () => { fireEvent.change(select, { target: { value: state.twin.id } }); });
  await waitFor(() => expect(screen.getByRole("checkbox", { name: /Crop structure/ })).toBeInTheDocument());
}

describe("Field Twin page", () => {
  it("lists the account's twin, opens it, and every layer switches on and off without errors", async () => {
    state.twin = synthetic;
    await openPage();
    expect(screen.getByLabelText("Field Twin map")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Diagnostics/ })); });
    for (const box of screen.getAllByRole("checkbox")) { await act(async () => { fireEvent.click(box); }); await act(async () => { fireEvent.click(box); }); }
    expect(screen.getAllByText(/Field view|Row view|Plant view|Field Twin/).length).toBeGreaterThan(0);
  });

  it("Explore Findings lists the qualifying objects, selecting one opens it, and the empty state says why", async () => {
    state.twin = synthetic;
    await openPage();
    const mode = screen.getByRole("combobox", { name: "Show" });
    await act(async () => { fireEvent.change(mode, { target: { value: "largest" } }); });
    const list = await screen.findByRole("list", { name: "Findings" });
    expect(list).toHaveTextContent("Weed 3");
    expect(screen.getByLabelText("Findings results")).toHaveTextContent("1 result");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Weed 3/ })); });
    expect(await screen.findByLabelText("Inspector")).toHaveTextContent("Weed 3");
    // A threshold nothing meets: an explicit empty state, with what was excluded.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Close the inspector" })); });
    await act(async () => { fireEvent.change(screen.getByLabelText("Least ground cover, m²"), { target: { value: "5" } }); });
    expect(await screen.findByText("Nothing qualifies.")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Clear filter" })); });
    expect(screen.queryByLabelText("Findings results")).not.toBeInTheDocument();
  });
});
