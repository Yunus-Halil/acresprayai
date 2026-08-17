import { Reveal } from "./Reveal";
import { STEPS } from "./copy";

export const Steps = () => (
  <Reveal className="relative mx-auto max-w-[1200px] px-5 pt-24 sm:px-10 sm:pt-[130px]">
    <section id="how">
      <div className="font-plex text-xs tracking-[0.1em] text-sw-green">HOW IT WORKS</div>
      <h2 className="m-0 mt-4 text-[clamp(30px,5vw,48px)] font-semibold tracking-[-0.03em] text-sw-ink sm:mt-[18px]">
        Get started in 3 steps
      </h2>

      <div className="mt-10 grid gap-8 sm:mt-14 sm:gap-10 md:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.num} className="border-t-2 border-sw-ink pt-[18px]">
            <div className="font-plex text-[32px] font-medium text-sw-edge">{step.num}</div>
            <h3 className="m-0 mb-2.5 mt-3.5 text-xl font-semibold tracking-[-0.01em] text-sw-ink">
              {step.title}
            </h3>
            <p className="m-0 text-[15px] leading-[1.55] text-sw-muted">{step.body}</p>
          </div>
        ))}
      </div>
    </section>
  </Reveal>
);
