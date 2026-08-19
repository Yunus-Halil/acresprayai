// The layer actually draws, and a click actually finds a cell.
//
// The pure arithmetic is covered in gridRender.test.ts. What is left — and what
// this covers — is the wiring between it and Leaflet: that mounting the layer
// paints the visible cells onto a canvas, that the level-of-detail decision
// reaches the caller, and that a map click resolves to the cell under it.
// Without this the render path could be dead and every other test would still
// pass.
//
// jsdom has no canvas implementation, so the 2D context is a recording stub.
// That is enough: what needs asserting is which draw calls are issued and how
// many, not what the pixels look like.
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MapContainer } from "react-leaflet";
import L from "leaflet";
import TreatmentGridLayer, { type GridRenderInfo } from "@/components/app/workspace/TreatmentGridLayer";
import {
  type CellId, buildTreatmentGrid, gridDefinitionFor,
} from "@/lib/treatmentGrid";

const SQUARE = [[
  { lat: 40.0000, lng: -100.0000 },
  { lat: 40.0000, lng: -99.99648 },
  { lat: 40.00270, lng: -99.99648 },
  { lat: 40.00270, lng: -100.0000 },
]];

/** Records the calls a draw pass makes, in order. */
type Recorder = {
  calls: string[];
  fills: number;
  strokes: number;
  ctx: Record<string, unknown>;
};

function recorder(): Recorder {
  const r: Recorder = { calls: [], fills: 0, strokes: 0, ctx: {} };
  const noop = (name: string) => (...args: unknown[]) => {
    r.calls.push(name);
    if (name === "fill") r.fills++;
    if (name === "stroke") r.strokes++;
    void args;
  };
  for (const m of [
    "beginPath", "closePath", "moveTo", "lineTo", "fill", "stroke",
    "clearRect", "setTransform", "save", "restore", "rect",
  ]) r.ctx[m] = noop(m);
  r.ctx.fillStyle = "";
  r.ctx.strokeStyle = "";
  r.ctx.lineWidth = 1;
  return r;
}

let rec: Recorder;

beforeAll(() => {
  // jsdom gives every element a zero size, and Leaflet refuses to lay out a map
  // it believes has no area — every cell would then be culled and the test
  // would pass for the wrong reason.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 900 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 700 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 900 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 700 });
  HTMLCanvasElement.prototype.getContext = vi.fn(() => rec.ctx) as never;
});

afterEach(cleanup);

const grid = (swathM = 30) =>
  buildTreatmentGrid(SQUARE, gridDefinitionFor(SQUARE, swathM, 1));

function mount(opts: {
  zoom: number;
  brushM?: number | null;
  selected?: Set<CellId>;
  onPaintCells?: (ids: CellId[]) => void;
  onPickCell?: (id: CellId | null) => void;
  onRender?: (i: GridRenderInfo) => void;
  swathM?: number;
}) {
  rec = recorder();
  let map: L.Map | null = null;
  const g = grid(opts.swathM);
  render(
    <MapContainer
      center={[40.00135, -99.99824]}
      zoom={opts.zoom}
      style={{ width: 900, height: 700 }}
      ref={(m) => { map = m; }}
    >
      <TreatmentGridLayer
        grid={g}
        selected={opts.selected ?? new Set()}
        brushM={opts.brushM ?? null}
        onPaintCells={opts.onPaintCells ?? (() => {})}
        onPickCell={opts.onPickCell ?? (() => {})}
        onRender={opts.onRender}
      />
    </MapContainer>,
  );
  return { map: map as unknown as L.Map, grid: g };
}

describe("drawing", () => {
  it("paints the cells in view", () => {
    let info: GridRenderInfo | null = null;
    const { grid: g } = mount({ zoom: 18, onRender: i => { info = i; } });

    expect(info).not.toBeNull();
    expect(info!.painted).toBeGreaterThan(0);
    // One fill per painted cell. If the render path were dead this is zero and
    // nothing else in the suite would notice.
    expect(rec.fills).toBeGreaterThanOrEqual(info!.painted);
    expect(rec.calls).toContain("clearRect");
    expect(g.cells.length).toBe(100);
  });

  it("strokes cell borders when they are big enough to read", () => {
    let info: GridRenderInfo | null = null;
    mount({ zoom: 19, onRender: i => { info = i; } });
    expect(info!.level).toBe("outline");
    expect(rec.strokes).toBeGreaterThan(0);
  });

  it("stops stroking once cells shrink, without stopping drawing", () => {
    let info: GridRenderInfo | null = null;
    mount({ zoom: 15, onRender: i => { info = i; } });
    expect(info!.level).toBe("fill");
    expect(rec.fills).toBeGreaterThan(0);
    expect(rec.strokes).toBe(0);
  });

  it("draws nothing for an untouched grid once cells are sub-pixel", () => {
    // Sparse detail keeps only decided cells, and nothing here is decided — so
    // the correct amount of work at this zoom is none.
    let info: GridRenderInfo | null = null;
    mount({ zoom: 11, onRender: i => { info = i; } });
    expect(info!.level).toBe("sparse");
    expect(info!.painted).toBe(0);
    expect(rec.fills).toBe(0);
  });

  it("still outlines a selected cell at every level of detail", () => {
    // Selection is the operator's own pointer feedback. Dropping it because the
    // field is large would remove the one thing saying what a click just hit.
    const g = grid();
    let info: GridRenderInfo | null = null;
    mount({ zoom: 11, selected: new Set([g.cells[0].id]), onRender: i => { info = i; } });
    expect(info!.level).toBe("sparse");
    expect(rec.strokes).toBeGreaterThan(0);
  });
});

