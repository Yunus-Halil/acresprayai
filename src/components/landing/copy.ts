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
 * 4. Not tied to one aircraft. Imagery can come from any drone with a camera,
 *    RGB or multispectral, and the flight files are DJI WPML and QGC WPL,
 *    which is what DJI Fly, DJI Pilot and most ground stations read. The
 *    product is not an Agras accessory and the page must not read like one.
 */

/**
 * The status band, top of the hero and again above the request button.
 *
 * Closed testing, not a pilot programme with an open door. The form still
 * exists, it just asks for access rather than promising a place. The window is
 * a date and not "this season" so a reader can tell when it has gone stale.
 */
export const STATUS_BADGE = "CLOSED TESTING · INVITE ONLY · OPENING Q4 2026";

/** Both CTAs, in one place, so every button on the page says the same thing. */
export const CTA_PRIMARY = "Request access";
export const CTA_SECONDARY = "Watch it work";

/** The one address the site hands out. Used by the footer and the status band. */
export const CONTACT_EMAIL = "yunus@swathwise.com";

/**
 * The full walkthrough recording, hosted on Google Drive.
 *
 * Kept here rather than inline so there is one place to change when the demo
 * is re-recorded. Anything linking to it opens a new tab and carries
 * rel="noopener".
 */
export const DEMO_VIDEO_URL =
  "https://drive.google.com/file/d/1JvYL2-GxRVNG5r9Lvd31x5iYHF6C8NRx/view?usp=sharing";

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
    + "the imagery, measures every plant against your own crop, and shows you exactly where the "
    + "weeds are, along with the bare ground, the thin stand and the wet patches. Then it plans "
    + "the flight that treats only those spots, and writes the record when you land.",
  bullets: [
    "Any drone, any camera, any crop",
    "Every plant compared to your field",
    "Treat only what it found",
    "Nothing sprays until you say so",
  ],
};

export const FEATURES = [
  {
    num: "01",
    title: "It reads the whole farm",
    body: "Not a sample. Every square foot of your imagery is measured: colour, brightness, vegetation, texture, and how each patch compares to the field around it and to the field as a whole. Weeds, bare ground, thin stand, wet patches, all from the same pass.",
  },
  {
    num: "02",
    title: "It knows what your crop looks like",
    body: "The baseline is your own field, not a textbook. Every plant is sized and coloured against the plants beside it, so a weed stands out because it is not corn, not because someone told it what corn is.",
  },
  {
    num: "03",
    title: "It flies whatever you fly",
    body: "Survey flights and spray flights come out as standard waypoint files. Load them into DJI Fly, DJI Pilot, or any controller that reads WPML or QGC waypoints. No Agras required.",
  },
  {
    num: "04",
    title: "It writes the paperwork",
    body: "Product, acres, conditions, applicator, field, signature line. The application record comes off the job you flew. Nothing retyped, nothing remembered at the kitchen table.",
  },
];

/**
 * The detection section. This is the product, so it gets the most words.
 *
 * Each card is a real step in src/lib/weedScout and the phrasing tracks what
 * the code does. Where a step has a limit, the limit is stated in the same
 * breath, because a farmer who finds it later trusts nothing else on the page.
 */
export const DETECTION = {
  eyebrow: "HOW IT FINDS THEM",
  headline: "It does not guess where the weeds are. It measures.",
  sub:
    "Most tools look for a picture of a weed. SwathWise does something harder and more honest: "
    + "it learns what your field looks like today, from your field, and then finds everything that "
    + "does not fit. It runs in your browser, on your imagery, with no model anyone else trained.",
  steps: [
    {
      label: "TILE BY TILE",
      title: "The whole field becomes a grid of measurements",
      body: "Your boundary is cut into ground squares, sized to the field so a trial plot and a quarter section both get a fair baseline. Every square is measured for colour, greenness, brightness and how much of it is plant. Nothing is skipped.",
    },
    {
      label: "THE FIELD IS THE BASELINE",
      title: "Normal is whatever most of your field is doing",
      body: "The baseline is the tightest band that holds half your field, so a weed patch covering a third of it cannot hide by being common. Every square is scored against the field and against its own neighbours, and a square is flagged only when two independent signals agree.",
    },
    {
      label: "REGIONS",
      title: "Flagged ground grows into shapes with an area",
      body: "Touching squares join into a region with an outline, an acreage and a class: bare or dry ground, wet ground, thin stand, dense vegetation, paler, greener, different. This is where precision agriculture starts: not only weeds, but every part of the field that is not behaving like the rest of it. Descriptive, never a diagnosis.",
    },
    {
      label: "PLANT BY PLANT",
      title: "Every plant is compared to every other plant",
      body: "Where plants can be separated, each one is sized and coloured against the population. A tall broadleaf among short corn is found even when the canopy has hidden the rows. Where crop rows can be fitted, anything growing between them is found too.",
    },
    {
      label: "THE DEEP PASS",
      title: "Then it does it all again at full resolution",
      body: "A second sweep reads the entire interior at the sharpest zoom your imagery has, window by window, so a single plant the size of your hand is not lost in a coarse first look. It says how deep it went and where it had to back off.",
    },
    {
      label: "IT LEARNS YOUR CALLS",
      title: "Every verdict you give makes the next scan sharper",
      body: "Keep it, remove it, unsure. Each answer goes into an archive that the next scan compares itself against, so a mark you made in June is remembered in August. Identification is suggested from your own past confirmations and a sourced reference catalog, and it is always your call.",
    },
  ],
  caveat:
    "It finds what departs from your field. It does not name a species from pixels, it does not "
    + "certify a field clean, and a closed canopy hides individual plants from any camera. Where it "
    + "cannot see, it says so on the scan.",
};

export const STEPS = [
  {
    num: "01",
    title: "Fly it with anything",
    body: "Plan the survey in SwathWise, load the file into your drone, fly it. Or drop in photos you already have, or a finished orthomosaic from any sensor. RGB, multispectral, it all reads.",
  },
  {
    num: "02",
    title: "See every weed on the map",
    body: "The scan lands as a map with every finding drawn on it, worst first, each with a real photo chip. Tap one, keep it or throw it out, name it if you know it. Ten minutes for a field, not a morning walking it.",
  },
  {
    num: "03",
    title: "Spray exactly those, then file it",
    body: "One button turns your confirmed findings into a spray mission for your aircraft: route, loads, batteries, refills. Fly it. The application record is already written.",
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
    body: "Arrive with the zones already found, sized and priced. Fly a mission that only crosses treated ground. Hand over a signed record before you leave the yard.",
  },
  {
    label: "AGRONOMISTS AND AGENCIES",
    title: "Survey at scale, consistently",
    body: "The same measurement on every field, every visit, in the same units. Track pressure over a season, across a county, with reports that came off the data and not off a memory.",
  },
];
