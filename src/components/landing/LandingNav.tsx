import { Wordmark } from "./Wordmark";
import { CTA_PRIMARY } from "./copy";

const LINKS = [
  { label: "What it finds", href: "#detection" },
  { label: "The software", href: "#software" },
  { label: "Who it's for", href: "#who" },
];

/**
 * "Sign in" stays and "Sign up" does not. Testers already have accounts and
 * need the door; everyone else is sent to the access request, which is the
 * only way in during closed testing.
 */
export const LandingNav = () => (
  <nav className="sw-load absolute inset-x-0 top-0 z-20 mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-x-6 gap-y-4 px-5 pt-6 sm:px-10 sm:pt-7">
    <a href="#top" className="flex items-center gap-2.5">
      <Wordmark tone="paper" glass />
      <span className="font-plex text-[11px] tracking-[0.08em] text-white/70">PRECISION AG</span>
    </a>

    <div className="flex items-center gap-6 text-[15px] sm:gap-8">
      {LINKS.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className="hidden text-white/90 transition-colors hover:text-sw-bright-hi md:inline"
        >
          {link.label}
        </a>
      ))}
      <a
        href="/auth"
        className="text-white/90 underline underline-offset-4 transition-colors hover:text-sw-bright-hi"
      >
        Sign in
      </a>
      <a
        href="#pilot"
        className="inline-flex items-center gap-2 rounded bg-white px-5 py-3 font-medium text-sw-ink transition-colors hover:bg-sw-bright-hi"
      >
        {CTA_PRIMARY} <span className="font-plex" aria-hidden="true">→</span>
      </a>
    </div>
  </nav>
);
