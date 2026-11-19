// The corn twin's View switch and plant count in the viewer (2026-11-19): Realistic, Simple and Geometry in place of
// the detail dial on a corn twin; every located plant counted, on the rows and off them; "not counted" said plainly on
// a twin whose photographs gave no plant-by-plant count; the field's colours accepted in a twin and refused when broken.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import L from "leaflet";
import FieldTwinView from "@/components/app/fieldTwin/FieldTwinView";
import { syntheticCornTwin } from "@/lib/fieldTwin/syntheticCorn";
import { parseTwin, type TwinBundle } from "@/lib/fieldTwin/types";
import { cornPlantCount } from "@/lib/fieldTwin/cornRender";
import { CORN_TWIN } from "./fixtures/cornTwin";

beforeAll(() => {
  L.Map.prototype.flyTo = function (this: L.Map, c: L.LatLngExpression, z?: number) { return this.setView(c, z ?? this.getZoom(), { animate: false }); } as typeof L.Map.prototype.flyTo;
  HTMLCanvasElement.prototype.getContext = function () {
    const store: Record<string | symbol, unknown> = {};
    return new Proxy(store, { get: (t, k) => (k in t ? t[k] : () => ({})), set: (t, k, v) => { t[k] = v; return true; } }) as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

const PLANTS_TWIN = syntheticCornTwin({ plants: 2000 });
const open = (twin: TwinBundle, audience: "founder" | "participant" = "participant") => render(<div style={{ width: 1200, height: 800 }}><FieldTwinView twin={twin} atlasUrl={async () => ""} audience={audience} /></div>);
const close = async (r: ReturnType<typeof render>) => { await new Promise(res => setTimeout(res, 100)); r.unmount(); };

describe("the View switch on a corn twin", () => {
  it("offers Realistic, Simple and Geometry in place of the detail dial, and opens on Realistic", async () => {
    try { localStorage.removeItem("swathwise:twin-corn-view"); } catch { /* no storage */ }
    const r = open(PLANTS_TWIN);
    const view = screen.getByRole("group", { name: "View" });
    expect(within(view).getByRole("button", { name: "Realistic" })).toHaveAttribute("aria-pressed", "true");
    expect(within(view).getByRole("button", { name: "Simple" })).toHaveAttribute("aria-pressed", "false");
    expect(within(view).getByRole("button", { name: "Geometry" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("group", { name: "Detail" })).toBeNull();
    // Realistic says what is measured and what is drawn, and whose colours these are.
    expect(within(view).getByText(/colours are this field's own, read from its photographs/)).toBeInTheDocument();
    expect(within(view).getByText(/Each plant's place is measured; its leaves are drawn/)).toBeInTheDocument();
    expect(screen.getByText("Corn plant, on a row")).toBeInTheDocument();
    expect(screen.getByText("Plant off the rows (counted)")).toBeInTheDocument();
    expect(screen.getByText("Soil, in this field's own colour")).toBeInTheDocument();
    await close(r);
  });

  it("changes the key with the view, and remembers the choice", async () => {
    let r = open(PLANTS_TWIN);
    fireEvent.click(within(screen.getByRole("group", { name: "View" })).getByRole("button", { name: "Geometry" }));
    expect(screen.getByText("Row, plants seen along it")).toBeInTheDocument();
    expect(screen.queryByText("Corn plant, on a row")).toBeNull();
    fireEvent.click(within(screen.getByRole("group", { name: "View" })).getByRole("button", { name: "Simple" }));
    expect(screen.getByText("Corn plant, on a row")).toBeInTheDocument();
    expect(screen.queryByText(/^Soil, in/)).toBeNull();
    await close(r);
    r = open(PLANTS_TWIN);
    expect(within(screen.getByRole("group", { name: "View" })).getByRole("button", { name: "Simple" })).toHaveAttribute("aria-pressed", "true");
    try { localStorage.removeItem("swathwise:twin-corn-view"); } catch { /* no storage */ }
    await close(r);
  });

  it("gives the founder alone the All layers tick", async () => {
    let r = open(PLANTS_TWIN, "participant");
    expect(screen.queryByRole("checkbox", { name: /^All layers/ })).toBeNull();
    await close(r);
    r = open(PLANTS_TWIN, "founder");
    expect(screen.getByRole("checkbox", { name: /^All layers/ })).not.toBeChecked();
    await close(r);
  });

  it("says the colours are standard on a twin built before colours were read", async () => {
    const old = { ...PLANTS_TWIN, corn: { ...PLANTS_TWIN.corn!, look: undefined } };
    const r = open(old);
    expect(within(screen.getByRole("group", { name: "View" })).getByText(/Standard soil and corn colours: this twin was built before colours were read/)).toBeInTheDocument();
    expect(screen.getByText("Soil, in a standard colour")).toBeInTheDocument();
    await close(r);
  });
});

describe("the plant count", () => {
  it("counts every located plant and splits it by the rows", async () => {
    const c = cornPlantCount(PLANTS_TWIN.corn)!;
    expect(c.total).toBe(PLANTS_TWIN.corn!.plants!.points.length);
    expect(c.onRows + c.offRows).toBe(c.total);
    expect(c.offRows).toBeGreaterThan(0);
    const r = open(PLANTS_TWIN);
    const count = screen.getByRole("group", { name: "Plant count" });
    expect(within(count).getByText("Plants counted").nextSibling?.textContent).toBe(c.total.toLocaleString());
    expect(within(count).getByText("On the rows").nextSibling?.textContent).toBe(c.onRows.toLocaleString());
    expect(within(count).getByText("Off the rows").nextSibling?.textContent).toBe(c.offRows.toLocaleString());
    expect(within(count).getByText(/Plants off the rows are counted too and drawn in their own colour/)).toBeInTheDocument();
    expect(screen.queryByText(/not a stand count/)).toBeNull();
    await close(r);
  });

  it("says a twin with no located plants was not counted, and draws its rows as bands", async () => {
    // The fixture twin's rows came from the photographs' lattice: it carries no plants.
    expect(CORN_TWIN.corn!.plants).toBeUndefined();
    const r = open(CORN_TWIN);
    expect(within(screen.getByRole("group", { name: "Plant count" })).getByText("not counted on this flight")).toBeInTheDocument();
    expect(screen.getByText("Corn row (plants not counted one by one)")).toBeInTheDocument();
    await close(r);
  });
});

describe("the field's colours in a twin", () => {
  it("are accepted, and a synthetic corn twin is a well-formed bundle", () => {
    const parsed = parseTwin(JSON.parse(JSON.stringify(PLANTS_TWIN)));
    expect(parsed.ok).toBe(true);
  });
  it("are refused when a colour or a sample is broken", () => {
    const bad = (look: unknown) => parseTwin({ ...JSON.parse(JSON.stringify(PLANTS_TWIN)), corn: { ...JSON.parse(JSON.stringify(PLANTS_TWIN.corn)), look } });
    const L0 = PLANTS_TWIN.corn!.look!;
    expect(bad({ ...L0, soil: [300, 0, 0] })).toMatchObject({ ok: false });
    expect(bad({ ...L0, version: 2 })).toMatchObject({ ok: false });
    expect(bad({ ...L0, samples: [{ lat: 1, lng: 2, soil: [1, 2], corn: null }] })).toMatchObject({ ok: false });
    expect(bad({ ...L0, plantSizeM: 0 })).toMatchObject({ ok: false });
    // A photograph that gave only one of the two colours is fine.
    expect(bad({ ...L0, samples: [{ lat: 1, lng: 2, soil: null, corn: [1, 2, 3] }] })).toMatchObject({ ok: true });
  });
});
