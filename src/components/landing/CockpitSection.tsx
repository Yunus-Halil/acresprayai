import { Reveal } from "./Reveal";
import { Frame } from "./Shot";
import { SimVideo } from "./SimVideo";

/**
 * The flagship shot: the flight planner mid-simulation, tank dynamics live.
 *
 * Every claim on this page is checkable against the product, and every one is
 * put in terms of what the operator gets out of it: loads, batteries, refill
 * stops. The physics underneath (slosh, center-of-gravity shift, load-dependent
 * draw) is what makes those numbers honest, but it stays in the code and in
 * offrow/FLIGHT.md. A farmer reading this page wants to know how many batteries
 * to bring, not how the estimate is integrated.
 */

type SpecProps = { value: string; label: string; detail: string };

const Spec = ({ value, label, detail }: SpecProps) => (
  <div className="border-t border-white/10 pt-4">
    <div className="font-plex text-[22px] leading-none tracking-[-0.01em] text-sw-bright-hi sm:text-[26px]">
      {value}
    </div>
    <div className="mt-2 font-plex text-[11px] tracking-[0.1em] text-sw-on-dark">
      {label}
    </div>
    <div className="mt-2 text-[13px] leading-[1.5] text-sw-on-dark">{detail}</div>
  </div>
);

export const CockpitSection = () => (
  <section
    id="cockpit"
    className="relative mt-24 bg-sw-ink py-20 sm:mt-[130px] sm:py-[110px]"
  >
    <div className="mx-auto max-w-[1200px] px-5 sm:px-10">
      <Reveal className="max-w-[720px]">
        <div className="font-plex text-xs tracking-[0.1em] text-sw-green">
          THE COCKPIT
        </div>
        <h2 className="m-0 mt-4 text-[clamp(30px,5vw,52px)] font-semibold leading-[1.03] tracking-[-0.03em] text-sw-on-dark sm:mt-[18px]">
          Fly the whole job before you fly it.
        </h2>
        <p className="m-0 mt-5 max-w-[620px] text-[17px] leading-[1.55] text-sw-on-dark">
          Press play and watch the aircraft work the field: each pass, each turn, the tank
          draining, the battery going down faster while it is heavy. Scrub to any minute and
          the numbers are for <em>that</em> minute. Before you leave the yard you know the
          loads, the batteries and where you will stop to refill.
        </p>
      </Reveal>

      <Reveal className="mt-12 sm:mt-16">
        <Frame
          caption="FLIGHT PLANNER · TANK DYNAMICS · LIVE SIMULATION"
          status={<span className="text-sw-bright-hi">● RECORDED IN-APP, 32× SPEED</span>}
          padding="p-2.5"
          className="shadow-[0_40px_90px_-30px_rgba(0,0,0,0.7)]"
        >
          <SimVideo
            poster="/video/cockpit-sim-poster.jpg"
            sources={[
              { src: "/video/cockpit-sim.webm", type: "video/webm" },
              { src: "/video/cockpit-sim.mp4", type: "video/mp4" },
            ]}
            label="The SwathWise flight planner running a mission simulation: the aircraft flying its spray passes over the stitched field map while the tank dynamics panel, battery, spray tank and distance readouts update in step"
            className="mx-auto w-full"
          />
        </Frame>
      </Reveal>

      <div className="mt-14 grid gap-x-10 gap-y-9 sm:mt-16 sm:grid-cols-2 lg:grid-cols-4">
        <Reveal>
          <Spec
            value="Refills"
            label="TANK PLANNING"
            detail="Where the tank runs dry on the route, and the refill stops, planned before you take off."
          />
        </Reveal>
        <Reveal>
          <Spec
            value="Batteries"
            label="BATTERY PLANNING"
            detail="A full tank drains a battery faster than an empty one. The estimate follows the load through the mission, so the battery count is for your job, not a rule of thumb."
          />
        </Reveal>
        <Reveal>
          <Spec
            value="One pass"
            label="RATE PER PASS"
            detail="Rates are set in strips the width of your boom, because that is what the aircraft can fly. Nothing finer is promised."
          />
        </Reveal>
        <Reveal>
          <Spec
            value="Your call"
            label="EVERY SUGGESTION"
            detail="SwathWise detects and proposes. You decide what gets sprayed, and you fly it."
          />
        </Reveal>
      </div>

    </div>
  </section>
);
