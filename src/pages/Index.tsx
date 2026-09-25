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
      title="SwathWise: Precision agriculture from the air"
      description="Map your farm from any drone, find every weed and every patch that is not behaving like the rest of the field, treat only those spots, and keep the record. Any drone, any camera, any crop."
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
