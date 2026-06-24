import { motion } from "framer-motion";
import logo from "@/assets/acrespray-logo.png.asset.json";

const links = [
  { label: "How it works", href: "#how" },
  { label: "Impact", href: "#impact" },
  { label: "For", href: "#personas" },
  { label: "Roadmap", href: "#roadmap" },
];

export const Nav = () => {
  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="fixed top-0 inset-x-0 z-50 backdrop-blur-md bg-background/70 border-b border-border/60"
    >
      <div className="container flex h-16 items-center justify-between">
        <a href="#" className="flex items-center gap-2 group">
          <img src={logo.url} alt="AcreSpray AI" className="h-8 w-8" />
          <span className="font-display font-semibold tracking-tight text-lg">AcreSpray AI</span>
        </a>
        <nav className="hidden md:flex items-center gap-8">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>
        <a
          href="/auth"
          className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Open app
          <span aria-hidden>→</span>
        </a>
      </div>
    </motion.header>
  );
};
