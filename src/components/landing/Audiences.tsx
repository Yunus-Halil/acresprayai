import { Label } from "./Cta";
import { Reveal } from "./Reveal";
import { AUDIENCES } from "./copy";

/**
 * "Built for those who work the land": four readers, set as an editorial list on warm ivory. Large names, one
 * line each, rules between them. No cards.
 */
export const Audiences = () => (
  <section id="who" className="bg-sw-ivory text-sw-night">
    <div className="mx-auto max-w-[1440px] px-5 py-[clamp(96px,12vw,180px)] sm:px-10 lg:px-16">
      <Reveal>
        <h2 className="m-0 max-w-[16ch] font-geist text-[clamp(44px,7vw,112px)] font-medium leading-[0.95] tracking-[-0.045em]">{AUDIENCES.heading}</h2>
      </Reveal>

      <ul className="m-0 mt-16 list-none border-b border-sw-night/15 p-0 sm:mt-24">
        {AUDIENCES.items.map((a, i) => (
          <li key={a.label} className="border-t border-sw-night/15">
            <Reveal className="grid gap-3 py-7 sm:py-9 md:grid-cols-[80px_minmax(0,1fr)_minmax(0,1fr)] md:items-baseline md:gap-8">
              <Label className="text-sw-night/45">{String(i + 1).padStart(2, "0")}</Label>
              <h3 className="m-0 font-geist text-[clamp(30px,3.6vw,52px)] font-medium leading-[1] tracking-[-0.035em]">{a.label}</h3>
              <p className="m-0 max-w-[36ch] text-[clamp(17px,1.4vw,20px)] leading-[1.4] text-sw-night/65">{a.line}</p>
            </Reveal>
          </li>
        ))}
      </ul>
    </div>
  </section>
);
