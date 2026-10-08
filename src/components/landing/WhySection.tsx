import { Reveal } from "./Reveal";
import { Shot } from "./Shot";
import { FLOW } from "./copy";

/**
 * How it works: three steps and one picture. The findings section above says
 * what is found; this one says what happens to it. It used to carry four rows
 * of screenshots, a cockpit section and the application record; Yunus cut
 * them on 2026-10-08 ("field intelligence, finds all the weeds, the flight
 * plan is too much"), so the page stays vague about the flying while the
 * product is in closed testing.
 *
 * Not one aircraft. The route capture happens to be from a spray drone, and the
 * caption says which; the copy talks about the file, because the file is what
 * the product actually produces. No manufacturer is named (copy.ts, rule 4).
 */
export const WhySection = () => (
  <section id="why" className="relative mx-auto max-w-[1200px] px-5 pt-24 sm:px-10 sm:pt-[130px]">
    <Reveal className="max-w-[720px]">
      <div className="font-plex text-xs tracking-[0.1em] text-sw-green">
        HOW IT WORKS
      </div>
      <h2 className="m-0 mt-4 text-[clamp(30px,5vw,48px)] font-semibold leading-[1.05] tracking-[-0.03em] text-sw-ink sm:mt-[18px]">
        {FLOW.headline}
      </h2>
      <p className="m-0 mt-5 max-w-[620px] text-[17px] leading-[1.55] text-sw-muted">
        {FLOW.sub}
      </p>
    </Reveal>

    {/* The three steps, as one strip. The first is the weed map; the rest are derived from it. */}
    <Reveal className="mt-10 sm:mt-14">
      <ol className="grid gap-6 sm:grid-cols-3 lg:gap-10">
        {FLOW.steps.map((step, i) => (
          <li key={step.label} className="border-t-2 border-sw-ink pt-4">
            <div className="flex items-baseline justify-between font-plex text-xs tracking-[0.1em] text-sw-green">
              <span>{step.label}</span>
              <span className="text-sw-muted">{String(i + 1).padStart(2, "0")}</span>
            </div>
            <p className="m-0 mt-2.5 text-[15px] leading-[1.5] text-sw-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </Reveal>

    <Reveal className="mt-12 sm:mt-16">
      <Shot
        src="/screens/mission-route.jpg"
        alt="SwathWise flight planner: a spray mission over a stitched field map, start to end"
        caption="FLIGHT PLANNER · SPRAY MISSION OVER CONFIRMED FINDINGS"
        status={<span className="text-sw-bright-hi">● SPRAYING</span>}
        padding="p-2.5"
        className="shadow-[0_40px_80px_-32px_rgba(20,23,18,0.45)]"
        imgClassName="mx-auto max-h-[700px] w-auto max-w-full"
      />
    </Reveal>
  </section>
);
