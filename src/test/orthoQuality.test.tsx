// The orthomosaic stays sharp across token refreshes, and the map says what detail it is showing.
import { render, screen } from "@testing-library/react";
import { MapContainer } from "react-leaflet";
import { describe, expect, it } from "vitest";
import { OrthoQualityBadge, orthoQualityState } from "@/components/app/workspace/OrthoQualityBadge";
import { orthoLayerKey, sameImagery } from "@/components/app/workspace/OrthoTileLayer";

const T = "https://x.supabase.co/functions/v1/tile/abc/{z}/{x}/{y}.png";

describe("a token refresh is not new imagery", () => {
  it("URLs differing only in the session token show the same imagery and share a layer key", () => {
    const a = `${T}?token=old-jwt&v=uint8~1-2-3~0_255`, b = `${T}?token=new-jwt&v=uint8~1-2-3~0_255`;
    expect(sameImagery(a, b)).toBe(true);
    expect(orthoLayerKey(a)).toBe(orthoLayerKey(b));
  });

  it("a rebake, a new render version or another scan is new imagery", () => {
    const base = `${T}?token=jwt`;
    expect(sameImagery(base, `${T}?token=jwt&rev=1`)).toBe(false);
    expect(sameImagery(`${T}?token=jwt&v=a`, `${T}?token=jwt&v=b`)).toBe(false);
    expect(sameImagery(base, base.replace("/abc/", "/def/"))).toBe(false);
    expect(orthoLayerKey(base)).not.toBe(orthoLayerKey(`${T}?token=jwt&rev=1`));
    expect(sameImagery(base, null)).toBe(false);
  });
});

describe("the quality badge", () => {
  it("reads the view against the deepest zoom with real tiles", () => {
    expect(orthoQualityState(22, 22, false)).toBe("full");
    expect(orthoQualityState(19, 22, false)).toBe("overview");
    expect(orthoQualityState(23, 22, false)).toBe("enlarged");
    expect(orthoQualityState(22, 22, true)).toBe("loading"); // loading wins
    expect(orthoQualityState(21.6, 22, false)).toBe("full"); // fractional zooms round
  });

  it("shows the finest detail in the operator's units and the state", () => {
    // Zoom 22 at 40 degrees N: about 2.86 cm (1.1 in) a pixel.
    const { unmount } = render(
      <MapContainer center={[40, -75]} zoom={22} style={{ height: 200, width: 200 }}>
        <OrthoQualityBadge lat={40} maxNativeZoom={22} loading={false} units="metric" />
      </MapContainer>,
    );
    const badge = screen.getByTestId("ortho-quality");
    expect(badge.textContent).toMatch(/Map detail 2\.9 cm a pixel/);
    expect(badge.textContent).toMatch(/Full detail/);
    unmount();
    render(
      <MapContainer center={[40, -75]} zoom={18} style={{ height: 200, width: 200 }}>
        <OrthoQualityBadge lat={40} maxNativeZoom={22} loading={false} units="imperial" />
      </MapContainer>,
    );
    const b2 = screen.getByTestId("ortho-quality");
    expect(b2.textContent).toMatch(/Map detail 1\.1 in a pixel/);
    expect(b2.textContent).toMatch(/zoom in for full detail/);
  });
});
