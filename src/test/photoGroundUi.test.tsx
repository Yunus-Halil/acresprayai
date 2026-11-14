// Photo ground in the viewer: behind its flag. Off (the default), a twin with an overview opens exactly as a twin without
// one: no Photographs panel, no evidence section, the geometry-only key. On: the panel, the photographs behind a selected
// finding (asking for the flight's files on this device, never uploading them), a plant that can be tapped, and a key
// that says what is drawn over the photographs.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import L from "leaflet";
import FieldTwinView from "@/components/app/fieldTwin/FieldTwinView";
import TwinInspector from "@/components/app/fieldTwin/TwinInspector";
import { buildScene } from "@/lib/fieldTwin/scene";
import { GROUND_FORMAT, type GroundManifest } from "@/lib/fieldTwin/photoGround";
import { photoGroundEnabled } from "@/lib/fieldTwin/photoGroundFlag";
import { CORN_TWIN } from "./fixtures/cornTwin";

beforeAll(() => {
  L.Map.prototype.flyTo = function (this: L.Map, c: L.LatLngExpression, z?: number) { return this.setView(c, z ?? this.getZoom(), { animate: false }); } as typeof L.Map.prototype.flyTo;
  HTMLCanvasElement.prototype.getContext = function () {
    const store: Record<string | symbol, unknown> = {};
    return new Proxy(store, { get: (t, k) => (k in t ? t[k] : () => ({})), set: (t, k, v) => { t[k] = v; return true; } }) as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => { vi.unstubAllEnvs(); });

const manifest: GroundManifest = {
  format: GROUND_FORMAT, twinId: CORN_TWIN.id, rule: "nearest nadir", featherM: 0.6, origin: [40, -90],
  overview: { zoom: 22, minZoom: 15, pixelCm: 3, tiles: 1, bytes: 1, source: "the photographs' previews" },
  detail: { zoom: 24, minZoom: 23, pixelCm: 0.8 }, frames: [], gains: [], timings: { previewsMs: 0, gainsMs: 0, tilesMs: 0, totalMs: 0 }, note: "Laid on flat ground.",
};
const ground = { manifest, overview: vi.fn(async () => null) };
const close = async (r: { unmount: () => void }) => { await new Promise(f => setTimeout(f, 100)); r.unmount(); await new Promise(f => setTimeout(f, 50)); };
const view = () => <div style={{ width: 1200, height: 800 }}><FieldTwinView twin={CORN_TWIN} atlasUrl={async () => ""} ground={ground} /></div>;

describe("photo ground's flag", () => {
  it("is off unless the deployment says so", () => {
    expect(photoGroundEnabled()).toBe(false);
    vi.stubEnv("VITE_FIELD_TWIN_PHOTO_GROUND", "1");
    expect(photoGroundEnabled()).toBe(true);
  });

  it("off: a twin with an overview opens as the geometry-only twin, with nothing about photographs", async () => {
    const r = render(view());
    expect(screen.queryByRole("group", { name: "Photographs" })).toBeNull();
    expect(screen.getByText("Not photographed")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("group", { name: "Corn" })).getByText("Weed 1"));
    expect(screen.queryByRole("region", { name: "Every photograph that saw it" })).toBeNull();
    expect(ground.overview).not.toHaveBeenCalled();
    await close(r);
  });

  it("on: the Photographs panel, a key for what is drawn over them, and the photographs behind a finding", async () => {
    vi.stubEnv("VITE_FIELD_TWIN_PHOTO_GROUND", "1");
    const r = render(view());
    const panel = screen.getByRole("group", { name: "Photographs" });
    expect(within(panel).getByRole("checkbox", { name: /The flight's photographs/ })).toBeChecked();
    expect(within(panel).getByText(/Open the flight's photographs/)).toBeInTheDocument();
    expect(screen.getByText("Dark: not photographed")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("group", { name: "Corn" })).getByText("Weed 1"));
    const ev = screen.getByRole("region", { name: "Every photograph that saw it" });
    expect(within(ev).getByText(/every photograph that saw it/)).toBeInTheDocument();
    expect(within(ev).getByText("Read on this device only, never uploaded.")).toBeInTheDocument();
    // Turned off, the twin is drawn as without photographs, and the key says so again.
    fireEvent.click(within(panel).getByRole("checkbox", { name: /The flight's photographs/ }));
    expect(screen.getByText("Not photographed")).toBeInTheDocument();
    await close(r);
  });
});

describe("a plant, selected", () => {
  it("says what it is drawn as and how many photographs located it, never a stand count", () => {
    const plants = { points: [[40.00005, -90] as [number, number]], certainty: [1], photos: [4] };
    render(<TwinInspector twin={CORN_TWIN} scene={buildScene(CORN_TWIN)} selection={{ kind: "plant", index: 0, lat: 40.00005, lng: -90 }} plants={plants} atlasUrl={async () => ""} onClose={() => undefined} />);
    expect(screen.getByText("Plant on a row, probable")).toBeInTheDocument();
    expect(screen.getByText("4 photographs")).toBeInTheDocument();
    expect(screen.getByText(/not a stand count/)).toBeInTheDocument();
  });
});
