// MouseReadout: the shared bottom-status-bar zoom/coordinate readout.
//
// The bug this guards against: Field View stays mounted (hidden, not
// unmounted) while another tab - Weed Scout, the Treatment Grid, the Flight
// Planner - is active, each with its own independent Leaflet map. Before the
// `active` guard, only Field View's map ever wrote to the shared readout, so
// switching to any other tab froze the zoom shown at whatever Field View last
// reported (or the hardcoded placeholder) no matter how far the operator
// zoomed the map they were actually looking at.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MapContainer } from "react-leaflet";
import L from "leaflet";
import { MouseReadout } from "@/components/app/workspace/layers";

beforeAll(() => {
  // jsdom gives every element a zero size, and Leaflet refuses to lay out a
  // map it believes has no area.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 900 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 700 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 900 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 700 });
});

afterEach(cleanup);

function mountMap(active: boolean, zoom: number) {
  let map: L.Map | null = null;
  const coordRef = { current: document.createElement("div") };
  const zoomRef = { current: document.createElement("div") };
  const { rerender } = render(
    <MapContainer center={[40, -100]} zoom={zoom} style={{ width: 900, height: 700 }} ref={m => { map = m; }}>
      <MouseReadout coordRef={coordRef} zoomRef={zoomRef} active={active} />
    </MapContainer>,
  );
  return {
    map: map as unknown as L.Map, coordRef, zoomRef,
    setActive: (next: boolean) => rerender(
      <MapContainer center={[40, -100]} zoom={zoom} style={{ width: 900, height: 700 }} ref={m => { map = m ?? map; }}>
        <MouseReadout coordRef={coordRef} zoomRef={zoomRef} active={next} />
      </MapContainer>,
    ),
  };
}

describe("an active map's readout", () => {
  it("shows its own zoom immediately on mount, before any mouse move", () => {
    const { zoomRef } = mountMap(true, 14);
    expect(zoomRef.current.textContent).toBe("Zoom 14");
  });

  it("updates on zoomend, e.g. from a scroll-wheel or a fitBounds call", () => {
    const { map, zoomRef } = mountMap(true, 10);
    map.setZoom(17);
    expect(zoomRef.current.textContent).toBe("Zoom 17");
  });

  it("updates on mousemove with the coordinate and the current zoom", () => {
    const { map, coordRef, zoomRef } = mountMap(true, 12);
    map.fire("mousemove", { latlng: L.latLng(38.123456, -77.654321) });
    expect(coordRef.current.textContent).toBe("38.123456, -77.654321");
    expect(zoomRef.current.textContent).toBe("Zoom 12");
  });
});

describe("an inactive map's readout - the bug this closes", () => {
  it("writes nothing on mount: a hidden Field View no longer stamps a stale zoom over another tab's", () => {
    const { zoomRef } = mountMap(false, 14);
    expect(zoomRef.current.textContent).toBe("");
  });

  it("a background zoomend (e.g. fitBounds firing on a hidden map) never overwrites the bar", () => {
    const { map, zoomRef } = mountMap(false, 10);
    map.setZoom(19);
    expect(zoomRef.current.textContent).toBe("");
  });

  it("mousemove on a map that is not the one being looked at is ignored", () => {
    const { map, coordRef, zoomRef } = mountMap(false, 12);
    map.fire("mousemove", { latlng: L.latLng(1, 2) });
    expect(coordRef.current.textContent).toBe("");
    expect(zoomRef.current.textContent).toBe("");
  });

  it("becoming active syncs the bar immediately, without waiting for a mouse move", () => {
    const { setActive, zoomRef } = mountMap(false, 16);
    expect(zoomRef.current.textContent).toBe("");
    setActive(true);
    expect(zoomRef.current.textContent).toBe("Zoom 16");
  });
});
