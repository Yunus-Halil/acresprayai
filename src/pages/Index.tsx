import { LandingNav } from "@/components/landing/LandingNav";
import { Hero } from "@/components/landing/Hero";
import { FeatureCards } from "@/components/landing/FeatureCards";
import { DetectionSection } from "@/components/landing/DetectionSection";
import { WhySection } from "@/components/landing/WhySection";
import { CockpitSection } from "@/components/landing/CockpitSection";
import { ComplianceSection } from "@/components/landing/ComplianceSection";
import { Steps } from "@/components/landing/Steps";
import { Audiences } from "@/components/landing/Audiences";
import { PilotCTA } from "@/components/landing/PilotCTA";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { TileGrid } from "@/components/landing/TileGrid";
import Seo from "@/components/Seo";

const Index = () => (
  <main className="relative min-h-screen overflow-hidden bg-sw-paper font-grotesk text-sw-ink">
    <Seo
      title="SwathWise: Every weed on your farm, found from the air"
      description="Fly any drone over any field. SwathWise measures every plant against your own crop, shows you every weed on the map, plans the flight that treats only those spots, and writes the record."
      path="/"
    />
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
    <DetectionSection />
    <WhySection />
    <CockpitSection />
    <ComplianceSection />
    <Steps />
    <Audiences />
    <PilotCTA />
    <LandingFooter />
  </main>
);

export default Index;
