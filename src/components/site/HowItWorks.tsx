import { motion } from "framer-motion";
import orthoAnomaly from "@/assets/landing/image-16.png.asset.json";

const steps = [
  {
    n: "01",
    title: "Upload drone imagery",
    body: "Drag a batch of nadir photos into a field. We stitch them into a georeferenced orthomosaic on our processing node — no GIS software required.",
  },
  {
    n: "02",
    title: "AI field analysis",
    body: "Gemini Vision scores overall health 0–100, flags bare soil, discoloration, weed pressure, and draws WGS84 treatment zones with recommended products and rates.",
  },
  {
    n: "03",
    title: "Auto flight plan",
    body: "One click builds a flyable lawnmower mission scoped to anomaly zones — validated against your drone's turn radius and climb rate, with battery swap points if needed.",
  },
  {
    n: "04",
    title: "Fly, log, repeat",
    body: "Export .waypoints for DJI Pilot 2 or Mission Planner. Watch a virtual drone simulate the flight, then log the completed mission for compliance and battery sync.",
  },
];

export const HowItWorks = () => {
  return (
    <section id="how" className="py-24 md:py-32 bg-primary text-primary-foreground relative overflow-hidden">
      <div className="absolute inset-0 grid-bg-dark opacity-50 pointer-events-none" />
      <div className="container relative">
        <div className="max-w-3xl mb-20">
          <div className="font-mono text-xs uppercase tracking-widest text-accent">
            How it works
          </div>
          <h2 className="mt-4 font-display text-4xl md:text-6xl font-semibold leading-tight text-balance">
            Analyze first. Spray only where needed.
          </h2>
          <p className="mt-6 text-lg text-primary-foreground/70 max-w-xl">
            The traditional model: spray everything, hope for the best. We invert it.
          </p>
        </div>

        <div className="grid lg:grid-cols-12 gap-12 items-start">
          <div className="lg:col-span-5 lg:sticky lg:top-24">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="relative aspect-square rounded-sm overflow-hidden border border-primary-foreground/20"
            >
              <img
                src={orthoAnomaly.url}
                alt="AcreSpray orthomosaic with AI-detected anomaly zones overlaid on a real field"
                width={1280}
                height={1280}
                loading="lazy"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-tr from-primary/40 via-transparent to-transparent" />
              <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-accent">Live orthomosaic</div>
                  <div className="font-display text-2xl">AI-detected zones</div>
                </div>
                <div className="font-mono text-xs text-primary-foreground/70">
                  4 treatment zones · 0.04 ac
                </div>
              </div>
            </motion.div>
          </div>

          <div className="lg:col-span-7 space-y-px bg-primary-foreground/10">
            {steps.map((s, i) => (
              <motion.div
                key={s.n}
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="bg-primary p-8 md:p-10 flex gap-8 group hover:bg-primary-foreground/5 transition-colors"
              >
                <div className="font-mono text-sm text-accent shrink-0 w-12 pt-1">{s.n}</div>
                <div>
                  <h3 className="font-display text-2xl md:text-3xl font-semibold mb-3 group-hover:text-accent transition-colors">
                    {s.title}
                  </h3>
                  <p className="text-primary-foreground/70 leading-relaxed max-w-md">
                    {s.body}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
