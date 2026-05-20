import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Map, Sparkles, Plane, Droplets, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

export default function Dashboard() {
  const [stats, setStats] = useState({ fields: 0, area: 0, scans: 0, jobs: 0, drones: 0, healthAvg: 0 });
  const [recent, setRecent] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const [f, s, j, d] = await Promise.all([
        supabase.from("fields").select("area_hectares"),
        supabase.from("scans").select("health_score, id, created_at, ai_summary").order("created_at", { ascending: false }).limit(5),
        supabase.from("jobs").select("id, status"),
        supabase.from("drones").select("id"),
      ]);
      const area = (f.data ?? []).reduce((a, r) => a + Number(r.area_hectares || 0), 0);
      const scores = (s.data ?? []).map(r => r.health_score).filter(Boolean) as number[];
      const healthAvg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
      setStats({
        fields: f.data?.length ?? 0,
        area: Math.round(area * 10) / 10,
        scans: s.data?.length ?? 0,
        jobs: (j.data ?? []).filter(x => x.status === "scheduled").length,
        drones: d.data?.length ?? 0,
        healthAvg,
      });
      setRecent(s.data ?? []);
    })();
  }, []);

  const kpis = [
    { label: "Fields monitored", value: stats.fields, sub: `${stats.area} ha total`, icon: Map },
    { label: "Avg crop health", value: stats.healthAvg ? `${stats.healthAvg}/100` : "—", sub: "Last 5 scans", icon: Sparkles },
    { label: "Active drones", value: stats.drones, sub: "Fleet idle/ready", icon: Plane },
    { label: "Scheduled sprays", value: stats.jobs, sub: "Next 14 days", icon: Droplets },
  ];

  return (
    <div className="p-8 space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl">Operations Dashboard</h1>
          <p className="text-muted-foreground">Live view of your fields, fleet, and AI recommendations.</p>
        </div>
        <Link to="/app/analyzer" className="inline-flex items-center gap-2 bg-[hsl(var(--field))] text-[hsl(var(--primary-foreground))] px-4 py-2 rounded text-sm">
          <Sparkles className="h-4 w-4" /> Run AI scan
        </Link>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => (
          <Card key={k.label} className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm text-muted-foreground">{k.label}</div>
                <div className="font-display text-3xl mt-1">{k.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{k.sub}</div>
              </div>
              <k.icon className="h-5 w-5 text-[hsl(var(--field))]" />
            </div>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg">Recent AI scans</h2>
            <Link to="/app/reports" className="text-xs text-muted-foreground inline-flex items-center gap-1">View all <ArrowUpRight className="h-3 w-3" /></Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scans yet. Head to the AI Analyzer to run your first one.</p>
          ) : (
            <ul className="divide-y">
              {recent.map(r => (
                <li key={r.id} className="py-3 flex items-start gap-4">
                  <div className="w-10 h-10 rounded bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] flex items-center justify-center font-mono text-sm">{r.health_score ?? "?"}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm line-clamp-2">{r.ai_summary || "Processing…"}</div>
                    <div className="text-xs text-muted-foreground mt-1">{new Date(r.created_at).toLocaleString()}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-6">
          <h2 className="font-display text-lg mb-4">Quick actions</h2>
          <div className="space-y-2 text-sm">
            <Link to="/app/fields" className="block p-3 border rounded hover:bg-muted/50">+ Add a new field</Link>
            <Link to="/app/planner" className="block p-3 border rounded hover:bg-muted/50">+ Schedule a spray mission</Link>
            <Link to="/app/analyzer" className="block p-3 border rounded hover:bg-muted/50">↗ Upload imagery for AI analysis</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}