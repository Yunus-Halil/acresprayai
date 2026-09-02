import { Reveal } from "./Reveal";

/**
 * The application record, between the cockpit and the three steps.
 *
 * It sits here because the record is the last thing that happens in a job and
 * the first thing an operator gets asked for afterwards. The licence is theirs,
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
  { label: "CONDITIONS", detail: "Wind and temperature at the time of the application." },
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
        Every state wants a record after the job. Most of them get one written at the
        kitchen table from memory, hours after the tank was empty. SwathWise already holds
        every field that record asks for, because it held them while you were flying. The
        record comes off the job that was flown. Nothing is retyped.
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
            The zones you confirmed are the zones that get recorded. There is no second
            pass where the paperwork drifts away from the job, because there is no second
            pass. If a grower disputes an application, or a neighbour calls in a drift
            complaint, this is the document that says what left the tank and where.
          </p>
        </div>
        <div>
          <h3 className="m-0 text-[24px] font-semibold tracking-[-0.02em] text-sw-ink sm:text-[28px]">
            The grower gets a document, not a text message.
          </h3>
          <p className="m-0 mt-4 text-base leading-[1.55] text-sw-muted">
            Hand it over at the end of the job. It has the field, the product, the rate and
            the acres on it, signed. That is a different conversation from a photo of a
            notebook page, and it is the one that gets you called back next season.
          </p>
        </div>
      </div>

      <div className="mt-14 border-t border-sw-line pt-6 sm:mt-16">
        <p className="m-0 max-w-[720px] font-plex text-[12px] leading-[1.9] tracking-[0.03em] text-sw-muted">
          We generate the record from what was flown. We do not certify that it meets any
          particular state's requirements, and we have not verified it against them. Meeting
          the rules you are licensed under stays your responsibility. Check the record
          against your state's form before you file it.
        </p>
      </div>
    </section>
  </Reveal>
);
