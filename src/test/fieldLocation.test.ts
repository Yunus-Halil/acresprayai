// Where a field is, in words.
//
// A field mapped to the metre said "No location set". The app knew exactly
// where it was and could not say so.
//
// The two risks worth testing are not about geocoding. They are about not
// overwriting what the operator typed, and not asking a free public service the
// same question on every page load.
import { describe, expect, it } from "vitest";
import {
  type DerivedLocation, type LocatableField, type ReverseAddress, displayLocation, fieldCentroid,
  fieldsNeedingGeocode, labelFrom, locationKey, needsGeocode, parseLocationKey,
} from "@/lib/fields/location";

const ring = (lat: number, lng: number, d = 0.001) => [[
  { lat, lng }, { lat, lng: lng + d }, { lat: lat + d, lng: lng + d }, { lat: lat + d, lng },
]];

const derived = (over: Partial<DerivedLocation> = {}): DerivedLocation => ({
  label: "Winchester, VA", road: null, key: "39.001,-78.164", at: "2026-09-24T00:00:00Z", ...over,
});

const field = (over: Partial<LocatableField> = {}): LocatableField => ({
  boundary: null, location: null, derived_location: null, ...over,
});

describe("the point to ask about", () => {
  it("is the boundary's centre when there is a boundary", () => {
    const c = fieldCentroid(field({ boundary: ring(39, -78) }))!;
    expect(c.lat).toBeCloseTo(39.0005, 4);
    expect(c.lng).toBeCloseTo(-77.9995, 4);
  });

  it("falls back to the orthomosaic's bounds, which came from the aircraft", () => {
    const c = fieldCentroid(field({
      orthoBounds: { north: 39.01, south: 38.99, east: -77.99, west: -78.01 },
    }))!;
    expect(c.lat).toBeCloseTo(39, 6);
    expect(c.lng).toBeCloseTo(-78, 6);
  });

  it("prefers the boundary, because it means the field and not the flight", () => {
    // Imagery covers whatever the flight covered and can reach past the edge.
    const c = fieldCentroid(field({
      boundary: ring(39, -78),
      orthoBounds: { north: 50, south: 49, east: 10, west: 9 },
    }))!;
    expect(c.lat).toBeCloseTo(39.0005, 4);
  });

  it("says it has nothing rather than guessing", () => {
    expect(fieldCentroid(field())).toBeNull();
    expect(fieldCentroid(field({ boundary: [] }))).toBeNull();
    expect(fieldCentroid(field({ boundary: [[{ lat: 1, lng: 1 }]] }))).toBeNull();
    expect(fieldCentroid(field({ boundary: "somewhere" }))).toBeNull();
  });
});

describe("reading the provider's answer", () => {
  it("gives locality and an abbreviated state in the US", () => {
    expect(labelFrom({
      city: "Winchester", state: "Virginia", "ISO3166-2-lvl4": "US-VA", country_code: "us",
    })).toEqual({ label: "Winchester, VA", road: null });
  });

  it("spells the region out where that is what people write", () => {
    expect(labelFrom({
      city: "Rostock", state: "Mecklenburg-Vorpommern", "ISO3166-2-lvl4": "DE-MV", country_code: "de",
    })).toEqual({ label: "Rostock, Mecklenburg-Vorpommern", road: null });
  });

  it("falls back through town, village and county, which farmland needs", () => {
    const at = (a: ReverseAddress) => labelFrom({ ...a, state: "Virginia", "ISO3166-2-lvl4": "US-VA", country_code: "us" })?.label;
    expect(at({ town: "Berryville" })).toBe("Berryville, VA");
    expect(at({ village: "Boyce" })).toBe("Boyce, VA");
    // A field ten miles from anywhere belongs to a county and to no town.
    expect(at({ county: "Frederick County" })).toBe("Frederick County, VA");
  });

  it("keeps a road when the provider names one", () => {
    expect(labelFrom({
      road: "Millwood Pond Dr", city: "Winchester", "ISO3166-2-lvl4": "US-VA", country_code: "us",
    })).toEqual({ label: "Winchester, VA", road: "Millwood Pond Dr" });
  });

  it("never builds a street address out of a field's coordinates", () => {
    // Reverse geocoding the middle of a field returns the nearest addressable
    // thing, which is somebody's house. "1164 Millwood Pond Dr" for a hundred
    // acres of corn is not a location, it is a neighbour.
    const out = labelFrom({
      house_number: "1164", road: "Millwood Pond Dr", city: "Winchester",
      "ISO3166-2-lvl4": "US-VA", country_code: "us",
    } as ReverseAddress);
    expect(out!.label).toBe("Winchester, VA");
    expect(out!.road).toBe("Millwood Pond Dr");
    expect(JSON.stringify(out)).not.toContain("1164");
  });

  it("says nothing rather than something shaped like an answer", () => {
    // "United States" under a field name is noise. A blank invites the operator
    // to type the real thing.
    expect(labelFrom({ country_code: "us", state: "Virginia" })).toBeNull();
    expect(labelFrom(null)).toBeNull();
    expect(labelFrom(undefined)).toBeNull();
    expect(labelFrom({})).toBeNull();
  });
});

