export const Footer = () => {
  return (
    <footer className="border-t border-border py-12 bg-background">
      <div className="container flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          <span className="font-display font-semibold">AgriPulse</span>
          <span className="font-mono text-xs text-muted-foreground ml-3">
            © 2026 · Pinnacle DSE Capstone
          </span>
        </div>
        <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          UN SDG · Agriculture & Industry · Spring 2026
        </div>
      </div>
    </footer>
  );
};
