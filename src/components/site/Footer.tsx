import logo from "@/assets/acrespray-logo.png.asset.json";

export const Footer = () => {
  return (
    <footer className="border-t border-border py-12 bg-background">
      <div className="container flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
        <div className="flex items-center gap-2">
          <img src={logo.url} alt="AcreSpray AI" className="h-6 w-6" />
          <span className="font-display font-semibold">AcreSpray AI</span>
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
