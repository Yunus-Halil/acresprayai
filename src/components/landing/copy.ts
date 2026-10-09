/**
 * Landing page copy, in one place.
 *
 * Standing rules for anything added here:
 *
 * 1. Nothing may claim a capability the product lacks. There is no 3D, no
 *    mobile app, and no autonomous flight: Swardus emits a waypoint file a
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
 * 9. HOW it finds weeds is a trade secret and stays off the page entirely
 *    (Yunus, 2026-10-08). The page says what it finds, what it measures and
 *    what happens next; never the pattern it reads, the rows, the spacing,
 *    the signal, or any step of the method. The method lives in
 *    docs/features/weed-scout.md, for the team.
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
 * whole promise, as broad as it is: upload the map, it finds the weeds,
 * measures them, you confirm, it acts. Not a word about how.
 */
export const HERO = {
  /** The full sentence, for anywhere that needs the headline as one line. */
  headline: "Field intelligence built for action.",
  /** The first line of the hero, which stands still... */
  lead: "Field intelligence built",
  /** ...and the last, which turns through what it is built for. Each phrase completes the lead as one sentence. */
  shifts: [
    "for action.",
    "for the whole farm.",
    "for the whole season.",
    "for your fields.",
  ],
  /** The brand line, under the headline. Kept verbatim. */
  brand: "Precision Agriculture, Precisely Simple.",
  body: [
    "Upload your field map. Swardus finds the weeds, all of them, measures each one, and turns what you confirm into action.",
  ],
};

/**
 * The statement, in the narrow column under the rail: what the product is,
 * in two sentences, with the words that matter picked out. The second line
 * names what it finds. Never how (rule 9).
 */
export const STATEMENT = {
  lead: [
    { text: "Swardus turns the field map from your drone into " },
    { text: "decisions", hi: true },
    { text: ": the weeds " },
    { text: "found and measured", hi: true },
    { text: ", the treatment confirmed by you, the mission flown by you." },
  ],
  findings: "It finds weeds and weed patches, a thin stand, bare or wet ground, and any patch that is not behaving like the rest of the field, each drawn on the map with its size and area.",
  softwareHeading: "The software",
};

/**
 * The parts of the product, as a list of names with one small line each.
 * Names, not features: a visitor reads the name and the line and moves on.
 * The mission line keeps the pilot in the seat (rule 6).
 */
export const SOFTWARE = [
  { name: "Scout", body: "Finds the weeds on your field map and measures each one." },
  { name: "Zones", body: "Confirmed findings become treatment areas, sized in acres." },
  { name: "Mission", body: "A spray mission over the zones you confirmed, for supported aircraft. You fly it, on your license." },
  { name: "Weather", body: "Wind, rain and temperature for your field, so the spray windows are easy to see." },
  { name: "Fields", body: "Your fields, your flights and your findings, in one account." },
];

/**
 * The rail under the hero: frames from the film, each with a small label.
 * The frames are cut from the hero master (public/film); the last card is a
 * real screen of a mission. The labels are the page in seven lines.
 */
export const RAIL = [
  { src: "/film/frame-10.jpg", eyebrow: "THE FLIGHT", title: "Fly the field you already fly", alt: "A spray drone on its trailer at the edge of a field" },
  { src: "/film/frame-35.jpg", eyebrow: "THE FIELD", title: "One flight, the whole field", alt: "A field from the air under a summer sky" },
  { src: "/film/frame-65.jpg", eyebrow: "THE MAP", title: "The field map, read for weeds", alt: "An orchard from above with the flight route drawn over it" },
  { src: "/film/frame-125.jpg", eyebrow: "THE SCOUT", title: "The weeds, found and measured", alt: "A field map with the findings outlined" },
  { src: "/film/frame-95.jpg", eyebrow: "THE ZONES", title: "Treat only what you confirmed", alt: "A spray drone lifting off beside a field" },
  { src: "/film/frame-155.jpg", eyebrow: "THE MISSION", title: "Flown by you, on your license", alt: "A pilot's controller showing the mission over the field" },
  { src: "/screens/mission-route.jpg", eyebrow: "THE PLAN", title: "The route before the flight", alt: "The flight planner with a spray mission drawn over a field map" },
];

export const AUDIENCES = [
  {
    label: "FARMERS",
    title: "Scout the whole field without walking it",
    body: "Fly it as often as the season demands, see the weed pressure before it goes to seed, and treat only what needs it.",
  },
  {
    label: "SPRAY OPERATORS",
    title: "Quote the acres you will actually treat",
    body: "Arrive with the zones already found and sized, and fly only the ground that needs treating.",
  },
  {
    label: "AGRONOMISTS AND AGENCIES",
    title: "Survey at scale, consistently",
    body: "The same measurement on each field, each visit, in the same units, with reports that came off the data.",
  },
];
