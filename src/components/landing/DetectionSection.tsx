import { Reveal } from "./Reveal";
import { DETECTION } from "./copy";

/**
 * The findings section. This is the product, and it sits before the flight
 * planning because a farmer who does not believe the finding will not read
 * about the flying. WHAT it finds, never HOW: the method is a trade secret
 * (copy.ts, rule 9) and no sentence here may describe a step of it.
 *
 * Two sentences, nothing more: the scan image that sat under them did not do
 * the product justice (Yunus, 2026-10-08). It follows the hero's dark
 * band directly, so the page goes film, band, this, with no paper between.
 */
export const DetectionSection = () => (
  <section
    id="detection"
    className="relative bg-sw-ink py-20 sm:py-[110px]"
  >
    <div className="mx-auto max-w-[1200px] px-5 sm:px-10">
      <Reveal className="max-w-[760px]">
        <div className="font-plex text-xs tracking-[0.1em] text-sw-green">{DETECTION.eyebrow}</div>
        <h2 className="m-0 mt-4 text-[clamp(30px,5vw,56px)] font-semibold leading-[1.02] tracking-[-0.03em] text-sw-paper sm:mt-[18px]">
          {DETECTION.headline}
        </h2>
        <div className="mt-5 max-w-[680px] space-y-3 text-[17px] leading-[1.55] text-sw-on-dark sm:text-lg">
          {DETECTION.body.map(p => <p key={p} className="m-0">{p}</p>)}
        </div>
      </Reveal>

    </div>
  </section>
);