describe("what the card shows", () => {
  it("shows the operator's own words above everything else", () => {
    expect(displayLocation(field({
      location: "Back 40, past the creek",
      derived_location: derived(),
    }))).toBe("Back 40, past the creek");
  });

  it("shows the derived label when the operator has not written one", () => {
    expect(displayLocation(field({ derived_location: derived() }))).toBe("Winchester, VA");
  });

  it("shows nothing when there is nothing, rather than a placeholder", () => {
    expect(displayLocation(field())).toBeNull();
    expect(displayLocation(field({ location: "   " }))).toBeNull();
  });
});

describe("when to ask the geocoder", () => {
  it("does not ask about a field the operator has already described", () => {
    // THE RULE THE WHOLE DESIGN RESTS ON. A farmer who typed "Back 40, past the
    // creek" means that, and a geocoder's opinion does not improve on it.
    expect(needsGeocode(field({
      boundary: ring(39, -78), location: "Back 40, past the creek",
    }))).toBe(false);
  });

  it("asks about a mapped field that has no location at all", () => {
    expect(needsGeocode(field({ boundary: ring(39, -78) }))).toBe(true);
  });

  it("does not ask again while the boundary is in the same place", () => {
    // THE RULE THAT KEEPS THIS OFF THE NETWORK. Nominatim allows one request a
    // second from everybody; re-asking on every page load is how an app gets
    // its users blocked rather than throttled.
    const f = field({ boundary: ring(39, -78) });
    const key = locationKey(fieldCentroid(f)!);
    expect(needsGeocode({ ...f, derived_location: derived({ key }) })).toBe(false);
  });

  it("ignores a boundary edit too small to change the answer", () => {
    // Nudging a corner by a few metres cannot move a field into the next town.
    const before = field({ boundary: ring(39, -78) });
    const key = locationKey(fieldCentroid(before)!);
    const nudged = field({
      boundary: ring(39.00002, -78.00002),
      derived_location: derived({ key }),
    });
    expect(needsGeocode(nudged)).toBe(false);
  });

  it("asks again when the boundary really has moved", () => {
    const moved = field({
      boundary: ring(40.5, -79.5),
      derived_location: derived({ key: locationKey({ lat: 39, lng: -78 }) }),
    });
    expect(needsGeocode(moved)).toBe(true);
  });

  it("does not ask about a field with nowhere to ask about", () => {
    expect(needsGeocode(field())).toBe(false);
  });

  it("picks out only the fields that need it from a page of them", () => {
    const mapped = field({ boundary: ring(39, -78) });
    const key = locationKey(fieldCentroid(mapped)!);
    const todo = fieldsNeedingGeocode([
      { ...mapped, id: "needs-it" },
      { ...mapped, id: "already-has-it", derived_location: derived({ key }) },
      { ...mapped, id: "operator-wrote-one", location: "Home farm" },
      { ...field(), id: "no-boundary" },
    ] as (LocatableField & { id: string })[]);
    expect(todo.map(f => f.id)).toEqual(["needs-it"]);
  });
});

describe("the stored centre", () => {
  it("round-trips, so the comparison is against a real point", () => {
    const c = { lat: 39.0004999, lng: -78.1644321 };
    const back = parseLocationKey(locationKey(c))!;
    expect(back.lat).toBeCloseTo(c.lat, 6);
    expect(back.lng).toBeCloseTo(c.lng, 6);
  });

  it("is asked again when the stored key is unreadable", () => {
    // Better to spend one request than to show a label nothing can vouch for.
    expect(needsGeocode(field({
      boundary: ring(39, -78), derived_location: derived({ key: "corrupt" }),
    }))).toBe(true);
  });

  it("has no rounding edge, which a rounded key did", () => {
    // A centroid sitting on a rounding boundary flipped to a different key when
    // a corner moved two metres, and refetched. Distance has no such edges.
    const onTheEdge = { lat: 39.0005, lng: -78.0005 };
    const nudged = { lat: 39.00052, lng: -78.00052 };
    expect(needsGeocode({
      boundary: ring(nudged.lat - 0.0005, nudged.lng - 0.0005),
      location: null,
      derived_location: derived({ key: locationKey(onTheEdge) }),
    })).toBe(false);
  });
});
