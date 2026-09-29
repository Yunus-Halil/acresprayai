import { Reveal } from "./Reveal";

/**
 * The application record, between the cockpit and the three steps.
 *
 * It sits here because the record is the last thing that happens in a job and
 * the first thing an operator gets asked for afterwards. The license is theirs,
 * so the paperwork is their exposure and not the grower's.
 *
 * The rule in copy.ts about not claiming a capability we lack binds hardest
 * here. We have not checked this record against any state's requirements, so
 * the page does not say it satisfies them. It says what the record is made of
 * and who stays responsible, and the closing line says so in the same words the
 * cockpit uses for its engineering estimates. If that changes, it changes
 * because someone verified it against a specific state, and this comment gets
 * the citation.
 */

/** The fields the record carries, named the way a state form names them. */
const RECORD_FIELDS = [
  { label: "PRODUCT", detail: "What was applied, and the rate it went out at." },
  { label: "ACRES", detail: "Treated area, summed from the zones that were sprayed." },
  { label: "CONDITIONS", detail: "Wind and temperature at the time of the application, as you recorded them on site or accepted from a nearby weather station, labeled either way." },
  { label: "APPLICATOR", detail: "Certification number, date and time of the job." },
  { label: "FIELD", detail: "Field identification, with the boundary it was flown on." },
  { label: "SIGNATURE", detail: "A line for the applicator to sign the record." },
];

export const ComplianceSection = () => (
  <Reveal className="relative mx-auto max-w-[1200px] px-5 pt-24 sm:px-10 sm:pt-[130px]">
    <section id="record">
      <div className="font-plex text-xs tracking-[0.1em] text-sw-green">
        THE APPLICATION RECORD
      </div>
      <h2 className="m-0 mt-4 max-w-[760px] text-[clamp(30px,5vw,48px)] font-semibold leading-[1.05] tracking-[-0.03em] text-sw-ink sm:mt-[18px]">
        The record you would have to write anyway.
      </h2>
      <p className="m-0 mt-5 max-w-[640px] text-[17px] leading-[1.55] text-sw-muted">
        Most states want a record after the job, and most get written from memory hours
        after the tank was empty. SwathWise already holds what the record asks for, because
        it held it while you were flying. Nothing is retyped.
      </p>

      <div className="mt-10 grid gap-x-10 gap-y-7 sm:mt-14 sm:grid-cols-2 lg:grid-cols-3">
        {RECORD_FIELDS.map((field) => (
          <div key={field.label} className="border-t border-sw-line pt-4">
            <div className="font-plex text-[11px] tracking-[0.1em] text-sw-green">
              {field.label}
            </div>
            <p className="m-0 mt-2.5 text-[15px] leading-[1.55] text-sw-muted">
              {field.detail}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-14 grid gap-10 sm:mt-16 lg:grid-cols-2 lg:gap-[70px]">
        <div>
          <h3 className="m-0 text-[24px] font-semibold tracking-[-0.02em] text-sw-ink sm:text-[28px]">
            Sprayed and documented are the same list.
          </h3>
          <p className="m-0 mt-4 text-base leading-[1.55] text-sw-muted">
            The zones you confirmed are the zones that get recorded; there is no second pass
            where the paperwork drifts from the job. If a grower asks what was applied, or a
            neighbor has a question about drift, this is the record: the zones, the product,
            the rate and the acres.
          </p>
        </div>
        <div>
          <h3 className="m-0 text-[24px] font-semibold tracking-[-0.02em] text-sw-ink sm:text-[28px]">
            The grower gets a document, not a text message.
          </h3>
          <p className="m-0 mt-4 text-base leading-[1.55] text-sw-muted">
            Hand it over at the end of the job: the field, the product, the rate and the acres,
            with a line for your signature. A different conversation from a photo of a notebook
            page, and the one that gets you called back next season.
          </p>
        </div>
      </div>

      {/* The limit, in the same type as the claims. The record is built from the
          job; whether it satisfies a given state's rules has not been checked
          and the page does not say it has. The flight is the pilot's too. */}
      <p className="m-0 mt-10 max-w-[640px] font-plex text-xs leading-[1.6] tracking-[0.06em] text-sw-muted sm:mt-14">
        THE RECORD IS BUILT FROM THE JOB. CHECKING IT AGAINST YOUR STATE'S REQUIREMENTS IS
        STILL THE APPLICATOR'S RESPONSIBILITY, AND SO IS THE FLIGHT.
      </p>

    </section>
  </Reveal>
);
