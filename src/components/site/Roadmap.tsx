import { motion } from "framer-motion";
import cropsImg from "@/assets/crops.jpg";

const milestones = [
  { q: "Q2 2026", title: "Prototype", body: "Drone + AI vision pipeline running on a 50-acre test plot." },
  { q: "Q3 2026", title: "Closed pilot", body: "Three farms across three crop types. Baseline vs. AcreSpray AI." },
  { q: "Q4 2026", title: "Spray-map API", body: "Open API for drone operators and existing farm equipment." },
  { q: "Q1 2027", title: "Public release", body: "Self-serve onboarding for any farm above 20 acres." },
];

export const Roadmap = () => {
  return (
    <section id="roadmap" className="py-24 md:py-32">
      <div className="container grid lg:grid-cols-12 gap-12 items-start">
        <div className="lg:col-span-5">
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            12-month plan
          </div>
          <h2 className="mt-4 font-display text-4xl md:text-5xl font-semibold leading-tight text-balance">
            From prototype to one real farm - in a year.
          </h2>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
            We’re not promising the future. We’re shipping it field by field,
            measuring pesticide savings against held-out control plots.
          </p>
          <div className="mt-8 rounded-sm overflow-hidden border border-border">
            <img
              src={cropsImg}
              alt="Healthy green wheat crops"
              width={1280}
              height={960}
              loading="lazy"
              className="w-full h-64 object-cover"
            />
          </div>
        </div>

        <div className="lg:col-span-7 lg:col-start-7 relative">
          <div className="absolute left-[7.5rem] top-2 bottom-2 w-px bg-border" aria-hidden />
          <div className="space-y-10">
            {milestones.map((m, i) => (
              <motion.div
                key={m.q}
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="flex gap-8"
              >
                <div className="w-28 shrink-0 font-mono text-sm uppercase tracking-widest text-muted-foreground pt-1">
                  {m.q}
                </div>
                <div className="relative">
                  <span className="absolute -left-[1.65rem] top-2 h-3 w-3 rounded-full bg-accent ring-4 ring-background" />
                  <h3 className="font-display text-2xl font-semibold">{m.title}</h3>
                  <p className="mt-2 text-muted-foreground max-w-md">{m.body}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
