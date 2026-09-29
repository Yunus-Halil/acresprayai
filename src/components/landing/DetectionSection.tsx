import { Reveal } from "./Reveal";
import { Shot } from "./Shot";
import { DETECTION } from "./copy";

/**
 * The detection section. This is the product, and it sits before the flight
 * planning because a farmer who does not believe the finding will not read
 * about the flying.
 *
 * A headline and a real scan, nothing more. Farmers want to see the finding,
 * not how the scan gets there, so the steps of the method stay in
 * docs/features/weed-scout.md and off this page.
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
        <div className="mt-5 max-w-[680px] space-y-3 text-[17px] leading-[1.55] text-sw-on-dark sm:text-lg">
          {DETECTION.body.map(p => <p key={p} className="m-0">{p}</p>)}
        </div>
      </Reveal>

      {/* A real scan, as the operator saw it. The one species name on it was
          typed by the operator; the classes are the detector's. */}
      <Reveal className="mt-12 sm:mt-16">
        <Shot
          src="/screens/scout-findings.png"
          alt="A stitched field with the scan's findings outlined and labelled: bare or dry ground, thin stand, and ground different from the field, with one region the operator has named barnyardgrass"
          caption="ONE SCAN · REAL FIELD"
          status={<span className="text-sw-bright-hi">● FINDINGS</span>}
          padding="p-2.5"
          className="shadow-[0_40px_90px_-30px_rgba(0,0,0,0.7)]"
          imgClassName="mx-auto w-full max-h-[760px] object-contain"
        />
      </Reveal>

    </div>
  </section>
);
