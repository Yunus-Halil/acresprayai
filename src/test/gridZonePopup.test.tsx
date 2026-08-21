// The Field View zone popup: the controls exist, and what they do reaches
// storage.
//
// The write itself is covered in zoneClassify.test.ts, against the real cells.
// What is left — and what this covers — is the wiring between the popup and
// that write: that the dropdown is built from the shared vocabulary, that
// picking one saves at once, and that a half-typed note is not lost when the
// operator closes the popup or leaves the tab. That last one is the whole
// reason the debounce needed a flush, and nothing else in the suite would
// notice if it stopped working.
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { MapContainer } from "react-leaflet";
import L from "leaflet";
import type { GridZone } from "@/lib/gridZones";
import { USER_POLY_ISSUES } from "@/components/app/workspace/layers";

const classify = vi.hoisted(() => vi.fn(async () => ({ zones: [], cells: 4 })));
vi.mock("@/lib/gridAnomalies", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gridAnomalies")>()),
  classifyGridZone: classify,
}));

// Imported after the mock so the layer picks up the spy.
const { default: GridAnomaliesLayer } = await import(
  "@/components/app/workspace/GridAnomaliesLayer");

const CENTER: [number, number] = [40.0013, -99.9982];
const BOUNDARY = [[
  { lat: 40.0000, lng: -100.0000 },
  { lat: 40.0000, lng: -99.99648 },
  { lat: 40.00270, lng: -99.99648 },
  { lat: 40.00270, lng: -100.0000 },
]];

const ZONE: GridZone = {
  id: "grid:abc:3:4",
  ring: [
    { lat: 40.0010, lng: -99.9990 },
    { lat: 40.0010, lng: -99.9975 },
    { lat: 40.0018, lng: -99.9975 },
    { lat: 40.0018, lng: -99.9990 },
  ],
  rateLha: 25,
  areaM2: 800,
  cellCount: 4,
  cellIds: ["abc:3:4", "abc:4:4", "abc:3:5", "abc:4:5"],
  source: "grid",
  matchScore: null,
};

beforeAll(() => {
  // Leaflet refuses to lay out a map it believes has no area, and jsdom gives
  // every element zero size.
  for (const p of ["clientWidth", "offsetWidth"]) {
    Object.defineProperty(HTMLElement.prototype, p, { configurable: true, value: 900 });
  }
  for (const p of ["clientHeight", "offsetHeight"]) {
    Object.defineProperty(HTMLElement.prototype, p, { configurable: true, value: 700 });
  }
  // jsdom has no canvas and no usable SVG, so Leaflet cannot build a renderer
  // for a vector layer. A recording stub is enough here: this test is about the
  // popup's DOM, not about which pixels the polygon lands on.
  // On the renderer: jsdom has no canvas, and Leaflet's canvas renderer
  // schedules a redraw while being torn down that then fires against its own
  // deleted context. The SVG renderer is plain DOM and unwinds cleanly, so the
  // map below is handed one directly — the factory would refuse, because
  // jsdom's SVG elements lack the method Leaflet feature-detects on.
});

afterEach(() => { cleanup(); classify.mockClear(); });

function mount(opts: { zone?: GridZone; fieldId?: string | null } = {}) {
  let map: L.Map | null = null;
  const view = render(
    <MapContainer center={CENTER} zoom={17} renderer={new L.SVG()}
                  style={{ width: 900, height: 700 }}
                  ref={(m) => { map = m; }}>
      <GridAnomaliesLayer
        zones={[opts.zone ?? ZONE]}
        fieldId={opts.fieldId === undefined ? "field-1" : opts.fieldId}
        boundary={BOUNDARY}
      />
    </MapContainer>,
  );
  const m = map as unknown as L.Map;
  let poly: L.Polygon | null = null;
  m.eachLayer(l => { if (l instanceof L.Polygon) poly = l as L.Polygon; });
  return { map: m, poly: poly as unknown as L.Polygon, view };
}

const open = (poly: L.Polygon) => act(() => { poly.openPopup(); });
const select = () => document.querySelector("select") as HTMLSelectElement;
const note = () => document.querySelector("textarea") as HTMLTextAreaElement;
const fire = (el: HTMLElement, type: string) =>
  act(() => { el.dispatchEvent(new Event(type, { bubbles: true })); });
const settle = () => act(async () => { await Promise.resolve(); });

