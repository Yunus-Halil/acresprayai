import { LandingNav } from "@/components/landing/LandingNav";
import { Hero } from "@/components/landing/Hero";
import { CardRail } from "@/components/landing/CardRail";
import { Statement } from "@/components/landing/Statement";
import { Audiences } from "@/components/landing/Audiences";
import { PilotCTA } from "@/components/landing/PilotCTA";
import { LandingFooter } from "@/components/landing/LandingFooter";
import Seo from "@/components/Seo";

const Index = () => (
  <main className="relative min-h-screen overflow-hidden bg-sw-paper font-grotesk text-sw-ink">
    <Seo
      title="SwathWise: Precision agriculture from the air"
      description="Field intelligence built for action. Upload your field map: SwathWise finds and measures the weeds, all of them, and turns what you confirm into a spray mission and a record."
      path="/"
    />
    {/* The nav sits over the hero film, which is the first screen; nothing decorates the page behind it. */}
    <LandingNav />
    <Hero />
    <CardRail />
    <Statement />
    <Audiences />
    <PilotCTA />
    <LandingFooter />
  </main>
);

export default Index;
