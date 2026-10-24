import { describe, expect, it } from "vitest";
import { utmToLatLng } from "../../scripts/bench/utm";

describe("utmToLatLng", () => {
  it("places the CN Tower (17T 630084 4833438) at 43.6426 N, 79.3871 W", () => {
    const p = utmToLatLng(630084, 4833438, 17, false);
    expect(p.lat).toBeCloseTo(43.6426, 3);
    expect(p.lng).toBeCloseTo(-79.3871, 3);
  });
  it("puts a zone's central meridian on the equator at 500000 E, 0 N", () => {
    const p = utmToLatLng(500000, 0, 31, false);
    expect(p.lat).toBeCloseTo(0, 6);
    expect(p.lng).toBeCloseTo(3, 6);
  });
  it("reads the southern hemisphere from the false northing", () => {
    const p = utmToLatLng(500000, 10000000 - 1105855, 31, true); // about 10 degrees south
    expect(p.lat).toBeCloseTo(-10, 1);
  });
});
