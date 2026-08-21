import { Reveal } from "./Reveal";
import { PilotLink } from "./Cta";
import { CONTACT_EMAIL, PILOT_BADGE } from "./copy";

export const PilotCTA = () => (
  <Reveal className="relative mx-auto mt-20 max-w-[1200px] px-5 pb-20 sm:mt-[100px] sm:px-10 sm:pb-[100px]">
    <section
      id="pilot"
      className="grid items-center gap-10 rounded-[10px] bg-sw-panel px-6 py-14 sm:px-12 sm:py-20 lg:grid-cols-[1fr_auto] lg:gap-[60px] lg:px-[70px]"
    >
      <div>
        <div className="font-plex text-xs tracking-[0.1em] text-sw-bright-hi">{PILOT_BADGE}</div>
        <h2 className="m-0 mt-4 max-w-[640px] text-balance text-[clamp(30px,5vw,52px)] font-semibold tracking-[-0.03em] text-sw-paper sm:mt-[18px]">
          Fly your farm free through the pilot.
        </h2>
        <p className="m-0 mt-4 max-w-[520px] text-[17px] leading-[1.55] text-sw-on-dark sm:mt-[18px]">
          We're selecting a small number of farms to pilot SwathWise in exchange for free usage.
          Bring a drone and a field; we'll handle the rest.
        </p>
      </div>

      <div className="justify-self-start">
        {/* The one place the button goes to the form rather than to this band:
            the band IS the destination every other "Apply to Pilot" points at. */}
        <PilotLink
          href="/apply"
          className="bg-sw-bright text-[#0c100b] hover:bg-sw-bright-hi sm:px-[34px] sm:py-[18px] sm:text-[17px]"
        />
        <p className="m-0 mt-4 font-plex text-[12px] tracking-[0.08em] text-sw-on-dark">
          OR EMAIL{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-sw-bright-hi underline-offset-4 hover:underline"
          >
            {CONTACT_EMAIL.toUpperCase()}
          </a>
        </p>
      </div>
    </section>
  </Reveal>
);
