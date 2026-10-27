import { useEffect, useState } from "react";
import { Wordmark } from "./Wordmark";
import { ACCESS_HREF, CTA_PRIMARY, NAV } from "./copy";

/**
 * Fixed at the top. Clear over the hero footage, then a solid near-black bar once the page has moved, so it
 * never sits as a translucent smear over the product pictures. "Sign in" stays for the testers who already
 * have accounts; everyone else is sent to the access request.
 */
export const LandingNav = () => {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <nav
      className={`fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300 ${solid ? "border-sw-ivory/10 bg-sw-night" : "border-transparent bg-transparent"}`}
    >
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-6 px-5 sm:h-[72px] sm:px-10 lg:px-16">
        <a href="#top" aria-label="Swardus, back to the top" className="shrink-0">
          <Wordmark tone="paper" size="sm" className="[&_img]:h-[22px] sm:[&_img]:h-6" />
        </a>

        <div className="flex items-center gap-5 text-[14px] text-sw-ivory/75 sm:gap-8">
          {NAV.map(link => (
            <a key={link.href} href={link.href} className="hidden transition-colors hover:text-sw-ivory lg:inline">
              {link.label}
            </a>
          ))}
          <a href="/auth" className="transition-colors hover:text-sw-ivory">Sign in</a>
          <a
            href={ACCESS_HREF}
            className="hidden border border-sw-ivory/35 px-4 py-2 text-sw-ivory transition-colors hover:border-sw-ivory sm:inline-block"
          >
            {CTA_PRIMARY}
          </a>
        </div>
      </div>
    </nav>
  );
};
