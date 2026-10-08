/**
 * Landing page copy, in one place.
 *
 * Standing rules for anything added here:
 *
 * 1. Nothing may claim a capability the product lacks. There is no 3D, no
 *    mobile app, and no autonomous flight: SwathWise emits a waypoint file a
 *    human loads into a flight controller. No invented metrics or savings
 *    percentages. No species named from pixels: identification is the
 *    operator's call, suggested from their own past verdicts and a sourced
 *    reference catalog.
 * 2. No social proof until it is approved in writing.
 * 3. No em dashes and no en dashes in anything a visitor reads, labels
 *    included. Use a colon, a comma, a period or a middot.
 * 4. Not tied to one supplier, and not claiming more than ships. Imagery can
 *    come from any drone with a camera, RGB or multispectral. Spray files ship
 *    for the aircraft in src/lib/exporters.ts and no others, so the page says
 *    "the spray aircraft we support today" and never "any spray aircraft". It
 *    names no drone maker, controller app or vendor file format: the customer
 *    base includes government work, and the copy must not tie the product to
 *    any one supplier.
 * 5. Written for a farmer, in US English. No jargon a farmer would have to
 *    look up (orthomosaic, RGB, waypoint, baseline, sub-swath), no British
 *    spelling (colour, centre, litre), and no jabs at other tools: say what
 *    this one does, not what the others get wrong. The stitched picture of
 *    the field is "the field map", never the orthomosaic.
 * 6. The pilot flies. Every mention of spraying keeps the operator in the
 *    seat: their aircraft, their license, their say-so. "Any drone" is a
 *    mapping claim and never sits next to spraying on its own.
 * 7. Nothing is said more than once. Each idea has one home on the page, and
 *    the page says less rather than more: a visitor who wants the method can
 *    ask for it.
 * 8. Broad and bold, by Yunus's decision on 2026-10-08. The page is field
 *    intelligence, not a drone-imagery pipeline, and it says it finds the
 *    weeds, all of them, from the field map. That is a flat claim the
 *    product has not yet proven on every field, crop, altitude and camera,
 *    and it stands because the founder chose it; it does not extend to
 *    invented numbers, a species named from pixels, or autonomous flight.
 */

/**
 * The status band, top of the hero and again above the request button.
 *
 * Closed testing, not a pilot program with an open door. The form still
 * exists, it just asks for access rather than promising a place. The window is
 * a date and not "this season" so a reader can tell when it has gone stale.
 */
export const STATUS_BADGE = "CLOSED TESTING · INVITE ONLY · OPENING Q4 2026";

/** The one call to action, in one place, so every button on the page says the same thing. */
export const CTA_PRIMARY = "Request access";

/** The one address the site hands out. Used by the footer and the closed-testing band. */
export const CONTACT_EMAIL = "yunus@swathwise.com";

/**
 * The hero.
 *
 * The headline is a lead that stands still and a last line that turns: what
 * the intelligence is built for. The one paragraph under the film is the
 * whole promise, as broad as it is: upload the map, it learns the field,
 * finds the weeds, measures them, you confirm, it acts.
 */
export const HERO = {
  /** The full sentence, for anywhere that needs the headline as one line. */
  headline: "Field intelligence built for action.",
  /** The first line of the hero, which stands still... */
  lead: "Field intelligence built",
  /** ...and the last, which turns through what it is built for. Each phrase completes the lead as one sentence. */
  shifts: [
    "for action.",
    "for every acre.",
    "for the whole season.",
    "for your fields.",
  ],
  /** The brand line, under the headline. Kept verbatim. */
  brand: "Precision Agriculture, Precisely Simple.",
  body: [
    "Upload your field map. SwathWise learns your field, finds the weeds, all of them, measures each one, and turns what you confirm into action.",
  ],
};

/**
 * The detection section: how it finds weeds, in three sentences a farmer can
 * repeat. The method stays in docs/features/weed-scout.md.
 */
export const DETECTION = {
  eyebrow: "HOW IT FINDS WEEDS",
  headline: "It learns your rows, then it finds what is not your crop.",
  body: [
    "Every field has a planting pattern: the rows, the spacing, the size of the plants. SwathWise measures that pattern from the field map itself, so it knows what the crop looks like before it looks for anything else.",
    "Vegetation that does not fit the pattern is a finding: likely weeds and weed patches, a thin stand, bare or wet ground. Each one is drawn on the map with its size and area, and you decide what gets treated.",
  ],
};

/**
 * The core product flow. Five steps, one line each, and the weed map is the
 * first one because everything after it is derived from it.
 */
export const FLOW = {
  headline: "Found it. Sized it. Priced it. Flew it. Filed it.",
  sub: "The weed map is the foundation. Everything after it is derived from what you confirmed on it.",
  steps: [
    { label: "FOUND IT", body: "Weeds and abnormal vegetation, found against your field's own planting pattern." },
    { label: "SIZED IT", body: "Every confirmed finding becomes a measured treatment area." },
    { label: "PRICED IT", body: "Treatment cost from your own inputs and per-acre costs." },
    { label: "FLEW IT", body: "Confirmed areas become a spray mission for supported aircraft. You fly it, on your license." },
    { label: "FILED IT", body: "The application record, written from the job that was actually flown." },
  ],
  /** The architecture, as one line. Arrows, not dashes. */
  chain: "field map → planting pattern → weed findings → your review → treatment zones → cost → mission → record",
};

export const AUDIENCES = [
  {
    label: "FARMERS",
    title: "Scout the whole field without walking it",
    body: "Fly it as often as the season demands, see the weed pressure before it goes to seed, and treat a strip instead of a section.",
  },
  {
    label: "SPRAY OPERATORS",
    title: "Quote the acres you will actually treat",
    body: "Arrive with the zones found, sized and priced, fly a mission that only crosses treated ground, and hand over a record ready to sign.",
  },
  {
    label: "AGRONOMISTS AND AGENCIES",
    title: "Survey at scale, consistently",
    body: "The same measurement on each field, each visit, in the same units, with reports that came off the data.",
  },
];
