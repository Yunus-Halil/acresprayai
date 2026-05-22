import { motion } from "framer-motion";
import fieldMap from "@/assets/field-map.jpg";

const steps = [
  {
    n: "01",
    title: "Scan",
    body: "Drones sweep your field capturing multi-spectral and thermal imagery. Soil and weather telemetry stream in alongside.",
  },
  {
    n: "02",
    title: "Analyze",
    body: "Our AI — adapted from medical imaging pattern detection — identifies weed clusters, pest pressure, and crop stress in near real-time.",
  },
  {
    n: "03",
    title: "Decide",
    body: "Acre Flight AI generates a per-square-meter spray map: when, where, and how much. Reviewable in a single mobile dashboard.",
  },
  {
    n: "04",
    title: "Spray",
    body: "GPS-guided equipment treats only the highlighted zones. Average treat-area: 8–15% of the field instead of 100%.",
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
                src={fieldMap}
                alt="Top-down field map showing detected weed zones"
                width={1280}
                height={1280}
                loading="lazy"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-tr from-primary/40 via-transparent to-transparent" />
              <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-accent">Live scan</div>
                  <div className="font-display text-2xl">Field A-019</div>
                </div>
                <div className="font-mono text-xs text-primary-foreground/70">
                  47 / 412 zones flagged
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
