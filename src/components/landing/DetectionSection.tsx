import { Reveal } from "./Reveal";
import { DETECTION } from "./copy";

/**
 * The detection section. This is the product, and it sits before the flight
 * planning because a farmer who does not believe the finding will not read
 * about the flying.
 *
 * Every card is a real step in src/lib/weedScout, in the order the scan runs
 * them, and the wording tracks what the code does. The closing caveat is not a
 * legal line tucked under the fold: it is set in the same type as the claims,
 * because a limit a reader finds for themselves later costs the whole page its
 * credibility.
 */
export const DetectionSection = () => (
  <section
    id="detection"
    className="relative mt-24 bg-sw-ink py-20 sm:mt-[130px] sm:py-[110px]"
  >
    <div className="mx-auto max-w-[1200px] px-5 sm:px-10">
      <Reveal className="max-w-[760px]">
        <div className="font-plex text-xs tracking-[0.1em] text-sw-green">{DETECTION.eyebrow}</div>
        <h2 className="m-0 mt-4 text-[clamp(30px,5vw,56px)] font-semibold leading-[1.02] tracking-[-0.03em] text-sw-paper sm:mt-[18px]">
          {DETECTION.headline}
        </h2>
        <p className="m-0 mt-5 max-w-[680px] text-[17px] leading-[1.55] text-sw-on-dark sm:text-lg">
          {DETECTION.sub}
        </p>
      </Reveal>

      <div className="mt-14 grid gap-x-10 gap-y-12 sm:mt-20 sm:grid-cols-2 lg:grid-cols-3">
        {DETECTION.steps.map((step, i) => (
          <Reveal key={step.label}>
            <div className="border-t border-white/15 pt-5">
              <div className="flex items-baseline justify-between gap-4">
                <div className="font-plex text-[11px] tracking-[0.1em] text-sw-bright-hi">
                  {step.label}
                </div>
                <div className="font-plex text-[11px] text-sw-on-dark-faint">
                  {String(i + 1).padStart(2, "0")}
                </div>
              </div>
              <h3 className="m-0 mt-3 text-[20px] font-semibold leading-[1.2] tracking-[-0.015em] text-sw-paper">
                {step.title}
              </h3>
              <p className="m-0 mt-3 text-[15px] leading-[1.55] text-sw-on-dark">{step.body}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-14 border-t border-white/10 pt-6 sm:mt-16">
        <p className="m-0 max-w-[760px] font-plex text-[12px] leading-[1.9] tracking-[0.03em] text-sw-on-dark">
          {DETECTION.caveat}
        </p>
      </Reveal>
    </div>
  </section>
);
