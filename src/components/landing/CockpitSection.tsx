import { Reveal } from "./Reveal";
import { DemoLink } from "./Cta";
import { Frame } from "./Shot";
import { SimVideo } from "./SimVideo";

/**
 * The flagship shot: the flight planner mid-simulation, tank dynamics live.
 *
 * Every claim on this page is checkable against the product. The specifics
 * below are chosen because they are TRUE and unusual, which is the only kind
 * of boast worth making: a farmer who buys on a promise and finds it missing
 * does not buy twice. Where a number is a model rather than a measurement, the
 * app says so on its own face, and so does the last line here.
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
          Press play and watch the aircraft work: every pass, every turn, the tank
          draining, the centre of gravity shifting as the liquid moves, the battery
          going down faster while it is heavy. Scrub to any minute of the mission and
          the numbers are the numbers for <em>that</em> minute. Nothing here is a
          progress bar pretending to be physics.
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
            label="The SwathWise flight planner running a mission simulation: the aircraft flying its spray passes over the orthomosaic while the tank dynamics panel, battery, spray tank and distance readouts update in step"
            className="mx-auto w-full"
          />
        </Frame>
      </Reveal>

      {/* The full recording, from the section that shows a clip of it. The demo
          used to have exactly one door, in the hero, which a visitor has
          usually scrolled past by the time they want it. */}
      <Reveal className="mt-8">
        <DemoLink className="border border-white/20 text-sw-paper hover:border-sw-bright-hi hover:text-sw-bright-hi" />
      </Reveal>

      <div className="mt-14 grid gap-x-10 gap-y-9 sm:mt-16 sm:grid-cols-2 lg:grid-cols-4">
        <Reveal>
          <Spec
            value="Slosh"
            label="FLUID DYNAMICS"
            detail="Liquid does not teleport. Pitch into a turn and the tank leans, the centre of gravity moves, and the motors pay for it, modelled continuously rather than as an on/off state."
          />
        </Reveal>
        <Reveal>
          <Spec
            value="Amp-seconds"
            label="ENDURANCE MODEL"
            detail="A full tank costs more per second than an empty one. Battery prediction integrates real draw across the mission instead of drawing a straight line through time."
          />
        </Reveal>
        <Reveal>
          <Spec
            value="One swath"
            label="PRESCRIPTION GRID"
            detail="Rates are assigned in cells the size of your boom. Sub-swath precision is refused rather than promised, because no aircraft can fly it."
          />
        </Reveal>
        <Reveal>
          <Spec
            value="Your call"
            label="EVERY SUGGESTION"
            detail="Mark a few patches and it finds the rest. Scan a fresh field and it surfaces what stands out. Nothing sprays until you say so."
          />
        </Reveal>
      </div>

      <Reveal className="mt-14 border-t border-white/10 pt-6 sm:mt-16">
        <p className="m-0 max-w-[720px] font-plex text-[12px] leading-[1.9] tracking-[0.03em] text-sw-on-dark">
          Endurance, slosh and centre-of-gravity figures are engineering estimates for
          planning, not certified flight-dynamics data. The app labels them as such
          wherever it shows them. We would rather you trusted the number you can check
          than the number that sounds best.
        </p>
      </Reveal>
    </div>
  </section>
);