describe("the popup's controls", () => {
  it("offers the same issue vocabulary as everywhere else, plus Unclassified", () => {
    const { poly } = mount();
    open(poly);
    const options = [...select().options].map(o => o.value);
    expect(options[0]).toBe("");
    expect(options.slice(1)).toEqual([...USER_POLY_ISSUES]);
    expect(select().options[0].textContent).toBe("Unclassified");
    // Nothing is preselected for an unclassified zone — the app does not guess.
    expect(select().value).toBe("");
  });

  it("shows the zone's existing classification and note", () => {
    const { poly } = mount({ zone: { ...ZONE, issue: "Bare soil", note: "check drainage" } });
    open(poly);
    expect(select().value).toBe("Bare soil");
    expect(note().value).toBe("check drainage");
  });

  it("lists a tag from outside today's vocabulary rather than hiding it", () => {
    const { poly } = mount({ zone: { ...ZONE, issue: "Frost damage" } });
    open(poly);
    expect(select().value).toBe("Frost damage");
  });

  it("disables both controls when the scan has no field to save against", () => {
    const { poly } = mount({ fieldId: null });
    open(poly);
    expect(select().disabled).toBe(true);
    expect(note().disabled).toBe(true);
  });
});

describe("what the controls do", () => {
  it("saves a classification the moment it is picked", async () => {
    const { poly } = mount();
    open(poly);
    select().value = "Pest damage";
    fire(select(), "change");
    await settle();

    expect(classify).toHaveBeenCalledTimes(1);
    const [fieldId, boundary, zoneId, patch] = classify.mock.calls[0] as unknown as
      [string, unknown, string, { issue?: string | null }];
    expect(fieldId).toBe("field-1");
    expect(boundary).toBe(BOUNDARY);
    expect(zoneId).toBe(ZONE.id);
    expect(patch).toEqual({ issue: "Pest damage" });
  });

  it("clears a classification back to unclassified", async () => {
    const { poly } = mount({ zone: { ...ZONE, issue: "Bare soil" } });
    open(poly);
    select().value = "";
    fire(select(), "change");
    await settle();
    expect((classify.mock.calls[0] as unknown as [string, unknown, string, unknown])[3])
      .toEqual({ issue: null });
  });

  it("relabels the zone without waiting for the round trip", () => {
    const { poly } = mount();
    open(poly);
    select().value = "Waterlogging";
    fire(select(), "change");
    expect(document.body.textContent).toContain("Waterlogging");
  });

  it("waits out the typing before saving a note", async () => {
    const { poly } = mount();
    open(poly);
    note().value = "third year running";
    fire(note(), "input");
    // Mid-sentence: nothing written yet.
    expect(classify).not.toHaveBeenCalled();

    await act(async () => { await new Promise(r => setTimeout(r, 700)); });
    expect(classify).toHaveBeenCalledTimes(1);
    expect((classify.mock.calls[0] as unknown as [string, unknown, string, unknown])[3])
      .toEqual({ note: "third year running" });
  });

  it("does not lose a note when the popup is closed straight away", async () => {
    const { poly } = mount();
    open(poly);
    note().value = "check drainage";
    fire(note(), "input");
    expect(classify).not.toHaveBeenCalled();

    act(() => { poly.closePopup(); });
    await settle();
    expect(classify).toHaveBeenCalledTimes(1);
    expect((classify.mock.calls[0] as unknown as [string, unknown, string, unknown])[3])
      .toEqual({ note: "check drainage" });
  });

  it("does not lose a note when the operator leaves the tab", async () => {
    const { poly } = mount();
    open(poly);
    note().value = "half typed";
    fire(note(), "input");
    expect(classify).not.toHaveBeenCalled();

    // Switching tabs unmounts the map, which is where the last strokes used to
    // go missing.
    cleanup();
    await settle();
    expect(classify).toHaveBeenCalledTimes(1);
    expect((classify.mock.calls[0] as unknown as [string, unknown, string, unknown])[3])
      .toEqual({ note: "half typed" });
  });

  it("keeps an edit on screen when the popup is reopened", async () => {
    const { poly } = mount();
    open(poly);
    select().value = "Weed pressure";
    fire(select(), "change");
    await settle();
    act(() => { poly.closePopup(); });

    open(poly);
    expect(select().value).toBe("Weed pressure");
  });

  it("says so when the write fails, instead of looking saved", async () => {
    classify.mockResolvedValueOnce(null as never);
    const { poly } = mount();
    open(poly);
    select().value = "Bare soil";
    fire(select(), "change");
    await settle();
    expect(document.body.textContent).toContain("Could not save");
  });
});
