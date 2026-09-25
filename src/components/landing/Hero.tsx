import { FlightPath } from "./FlightPath";
import { DemoLink, PilotLink } from "./Cta";
import { HERO, STATUS_BADGE } from "./copy";

export const Hero = () => (
  <header id="top" className="relative mx-auto max-w-[1200px] px-5 pt-14 sm:px-10 sm:pt-[90px]">
    <div
      className="sw-load inline-flex items-center gap-2.5 rounded-[3px] border border-sw-rule bg-sw-card px-3.5 py-1.5 font-plex text-[11px] tracking-[0.04em] text-[#40483c] sm:text-xs"
      style={{ animationDelay: "0.05s" }}
    >
      <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-sw-bright" />
      {STATUS_BADGE}
    </div>

    <div className="mt-7">
      {/* The category first, in mono, so the headline below is read as the
          flagship job of a precision agriculture product and not as the whole
          product. */}
      <div
        className="sw-load font-plex text-xs tracking-[0.1em] text-sw-green"
        style={{ animationDelay: "0.1s" }}
      >
        {HERO.kicker}
      </div>
      {/* Capped rather than full-bleed so the headline breaks after "farm."
          at the largest sizes and the second line lands alone. */}
      <h1
        className="sw-load m-0 mt-4 max-w-[860px] text-balance text-[clamp(40px,7.4vw,88px)] font-semibold leading-[0.98] tracking-[-0.035em] text-sw-ink"
        style={{ animationDelay: "0.15s" }}
      >
        {HERO.headline}
      </h1>

      <p
        className="sw-load mt-6 max-w-[640px] text-[17px] leading-[1.5] text-sw-muted sm:mt-7 sm:text-xl"
        style={{ animationDelay: "0.28s" }}
      >
        {HERO.sub}
      </p>

      <ul
        className="sw-load mt-6 flex flex-wrap gap-x-6 gap-y-2 font-plex text-[11px] tracking-[0.04em] text-sw-muted sm:text-xs"
        style={{ animationDelay: "0.34s" }}
      >
        {HERO.bullets.map(item => (
          <li key={item} className="flex items-center gap-2">
            <span className="h-[3px] w-[3px] rounded-full bg-sw-green" />
            {item}
          </li>
        ))}
      </ul>

      <div
        className="sw-load mt-8 flex flex-wrap gap-3.5 sm:mt-9"
        style={{ animationDelay: "0.4s" }}
      >
        <PilotLink className="bg-sw-green text-white hover:bg-sw-green-deep" />
        <DemoLink className="border border-sw-edge bg-sw-card text-sw-ink hover:border-sw-ink" />
      </div>
    </div>

    <FlightPath />
  </header>
);
