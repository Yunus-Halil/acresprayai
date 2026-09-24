// Where a field is, in words.
//
// A field that has been mapped to the metre said "No location set", which is
// absurd: the app knew exactly where it was and could not say so. The boundary
// is the answer; it just needed reading back in a form a person uses.
//
// TWO THINGS THAT MUST NOT BE CONFUSED, and the reason this file exists rather
// than a `location = geocode(field)` line somewhere:
//
//   `fields.location`    the operator's own text. Theirs. Nothing here ever
//                        writes it. A farmer who typed "Back 40, past the
//                        creek" means that, and a geocoder's opinion does not
//                        improve on it.
//   `derived_location`   what the boundary reverse-geocodes to. Overwritable,
//                        refreshable, and always second in line.
//
// AND ONE THING THE PROVIDER MUST NOT BE ALLOWED TO INVENT. Reverse geocoding a
// point in the middle of a field returns the nearest addressable thing, which
// is somebody's house. "1164 Millwood Pond Dr" for a hundred acres of corn is
// not a location, it is a neighbour. So the label is locality and state, the
// level a field genuinely has, and a house number is discarded on principle
// rather than trimmed for tidiness.
import { type LatLng2, centroidOfRings, distM } from "../geo";

/** What the app remembers about a field's derived location. */
export type DerivedLocation = {
  /** "Winchester, VA". The locality and state, and nothing finer. */
  label: string;
  /** The road the provider named, when it named one. Usually absent. */
  road: string | null;
  /** The boundary centre this was derived from. See RELOCATE_THRESHOLD_M. */
  key: string;
  /** When it was fetched, ISO. */
  at: string;
};

/**
 * How far a boundary's centre must move before the answer could have changed.
 *
 * A hundred metres. Below that a field cannot have crossed into another town,
 * so refetching would spend somebody else's rate limit to be told the same
 * thing. Above it, a field genuinely dragged somewhere new would keep a stale
 * label.
 *
 * NOT A ROUNDED KEY, which is what this was first. Rounding to three decimal
 * places is also about a hundred metres, and it is wrong at every boundary
 * between two rounded values: a centroid sitting on .0005 flips to a different
 * key when a corner moves two metres, and refetches. Distance has no such
 * edges, and "has it moved 100 m" is the question actually being asked.
 */
export const RELOCATE_THRESHOLD_M = 100;

/**
 * The centre a derived location was worked out from, as stored.
 *
 * Six places, about a tenth of a metre, because it is compared by distance and
 * there is no reason to throw precision away first.
 */
export const locationKey = (c: LatLng2): string => `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`;

