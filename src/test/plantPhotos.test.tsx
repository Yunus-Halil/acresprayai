// The founder's photographs of a selected corn plant (PlantPhotos.tsx): every photograph that saw it, cut on demand
// from the flight's own files on this device, with the plants located around it ringed on a row or off the rows. Only
// where the page passes `plantPhotos` (photo ground's rule: the founder); a participant's plant shows what it always did.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import L from "leaflet";
import FieldTwinView from "@/components/app/fieldTwin/FieldTwinView";
import PlantPhotos, { PLANT_PHOTOS, plantNeighbours } from "@/components/app/fieldTwin/PlantPhotos";
import { cameraSource } from "@/lib/fieldTwin/plantCameras";
import { viewsOf } from "@/lib/fieldTwin/photoGround";
import { IDENTITY, enuFromCamera, mulM, type GeorefFrame, type M3 } from "@/lib/directGeoref/projection";
import { CORN_TWIN } from "./fixtures/cornTwin";

vi.mock("@/lib/pilot/access", () => ({ usePilotRole: () => null }));

beforeAll(() => {
  L.Map.prototype.flyTo = function (this: L.Map, c: L.LatLngExpression, z?: number) { return this.setView(c, z ?? this.getZoom(), { animate: false }); } as typeof L.Map.prototype.flyTo;
  HTMLCanvasElement.prototype.getContext = function () {
    const store: Record<string | symbol, unknown> = {};
    return new Proxy(store, { get: (t, k) => (k in t ? t[k] : () => ({})), set: (t, k, v) => { t[k] = v; return true; } }) as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => { delete window.__fieldTwin; });

// Three plants on a row 5 cm apart along it (east), the middle one off the rows (a "double"), and one 2 m away.
const M = 111_320, cos = Math.cos((40 * Math.PI) / 180);
const at = (eastM: number, northM = 0): [number, number] => [40 + northM / M, -90 + eastM / (M * cos)];
const PLANTS = { points: [at(0), at(0.05), at(0.1), at(2)], certainty: [0, 2, 0, 0], photos: [6, 3, 5, 4] };

/** A camera straight down from 10 m over the plants, 0.5 cm a pixel (as photoGround.test.ts builds its cameras). */
const M0 = enuFromCamera({ yawDeg: 0, pitchDeg: 0, rollDeg: 0, basis: "t" }, { rotation: IDENTITY, basis: "t" });
const M0t: M3 = [M0[0], M0[3], M0[6], M0[1], M0[4], M0[7], M0[2], M0[5], M0[8]];
const NADIR: M3 = [1, 0, 0, 0, -1, 0, 0, 0, -1];
const GSD = 0.005;
const camera = (name: string, eastM: number): GeorefFrame => {
  const [lat, lng] = at(eastM);
  return { name, intrinsics: { width: 4000, height: 3000, fx: 10 / GSD, fy: 10 / GSD, cx: 2000, cy: 1500, distortion: null, basis: "t" }, pose: { lat, lng, altM: 10, datum: "t", attitude: { yawDeg: 0, pitchDeg: 0, rollDeg: 0, basis: "t" }, boresight: { rotation: mulM(M0t, NADIR), basis: "t" }, basis: "t" }, ground: { kind: "flat", altM: 0, datum: "t", basis: "t" } } as GeorefFrame;
};

describe("the plants around a plant", () => {
  it("are those located within reach, nearest first, each on a row or off the rows", () => {
    const n = plantNeighbours(PLANTS, 1);
    expect(n.map(x => x.i).sort()).toEqual([0, 2]);
    expect(n[0].d).toBeCloseTo(0.05, 3);
    expect(n.every(x => x.onRow)).toBe(true);
    expect(plantNeighbours(PLANTS, 0).map(x => [x.i, x.onRow])).toEqual([[1, false], [2, true]]);
    expect(plantNeighbours(PLANTS, 3)).toEqual([]);
  });

  it("fall in each photograph through the same camera as the plant itself", () => {
    const frames = [camera("a", 0), camera("b", 1)];
    const views = viewsOf(frames, PLANTS.points[1][0], PLANTS.points[1][1], 4, [PLANTS.points[0], PLANTS.points[2]]);
    expect(views.map(v => v.name)).toEqual(["a", "b"]);
    for (const v of views) {
      const [o0, o2] = v.others!;
      // 5 cm at 0.5 cm a pixel: 10 pixels either side of the plant, along the same image row.
      expect(Math.abs(Math.abs(o0.u - v.u) - 10)).toBeLessThan(0.5);
      expect(Math.abs(Math.abs(o2.u - v.u) - 10)).toBeLessThan(0.5);
      expect(Math.sign(o0.u - v.u)).toBe(-Math.sign(o2.u - v.u));
    }
    // Without others asked for, a view is as it always was.
    expect(viewsOf(frames, PLANTS.points[1][0], PLANTS.points[1][1])[0].others).toBeUndefined();
  });
});

describe("the founder's photographs of a plant", () => {
  it("say where the plant is drawn and how close its neighbours are, then offer the flight's photographs from this device", async () => {
    const cameras = vi.fn(async () => [camera("a", 0)]);
    render(<PlantPhotos plants={PLANTS} index={1} lat={PLANTS.points[1][0]} lng={PLANTS.points[1][1]} groundFrames={null} cameras={cameras} access={null} setAccess={() => undefined} />);
    // Once the cameras are read, the section offers the flight's own files.
    await screen.findByRole("button", { name: "Open the flight's photographs" });
    const s = screen.getByRole("region", { name: "Every photograph that saw it" });
    expect(within(s).getByText(/This plant is drawn off the rows; 3 photographs located it/)).toBeInTheDocument();
    expect(within(s).getByText(/Nearest plant the twin located: 5\.0 cm away, on a row/)).toBeInTheDocument();
    expect(within(s).getByText("Read on this device only, never uploaded.")).toBeInTheDocument();
    expect(cameras).toHaveBeenCalledTimes(1);
  });

  it("says so when the twin keeps no record of its cameras", async () => {
    render(<PlantPhotos plants={PLANTS} index={0} lat={PLANTS.points[0][0]} lng={PLANTS.points[0][1]} groundFrames={null} cameras={async () => null} access={null} setAccess={() => undefined} />);
    expect(await screen.findByText(/keeps no record of its cameras/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open the flight's photographs" })).toBeNull();
  });

  it("reads the cameras once a twin, and again after a failed read", async () => {
    let fail = true;
    const read = vi.fn(async () => { if (fail) throw new Error("offline"); return null; });
    const s = cameraSource(read);
    await expect(s()).rejects.toThrow("offline");
    fail = false;
    await expect(s()).resolves.toBeNull();
    await s();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("as large crops, a few plant spacings across", () => {
    expect(PLANT_PHOTOS.windowM).toBeLessThanOrEqual(0.8);
    expect(PLANT_PHOTOS.max).toBeGreaterThanOrEqual(12);
  });
});

describe("a plant selected in the viewer", () => {
  const twin = JSON.parse(JSON.stringify(CORN_TWIN));
  twin.corn.plants = { points: PLANTS.points, certainty: PLANTS.certainty, photos: PLANTS.photos, note: "test", summary: { plants: 4, certain: 3, probable: 0, onNoRow: 1, betweenRows: 0, confirmedM: 1, notConfirmedM: 0 } };
  const pick = { kind: "plant" as const, index: 1, lat: PLANTS.points[1][0], lng: PLANTS.points[1][1] };
  const close = async (r: { unmount: () => void }) => { await new Promise(f => setTimeout(f, 100)); r.unmount(); await new Promise(f => setTimeout(f, 50)); };

  it("shows the founder every photograph that saw it", async () => {
    const r = render(<div style={{ width: 1200, height: 800 }}><FieldTwinView twin={twin} atlasUrl={async () => ""} expose plantPhotos={{ cameras: async () => [camera("a", 0)] }} /></div>);
    act(() => window.__fieldTwin!.select(pick));
    await screen.findByRole("button", { name: "Open the flight's photographs" });
    expect(within(screen.getByRole("complementary", { name: "Inspector" })).getByRole("region", { name: "Every photograph that saw it" })).toBeInTheDocument();
    await close(r);
  });

  it("shows a participant (no plantPhotos) only what it always did", async () => {
    const r = render(<div style={{ width: 1200, height: 800 }}><FieldTwinView twin={twin} atlasUrl={async () => ""} expose audience="participant" /></div>);
    act(() => window.__fieldTwin!.select(pick));
    const inspector = screen.getByRole("complementary", { name: "Inspector" });
    expect(within(inspector).getByText("Plant off the rows")).toBeInTheDocument();
    expect(within(inspector).queryByRole("region", { name: "Every photograph that saw it" })).toBeNull();
    await close(r);
  });
});
