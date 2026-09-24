import { Reveal } from "./Reveal";
import { PilotLink } from "./Cta";
import { CONTACT_EMAIL, STATUS_BADGE } from "./copy";

/**
 * The closed-testing band. Every "Request access" on the page lands here, and
 * this is the one place the button goes on to the form.
 *
 * It replaced an open pilot invitation. Nothing is promised here except a
 * reply: the form asks for access, and access is granted by a person.
 */
export const PilotCTA = () => (
  <Reveal className="relative mx-auto mt-20 max-w-[1200px] px-5 pb-20 sm:mt-[100px] sm:px-10 sm:pb-[100px]">
    <section
      id="pilot"
      className="grid items-center gap-10 rounded-[10px] bg-sw-panel px-6 py-14 sm:px-12 sm:py-20 lg:grid-cols-[1fr_auto] lg:gap-[60px] lg:px-[70px]"
    >
      <div>
        <div className="font-plex text-xs tracking-[0.1em] text-sw-bright-hi">{STATUS_BADGE}</div>
        <h2 className="m-0 mt-4 max-w-[680px] text-balance text-[clamp(30px,5vw,52px)] font-semibold tracking-[-0.03em] text-sw-paper sm:mt-[18px]">
          We are in closed testing with a small number of farms.
        </h2>
        <p className="m-0 mt-4 max-w-[560px] text-[17px] leading-[1.55] text-sw-on-dark sm:mt-[18px]">
          Public sign-up is closed while we fly with them. If you have fields, a drone of any
          kind, and weeds you would rather find from the air, tell us about your operation and we
          will be in touch when a place opens.
        </p>
      </div>

      <div className="justify-self-start">
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
