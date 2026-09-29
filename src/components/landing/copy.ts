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
 * The product is the weed map. Everything else on the page (acres, cost,
 * mission, record) is what happens after SwathWise finds and measures the
 * weeds, and the hero says so in that order. "Likely weeds", "abnormal
 * vegetation", "findings": the detector proposes, the operator confirms,
 * and no sentence here claims a recall nobody has measured on a flown field.
 */
export const HERO = {
  headline: "Turn ordinary drone imagery into a weed map.",
  /** The brand line, under the headline. Kept verbatim. */
  brand: "Precision Agriculture, Precisely Simple.",
  body: [
    "SwathWise analyzes RGB drone imagery, learns what the crop looks like in that field, and maps likely weeds and abnormal vegetation for you to review.",
    "Every finding is measured and placed directly on the field map. Confirm what needs treatment, and SwathWise turns those areas into a spray mission and application record.",
  ],
  bullets: [
    "Built for standard RGB drone imagery",
    "Field-specific weed detection",
    "Every finding measured in real-world area",
    "Nothing gets treated until you confirm it",
    "Runs in the browser",
  ],
};

/**
 * One flight, the whole field. What the scan reads and what it can turn up,
 * in the words a farmer uses, with no method and no absolutes.
 */
export const WHOLE_FIELD = {
  eyebrow: "WHOLE-FIELD ANALYSIS",
  headline: "One flight. The whole field.",
  body: [
    "SwathWise analyzes the entire stitched field map, not a handful of sample points.",
    "It finds vegetation, measures how it compares with the crop around it, and maps the areas that deserve attention.",
  ],
  findingsLead: "Potential findings include",
  findings: [
    "likely weeds",
    "weed patches",
    "thin stand",
    "bare or wet ground",
    "unusual vegetation",
    "areas behaving differently from the rest of the field",
  ],
  close: "Every finding is drawn directly on the map so the operator can inspect it before anything becomes a treatment zone.",
};

/**
 * The detection section: a headline, one paragraph, and a real scan. No
 * walkthrough of the method. Farmers care what it finds, not how.
 */
export const DETECTION = {
  eyebrow: "FIELD-SPECIFIC DETECTION",
  headline: "It learns the field before it looks for weeds.",
  body: [
    "SwathWise does not assume every field looks the same.",
    "It measures the crop already growing in your imagery, including plant position, spacing, size, color, density, and surrounding vegetation. Then it looks for plants and patches that do not fit that pattern.",
    "A weed stands out because it does not behave like the crop around it.",
    "Every finding includes its location, size, confidence, and affected area. The operator decides whether it should be treated.",
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
    { label: "FOUND IT", body: "SwathWise identifies likely weeds and abnormal vegetation from the field imagery." },
    { label: "SIZED IT", body: "Every confirmed finding becomes a measured treatment area." },
    { label: "PRICED IT", body: "Estimate treatment cost using your own inputs and per-acre costs." },
    { label: "FLEW IT", body: "Turn confirmed treatment areas into a spray mission for supported aircraft. You fly it, on your license." },
    { label: "FILED IT", body: "Build the application record directly from the job that was flown." },
  ],
  /** The architecture, as one line. Arrows, not dashes. */
  chain: "RGB imagery → field-specific analysis → likely weed findings → operator review → treatment zones → cost → mission → application record",
};


export const STEPS = [
  {
    num: "01",
    title: "Fly the field you already fly",
    body: "Plan the survey in SwathWise and load it into the drone you already have, or drop in the photos or the stitched map from a flight you already made. Standard RGB imagery and a browser are all it takes.",
  },
  {
    num: "02",
    title: "Review the findings on the map",
    body: "The scan comes back as a map with every finding drawn on it, worst first, each with a photo of the spot. Keep it, remove it, or mark it unsure; name it if you know it.",
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
    title: "Scout the whole field without walking every acre",
    body: "Every field, every week if you want. Spot weed pressure before it goes to seed and treat a strip instead of a section. If you can use a browser, you can run it.",
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
