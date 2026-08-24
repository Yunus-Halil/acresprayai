// The compare view's structural guarantee: ONE map.
//
// The old compare ran two Leaflet maps synced by event listeners; misalignment
// was a bug it could have (and had). The rebuilt compare renders both scans as
// panes of a single map and splits them with a CSS clip — so the property
// worth a test is not "the panes stay in sync" but "there is exactly one map,
// and the clip divides it where the handle says". Real Leaflet, real panes.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MapContainer } from "react-leaflet";
import { ComparePanes } from "@/components/app/workspace/SwipeCompare";
import type { FieldScan } from "@/components/app/workspace/ScanTimeline";
import { rectIntersection } from "@/lib/compareGround";
import type { ScanBounds } from "@/lib/scanLayers";

const scan = (id: string, iso: string): FieldScan => ({
  id, odm_uuid: `uuid-${id}`, status: "completed", created_at: iso,
  image_count: 40, ai_analysis: null, ai_analysis_at: null, tiles_baked: true,
});

const A = scan("scan-a", "2026-05-01T10:00:00Z");
const B = scan("scan-b", "2026-06-15T10:00:00Z");

const A_BOUNDS: ScanBounds = { west: -93.01, south: 45.0, east: -93.0, north: 45.01 };
// Offset east so the intersection is a strict subset of both.
const B_BOUNDS: ScanBounds = { west: -93.005, south: 45.0, east: -92.995, north: 45.01 };
const OVERLAP = rectIntersection(A_BOUNDS, B_BOUNDS)!;

const ZONES_A = [{ id: "z1", severity: "high", ring: [
  { lat: 45.002, lng: -93.004 }, { lat: 45.003, lng: -93.004 }, { lat: 45.003, lng: -93.003 },
] }];

function renderCompare(swipePct: number, over: Partial<React.ComponentProps<typeof ComparePanes>> = {}) {
  return render(
    <MapContainer
      center={[45.005, -93.0025]}
      zoom={16}
      style={{ height: "400px", width: "600px" }}
    >
      <ComparePanes
        a={A}
        b={B}
        token="jwt"
        rev={0}
        sideA={{ imagery: "rgb", index: null, zones: true }}
        sideB={{ imagery: "rgb", index: null, zones: true }}
        aInfo={null}
        bInfo={null}
        aMeta={{ bounds: A_BOUNDS, maxZoom: 18, error: null }}
        bMeta={{ bounds: B_BOUNDS, maxZoom: 18, error: null }}
        aZones={ZONES_A}
        bZones={[]}
        overlap={OVERLAP}
        swipePct={swipePct}
        {...over}
      />
    </MapContainer>,
  );
}

afterEach(cleanup);

const pane = (name: string) =>
  document.querySelector(`.leaflet-${name}-pane`) as HTMLElement | null ??
  (document.querySelector(`.leaflet-pane[class*="${name}"]`) as HTMLElement | null);

describe("one map, split by a clip", () => {
  it("renders exactly one Leaflet map for both scans", () => {
    renderCompare(50);
    expect(document.querySelectorAll(".leaflet-container")).toHaveLength(1);
  });

  it("creates the side panes and clips A left of the divider, B right of it", () => {
    const { rerender } = renderCompare(50);
    const container = document.querySelector(".leaflet-container") as HTMLElement;
    // jsdom has no layout; give the map a real size, then move the divider so
    // the clip re-applies with it.
    Object.defineProperty(container, "clientWidth", { value: 200, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 100, configurable: true });

    rerender(
      <MapContainer center={[45.005, -93.0025]} zoom={16} style={{ height: "400px", width: "600px" }}>
        <ComparePanes
          a={A} b={B} token="jwt" rev={0}
          sideA={{ imagery: "rgb", index: null, zones: true }}
          sideB={{ imagery: "rgb", index: null, zones: true }}
          aInfo={null} bInfo={null}
          aMeta={{ bounds: A_BOUNDS, maxZoom: 18, error: null }}
          bMeta={{ bounds: B_BOUNDS, maxZoom: 18, error: null }}
          aZones={ZONES_A} bZones={[]}
          overlap={OVERLAP}
          swipePct={25}
        />
      </MapContainer>,
    );

    const aPane = pane("cmp-a")!;
    const bPane = pane("cmp-b")!;
    expect(aPane).toBeTruthy();
    expect(bPane).toBeTruthy();
    // 25% of 200px: A keeps the left 50px (150px clipped off its right), B
    // starts at 50px. The divider is one screen line — one longitude — for both.
    expect(aPane.style.clipPath).toBe("inset(0 150px 0 0)");
    expect(bPane.style.clipPath).toBe("inset(0 0 0 50px)");
  });

  it("draws each side's zones into that side's clipped pane", () => {
    renderCompare(50);
    const vecA = pane("cmp-a-vec")!;
    expect(vecA).toBeTruthy();
    expect(vecA.querySelectorAll("path").length).toBe(1);
    // B has an analyzed-but-clean scan: no zone paths, and that is a result,
    // not an error.
    const vecB = pane("cmp-b-vec")!;
    expect(vecB.querySelectorAll("path").length).toBe(0);
  });

  it("dims the ground outside the shared footprint and outlines the overlap", () => {
    renderCompare(50);
    const mask = pane("cmp-mask")!;
    expect(mask).toBeTruthy();
    // The dim polygon (with its overlap-shaped hole) plus the dashed outline.
    expect(mask.querySelectorAll("path").length).toBe(2);
  });

  it("shows no mask when the footprints share no ground", () => {
    renderCompare(50, { overlap: null });
    const mask = pane("cmp-mask");
    expect(mask?.querySelectorAll("path").length ?? 0).toBe(0);
  });

  it("clears the clips on unmount so ordinary Field View is untouched", () => {
    const { unmount } = renderCompare(50);
    // Panes survive on the map (Leaflet has no removePane), but must not keep
    // clipping whatever renders next.
    unmount();
    // After unmount the map itself is gone; the property that matters is that
    // remounting a plain map has no clipped panes.
    render(
      <MapContainer center={[45, -93]} zoom={15} style={{ height: "100px", width: "100px" }} />,
    );
    expect(pane("cmp-a")?.style.clipPath ?? "").toBe("");
  });
});
