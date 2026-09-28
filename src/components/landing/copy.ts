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
 * 4. Not tied to one supplier. Imagery can come from any drone with a camera,
 *    RGB or multispectral, and the flight files are standard files a drone's
 *    controller already reads. The page names no drone maker, controller app
 *    or vendor file format: the customer base includes government work, and
 *    the copy must not tie the product to any one supplier.
 * 5. Written for a farmer, in US English. No jargon a farmer would have to
 *    look up (orthomosaic, RGB, waypoint, baseline, sub-swath), no British
 *    spelling (colour, centre, litre), and no jabs at other tools: say what
 *    this one does, not what the others get wrong.
 * 6. The pilot flies. Every mention of spraying keeps the operator in the
 *    seat: their aircraft, their license, their say-so. "Any drone" is a
 *    mapping claim and never sits next to spraying on its own.
 * 7. Nothing is said more than once. Each idea has one home on the page.
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
 * SwathWise is precision agriculture: map the field, find what is wrong with
 * it, treat only that, keep the record. Weeds are the flagship job and the
 * one the page leads with, because they are the one most farms lose money on
 * every season, but they are not the category. The same scan surfaces bare
 * ground, thin stand and waterlogged patches, and the same planner treats
 * whatever the operator confirms.
 *
 * Every clause is a capability that ships. "Every plant that does not match
 * the field" is the exact thing the detector does: it builds the field's own
 * baseline from the field's own pixels and flags what departs from it. It is
 * not a promise of perfect recall and the page never makes one.
 */
export const HERO = {
  kicker: "PRECISION AGRICULTURE, FROM THE AIR",
  headline: "Every weed on your farm. Found from the air.",
  sub:
    "SwathWise is precision agriculture for any drone and any field. It maps your farm from "
    + "the imagery, measures every plant against your own crop, and shows you where the weeds "
    + "are, along with every patch that is not behaving like the rest of the field. Confirm what "
    + "you want treated, and it plans the spray flight that covers only those spots and writes "
    + "the record when you land. For the farmer who owns the fields and the operator who sprays them.",
  bullets: [
    "Any drone, any camera, any crop",
    "Every plant measured against your own field",
    "Nothing sprays until you say so",
    "Runs in a browser. Nothing to install",
  ],
};

export const FEATURES = [
  {
    num: "01",
    title: "It reads the whole farm",
    body: "Not a sample. Every square foot of your imagery is measured: color, brightness, how much of it is plant, and how each patch compares to the ground around it. Weeds, bare ground, thin stand, wet patches, all from one flight.",
  },
  {
    num: "02",
    title: "It knows what your crop looks like",
    body: "It learns from your own field, not a textbook. Every plant is sized and colored against the plants beside it, so a weed stands out because it is not corn, not because someone told it what corn is.",
  },
  {
    num: "03",
    title: "It flies whatever you fly",
    body: "Survey flights and spray flights come out as standard flight files your drone's controller already reads. Map with any drone that has a camera. Spray with your own spray aircraft.",
  },
  {
    num: "04",
    title: "It writes the paperwork",
    body: "Product, acres, conditions, applicator, field, signature line. The application record comes off the job you flew. Nothing retyped, nothing remembered at the kitchen table.",
  },
];

/**
 * The detection section: a headline, one paragraph, and a real scan. No
 * walkthrough of the method. Farmers care what it finds, not how.
 */
export const DETECTION = {
  eyebrow: "HOW IT FINDS THEM",
  headline: "It does not guess where the weeds are. It measures.",
  sub:
    "Most tools look for a picture of a weed. SwathWise learns what your field looks like today, "
    + "from your own imagery, and then shows you everything that does not fit. It runs in your "
    + "browser, on your fields.",
};

export const STEPS = [
  {
    num: "01",
    title: "Fly it with anything",
    body: "Plan the survey in SwathWise, load the flight into your drone, fly it. Or drop in photos you already have, or a finished field map from any camera. All you need is a drone with a camera and a browser.",
  },
  {
    num: "02",
    title: "See every weed on the map",
    body: "The scan comes back as a map with every finding drawn on it, worst first, each with a photo of the spot. Tap one, keep it or throw it out, name it if you know it.",
  },
  {
    num: "03",
    title: "Spray exactly those, then file it",
    body: "One button turns the findings you kept into a spray mission for your aircraft: route, loads, batteries, refills. You fly it, on your license, on your say-so. The application record is already written when you land.",
  },
];

export const AUDIENCES = [
  {
    label: "FARMERS",
    title: "Walk the whole farm from a chair",
    body: "Every field, every plant, every week if you want. Spot the patch before it goes to seed and spray a strip instead of a section. If you can use a browser, you can run it.",
  },
  {
    label: "SPRAY OPERATORS",
    title: "Quote the acres you will actually treat",
    body: "Arrive with the zones already found, sized and priced. Keep every grower's fields in one account. Fly a mission that only crosses treated ground, and hand the grower a record ready to sign before you leave the yard.",
  },
  {
    label: "AGRONOMISTS AND AGENCIES",
    title: "Survey at scale, consistently",
    body: "The same measurement on every field, every visit, in the same units. Track pressure over a season, across a county, with reports that came off the data and not off a memory.",
  },
];
