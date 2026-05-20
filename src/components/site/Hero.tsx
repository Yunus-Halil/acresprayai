import { motion } from "framer-motion";
import heroImg from "@/assets/hero-drone.jpg";

export const Hero = () => {
  return (
    <section className="relative pt-28 pb-20 md:pt-36 md:pb-28 overflow-hidden bg-gradient-hero">
      <div className="absolute inset-0 grid-bg opacity-60 pointer-events-none" />
      <div className="container relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-4xl"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-mono uppercase tracking-wider text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot" />
            UN SDG · Agriculture & Industry
          </div>
          <h1 className="mt-6 font-display text-5xl md:text-7xl lg:text-8xl font-semibold leading-[0.95] text-balance">
            Spray only{" "}
            <span className="italic font-normal text-muted-foreground">where it’s</span>{" "}
            <span className="relative inline-block">
              needed.
              <svg
                className="absolute -bottom-2 left-0 w-full"
                viewBox="0 0 300 12"
                fill="none"
              >
                <path
                  d="M2 8 Q 75 2, 150 6 T 298 5"
                  stroke="hsl(var(--accent))"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </h1>
          <p className="mt-8 max-w-2xl text-lg md:text-xl text-muted-foreground leading-relaxed">
            AgriPulse fuses AI vision, drone imagery, weather and soil data into one
            decision system — telling farmers exactly when, where, and how much to spray.
            <span className="text-foreground"> Cut chemical use by 30%+. Keep yield intact.</span>
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <a
              href="/auth"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3.5 text-base text-primary-foreground hover:bg-primary/90 transition-all hover:shadow-elevated"
            >
              Launch app
              <span aria-hidden>→</span>
            </a>
            <a
              href="#how"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-6 py-3.5 text-base text-foreground hover:bg-secondary transition-colors"
            >
              See how it works
            </a>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="mt-20 relative rounded-lg overflow-hidden shadow-elevated border border-border"
        >
          <img
            src={heroImg}
            alt="AI drone scanning a crop field with a glowing detection grid"
            width={1920}
            height={1080}
            className="w-full h-auto block"
          />
          {/* Scan line */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-accent/30 to-transparent animate-scan" />
          </div>
          {/* HUD chips */}
          <div className="absolute top-4 left-4 md:top-6 md:left-6 flex flex-col gap-2">
            <div className="font-mono text-[10px] md:text-xs tracking-widest text-accent bg-primary/80 backdrop-blur px-3 py-1.5 rounded-sm">
              SCAN · 04.21.26 · 17:42 UTC
            </div>
            <div className="font-mono text-[10px] md:text-xs tracking-widest text-primary-foreground bg-primary/80 backdrop-blur px-3 py-1.5 rounded-sm">
              FIELD #A-019 · 142 ACRES
            </div>
          </div>
          <div className="absolute bottom-4 right-4 md:bottom-6 md:right-6 flex gap-3">
            <div className="bg-card/95 backdrop-blur rounded-sm px-4 py-2 shadow-soft">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Treat zone</div>
              <div className="font-display text-2xl font-semibold">11.2%</div>
            </div>
            <div className="bg-card/95 backdrop-blur rounded-sm px-4 py-2 shadow-soft">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Saved</div>
              <div className="font-display text-2xl font-semibold text-field">$3,840</div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};
