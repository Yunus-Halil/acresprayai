const items = [
  "USDA datasets",
  "Multi-spectral imaging",
  "Thermal vision",
  "GPS auto-guidance",
  "Soil telemetry",
  "Real-time weather",
  "Drone fleet API",
  "Yield modeling",
];

export const Marquee = () => {
  return (
    <section className="border-y border-border bg-card overflow-hidden py-6">
      <div className="flex animate-marquee whitespace-nowrap">
        {[...items, ...items, ...items].map((item, i) => (
          <div key={i} className="flex items-center gap-12 px-8 font-mono text-sm uppercase tracking-widest text-muted-foreground">
            {item}
            <span className="h-1 w-1 rounded-full bg-accent" />
          </div>
        ))}
      </div>
    </section>
  );
};
