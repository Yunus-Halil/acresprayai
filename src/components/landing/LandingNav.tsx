import { Wordmark } from "./Wordmark";
import { CTA_PRIMARY } from "./copy";

const LINKS = [
  { label: "Why SwathWise", href: "#why" },
  { label: "How it works", href: "#how" },
  { label: "Who it's for", href: "#who" },
];

export const LandingNav = () => (
  <nav className="sw-load relative mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-x-6 gap-y-4 px-5 pt-6 sm:px-10 sm:pt-7">
    <a href="#top" className="flex items-center gap-2.5">
      <Wordmark />
      <span className="font-plex text-[11px] tracking-[0.08em] text-sw-muted">PRECISION AG</span>
    </a>

    <div className="flex items-center gap-6 text-[15px] sm:gap-8">
      {LINKS.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className="hidden text-sw-ink transition-colors hover:text-sw-green md:inline"
        >
          {link.label}
        </a>
      ))}
      <a
        href="/auth"
        className="text-sw-ink underline underline-offset-4 transition-colors hover:text-sw-green"
      >
        Sign in
      </a>
      <a
        href="#pilot"
        className="inline-flex items-center gap-2 rounded bg-sw-ink px-5 py-3 font-medium text-sw-paper transition-colors hover:bg-sw-green hover:text-white"
      >
        {CTA_PRIMARY} <span className="font-plex" aria-hidden="true">→</span>
      </a>
    </div>
  </nav>
);
