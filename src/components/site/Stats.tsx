import { motion } from "framer-motion";

const stats = [
  { value: "$20B", label: "Spent on US crop spraying annually", note: "Source: Fermi estimate, 2 M farms × 50% × $20K" },
  { value: "30%+", label: "Pesticide reduction with AI targeting", note: "Maintained or improved yield in field tests" },
  { value: "$6B", label: "Potential annual savings - US alone", note: "If precision spraying scales nationwide" },
  { value: "12 mo", label: "From prototype to first farm pilot", note: "Build · test · iterate on real fields" },
];

export const Stats = () => {
  return (
    <section id="impact" className="py-24 md:py-32">
      <div className="container">
        <div className="grid md:grid-cols-12 gap-12 mb-16">
          <div className="md:col-span-5">
            <div className="font-mono text-xs uppercase tracking-widest text-accent-foreground bg-accent inline-block px-2 py-1">
              The math
            </div>
            <h2 className="mt-6 font-display text-4xl md:text-5xl font-semibold leading-tight text-balance">
              Farmers waste billions on chemicals they don’t need.
            </h2>
          </div>
          <p className="md:col-span-6 md:col-start-7 text-lg text-muted-foreground leading-relaxed self-end">
            Spraying is done uniformly across fields instead of where it’s needed.
            The root cause isn’t farmer behavior - it’s the absence of accessible,
            AI-powered precision tools. AcreSpray AI closes that gap.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.6, delay: i * 0.08 }}
              className="bg-background p-8 hover:bg-secondary/40 transition-colors group"
            >
              <div className="font-display text-5xl md:text-6xl font-semibold text-field group-hover:text-foreground transition-colors">
                {s.value}
              </div>
              <div className="mt-4 text-sm font-medium">{s.label}</div>
              <div className="mt-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                {s.note}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};
