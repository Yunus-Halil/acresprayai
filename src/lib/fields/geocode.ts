// Asking OpenStreetMap where a point is.
//
// Nominatim, which the flight planner's address search already uses. No key, no
// billing, no new dependency, and the same provider for both directions of the
// same question.
//
// THE RATE LIMIT IS A CONDITION OF USE, NOT A PERFORMANCE SETTING. Nominatim's
// policy is one request per second from a single source, and an app that fires
// twenty in parallel on page load gets its users blocked rather than throttled.
// So requests are serialised here, in the one place that makes them, instead of
// each caller being trusted to remember.
import { supabase } from "@/integrations/supabase/client";
import type { LatLng2 } from "../geo";
import {
  type DerivedLocation, type LocatableField, type ReverseAddress, fieldCentroid, labelFrom,
  locationKey,
} from "./location";

/** Nominatim's stated limit. One per second, from everybody. */
export const MIN_REQUEST_GAP_MS = 1100;

/**
 * Zoom 14 is roughly "suburb or village".
 *
 * Deliberately not 18. A higher zoom returns the nearest building, which for a
 * field is a neighbour's house, and the label would then look precise and be
 * wrong. Asking at the level the answer is wanted is more honest than asking
 * precisely and discarding most of it.
 */
const ZOOM = 14;

let lastRequestAt = 0;

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Reverse-geocode one point.
 *
 * Returns null for "no usable answer", which covers a failed request, a
 * throttled one and a response with no locality in it. The caller cannot act
 * differently on those and the operator certainly cannot, so they collapse into
 * one outcome: nothing was learned, the field keeps everything it already had,
 * and the operator can type a location themselves.
 */
export async function reverseGeocode(
  point: LatLng2,
  signal?: AbortSignal,
): Promise<{ label: string; road: string | null } | null> {
  const since = Date.now() - lastRequestAt;
  if (since < MIN_REQUEST_GAP_MS) await wait(MIN_REQUEST_GAP_MS - since);
  lastRequestAt = Date.now();

  try {
    const url = "https://nominatim.openstreetmap.org/reverse"
      + `?format=jsonv2&zoom=${ZOOM}&addressdetails=1`
      + `&lat=${encodeURIComponent(point.lat)}&lon=${encodeURIComponent(point.lng)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { address?: ReverseAddress } | null;
    return labelFrom(body?.address);
  } catch {
    // Offline, blocked, aborted, or malformed. All the same to the caller, and
    // none of them is a reason to lose the field's geometry or its own text.
    return null;
  }
}

export type GeocodeOutcome = { id: string; derived: DerivedLocation };

/**
 * Work through the fields that need a location, one per second, persisting each
 * answer as it arrives.
 *
 * PERSISTED IMMEDIATELY, ONE ROW AT A TIME. A backfill over twenty fields takes
 * twenty seconds, and an operator who navigates away after five should keep
 * those five. Batching the writes to the end would throw away most of the work
 * and then do it all again on the next visit.
 *
 * `onResolved` reports each answer so the page can show it without refetching.
 */
export async function backfillLocations(
  fields: readonly (LocatableField & { id: string })[],
  onResolved: (out: GeocodeOutcome) => void,
  signal?: AbortSignal,
): Promise<void> {
  for (const f of fields) {
    if (signal?.aborted) return;
    const centre = fieldCentroid(f);
    if (!centre) continue;

    const answer = await reverseGeocode(centre, signal);
    if (signal?.aborted) return;
    // A failure writes nothing. Storing an empty label would look like a
    // settled "nowhere" and would stop the field ever being asked about again.
    if (!answer) continue;

    const derived: DerivedLocation = {
      label: answer.label,
      road: answer.road,
      key: locationKey(centre),
      at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("fields")
      .update({ derived_location: derived as never })
      .eq("id", f.id);
    // A write that fails leaves the field exactly as it was, which is a field
    // that will be asked about again next time. That is the right failure.
    if (!error) onResolved({ id: f.id, derived });
  }
}
