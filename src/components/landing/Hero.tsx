import { FlightPath } from "./FlightPath";
import { PilotLink } from "./Cta";
import { HeroVideo } from "./HeroVideo";
import { ShiftingLine } from "./ShiftingLine";
import { HERO, STATUS_BADGE } from "./copy";

/**
 * The hero: the whole first screen is the film, real flights over real
 * fields, with the headline set in the middle of it. The first line stands
 * still and the last turns through what the intelligence is built for, in the order
 * the product makes it. The one paragraph under the film is the whole promise,
 * with the flight picture, so the film carries the feeling and the band
 * carries the facts.
 */
export const Hero = () => (
  <>
    <header id="top" className="relative flex min-h-[100svh] flex-col text-sw-paper">
      <HeroVideo />
      {/* Legibility, not mood: dark enough behind the type, open at the edges, and sunk into the band below. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(16,20,16,0.55) 0%, rgba(16,20,16,0.28) 35%, rgba(16,20,16,0.38) 70%, #101410 100%)",
        }}
      />

      <div className="relative z-10 mx-auto flex w-full max-w-[1200px] flex-1 flex-col items-center justify-center px-5 pb-24 pt-32 text-center sm:px-10 sm:pt-36">
        <div
          className="sw-load inline-flex items-center gap-2.5 rounded-[3px] border border-white/25 bg-black/30 px-3.5 py-1.5 font-plex text-[11px] tracking-[0.04em] text-white/85 backdrop-blur-sm sm:text-xs"
          style={{ animationDelay: "0.05s" }}
        >
          <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-sw-bright-hi" />
          {STATUS_BADGE}
        </div>

        <h1
          className="sw-load mt-8 m-0 max-w-[1100px] text-[clamp(38px,6.6vw,92px)] font-semibold leading-[1.02] tracking-[-0.035em] text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.35)]"
          style={{ animationDelay: "0.12s" }}
        >
          <span className="block">{HERO.lead}</span>
          <ShiftingLine phrases={HERO.shifts} className="block text-sw-bright-hi" />
        </h1>

        <div
          className="sw-load mt-6 font-plex text-xs tracking-[0.12em] text-white/80 sm:text-sm"
          style={{ animationDelay: "0.2s" }}
        >
          {HERO.brand}
        </div>

        <div className="sw-load mt-9 flex flex-wrap justify-center gap-3.5" style={{ animationDelay: "0.3s" }}>
          <PilotLink className="bg-white text-sw-ink hover:bg-sw-bright-hi hover:text-sw-ink" />
        </div>
      </div>

      {/* The cue to keep going. A line, not an arrow, in the panel's own mono. */}
      <a
        href="#hero-detail"
        aria-label="Scroll to read more"
        className="sw-load absolute bottom-7 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2 font-plex text-[10px] tracking-[0.18em] text-white/70 transition-colors hover:text-white"
        style={{ animationDelay: "0.9s" }}
      >
        SCROLL
        <span className="block h-8 w-px bg-white/50" />
      </a>
    </header>

    <section id="hero-detail" className="relative bg-sw-panel text-sw-paper">
      <div className="mx-auto max-w-[1200px] px-5 pb-16 pt-14 sm:px-10 sm:pb-24 sm:pt-20">
        <div className="max-w-[720px] space-y-3 text-[17px] leading-[1.5] text-[#c9cfc2] sm:text-xl">
          {HERO.body.map(p => <p key={p} className="m-0">{p}</p>)}
        </div>


        <FlightPath />
      </div>
    </section>
  </>
);
