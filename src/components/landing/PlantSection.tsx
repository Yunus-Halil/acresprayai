import { Label } from "./Cta";
import { EvidencePhoto } from "./EvidencePhoto";
import { Reveal } from "./Reveal";
import { PLANT } from "./copy";
import { SPECIMEN, specimenSizes } from "./specimen";

/**
 * "Down to the individual plant": the weed the zoom above ended on, near full screen, selected in the Field
 * Twin, with its measurements and two of the photographs it was measured in. The picture is the app's
 * renderer (scripts/site/captureTwin.mjs); the numbers are the twin's (specimen.ts).
 */
export const PlantSection = () => {
  const size = specimenSizes();
  const rows = [
    { k: PLANT.across, v: size.across, m: size.acrossMetric },
    { k: PLANT.ground, v: size.ground, m: size.groundMetric },
    { k: PLANT.seen, v: PLANT.seenValue.replace("{seen}", String(SPECIMEN.seenBy)).replace("{covered}", String(SPECIMEN.coveredBy)), m: PLANT.seenNote },
  ];
  return (
    <section id="plant" className="relative overflow-hidden bg-sw-night text-sw-ivory">
      {/* On a phone the picture is the top of the section and the panel sits under the weed, not on it. */}
      <div className="absolute inset-x-0 top-0 h-[80svh] lg:inset-0 lg:h-auto">
        <picture>
          <source media="(max-aspect-ratio: 9/10)" srcSet="/site/plant/plant-tall.webp" />
          <img
            src="/site/plant/plant-wide.webp"
            alt="One weed selected in the Field Twin, between apricot trees"
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
            style={{ objectPosition: "34% 50%" }}
          />
        </picture>
      </div>

      <div className="relative mx-auto flex max-w-[1440px] flex-col px-5 pb-8 pt-24 sm:px-10 sm:pb-12 sm:pt-28 lg:min-h-[100svh] lg:justify-between lg:gap-10 lg:px-16 lg:pb-16">
          <Reveal>
            <h2 className="m-0 max-w-[11ch] font-geist text-[clamp(44px,7vw,112px)] font-medium leading-[0.95] tracking-[-0.045em] [text-shadow:0_1px_0_rgba(11,13,11,0.4)]">
              {PLANT.heading}
            </h2>
          </Reveal>

          <Reveal className="mt-[52svh] w-full self-end md:max-w-[480px] lg:mt-0 lg:w-[440px]">
            <div className="border border-sw-ivory/10 bg-sw-night/95 p-5 sm:p-6">
              <Label className="text-sw-amber">{PLANT.caption}</Label>
              <dl className="m-0 mt-5">
                {rows.map(r => (
                  <div key={r.k} className="grid grid-cols-[1fr_auto] items-baseline gap-4 border-t border-sw-ivory/10 py-3.5">
                    <dt className="text-[14px] text-sw-ivory/60">{r.k}</dt>
                    <dd className="m-0 text-right">
                      <span className="text-[clamp(22px,2.2vw,28px)] tabular-nums tracking-[-0.02em]">{r.v}</span>
                      <span className="ml-2 font-geist-mono text-[12px] text-sw-ivory/45">{r.m}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 grid grid-cols-2 gap-1.5">
                <EvidencePhoto index={1} />
                <EvidencePhoto index={2} />
              </div>
            </div>
          </Reveal>
      </div>
    </section>
  );
};
