import { AccessButton, Label } from "./Cta";
import { Reveal } from "./Reveal";
import { ACCESS, CONTACT_EMAIL, STATUS_BADGE } from "./copy";

/**
 * The close: closed testing, and the one way in. Access is granted by a person; nothing here promises a place.
 */
export const Access = () => (
  <section id="access" className="bg-sw-night text-sw-ivory">
    <div className="mx-auto max-w-[1440px] px-5 py-[clamp(112px,14vw,220px)] sm:px-10 lg:px-16">
      <Reveal>
        <Label className="text-sw-ivory/60">
          <span aria-hidden="true" className="mr-2.5 inline-block h-1.5 w-1.5 translate-y-[-1px] rounded-full bg-sw-bright-hi" />
          {STATUS_BADGE}
        </Label>
        <h2 className="m-0 mt-8 max-w-[15ch] font-geist text-[clamp(44px,7.6vw,124px)] font-medium leading-[0.94] tracking-[-0.048em]">{ACCESS.heading}</h2>
        <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-5 sm:mt-16">
          <AccessButton />
          <span className="font-geist-mono text-[12px] tracking-[0.08em] text-sw-ivory/50">
            {ACCESS.email}{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-sw-ivory/80 underline-offset-4 hover:text-sw-ivory hover:underline">
              {CONTACT_EMAIL.toUpperCase()}
            </a>
          </span>
        </div>
      </Reveal>
    </div>
  </section>
);
