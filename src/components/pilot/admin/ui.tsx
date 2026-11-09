// Small pieces the admin panel is built from. Plain, dense, readable; status always carries a word, never colour alone.
import { useState, type ReactNode } from "react";

export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");
export const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
export const dur = (ms: number | null | undefined) => (ms == null ? "" : ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : `${Math.max(1, Math.round(ms / 1000))} s`);
export const ago = (iso: string | null | undefined, now = Date.now()) => {
  if (!iso) return "never";
  const m = Math.round((now - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
};

export function Stat({ label, value, sub, tone = "plain" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "plain" | "warn" | "bad" | "good" }) {
  const ring = tone === "bad" ? "border-red-300" : tone === "warn" ? "border-amber-300" : tone === "good" ? "border-emerald-300" : "";
  return (
    <div className={`rounded-lg border bg-card p-4 ${ring}`}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-3xl tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function Badge({ tone, children }: { tone: "ok" | "warn" | "bad" | "plain" | "info"; children: ReactNode }) {
  const c = tone === "ok" ? "bg-emerald-100 text-emerald-900" : tone === "warn" ? "bg-amber-100 text-amber-950" : tone === "bad" ? "bg-red-100 text-red-900" : tone === "info" ? "bg-sky-100 text-sky-900" : "bg-muted text-muted-foreground";
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${c}`}>{children}</span>;
}

export function Table({ head, children, min = 720, empty }: { head: ReactNode[]; children: ReactNode; min?: number; empty?: string | false }) {
  if (empty) return <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full border-collapse text-sm" style={{ minWidth: min }}>
        <thead><tr className="border-b bg-muted/50 text-left">{head.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody className="[&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_tr]:border-b [&_tr:last-child]:border-0">{children}</tbody>
      </table>
    </div>
  );
}

export function Section({ title, hint, actions, children }: { title: string; hint?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h2 className="font-display text-xl">{title}</h2>{hint && <p className="text-sm text-muted-foreground">{hint}</p>}</div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/**
 * One measure per day as bars, for the last N days. Single series: one hue, no legend (the title names it), a hover
 * readout per bar, and the numbers available as a table below for anyone who cannot read the bars.
 */
export function DayBars({ title, days, value, unit }: { title: string; days: { day: string }[] & Record<string, unknown>[]; value: (d: Record<string, unknown>) => number; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const vals = days.map(d => value(d));
  const max = Math.max(1, ...vals);
  const H = 96, gap = 2;
  const w = 100 / days.length;
  const h = hover != null ? days[hover] : null;
  return (
    <figure className="rounded-lg border bg-card p-4">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">{h ? `${new Date(h.day).toLocaleDateString(undefined, { day: "numeric", month: "short" })}: ${vals[hover!]} ${unit}` : `peak ${max === 1 && !vals.some(v => v) ? 0 : max} ${unit}`}</span>
      </figcaption>
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="mt-2 h-24 w-full" role="img" aria-label={`${title}, last ${days.length} days`} onMouseLeave={() => setHover(null)}>
        <line x1="0" x2="100" y1={H - 0.5} y2={H - 0.5} stroke="hsl(var(--border))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {vals.map((v, i) => {
          const bh = v ? Math.max(3, (v / max) * (H - 4)) : 0;
          return (
            <g key={days[i].day} onMouseEnter={() => setHover(i)}>
              <rect x={i * w} y={0} width={w} height={H} fill="transparent" />
              {bh > 0 && <rect x={i * w + gap / 4} y={H - bh} width={Math.max(0.4, w - gap / 2)} height={bh} rx={0.6} fill="hsl(var(--primary))" opacity={hover == null || hover === i ? 1 : 0.45} />}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{new Date(days[0]?.day ?? Date.now()).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span><span>today</span></div>
      <button type="button" className="mt-1 text-xs text-muted-foreground underline underline-offset-2" onClick={() => setTable(t => !t)} aria-expanded={table}>{table ? "Hide the numbers" : "Show the numbers"}</button>
      {table && <ul className="mt-1 grid grid-cols-3 gap-x-4 text-xs tabular-nums sm:grid-cols-5">{days.map((d, i) => <li key={d.day}>{d.day.slice(5)}: {vals[i]}</li>)}</ul>}
    </figure>
  );
}