describe("clicking", () => {
  it("reports the cell under the pointer", () => {
    const picked: (CellId | null)[] = [];
    const { map, grid: g } = mount({ zoom: 18, onPickCell: id => picked.push(id) });

    const target = g.cells[42];
    map.fire("click", { latlng: L.latLng(target.centroid.lat, target.centroid.lng) } as never);

    expect(picked).toEqual([target.id]);
  });

  it("reports null off the field", () => {
    const picked: (CellId | null)[] = [];
    const { map } = mount({ zoom: 18, onPickCell: id => picked.push(id) });
    map.fire("click", { latlng: L.latLng(39.9, -100.2) } as never);
    expect(picked).toEqual([null]);
  });

  it("does not pick while the brush is armed — painting owns the click then", () => {
    const picked: (CellId | null)[] = [];
    const { map, grid: g } = mount({ zoom: 18, brushM: 15, onPickCell: id => picked.push(id) });
    const target = g.cells[10];
    map.fire("click", { latlng: L.latLng(target.centroid.lat, target.centroid.lng) } as never);
    expect(picked).toEqual([]);
  });
});

describe("painting", () => {
  it("paints on press and continues on drag", () => {
    const painted: CellId[] = [];
    const { map, grid: g } = mount({
      zoom: 18, brushM: 5, onPaintCells: ids => painted.push(...ids),
    });

    const a = g.cells[10], b = g.cells[11];
    map.fire("mousedown", { latlng: L.latLng(a.centroid.lat, a.centroid.lng) } as never);
    map.fire("mousemove", { latlng: L.latLng(b.centroid.lat, b.centroid.lng) } as never);
    map.fire("mouseup", {} as never);

    expect(painted).toContain(a.id);
    expect(painted).toContain(b.id);
  });

  it("reports each cell once per stroke however much the drag wobbles", () => {
    // Without the per-stroke set, one shaky drag re-fires the same cell dozens
    // of times, and every fire is a state update over the whole grid.
    const painted: CellId[] = [];
    const { map, grid: g } = mount({
      zoom: 18, brushM: 5, onPaintCells: ids => painted.push(...ids),
    });

    const a = g.cells[10];
    const ll = L.latLng(a.centroid.lat, a.centroid.lng);
    map.fire("mousedown", { latlng: ll } as never);
    for (let i = 0; i < 8; i++) map.fire("mousemove", { latlng: ll } as never);
    map.fire("mouseup", {} as never);

    expect(painted.filter(id => id === a.id)).toHaveLength(1);
  });

  it("does not paint on hover before the press", () => {
    const painted: CellId[] = [];
    const { map, grid: g } = mount({
      zoom: 18, brushM: 5, onPaintCells: ids => painted.push(...ids),
    });
    map.fire("mousemove", { latlng: L.latLng(g.cells[3].centroid.lat, g.cells[3].centroid.lng) } as never);
    expect(painted).toEqual([]);
  });

  it("does not paint at all when the layer is read-only", () => {
    const painted: CellId[] = [];
    const { map, grid: g } = mount({
      zoom: 18, brushM: null, onPaintCells: ids => painted.push(...ids),
    });
    const ll = L.latLng(g.cells[3].centroid.lat, g.cells[3].centroid.lng);
    map.fire("mousedown", { latlng: ll } as never);
    map.fire("mousemove", { latlng: ll } as never);
    expect(painted).toEqual([]);
  });

  it("frees the map again when the stroke ends", () => {
    // The brush disables dragging so the map does not pan out from under it.
    // Failing to re-enable would leave the map permanently stuck.
    const { map, grid: g } = mount({ zoom: 18, brushM: 5 });
    const ll = L.latLng(g.cells[3].centroid.lat, g.cells[3].centroid.lng);
    map.fire("mousedown", { latlng: ll } as never);
    expect(map.dragging.enabled()).toBe(false);
    map.fire("mouseup", {} as never);
    expect(map.dragging.enabled()).toBe(true);
  });

  it("a wide brush takes more cells than a narrow one", () => {
    const wide: CellId[] = [];
    const { map, grid: g } = mount({ zoom: 18, brushM: 45, onPaintCells: ids => wide.push(...ids) });
    map.fire("mousedown", { latlng: L.latLng(g.cells[55].centroid.lat, g.cells[55].centroid.lng) } as never);
    map.fire("mouseup", {} as never);
    expect(wide.length).toBeGreaterThan(1);
  });
});