/** Back to a point, or null if the stored key is unreadable. */
export function parseLocationKey(key: string | null | undefined): LatLng2 | null {
  if (!key) return null;
  const [lat, lng] = key.split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export type FieldGeo = {
  boundary: unknown | null;
  /** Ortho bounds, when there is no boundary. See `fieldCentroid`. */
  orthoBounds?: { north: number; south: number; east: number; west: number } | null;
};

const isRings = (v: unknown): v is LatLng2[][] =>
  Array.isArray(v) && v.length > 0 && Array.isArray(v[0]) && v[0].length >= 3
  && typeof (v[0][0] as LatLng2)?.lat === "number";

/**
 * The point to ask about.
 *
 * THE BOUNDARY FIRST, always. It is the operator's own statement of where the
 * field is, and it is the only source that means the field rather than
 * something near it.
 *
 * Failing that, the centre of an orthomosaic's bounds. That imagery was flown
 * over this field and its extent came from the aircraft's own GPS, so it is
 * real evidence rather than a guess, but it covers whatever the flight covered
 * and can reach past the field edge, which is why it is second.
 *
 * There is deliberately no third fallback. Per-image EXIF GPS is not persisted
 * anywhere in this database, so "read it off the photographs" would mean
 * re-downloading imagery to place a text label, and a field with neither a
 * boundary nor an orthomosaic has given the app nothing to work from. It says
 * so instead of guessing.
 */
export function fieldCentroid(f: FieldGeo): LatLng2 | null {
  if (isRings(f.boundary)) {
    const c = centroidOfRings(f.boundary);
    if (Number.isFinite(c.lat) && Number.isFinite(c.lng)) return c;
  }
  const b = f.orthoBounds;
  if (b && [b.north, b.south, b.east, b.west].every(v => typeof v === "number" && Number.isFinite(v))) {
    return { lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading a provider's answer
// ---------------------------------------------------------------------------

/** The part of a Nominatim reverse response this reads. Everything is optional. */
export type ReverseAddress = {
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  suburb?: string;
  county?: string;
  state?: string;
  "ISO3166-2-lvl4"?: string;
  country_code?: string;
  road?: string;
};

/**
 * The locality, in the order a person would reach for one.
 *
 * County is last and is a real answer for farmland: a field ten miles from
 * anywhere belongs to a county and to no town, and "Frederick County" is more
 * use than the name of the nearest hamlet nobody has heard of.
 */
const locality = (a: ReverseAddress): string | null =>
  a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || a.county || null;

/**
 * The state, abbreviated where the provider gives a code.
 *
 * `ISO3166-2-lvl4` is "US-VA", and the half after the dash is what an American
 * operator writes. Outside the US the full name is what people use, so the
 * abbreviation is only taken when the country is one that abbreviates.
 */
function stateOf(a: ReverseAddress): string | null {
  const iso = a["ISO3166-2-lvl4"];
  const cc = (a.country_code ?? "").toLowerCase();
  if (iso && (cc === "us" || cc === "ca" || cc === "au")) {
    const code = iso.split("-")[1];
    if (code) return code.toUpperCase();
  }
  return a.state ?? null;
}

/**
 * Turn a reverse-geocode response into the label a card shows.
 *
 * Returns null rather than something shaped like an answer when the response
 * carries no locality. "United States" under a field name is noise, and a blank
 * that invites the operator to type the real thing is better than filler.
 */
export function labelFrom(address: ReverseAddress | null | undefined): { label: string; road: string | null } | null {
  if (!address) return null;
  const place = locality(address);
  if (!place) return null;
  const state = stateOf(address);
  return {
    label: state ? `${place}, ${state}` : place,
    // The road only, never the house number: see the note at the top. A field
    // is on a road; it is not at number 1164.
    road: address.road?.trim() || null,
  };
}

// ---------------------------------------------------------------------------
// What to show, and when to ask again
// ---------------------------------------------------------------------------

export type LocatableField = FieldGeo & {
  /** The operator's own text, or null. */
  location: string | null;
  derived_location: DerivedLocation | null;
};

/**
 * The line under a field's name.
 *
 * The operator's own words first, whatever they are. This is the whole reason
 * the two are stored apart.
 */
export function displayLocation(f: LocatableField): string | null {
  const own = f.location?.trim();
  if (own) return own;
  return f.derived_location?.label?.trim() || null;
}

/**
 * Whether this field should be sent to the geocoder now.
 *
 * Four reasons not to, and each one matters:
 *
 *   the operator wrote their own       nothing to add, and asking would spend a
 *                                      request to produce something unused
 *   nowhere to ask about               no boundary and no imagery
 *   the answer still fits the boundary the centre has not moved 100 m, so the
 *                                      town cannot have changed
 *   it was tried and there was nothing there
 *
 * The third is the one that keeps this off the network on every page load,
 * which is the difference between a feature and an abuse of a free service.
 */
export function needsGeocode(f: LocatableField): boolean {
  if (f.location?.trim()) return false;
  const c = fieldCentroid(f);
  if (!c) return false;
  const derived = f.derived_location;
  if (!derived) return true;
  const was = parseLocationKey(derived.key);
  // An unreadable key is treated as no key: ask again rather than keep a label
  // nothing can vouch for.
  if (!was) return true;
  return distM(was, c) > RELOCATE_THRESHOLD_M;
}

/** The fields to ask about, in order, given a page's worth of them. */
export const fieldsNeedingGeocode = <F extends LocatableField>(fields: readonly F[]): F[] =>
  fields.filter(needsGeocode);
