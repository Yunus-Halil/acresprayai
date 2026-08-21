import { CTA_PRIMARY, CTA_SECONDARY, DEMO_VIDEO_URL } from "./copy";

/**
 * The page's two calls to action, defined once.
 *
 * There are exactly two things a visitor can do here: apply to the pilot, or
 * watch the demo. They appeared in three places with three sets of hand-written
 * classes, and the demo appeared in one place only, which meant the strongest
 * asset on the site had a single door. Wording, target and shape now come from
 * here, so a change to either is a change everywhere.
 *
 * Skin, not structure: `className` sets the colours for the surface the button
 * is sitting on. Padding, weight and the arrow are fixed on purpose.
 */
const BASE =
  "inline-flex items-center gap-2.5 whitespace-nowrap rounded px-7 py-4 text-base font-semibold transition-colors";

/** Apply to Pilot. Always the in-page pilot band, which owns the apply link. */
export const PilotLink = ({ className = "", href = "#pilot" }: { className?: string; href?: string }) => (
  <a href={href} className={`${BASE} ${className}`}>
    {CTA_PRIMARY} <span className="font-plex" aria-hidden="true">→</span>
  </a>
);

/**
 * Watch the demo. Off-site, so it opens in a new tab and keeps the visitor's
 * place on the page. `rel="noopener noreferrer"` is not optional on a
 * `target="_blank"` link: without it the opened page can reach back through
 * `window.opener`.
 */
export const DemoLink = ({ className = "" }: { className?: string }) => (
  <a
    href={DEMO_VIDEO_URL}
    target="_blank"
    rel="noopener noreferrer"
    className={`${BASE} font-medium ${className}`}
  >
    {CTA_SECONDARY}
    <span className="font-plex opacity-70" aria-hidden="true">↗</span>
  </a>
);
