import { Label } from "./Cta";
import { Wordmark } from "./Wordmark";
import { ACCESS_HREF, CONTACT_EMAIL, CTA_PRIMARY, HERO, NAV } from "./copy";

/** The footer carries the brand line, kept verbatim, and the same few doors as the top bar. */
export const LandingFooter = () => (
  <footer className="border-t border-sw-ivory/10 bg-sw-night text-sw-ivory">
    <div className="mx-auto grid max-w-[1440px] gap-10 px-5 py-14 sm:px-10 md:grid-cols-[1fr_auto] md:items-end lg:px-16">
      <div>
        <Wordmark tone="paper" size="sm" />
        <p className="m-0 mt-5 text-[15px] text-sw-ivory/60">{HERO.brand}</p>
      </div>
      <div className="flex flex-col gap-6 md:items-end">
        <nav className="flex flex-wrap gap-x-7 gap-y-3 text-[14px] text-sw-ivory/70">
          {NAV.map(l => <a key={l.href} href={l.href} className="hover:text-sw-ivory">{l.label}</a>)}
          <a href={ACCESS_HREF} className="hover:text-sw-ivory">{CTA_PRIMARY}</a>
          <a href="/auth" className="hover:text-sw-ivory">Sign in</a>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-sw-ivory">Contact</a>
        </nav>
        <Label className="text-sw-ivory/40">© 2026 Swardus</Label>
      </div>
    </div>
  </footer>
);
