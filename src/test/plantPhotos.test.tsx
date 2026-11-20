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
import { alignOnMarks, cropPoint, markedFirst, northUpTurn } from "@/lib/fieldTwin/photoAccess";
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
const camera = (name: string, eastM: number, yawDeg = 0): GeorefFrame => {
  const [lat, lng] = at(eastM);
  return { name, intrinsics: { width: 4000, height: 3000, fx: 10 / GSD, fy: 10 / GSD, cx: 2000, cy: 1500, distortion: null, basis: "t" }, pose: { lat, lng, altM: 10, datum: "t", attitude: { yawDeg, pitchDeg: 0, rollDeg: 0, basis: "t" }, boresight: { rotation: mulM(M0t, NADIR), basis: "t" }, basis: "t" }, ground: { kind: "flat", altM: 0, datum: "t", basis: "t" } } as GeorefFrame;
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
    const views = viewsOf(frames, PLANTS.points[1][0], PLANTS.points[1][1], 4, { others: [PLANTS.points[0], PLANTS.points[2]] });
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

describe("a crop turned north up, as the map is", () => {
  it("puts a point north of the plant straight above it and a point east of it to its right, whatever way the drone faced", () => {
    for (const yaw of [0, 37, 90, 200]) {
      const f = camera("y", 0, yaw), [lat, lng] = at(0), north = at(0, 0.1), east = at(0.1);
      const [v] = viewsOf([f], lat, lng, 1, { others: [north, east], north: true });
      expect(v.north).toBeDefined();
      const turn = northUpTurn(v.north!), sz = 120, px = 480;
      const [nx, ny] = cropPoint(v.others![0].u, v.others![0].v, v.u, v.v, sz, px, turn);
      const [ex, ey] = cropPoint(v.others![1].u, v.others![1].v, v.u, v.v, sz, px, turn);
      // 10 cm at 0.5 cm a pixel is 20 photograph pixels, 80 crop pixels at 4 crop pixels to one.
      expect(nx).toBeCloseTo(px / 2, 0); expect(ny).toBeCloseTo(px / 2 - 80, 0);
      expect(ex).toBeCloseTo(px / 2 + 80, 0); expect(ey).toBeCloseTo(px / 2, 0);
    }
  });
});

describe("a crop aligned on the photograph's own marks", () => {
  // 0.5 cm a pixel; the photograph marked each neighbour 4 px right and 2 px down of where the camera draws it.
  const view = { name: "a", u: 1000, v: 1000, nadirM: 1, pixelM: 0.005, others: [{ i: 0, u: 980, v: 1000 }, { i: 1, u: 1020, v: 1000 }, { i: 2, u: 1000, v: 1030 }, { i: 3, u: 1040, v: 980 }] };
  it("moves the view by the median step from the neighbours to the photograph's marks of them, the plant itself not asked", () => {
    const marks: [number, number][] = [...view.others.map(o => [o.u + 4, o.v + 2] as [number, number]), [1000, 1000], [1500, 1500]];
    expect(alignOnMarks(view, marks)).toEqual({ du: 4, dv: 2, on: 4 });
    // One neighbour paired with a mark well off (6.7 cm, still within reach: a wrong pairing) does not move the median.
    marks[0] = [980 + 12, 1000 - 6];
    expect(alignOnMarks(view, marks)).toEqual({ du: 4, dv: 2, on: 4 });
  });
  it("is not aligned with fewer than three neighbours the photograph marked within 8 cm", () => {
    expect(alignOnMarks(view, [[984, 1002], [1024, 1002]])).toBeNull();
    expect(alignOnMarks(view, view.others.map(o => [o.u + 20, o.v] as [number, number]))).toBeNull();
    expect(alignOnMarks({ ...view, others: [] }, [[1, 1]])).toBeNull();
  });
});

describe("the founder's photographs of a plant", () => {
  it("say where the plant is drawn and how close its neighbours are, then offer the flight's photographs from this device", async () => {
    const cameras = vi.fn(async () => ({ frames: [camera("a", 0)], marks: new Map<string, [number, number][]>() }));
    render(<PlantPhotos plants={PLANTS} index={1} lat={PLANTS.points[1][0]} lng={PLANTS.points[1][1]} groundFrames={null} cameras={cameras} access={null} setAccess={() => undefined} />);
    // Once the cameras are read, the section offers the flight's own files.
    await screen.findByRole("button", { name: "Open the flight's photographs" }, { timeout: 5000 });
    const s = screen.getByRole("region", { name: "Every photograph that saw it" });
    expect(within(s).getByText(/This plant is drawn off the rows; 3 photographs located it/)).toBeInTheDocument();
    expect(within(s).getByText(/Nearest plant the twin located: 5\.0 cm away, on a row/)).toBeInTheDocument();
    expect(within(s).getByText("Read on this device only, never uploaded.")).toBeInTheDocument();
    expect(cameras).toHaveBeenCalledTimes(1);
  });

  it("names the photographs that marked the plant, which come first whatever is nearest overhead", async () => {
    // Three photographs see the place, nearest first a, b, c; the record says c and b marked it.
    expect(markedFirst([{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }], new Set(["c", "b"]), 3).map(v => v.name)).toEqual(["b", "c", "a"]);
    const cameras = async () => ({ frames: [camera("a", 0)], marks: new Map<string, [number, number][]>(), marked: (i: number) => (i === 1 ? [{ photo: "DJI_20260417134335_0078_D", u: 10, v: 20 }, { photo: "DJI_20260417134337_0079_D", u: 30, v: 40 }] : []) });
    render(<PlantPhotos plants={PLANTS} index={1} lat={PLANTS.points[1][0]} lng={PLANTS.points[1][1]} groundFrames={null} cameras={cameras} access={null} setAccess={() => undefined} />);
    expect(await screen.findByText(/Marked by 0078_D, 0079_D: shown first, each centred on its own mark\. The others saw the place and did not mark it\./, undefined, { timeout: 5000 })).toBeInTheDocument();
  });

  it("says so when the record does not say which photographs marked each plant", async () => {
    render(<PlantPhotos plants={PLANTS} index={1} lat={PLANTS.points[1][0]} lng={PLANTS.points[1][1]} groundFrames={null} cameras={async () => ({ frames: [camera("a", 0)], marks: new Map<string, [number, number][]>() })} access={null} setAccess={() => undefined} />);
    expect(await screen.findByText(/does not say which photographs marked each plant/, undefined, { timeout: 5000 })).toBeInTheDocument();
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
    const r = render(<div style={{ width: 1200, height: 800 }}><FieldTwinView twin={twin} atlasUrl={async () => ""} expose plantPhotos={{ cameras: async () => ({ frames: [camera("a", 0)], marks: new Map<string, [number, number][]>() }) }} /></div>);
    act(() => window.__fieldTwin!.select(pick));
    await screen.findByRole("button", { name: "Open the flight's photographs" }, { timeout: 5000 });
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
