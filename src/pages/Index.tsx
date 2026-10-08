import { LandingNav } from "@/components/landing/LandingNav";
import { Hero } from "@/components/landing/Hero";
import { DetectionSection } from "@/components/landing/DetectionSection";
import { WhySection } from "@/components/landing/WhySection";
import { CockpitSection } from "@/components/landing/CockpitSection";
import { ComplianceSection } from "@/components/landing/ComplianceSection";
import { Audiences } from "@/components/landing/Audiences";
import { PilotCTA } from "@/components/landing/PilotCTA";
import { LandingFooter } from "@/components/landing/LandingFooter";
import Seo from "@/components/Seo";

const Index = () => (
  <main className="relative min-h-screen overflow-hidden bg-sw-paper font-grotesk text-sw-ink">
    <Seo
      title="SwathWise: Precision agriculture from the air"
      description="Field intelligence built for action. Upload the field map from one drone flight: SwathWise reads your planting pattern, finds and measures the weeds, and turns what you confirm into a spray mission and a record."
      path="/"
    />
    {/* The nav sits over the hero film, which is the first screen; nothing decorates the page behind it. */}
    <LandingNav />
    <Hero />
    <DetectionSection />
    <WhySection />
    <CockpitSection />
    <ComplianceSection />
    <Audiences />
    <PilotCTA />
    <LandingFooter />
  </main>
);

export default Index;
