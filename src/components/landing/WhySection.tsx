import type { ReactNode } from "react";
import { Reveal } from "./Reveal";
import { Frame, Screenshot, Shot } from "./Shot";

type RowProps = {
  title: string;
  body: string;
  /** Mono data line naming what the screenshot actually shows. */
  footnote: string;
  media: ReactNode;
  /** Screenshot on the left on wide viewports. Text always comes first on mobile. */
  mediaFirst?: boolean;
};

const Row = ({ title, body, footnote, media, mediaFirst = false }: RowProps) => (
  <Reveal
    className={`grid items-center gap-10 lg:gap-[70px] ${
      mediaFirst ? "lg:grid-cols-[1fr_380px]" : "lg:grid-cols-[380px_1fr]"
    }`}
  >
    <div className={mediaFirst ? "order-2 lg:order-1" : ""}>
      <h3 className="m-0 text-[24px] font-semibold tracking-[-0.02em] text-sw-ink sm:text-[28px]">
        {title}
      </h3>
      <p className="m-0 mt-4 text-base leading-[1.55] text-sw-muted">{body}</p>
      <div className="mt-5 font-plex text-xs leading-[2] text-sw-muted">{footnote}</div>
    </div>
    <div className={mediaFirst ? "order-1 lg:order-2" : ""}>{media}</div>
  </Reveal>
);

/**
 * From the finding to the flight. The detection section above says how the
 * weeds are found; this one says what happens to them, in the order it happens:
 * sized and priced, flown, flown in the right weather, costed in your numbers.
 *
 * Not one aircraft. The route capture happens to be from a spray drone, and the
 * caption says which; the copy talks about the file, because the file is what
 * the product actually produces and what any DJI or QGC controller reads.
 */
export const WhySection = () => (
  <section id="why" className="relative mx-auto max-w-[1200px] px-5 pt-24 sm:px-10 sm:pt-[130px]">
    <Reveal className="max-w-[720px]">
      <div className="font-plex text-xs tracking-[0.1em] text-sw-green">
        FROM THE FINDING TO THE FLIGHT
      </div>
      <h2 className="m-0 mt-4 text-[clamp(30px,5vw,48px)] font-semibold leading-[1.05] tracking-[-0.03em] text-sw-ink sm:mt-[18px]">
        Found it. Sized it. Priced it. Flew it. Filed it.
      </h2>
      <p className="m-0 mt-5 max-w-[620px] text-[17px] leading-[1.55] text-sw-muted">
        A weed you can see on a map is a weed you can put a number on. SwathWise turns every
        confirmed finding into acres, into a cost against your own inputs, into a spray route
        for whatever you fly, and into the record you would have had to write anyway.
      </p>
    </Reveal>

    <Reveal className="mt-12 sm:mt-16">
      <Shot
        src="/screens/mission-route.jpg"
        alt="SwathWise flight planner: a spray mission over a stitched orthomosaic, start to end"
        caption="FLIGHT PLANNER · SPRAY MISSION OVER CONFIRMED FINDINGS"
        status={<span className="text-sw-bright-hi">● SPRAYING</span>}
        padding="p-2.5"
        className="shadow-[0_40px_80px_-32px_rgba(20,23,18,0.45)]"
        imgClassName="mx-auto max-h-[700px] w-auto max-w-full"
      />
    </Reveal>

    <div className="mt-16 flex flex-col gap-16 sm:mt-[90px] sm:gap-[90px]">
      <Row
        title="Every finding comes with an acreage and a price"
        body="Each weed zone is measured in acres, clipped to your boundary and inset by the headland your aircraft needs, so the acres you see are the acres you will treat. Price them against the inputs you carry, at your own per-acre cost. Nothing is suggested that you do not have."
        footnote="ZONE AREA · TREATED AREA AFTER HEADLAND · EST. COST"
        media={
          <Shot
            src="/screens/treatment-zone.png"
            alt="A confirmed treatment zone with its area and cost estimate"
          />
        }
      />

      <Row
        mediaFirst
        title="One button, one flight, only those spots"
        body="Confirm the findings and the spray mission is built: a route that crosses treated ground and nothing else, the litres it needs, the batteries, where the tank runs dry and where to refill. Simulate it first. Then download a standard waypoint file and fly it on your own aircraft."
        footnote="WPML AND QGC WAYPOINTS · DJI FLY · DJI PILOT · ANY WPML CONTROLLER"
        media={
          <Frame>
            <div className="grid gap-2 sm:grid-cols-[220px_1fr]">
              <Screenshot
                src="/screens/mission-summary.png"
                alt="Mission summary with battery and spray estimates"
                className="h-[300px] w-full object-cover object-top sm:h-[460px]"
              />
              <Screenshot
                src="/screens/mission-route.jpg"
                alt="Stitched orthomosaic with the planned route"
                className="h-[300px] w-full object-cover sm:h-[460px]"
              />
            </div>
          </Frame>
        }
      />

      <Row
        title="It tells you when the sky will let you"
        body="Wind, humidity, rain and temperature for your field, read against spray conditions, so the best windows over the next three days are named for you. Schedule the mission into one of them and the forecast rides along with it."
        footnote="WIND · HUMIDITY · RAIN · BEST WINDOWS, NEXT 3 DAYS"
        media={
          <Shot src="/screens/weather.png" alt="Weather dashboard with best spray windows" />
        }
      />

      <Row
        mediaFirst
        title="Your inputs, your prices, your units"
        body="Tell it what you carry and what it costs you per acre. Every zone is priced in your numbers, in acres or hectares, gallons or litres, whichever you set once. It never invents a product, a rate or a saving."
        footnote="ACRES × YOUR PER-ACRE COST · ONE UNIT SETTING, EVERYWHERE"
        media={
          <Shot src="/screens/field-settings.png" alt="Field settings with per-acre input costs" />
        }
      />
    </div>
  </section>
);
