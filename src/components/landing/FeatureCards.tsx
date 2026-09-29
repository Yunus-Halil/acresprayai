import { Reveal } from "./Reveal";
import { WHOLE_FIELD } from "./copy";

/**
 * One flight, the whole field. Sits directly under the hero: what the scan
 * reads and what it can turn up, before the page says how. The findings are
 * a list a farmer recognises, with no method and no absolutes; the last line
 * puts the operator between a finding and a treatment zone.
 */
export const FeatureCards = () => (
  <Reveal className="relative mx-auto max-w-[1200px] px-5 pt-16 sm:px-10 sm:pt-[90px]">
    <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:gap-[70px]">
      <div>
        <div className="font-plex text-xs tracking-[0.1em] text-sw-green">{WHOLE_FIELD.eyebrow}</div>
        <h2 className="m-0 mt-4 text-[clamp(30px,5vw,48px)] font-semibold leading-[1.05] tracking-[-0.03em] text-sw-ink sm:mt-[18px]">
          {WHOLE_FIELD.headline}
        </h2>
        <div className="mt-5 max-w-[560px] space-y-3 text-[17px] leading-[1.55] text-sw-muted">
          {WHOLE_FIELD.body.map(p => <p key={p} className="m-0">{p}</p>)}
        </div>
      </div>
      <div className="border-t-2 border-sw-ink pt-[18px] lg:border-t-0 lg:border-l-2 lg:pl-10 lg:pt-1">
        <div className="font-plex text-xs tracking-[0.1em] text-sw-green">{WHOLE_FIELD.findingsLead.toUpperCase()}</div>
        <ul className="mt-4 grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
          {WHOLE_FIELD.findings.map(f => (
            <li key={f} className="flex items-start gap-2.5 text-[15px] leading-[1.45] text-sw-ink">
              <span className="mt-[9px] h-[5px] w-[5px] shrink-0 rounded-full bg-sw-green" />
              {f}
            </li>
          ))}
        </ul>
        <p className="m-0 mt-6 text-[15px] leading-[1.5] text-sw-muted">{WHOLE_FIELD.close}</p>
      </div>
    </div>
  </Reveal>
);
