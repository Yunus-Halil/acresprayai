import type { ReactNode } from "react";
import { ACCESS_HREF, CTA_EXPLORE, CTA_PRIMARY } from "./copy";

/**
 * The site's two buttons, defined once. Square corners, one weight, a short rule for an arrow: no pills, no
 * gradients, no glow. `tone` is the surface the button sits on.
 */
const BASE =
  "group inline-flex items-center gap-3 whitespace-nowrap px-6 py-3.5 text-[15px] font-medium tracking-[-0.005em] transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4";

const Rule = () => (
  <span aria-hidden="true" className="relative block h-px w-5 bg-current transition-[width] duration-300 group-hover:w-7">
    <span className="absolute -right-px -top-[3px] block h-[7px] w-[7px] rotate-45 border-r border-t border-current" />
  </span>
);

/** Request access: the form, which is the only way in during closed testing. */
export const AccessButton = ({ tone = "dark", className = "" }: { tone?: "dark" | "light"; className?: string }) => (
  <a
    href={ACCESS_HREF}
    className={`${BASE} ${tone === "dark" ? "bg-sw-ivory text-sw-night hover:bg-white focus-visible:outline-sw-ivory" : "bg-sw-night text-sw-ivory hover:bg-black focus-visible:outline-sw-night"} ${className}`}
  >
    {CTA_PRIMARY} <Rule />
  </a>
);

/** A quiet link-button: an outline on the dark ground. */
export const GhostButton = ({ href, children = CTA_EXPLORE, className = "" }: { href: string; children?: ReactNode; className?: string }) => (
  <a
    href={href}
    className={`${BASE} border border-sw-ivory/35 text-sw-ivory hover:border-sw-ivory hover:bg-sw-ivory/5 focus-visible:outline-sw-ivory ${className}`}
  >
    {children} <Rule />
  </a>
);

/** The small mono label used for section indexes and captions. */
export const Label = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <span className={`font-geist-mono text-[11px] uppercase tracking-[0.16em] ${className}`}>{children}</span>
);
