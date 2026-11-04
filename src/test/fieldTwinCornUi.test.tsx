// Corn in the Field Twin viewer: the inspector for each corn object (state, what the photographs said, the crops),
// and the corn panel on the open twin (counts, the local-placement warning, the review list opening the inspector,
// the layer for observations the photographs do not confirm).
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import L from "leaflet";
import TwinInspector from "@/components/app/fieldTwin/TwinInspector";
import FieldTwinView from "@/components/app/fieldTwin/FieldTwinView";
import { buildScene } from "@/lib/fieldTwin/scene";
import { CORN_TWIN } from "./fixtures/cornTwin";

beforeAll(() => {
  // Clicking a finding flies the map to it; jsdom has no animation frames to finish the flight before the test
  // unmounts, so the map jumps instead.
  L.Map.prototype.flyTo = function (this: L.Map, c: L.LatLngExpression, z?: number) { return this.setView(c, z ?? this.getZoom(), { animate: false }); } as typeof L.Map.prototype.flyTo;
  HTMLCanvasElement.prototype.getContext = function () {
    const store: Record<string | symbol, unknown> = {};
    return new Proxy(store, { get: (t, k) => (k in t ? t[k] : () => ({})), set: (t, k, v) => { t[k] = v; return true; } }) as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

const scene = buildScene(CORN_TWIN);

describe("the corn inspector", () => {
  it("shows a confirmed weed candidate with what each photograph said and a crop from one of them", async () => {
    const atlas = vi.fn(async () => "blob:atlas-0");
    render(<TwinInspector twin={CORN_TWIN} scene={scene} selection={{ kind: "cornWeed", id: 1 }} atlasUrl={atlas} onClose={() => undefined} />);
    expect(screen.getByText("Weed candidate, confirmed")).toBeInTheDocument();
    expect(screen.getByText("What the photographs said")).toBeInTheDocument();
    expect(screen.getByText("746, 747, 748")).toBeInTheDocument();
    expect(await screen.findByAltText("Crop of 746")).toHaveAttribute("src", "blob:atlas-0");
    expect(screen.getByText(/not a treatment decision/)).toBeInTheDocument();
  });

  it("keeps an unconfirmed observation inspectable and says why it is not confirmed", () => {
    render(<TwinInspector twin={CORN_TWIN} scene={scene} selection={{ kind: "cornWeed", id: 2 }} atlasUrl={async () => ""} onClose={() => undefined} />);
    expect(screen.getByText("Weed candidate, not confirmed")).toBeInTheDocument();
    expect(screen.getByText(/only 1 of the 3 photographs/)).toBeInTheDocument();
    expect(screen.getByText("No photograph crops were kept for this object.")).toBeInTheDocument();
  });

  it("shows a withheld gap with the photograph that saw a plant inside it", () => {
    render(<TwinInspector twin={CORN_TWIN} scene={scene} selection={{ kind: "cornGap", id: 1 }} atlasUrl={async () => ""} onClose={() => undefined} />);
    expect(screen.getByText("Stand gap, withheld")).toBeInTheDocument();
    expect(screen.getByText("Located a plant inside it").nextSibling?.textContent).toBe("747");
  });

  it("names a row the photographs do not confirm", () => {
    render(<TwinInspector twin={CORN_TWIN} scene={scene} selection={{ kind: "cornRow", id: 2 }} atlasUrl={async () => ""} onClose={() => undefined} />);
    expect(screen.getByText("Row 2, crop not confirmed")).toBeInTheDocument();
    expect(screen.getByText("1 of the 3 photographs covering it")).toBeInTheDocument();
  });
});

describe("the corn panel on the open twin", () => {
  it("shows the counts and the local placement, and opens the inspector from the review list", async () => {
    const view = render(<div style={{ width: 1200, height: 800 }}><FieldTwinView twin={CORN_TWIN} atlasUrl={async () => ""} /></div>);
    const panel = screen.getByRole("group", { name: "Corn" });
    expect(within(panel).getByText(/Test flight, locally aligned/)).toBeInTheDocument();
    expect(within(panel).getByText("Weeds, confirmed").nextSibling?.textContent).toBe("1");
    // A locally aligned twin's boundary is never offered for operations, and it is never put on real map tiles.
    expect(screen.queryByRole("button", { name: "Accept for operations" })).toBeNull();
    expect(screen.getByText(/cannot be accepted for operations/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByText("Weed 1"));
    const inspector = screen.getByRole("complementary", { name: "Inspector" });
    expect(within(inspector).getByText("Weed candidate, confirmed")).toBeInTheDocument();
    // The unconfirmed list holds the observation the other photographs did not repeat.
    fireEvent.click(within(panel).getByRole("button", { name: /^Unconfirmed 1/ }));
    expect(within(panel).getByText("Unconfirmed 2")).toBeInTheDocument();
    // The layer for observations not confirmed can be switched off.
    const box = within(panel).getByRole("checkbox", { name: /Observations not confirmed/ });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(box).not.toBeChecked();
    // Let the map's pending frames run while it is mounted, then close it.
    await new Promise(r => setTimeout(r, 100));
    view.unmount();
    await new Promise(r => setTimeout(r, 50));
  });
});
