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
import Seo from "@/components/Seo";

const Index = () => (
  <main className="relative min-h-screen overflow-hidden bg-sw-paper font-grotesk text-sw-ink">
    <Seo
      title="SwathWise: Precision agriculture from the air"
      description="Map your farm from any drone, find the weeds and every patch that is not behaving like the rest of the field, treat only those spots, and keep the record. Any drone, any camera, any crop."
      path="/"
    />
    {/* The nav sits over the hero film, which is the first screen; nothing decorates the page behind it. */}
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
