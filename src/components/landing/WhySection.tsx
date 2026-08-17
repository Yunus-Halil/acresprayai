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
      <div className="mt-5 font-plex text-xs leading-[2] text-sw-faint">{footnote}</div>
    </div>
    <div className={mediaFirst ? "order-1 lg:order-2" : ""}>{media}</div>
  </Reveal>
);

export const WhySection = () => (
  <section id="why" className="relative mx-auto max-w-[1200px] px-5 pt-24 sm:px-10 sm:pt-[130px]">
    <Reveal className="max-w-[620px]">
      <div className="font-plex text-xs tracking-[0.1em] text-sw-green">
        WHY FARM OWNERS CHOOSE US
      </div>
      <h2 className="m-0 mt-4 text-[clamp(30px,5vw,48px)] font-semibold leading-[1.05] tracking-[-0.03em] text-sw-ink sm:mt-[18px]">
        A smarter farm management engine for farmers with little time and big needs.
      </h2>
    </Reveal>

    <Reveal className="mt-12 sm:mt-16">
      <Shot
        src="/screens/flight-planner.png"
        alt="SwathWise flight planner over a stitched orthomosaic"
        caption="FLIGHT PLANNER · MISSION SIMULATION"
        status={<span className="text-sw-bright-hi">● SPRAYING</span>}
        padding="p-2.5"
        className="shadow-[0_40px_80px_-32px_rgba(20,23,18,0.45)]"
      />
    </Reveal>

    <div className="mt-16 flex flex-col gap-16 sm:mt-[90px] sm:gap-[90px]">
      <Row
        title="Real-time intelligence"
        body="Get instant insights on crop health. AI draws treatment zones on your field, sizes each one in acres, and estimates what it will cost to treat — before anything flies."
        footnote="ZONE AREA · EST. COST · RECOMMENDED TREATMENT"
        media={
          <Shot
            src="/screens/treatment-zone.png"
            alt="AI treatment zone with area and cost estimate"
          />
        }
      />

      <Row
        mediaFirst
        title="Flight plans that fly themselves"
        body="Click a button, get flight plans for your drone that only target crops that need spraying. Simulate the mission first: spray distance, transit time, battery use, tank load."
        footnote="236 WAYPOINTS · 29 SPRAY ACTIVATIONS · 1 BATTERY"
        media={
          <Frame>
            <div className="grid gap-2 sm:grid-cols-[220px_1fr]">
              <Screenshot
                src="/screens/mission-summary.png"
                alt="Mission summary with battery and spray estimates"
                className="h-[300px] object-cover object-top sm:h-[460px]"
              />
              <Screenshot
                src="/screens/ortho-route.png"
                alt="Stitched orthomosaic with planned route"
                className="h-[300px] object-cover sm:h-[460px]"
              />
            </div>
          </Frame>
        }
      />

      <Row
        title="Weather that speaks spray windows"
        body="Track weather, flight plans, and recommendations, all in a browser-style interface that doesn't take a degree to use. SwathWise reads the forecast and tells you when it's safe to spray."
        footnote="WIND · HUMIDITY · RAIN · BEST WINDOWS, NEXT 3 DAYS"
        media={
          <Shot src="/screens/weather.png" alt="Weather dashboard with best spray windows" />
        }
      />

      <Row
        mediaFirst
        title="Costs on every acre"
        body="Tell SwathWise what inputs you carry and what they cost per acre. Every treatment zone the AI finds is priced against your numbers — and it never recommends a product you don't have."
        footnote="ACRES × YOUR PER-ACRE COST"
        media={
          <Shot src="/screens/field-settings.png" alt="Field settings with per-acre input costs" />
        }
      />
    </div>
  </section>
);
