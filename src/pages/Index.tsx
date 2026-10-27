import { LandingNav } from "@/components/landing/LandingNav";
import { Hero } from "@/components/landing/Hero";
import { BeyondTheMap } from "@/components/landing/BeyondTheMap";
import { PlantSection } from "@/components/landing/PlantSection";
import { Operations } from "@/components/landing/Operations";
import { Audiences } from "@/components/landing/Audiences";
import { Access } from "@/components/landing/Access";
import { LandingFooter } from "@/components/landing/LandingFooter";
import Seo from "@/components/Seo";

/**
 * The public website (redesign of 2026-10-27). overflow-x is clipped rather than hidden: "hidden" would make
 * this element a scroll container and break the sticky Field Twin zoom in BeyondTheMap.
 */
const Index = () => (
  <main className="relative min-h-screen bg-sw-night font-geist text-sw-ivory antialiased [overflow-x:clip]">
    <Seo
      title="Swardus: Every field. Understood."
      description="From drone imagery to field intelligence."
      path="/"
    />
    <LandingNav />
    <Hero />
    <BeyondTheMap />
    <PlantSection />
    <Operations />
    <Audiences />
    <Access />
    <LandingFooter />
  </main>
);

export default Index;
