import { Wordmark } from "./Wordmark";
import { CONTACT_EMAIL } from "./copy";

const LINKS = [
  { label: "About", href: "#why" },
  { label: "Pricing", href: "#pilot" },
  { label: "Contact", href: `mailto:${CONTACT_EMAIL}` },
];

export const LandingFooter = () => (
  <footer className="border-t border-sw-line">
    <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-x-8 gap-y-5 px-5 py-8 text-sm text-sw-faint sm:px-10">
      <Wordmark size="sm" />

      <div className="flex gap-7">
        {LINKS.map((link) => (
          <a key={link.label} href={link.href} className="text-sw-faint hover:text-sw-ink">
            {link.label}
          </a>
        ))}
      </div>

      <span className="font-plex text-xs">© 2026 SWATHWISE</span>
    </div>
  </footer>
);
