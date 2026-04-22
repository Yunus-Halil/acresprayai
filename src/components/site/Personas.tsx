import { motion } from "framer-motion";

const personas = [
  {
    name: "John Miller",
    role: "Farm owner, 45",
    context: "Mid-size grain operation",
    needs: "Lower input costs, predictable yield, simple mobile reports.",
    tag: "FARMER",
  },
  {
    name: "Sarah Lee",
    role: "Agri-tech ops, 38",
    context: "Scaling spraying ops across thousands of acres",
    needs: "Consistent data, deployable systems, measurable ROI.",
    tag: "ENTERPRISE",
  },
  {
    name: "Alex Rodriguez",
    role: "Drone pilot, 29",
    context: "FAA-certified service provider",
    needs: "AI tools that turn flight time into premium recurring services.",
    tag: "OPERATOR",
  },
  {
    name: "Maria Gomez",
    role: "Policy maker, 50",
    context: "Sustainable agriculture initiatives",
    needs: "Auditable reductions in chemical runoff, food security data.",
    tag: "REGULATOR",
  },
];

export const Personas = () => {
  return (
    <section id="personas" className="py-24 md:py-32 bg-secondary/40">
      <div className="container">
        <div className="max-w-3xl mb-16">
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Built for
          </div>
          <h2 className="mt-4 font-display text-4xl md:text-5xl font-semibold leading-tight text-balance">
            Four people. One precision toolkit.
          </h2>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {personas.map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="bg-card border border-border p-6 hover:border-field hover:shadow-soft transition-all group"
            >
              <div className="flex items-start justify-between mb-6">
                <div className="h-14 w-14 rounded-full bg-gradient-field flex items-center justify-center text-primary-foreground font-display text-xl">
                  {p.name.split(" ").map((n) => n[0]).join("")}
                </div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-accent-foreground bg-accent px-2 py-0.5">
                  {p.tag}
                </span>
              </div>
              <div className="font-display text-xl font-semibold">{p.name}</div>
              <div className="text-sm text-muted-foreground mt-1">{p.role}</div>
              <div className="mt-4 text-sm leading-relaxed border-t border-border pt-4">
                <span className="text-muted-foreground">{p.context}.</span>{" "}
                {p.needs}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};
