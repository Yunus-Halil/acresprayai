import { Nav } from "@/components/site/Nav";
import { Hero } from "@/components/site/Hero";
import { Marquee } from "@/components/site/Marquee";
import { Stats } from "@/components/site/Stats";
import { HowItWorks } from "@/components/site/HowItWorks";
import { Personas } from "@/components/site/Personas";
import { Roadmap } from "@/components/site/Roadmap";
import { CTA } from "@/components/site/CTA";
import { Footer } from "@/components/site/Footer";

const Index = () => {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <Nav />
      <Hero />
      <Marquee />
      <Stats />
      <HowItWorks />
      <Personas />
      <Roadmap />
      <CTA />
      <Footer />
    </main>
  );
};

export default Index;
