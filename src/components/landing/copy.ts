/**
 * Landing page copy, in one place.
 *
 * Standing rules for anything added here:
 *
 * 1. Nothing may claim a capability the product lacks. There is no mobile
 *    app and no autonomous flight: Swardus emits a mission file a human loads
 *    into a flight controller. No invented metrics or savings percentages. No
 *    species named from pixels: identification is the operator's call,
 *    suggested from their own past verdicts and a sourced reference catalog.
 * 2. No social proof until it is approved in writing.
 * 3. No em dashes and no en dashes in anything a visitor reads, labels
 *    included. Use a colon, a comma, a period or a middot.
 * 4. Not tied to one supplier, and not claiming more than ships. It names no
 *    drone maker, controller app or vendor file format: the customer base
 *    includes government work. Spray files ship for the aircraft in
 *    src/lib/exporters.ts and no others.
 * 5. Written for a farmer, in US English. No jargon a farmer would have to
 *    look up (orthomosaic, RGB, waypoint), no British spelling (colour,
 *    centre, litre). The stitched picture of the field is "the field map",
 *    never the orthomosaic.
 * 6. The pilot flies. Every mention of spraying keeps the operator in the
 *    seat: their aircraft, their license, their say-so.
 * 7. Extremely little copy. The pictures carry the page; each idea has one
 *    home and the words under it are as few as will do.
 * 8. Nothing unmeasured is presented as an established result (the website
 *    redesign brief, 2026-10-27). No turnaround time, no accuracy figure and
 *    no "finds all of them": the page shows what the product does on a real
 *    flight and lets the picture make the case. This replaces the 2026-10-08
 *    "broad and bold" rule, which promised every weed found.
 * 9. HOW it finds weeds is a trade secret and stays out of the words (Yunus,
 *    2026-10-08): never the pattern it reads, the spacing, the signal, or any
 *    step of the method. The pictures are the product's own output and may
 *    show what it draws; the copy does not explain it.
 * 10. Every picture is the product's own output over a real flight, never a
 *    mock-up, a render made for the page, or stock. Where a picture is
 *    missing, the page says so in the frame; it does not fake one.
 */

/** The closed-testing line. The window is a date so a reader can tell when it has gone stale. */
export const STATUS_BADGE = "CLOSED TESTING · INVITE ONLY · OPENING Q4 2026";

/** The one call to action, so every button that asks for access says the same thing. */
export const CTA_PRIMARY = "Request access";

/** The hero's second button: into the product, on this page. */
export const CTA_EXPLORE = "Explore Swardus";

/** Where every "Request access" goes. */
export const ACCESS_HREF = "/apply";

/** The one address the site hands out. */
export const CONTACT_EMAIL = "yunus@swardus.com";

export const NAV = [
  { label: "Platform", href: "#beyond" },
  { label: "Operations", href: "#operations" },
  { label: "Who it's for", href: "#who" },
];

/**
 * The hero, word for word from the redesign brief. "Every" is allowed here
 * and only here: the brief's headline is the one exception to the 2026-10-08
 * "no every" rule.
 */
export const HERO = {
  headline: "Every field. Understood.",
  lines: ["Every field.", "Understood."],
  sub: "From drone imagery to field intelligence.",
  /** The brand line, kept verbatim. It lives in the footer now. */
  brand: "Precision Agriculture, Precisely Simple.",
};

/**
 * "Beyond the map": one real flight, from the whole field down to one plant
 * and its photographs. `from` is where each stage starts in the scroll, 0 to 1.
 */
export const BEYOND = {
  heading: "Beyond the map.",
  stages: [
    { label: "Field", line: "The whole field from one flight.", from: 0 },
    { label: "Crop", line: "Each tree where it stands.", from: 0.2 },
    { label: "Plant", line: "Each weed, outlined.", from: 0.45 },
    { label: "Finding", line: "One weed, selected.", from: 0.76 },
    { label: "Evidence", line: "Back to the photographs.", from: 0.86 },
  ],
  photosLabel: "4 OF THE 12 PHOTOGRAPHS THAT SAW IT",
};

/** "Down to the individual plant": the selected weed, its measurements and its photographs. */
export const PLANT = {
  heading: "Down to the individual plant.",
  across: "Across",
  ground: "Ground covered",
  seen: "Photographs",
  /** {seen} and {covered} are filled from the specimen. */
  seenValue: "{seen} of {covered}",
  seenNote: "that covered it",
  caption: "ONE WEED · REAL FLIGHT · MEASURED IN THE PHOTOGRAPHS",
};

/**
 * "From finding to field operation": scouting, zones and the mission as one
 * line of work, in words only (Yunus removed the pictures, 2026-10-27). The findings line names what is found besides weeds; the
 * mission line keeps the pilot in the seat (rule 6).
 */
export const OPERATIONS = {
  heading: "From finding to field operation.",
  steps: [
    {
      label: "Scout",
      line: "Weeds, thin stand, bare or wet ground: outlined and sized.",
    },
    {
      label: "Zones",
      line: "What you confirm becomes a treatment zone.",
    },
    {
      label: "Mission",
      line: "Planned over those zones. Flown by you, on your license.",
    },
  ],
};

export const AUDIENCES = {
  heading: "Built for those who work the land.",
  items: [
    { label: "Growers", line: "See the whole field before you walk it." },
    { label: "Agronomists", line: "The same measurement on each field, each visit." },
    { label: "Drone operators", line: "Arrive knowing which acres need treating." },
    { label: "Researchers", line: "Plant-level records, traced to the source photographs." },
  ],
};

export const ACCESS = {
  heading: "The next generation of field intelligence.",
  status: "CLOSED TESTING",
  email: "OR EMAIL",
};
