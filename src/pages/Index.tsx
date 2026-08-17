import { LandingNav } from "@/components/landing/LandingNav";
import { Hero } from "@/components/landing/Hero";
import { FeatureCards } from "@/components/landing/FeatureCards";
import { WhySection } from "@/components/landing/WhySection";
import { Steps } from "@/components/landing/Steps";
import { Audiences } from "@/components/landing/Audiences";
import { PilotCTA } from "@/components/landing/PilotCTA";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { TileGrid } from "@/components/landing/TileGrid";

const Index = () => (
  <main className="relative min-h-screen overflow-hidden bg-sw-paper font-grotesk text-sw-ink">
    {/* Faint ink grid, fading out below the hero. */}
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 opacity-[0.045]"
      style={{
        backgroundImage:
          "linear-gradient(#141712 1px, transparent 1px), linear-gradient(90deg, #141712 1px, transparent 1px)",
        backgroundSize: "72px 72px",
        maskImage: "linear-gradient(to bottom, black 0, black 720px, transparent 1200px)",
        WebkitMaskImage: "linear-gradient(to bottom, black 0, black 720px, transparent 1200px)",
      }}
    />
    <TileGrid />

    <LandingNav />
    <Hero />
    <FeatureCards />
    <WhySection />
    <Steps />
    <Audiences />
    <PilotCTA />
    <LandingFooter />
  </main>
);

export default Index;
