import { AccessButton, GhostButton, Label } from "./Cta";
import { HeroVideo } from "./HeroVideo";
import { HERO, STATUS_BADGE } from "./copy";

/**
 * The first screen is the footage: real flights over real fields (heroMedia.ts), with the headline set low and
 * left over a flat shade that is there for legibility, not mood. Two buttons, one status line, nothing else.
 */
export const Hero = () => (
  <header id="top" className="relative flex min-h-[100svh] flex-col overflow-hidden bg-sw-night text-sw-ivory">
    <HeroVideo />
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-sw-night/50" />

    <div className="relative z-10 mx-auto flex w-full max-w-[1440px] flex-1 flex-col justify-end px-5 pb-12 pt-32 sm:px-10 sm:pb-16 lg:px-16 lg:pb-20">
      <h1 className="sw-load m-0 font-geist text-[clamp(52px,9.2vw,148px)] font-medium leading-[0.92] tracking-[-0.05em]" style={{ animationDelay: "0.1s" }}>
        {HERO.lines.map(l => <span key={l} className="block">{l}</span>)}
      </h1>

      <div className="mt-8 flex flex-col gap-8 sm:mt-10 lg:flex-row lg:items-end lg:justify-between">
        <p className="sw-load m-0 max-w-[30ch] text-[clamp(18px,1.7vw,24px)] leading-[1.35] tracking-[-0.01em] text-sw-ivory/80" style={{ animationDelay: "0.25s" }}>
          {HERO.sub}
        </p>
        <div className="sw-load flex flex-wrap gap-3" style={{ animationDelay: "0.4s" }}>
          <GhostButton href="#beyond" />
          <AccessButton />
        </div>
      </div>

      <div className="sw-load mt-12 border-t border-sw-ivory/15 pt-5 sm:mt-16" style={{ animationDelay: "0.6s" }}>
        <Label className="text-sw-ivory/60">
          <span aria-hidden="true" className="mr-2.5 inline-block h-1.5 w-1.5 translate-y-[-1px] rounded-full bg-sw-bright-hi" />
          {STATUS_BADGE}
        </Label>
      </div>
    </div>
  </header>
);
