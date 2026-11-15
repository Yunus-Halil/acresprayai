// Photo ground in the viewer: the founder's own account only (photoGroundFlag.ts). For everyone else (a participant,
// the founder previewing as one, an account still loading, a deployed build with the developer's switch set, any
// build with the kill switch) a twin with an overview opens exactly as a twin without one: no Photographs panel, no
// evidence section, the geometry-only key. For the founder: the panel, the photographs behind a selected finding
// (asking for the flight's files on this device, never uploading them), a plant that can be tapped, and a key that
// says what is drawn over the photographs.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import L from "leaflet";
import FieldTwinView from "@/components/app/fieldTwin/FieldTwinView";
import TwinInspector from "@/components/app/fieldTwin/TwinInspector";
import { buildScene } from "@/lib/fieldTwin/scene";
import { DETAIL_PRESETS } from "@/lib/fieldTwin/style";
import { GROUND_FORMAT, type GroundManifest } from "@/lib/fieldTwin/photoGround";
import { photoGroundAllowed, photoGroundDevFlag } from "@/lib/fieldTwin/photoGroundFlag";
import type { PilotRole } from "@/lib/pilot/access";
import { CORN_TWIN } from "./fixtures/cornTwin";

// The role the app shows: the founder's preview shows "participant" (access.tsx).
let role: PilotRole | null = null;
vi.mock("@/lib/pilot/access", () => ({ usePilotRole: () => role }));

beforeAll(() => {
  L.Map.prototype.flyTo = function (this: L.Map, c: L.LatLngExpression, z?: number) { return this.setView(c, z ?? this.getZoom(), { animate: false }); } as typeof L.Map.prototype.flyTo;
  HTMLCanvasElement.prototype.getContext = function () {
    const store: Record<string | symbol, unknown> = {};
    return new Proxy(store, { get: (t, k) => (k in t ? t[k] : () => ({})), set: (t, k, v) => { t[k] = v; return true; } }) as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => { vi.unstubAllEnvs(); role = null; });

const manifest: GroundManifest = {
  format: GROUND_FORMAT, twinId: CORN_TWIN.id, rule: "nearest nadir", featherM: 0.6, origin: [40, -90],
  overview: { zoom: 22, minZoom: 15, pixelCm: 3, tiles: 1, bytes: 1, source: "the photographs' previews" },
  detail: { zoom: 24, minZoom: 23, pixelCm: 0.8 }, frames: [], gains: [], timings: { previewsMs: 0, gainsMs: 0, tilesMs: 0, totalMs: 0 }, note: "Laid on flat ground.",
};
const ground = { manifest, overview: vi.fn(async () => null) };
const close = async (r: { unmount: () => void }) => { await new Promise(f => setTimeout(f, 100)); r.unmount(); await new Promise(f => setTimeout(f, 50)); };
const view = () => <div style={{ width: 1200, height: 800 }}><FieldTwinView twin={CORN_TWIN} atlasUrl={async () => ""} ground={ground} /></div>;

describe("who sees photo ground", () => {
  it("the founder's own account, in any build; nobody else unless a development build says so", () => {
    const deployed = { DEV: false }, dev = { DEV: true };
    expect(photoGroundAllowed("founder", deployed)).toBe(true);
    expect(photoGroundAllowed("participant", deployed)).toBe(false);
    expect(photoGroundAllowed(null, deployed)).toBe(false);
    // The developer's switch is ignored by a deployed build: it can never turn it on for participants.
    expect(photoGroundAllowed("participant", { ...deployed, VITE_FIELD_TWIN_PHOTO_GROUND: "1" })).toBe(false);
    expect(photoGroundDevFlag({ ...deployed, VITE_FIELD_TWIN_PHOTO_GROUND: "1" })).toBe(false);
    expect(photoGroundAllowed("participant", { ...dev, VITE_FIELD_TWIN_PHOTO_GROUND: "1" })).toBe(true);
    expect(photoGroundAllowed(null, dev)).toBe(false);
    // The kill switch: off for everyone, the founder too.
    expect(photoGroundAllowed("founder", { ...deployed, VITE_FIELD_TWIN_PHOTO_GROUND: "0" })).toBe(false);
    expect(photoGroundAllowed("founder", { ...dev, VITE_FIELD_TWIN_PHOTO_GROUND: "0" })).toBe(false);
  });

  for (const [who, r] of [["a participant", "participant"], ["the founder previewing as a participant", "participant"], ["an account whose role is still loading", null]] as const) {
    it(`${who}: a twin with an overview opens as the geometry-only twin, with nothing about photographs`, async () => {
      role = r;
      const rendered = render(view());
      expect(screen.queryByRole("group", { name: "Photographs" })).toBeNull();
      expect(screen.getByText("Not photographed")).toBeInTheDocument();
      fireEvent.click(within(screen.getByRole("group", { name: "Corn" })).getByText("Weed 1"));
      expect(screen.queryByRole("region", { name: "Every photograph that saw it" })).toBeNull();
      expect(ground.overview).not.toHaveBeenCalled();
      await close(rendered);
    });
  }

  it("the kill switch hides it from the founder too", async () => {
    role = "founder";
    vi.stubEnv("VITE_FIELD_TWIN_PHOTO_GROUND", "0");
    const rendered = render(view());
    expect(screen.queryByRole("group", { name: "Photographs" })).toBeNull();
    expect(ground.overview).not.toHaveBeenCalled();
    await close(rendered);
  });

  it("the founder: the Photographs panel, a key for what is drawn over them, and the photographs behind a finding", async () => {
    role = "founder";
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

describe("a twin opened again", () => {
  it("over the photographs, the field edge estimated from the rows is hidden by default and can be shown from Diagnostics", async () => {
    role = "founder";
    for (const stop of ["simple", "standard", "full"] as const) expect(DETAIL_PRESETS[stop].rowsEdgeOverPhotos).toBe(false);
    const r = render(view());
    fireEvent.click(screen.getByRole("button", { name: "Full" }));
    fireEvent.click(screen.getByRole("button", { name: /Diagnostics/ }));
    const edge = screen.getByRole("checkbox", { name: /Field edge from the rows, over the photographs/ });
    expect(edge).not.toBeChecked();
    fireEvent.click(edge);
    expect(screen.getByRole("checkbox", { name: /Field edge from the rows, over the photographs/ })).toBeChecked();
    // Without the photographs under the twin the edge is drawn as always, and the switch is not offered.
    fireEvent.click(within(screen.getByRole("group", { name: "Photographs" })).getByRole("checkbox", { name: /The flight's photographs/ }));
    expect(screen.queryByRole("checkbox", { name: /Field edge from the rows, over the photographs/ })).toBeNull();
    await close(r);
  });

  it("the founder is told why there are no photographs under it; a participant is told nothing", async () => {
    role = "founder";
    const reopened = () => <div style={{ width: 1200, height: 800 }}><FieldTwinView twin={CORN_TWIN} atlasUrl={async () => ""} groundAbsent /></div>;
    let r = render(reopened());
    expect(within(screen.getByRole("group", { name: "Photographs" })).getByText(/Shown only in the tab that built this twin: nothing of them is kept/)).toBeInTheDocument();
    await close(r);
    role = "participant";
    r = render(reopened());
    expect(screen.queryByRole("group", { name: "Photographs" })).toBeNull();
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
