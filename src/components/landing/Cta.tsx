import { CTA_PRIMARY } from "./copy";

/**
 * The page's one call to action, defined once.
 *
 * There is exactly one thing a visitor can do here: request access. It
 * appears in three places, so wording, target and shape come from here and a
 * change is a change everywhere. The demo video link that used to sit beside
 * it was removed on purpose: nothing on the page points off-site.
 *
 * Skin, not structure: `className` sets the colours for the surface the button
 * is sitting on. Padding, weight and the arrow are fixed on purpose.
 */
const BASE =
  "inline-flex items-center gap-2.5 whitespace-nowrap rounded px-7 py-4 text-base font-semibold transition-colors";

/** Request access. Always the in-page closed-testing band, which owns the apply link. */
export const PilotLink = ({ className = "", href = "#pilot" }: { className?: string; href?: string }) => (
  <a href={href} className={`${BASE} ${className}`}>
    {CTA_PRIMARY} <span className="font-plex" aria-hidden="true">→</span>
  </a>
);
