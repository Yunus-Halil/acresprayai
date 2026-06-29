import { motion } from "framer-motion";
import { Bot, Plane, CloudSun, Map } from "lucide-react";
import analysis from "@/assets/landing/image-20.png.asset.json";
import planner from "@/assets/landing/image-18.png.asset.json";
import flight from "@/assets/landing/image-17.png.asset.json";
import weather from "@/assets/landing/image-19.png.asset.json";

const features = [
  {
    tag: "AI ANALYSIS",
    icon: Bot,
    title: "Spot every bare patch and stressed zone",
    body: "Upload an orthomosaic, get an overall crop health score, a ranked list of detected issues, and per-zone treatment recommendations with product, rate, and estimated cost.",
    cta: "Run AI on a field",
    href: "/auth",
    img: analysis.url,
    side: "right" as const,
  },
  {
    tag: "FLIGHT PLANNER",
    icon: Plane,
    title: "One click, one flyable mission",
    body: "Generate recommended swath, altitude, and speed for your drone — auto-tuned to fit physical turn radius and climb rate. Export .waypoints for DJI Pilot 2 or Mission Planner.",
    cta: "Plan a flight",
    href: "/auth",
    img: planner.url,
    side: "left" as const,
  },
  {
    tag: "MISSION TRACKING",
    icon: Map,
    title: "See the full path before you launch",
    body: "Takeoff, transit (yellow), spray-on (cyan), and return-to-home (red) rendered on the live orthomosaic. Play a virtual drone simulation at up to 32× speed with live battery and tank telemetry.",
    cta: "Track a flight",
    href: "/auth",
    img: flight.url,
    side: "right" as const,
  },
  {
    tag: "SPRAY WEATHER",
    icon: CloudSun,
    title: "Know exactly when it's safe to spray",
    body: "Live conditions and a 7-day forecast at your field centroid, plus a Best Spray Windows finder that hunts for the next 3-day slots where wind, humidity, temperature, and rain all line up.",
    cta: "Check the weather",
    href: "/auth",
    img: weather.url,
    side: "left" as const,
  },
];

export const Features = () => {
  return (
    <section id="features" className="py-24 md:py-32 bg-background">
      <div className="container">
        <div className="max-w-3xl mb-20">
          <div className="font-mono text-xs uppercase tracking-widest text-accent-foreground bg-accent inline-block px-2 py-1">
            Inside the app
          </div>
          <h2 className="mt-6 font-display text-4xl md:text-6xl font-semibold leading-tight text-balance">
            Real screenshots. Real fields. Real drones.
          </h2>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl">
            Every pixel below is the live product running on actual flights — not a mockup.
          </p>
        </div>

        <div className="space-y-24 md:space-y-32">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                className="grid lg:grid-cols-12 gap-10 items-center"
              >
                <div className={`lg:col-span-5 ${f.side === "right" ? "lg:order-1" : "lg:order-2"}`}>
                  <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-accent">
                    <Icon className="h-3.5 w-3.5" />
                    {f.tag}
                  </div>
                  <h3 className="mt-4 font-display text-3xl md:text-4xl font-semibold leading-tight text-balance">
                    {f.title}
                  </h3>
                  <p className="mt-5 text-muted-foreground leading-relaxed">{f.body}</p>
                  <a
                    href={f.href}
                    className="mt-7 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm text-primary-foreground hover:bg-primary/90 transition-all hover:shadow-elevated"
                  >
                    {f.cta} <span aria-hidden>→</span>
                  </a>
                </div>
                <div className={`lg:col-span-7 ${f.side === "right" ? "lg:order-2" : "lg:order-1"}`}>
                  <div className="relative rounded-lg overflow-hidden border border-border shadow-elevated bg-card">
                    <img
                      src={f.img}
                      alt={f.title}
                      loading="lazy"
                      className="w-full h-auto block"
                    />
                  </div>
                  <div className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Captured from /app · {f.tag.toLowerCase()}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
};