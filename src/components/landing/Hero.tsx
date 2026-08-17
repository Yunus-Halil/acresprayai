import { FlightPath } from "./FlightPath";
import { PILOT_BADGE } from "./copy";

export const Hero = () => (
  <header id="top" className="relative mx-auto max-w-[1200px] px-5 pt-14 sm:px-10 sm:pt-[90px]">
    <div
      className="sw-load inline-flex items-center gap-2.5 rounded-[3px] border border-sw-rule bg-sw-card px-3.5 py-1.5 font-plex text-[11px] tracking-[0.04em] text-[#40483c] sm:text-xs"
      style={{ animationDelay: "0.05s" }}
    >
      <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-sw-bright" />
      {PILOT_BADGE}
    </div>

    <div className="mt-7">
      {/* Capped rather than full-bleed so the headline still breaks after
          "problem." at the largest sizes. */}
      <h1
        className="sw-load m-0 max-w-[760px] text-balance text-[clamp(40px,7.4vw,88px)] font-semibold leading-[0.98] tracking-[-0.035em] text-sw-ink"
        style={{ animationDelay: "0.15s" }}
      >
        Find the problem. Fly the fix.
      </h1>

      <p
        className="sw-load mt-6 max-w-[560px] text-[17px] leading-[1.5] text-sw-muted sm:mt-7 sm:text-xl"
        style={{ animationDelay: "0.28s" }}
      >
        Upload drone images, get a stitched map of your farm, and let AI find the crops that need
        spraying, with flight plans ready for your drone.
      </p>

      <div
        className="sw-load mt-8 flex flex-wrap gap-3.5 sm:mt-9"
        style={{ animationDelay: "0.4s" }}
      >
        <a
          href="#pilot"
          className="inline-flex items-center gap-2.5 rounded bg-sw-green px-7 py-4 text-base font-semibold text-white transition-colors hover:bg-sw-green-deep"
        >
          Apply to Pilot <span className="font-plex">→</span>
        </a>
        <a
          href="#why"
          className="inline-flex items-center gap-2.5 rounded border border-sw-edge bg-sw-card px-7 py-4 text-base font-medium text-sw-ink transition-colors hover:border-sw-ink"
        >
          Watch a full demo
        </a>
      </div>
    </div>

    <FlightPath />
  </header>
);
