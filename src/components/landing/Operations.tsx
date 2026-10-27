import { Label } from "./Cta";
import { Reveal } from "./Reveal";
import { OPERATIONS } from "./copy";

/**
 * "From finding to field operation": scout, zones and mission as three numbered steps on one line of work.
 * Words only: Yunus removed the screenshots on 2026-10-27, so the type carries the section.
 */
export const Operations = () => (
  <section id="operations" className="bg-sw-coal text-sw-ivory">
    <div className="mx-auto max-w-[1440px] px-5 py-[clamp(96px,12vw,180px)] sm:px-10 lg:px-16">
      <Reveal>
        <h2 className="m-0 max-w-[14ch] font-geist text-[clamp(44px,7vw,112px)] font-medium leading-[0.95] tracking-[-0.045em]">{OPERATIONS.heading}</h2>
      </Reveal>

      <ol className="m-0 mt-16 grid list-none gap-10 p-0 sm:mt-24 md:grid-cols-3 md:gap-6">
        {OPERATIONS.steps.map((s, i) => (
          <li key={s.label}>
            <Reveal className="border-t border-sw-ivory/20 pt-5">
              <Label className="text-sw-sage">{String(i + 1).padStart(2, "0")}</Label>
              <h3 className="m-0 mt-4 font-geist text-[clamp(30px,3.4vw,48px)] font-medium leading-[1] tracking-[-0.035em]">{s.label}</h3>
              <p className="m-0 mt-4 max-w-[30ch] text-[clamp(16px,1.3vw,19px)] leading-[1.45] text-sw-ivory/65">{s.line}</p>
            </Reveal>
          </li>
        ))}
      </ol>
    </div>
  </section>
);
