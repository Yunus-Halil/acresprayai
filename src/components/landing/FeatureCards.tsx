import { Reveal } from "./Reveal";
import { FEATURES } from "./copy";

export const FeatureCards = () => (
  <Reveal className="relative mx-auto max-w-[1200px] px-5 pt-16 sm:px-10 sm:pt-[90px]">
    <div className="grid gap-8 sm:grid-cols-2 sm:gap-10 lg:grid-cols-4">
      {FEATURES.map((feature) => (
        <div key={feature.num} className="border-t-2 border-sw-ink pt-[18px]">
          <div className="mb-3.5 font-plex text-xs text-sw-green">{feature.num}</div>
          <h3 className="m-0 mb-2.5 text-[19px] font-semibold tracking-[-0.01em] text-sw-ink">
            {feature.title}
          </h3>
          <p className="m-0 text-[15px] leading-[1.5] text-sw-muted">{feature.body}</p>
        </div>
      ))}
    </div>
  </Reveal>
);
