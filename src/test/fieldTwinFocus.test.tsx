// The twin viewer opened on a finding (the founder's viewer, from a review): that finding is selected and shown,
// once; a finding the saved twin does not hold selects nothing and says so. The real viewer, not a stand-in.
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import L from "leaflet";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import FieldTwinView from "@/components/app/fieldTwin/FieldTwinView";
import { CORN_TWIN } from "./fixtures/cornTwin";

beforeAll(() => {
  L.Map.prototype.flyTo = function (this: L.Map, c: L.LatLngExpression, z?: number) { return this.setView(c, z ?? this.getZoom(), { animate: false }); } as typeof L.Map.prototype.flyTo;
  HTMLCanvasElement.prototype.getContext = function () {
    const store: Record<string | symbol, unknown> = {};
    return new Proxy(store, { get: (t, k) => (k in t ? t[k] : () => ({})), set: (t, k, v) => { t[k] = v; return true; } }) as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => { delete window.__fieldTwin; });

const view = (props: Partial<Parameters<typeof FieldTwinView>[0]>) => <div style={{ width: 1200, height: 800 }}><FieldTwinView twin={CORN_TWIN} atlasUrl={async () => ""} expose {...props} /></div>;
const centre = () => window.__fieldTwin!.map.getCenter();
/** Text in the inspector only (the key's legend names the same states). */
const inInspector = (t: string | RegExp) => { const a = screen.queryByRole("complementary", { name: "Inspector" }); return a ? within(a).queryByText(t) : null; };
/** Let the map's pending frames run while it is mounted, then close it (jsdom has no animation frames to cancel). */
const close = async (r: { unmount: () => void }) => { await new Promise(f => setTimeout(f, 100)); r.unmount(); await new Promise(f => setTimeout(f, 50)); };

describe("the viewer opened on a reviewed finding", () => {
  it("selects that finding and brings it into view, and reports what the saved twin calls it", async () => {
    const onFocus = vi.fn();
    const r = render(view({ focus: { kind: "corn_weed", id: "2" }, onFocus }));
    // The inspector is open on weed observation 2 (the one the photographs do not confirm), not on 1.
    expect(inInspector("Weed candidate, not confirmed")).not.toBeNull();
    expect(inInspector("Weed candidate, confirmed")).toBeNull();
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledWith({ status: "unconfirmed" });
    // An unconfirmed observation is hidden by default: opened on one, the viewer shows them, so it is on the map.
    expect(screen.getByRole("checkbox", { name: /Observations not confirmed/ })).toBeChecked();
    expect(centre().lat).toBeCloseTo(40.00007, 5);
    expect(centre().lng).toBeCloseTo(-89.999995, 5);
    await close(r);
  });

  it("does it once: closing the inspector afterwards is not undone by a redraw", async () => {
    const onFocus = vi.fn();
    const r = render(view({ focus: { kind: "corn_gap", id: "1" }, onFocus }));
    expect(screen.getByText("Stand gap, withheld")).toBeInTheDocument();
    r.rerender(view({ focus: { kind: "corn_gap", id: "1" }, onFocus }));
    r.rerender(view({ focus: { kind: "corn_gap", id: "1" }, onFocus }));
    expect(onFocus).toHaveBeenCalledTimes(1);
    await close(r);
  });

  it("a finding the saved twin does not hold selects nothing, moves nothing, and says so", async () => {
    const plain = render(view({}));
    const before = { lat: centre().lat, lng: centre().lng, zoom: window.__fieldTwin!.map.getZoom() };
    await close(plain);
    const onFocus = vi.fn();
    const r = render(view({ focus: { kind: "corn_weed", id: "3" }, onFocus }));
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledWith(null);
    expect(inInspector(/^Weed candidate, /)).toBeNull();
    expect(inInspector(/^Stand gap, /)).toBeNull();
    expect({ lat: centre().lat, lng: centre().lng, zoom: window.__fieldTwin!.map.getZoom() }).toEqual(before);
    await close(r);
  });

  it("with no finding asked for, the viewer opens as it always has", async () => {
    const onFocus = vi.fn();
    const r = render(view({ onFocus }));
    expect(onFocus).not.toHaveBeenCalled();
    expect(inInspector(/^Weed candidate, /)).toBeNull();
    await close(r);
  });
});
