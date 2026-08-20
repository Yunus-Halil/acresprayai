/**
 * Landing page copy, in one place.
 *
 * Two standing rules for anything added here:
 *
 * 1. Nothing may claim a capability the product lacks. There is no 3D, no
 *    mobile app, and no autonomous flight - SwathWise emits a waypoint file a
 *    human loads into a flight controller. No invented metrics or savings
 *    percentages.
 * 2. No social proof until it is approved in writing. There is no testimonial
 *    on this page, and an unapproved one is not better than none.
 */

export const PILOT_BADGE = "PILOT PROGRAM · 10 FARMS · Q3–Q4 2026 · FREE USAGE";

/** The one address the site hands out. Used by the footer and the pilot band. */
export const CONTACT_EMAIL = "yunus@swathwise.com";

/**
 * The full walkthrough recording, hosted on Google Drive.
 *
 * Kept here rather than inline so there is one place to change when the demo
 * is re-recorded. Anything linking to it opens a new tab and carries
 * rel="noopener", because without it the opened page gets a handle on this
 * one through window.opener.
 *
 * If this ever 404s or asks visitors to request access, the sharing setting
 * has been changed on the Drive file, not in this repo.
 */
export const DEMO_VIDEO_URL =
  "https://drive.google.com/file/d/1JvYL2-GxRVNG5r9Lvd31x5iYHF6C8NRx/view?usp=sharing";

export const FEATURES = [
  {
    num: "01",
    title: "Instant crop anomaly detection",
    body: "Find and identify the crops that need spraying in the click of a button.",
  },
  {
    num: "02",
    title: "Flight path creation",
    body: "Click a button, get flight plans for your drone to only target crops that need spraying.",
  },
  {
    num: "03",
    title: "Unified dashboard",
    body: "Track weather, flight plans, recommendations, all in a browser-style interface that doesn't take a degree to use.",
  },
  {
    num: "04",
    title: "Automated reporting",
    body: "Create clear reports instantly with no manual effort.",
  },
];

export const STEPS = [
  {
    num: "01",
    title: "Upload drone images",
    body: "Drag in a folder of overlapping drone images and get a fully stitched map of your farm. Drag and drop.",
  },
  {
    num: "02",
    title: "Let AI analyze",
    body: "Your data is processed instantly to reveal trends and patterns, all overlaid on your interactive farm.",
  },
  {
    num: "03",
    title: "Get valuable insights",
    body: "Get flight plans, reports, and weather data: everything you need to spray only where it counts.",
  },
];

export const AUDIENCES = [
  {
    label: "FARMERS",
    title: "Run your own fields",
    body: "Scout, plan, and spray with one tool. No degree required. If you can use a browser, you can use SwathWise.",
  },
  {
    label: "GOVERNMENTS",
    title: "Monitor at scale",
    body: "Survey regions, track crop health over time, and generate consistent reports across many sites.",
  },
  {
    label: "ENTERPRISE",
    title: "Standardize the fleet",
    body: "One workflow for every field and every operator, from upload to flight plan to report.",
  },
];
