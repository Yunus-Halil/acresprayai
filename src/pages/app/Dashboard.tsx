import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Map, Sparkles, Plane, Droplets, ArrowUpRight, Battery, Wifi } from "lucide-react";

type Field = { id: string; name: string; area_hectares: number };
type Drone = { id: string; name: string; status: string; battery: number; signal: number };
type Job = { id: string; type: string; status: string; scheduled_at: string; field_id: string | null };
type Scan = { id: string; created_at: string; health_score: number | null };

export default function Dashboard() {
  const [fields, setFields] = useState<Field[]>([]);
  const [drones, setDrones] = useState<Drone[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);

  useEffect(() => {
    (async () => {
      const [f, d, j, s] = await Promise.all([
        supabase.from("fields").select("id, name, area_hectares"),
        supabase.from("drones").select("id, name, status, battery, signal"),
        supabase.from("jobs").select("id, type, status, scheduled_at, field_id").order("scheduled_at", { ascending: false }),
        supabase.from("scans").select("id, created_at, health_score").order("created_at", { ascending: false }).limit(30),
      ]);
      setFields((f.data as Field[]) ?? []);
      setDrones((d.data as Drone[]) ?? []);
      setJobs((j.data as Job[]) ?? []);
      setScans((s.data as Scan[]) ?? []);
    })();
  }, []);

  const totalArea = fields.reduce((a, f) => a + Number(f.area_hectares || 0), 0);
  const activeDrones = drones.filter(d => d.status === "in_flight").length;
  const openJobs = jobs.filter(j => j.status !== "completed" && j.status !== "cancelled").length;
  const healthScans = scans.filter(s => typeof s.health_score === "number");
  const avgHealth = healthScans.length
    ? Math.round(healthScans.reduce((a, s) => a + (s.health_score ?? 0), 0) / healthScans.length)
    : null;

  const kpis = [
    { label: "Fields monitored", value: fields.length, sub: `${totalArea.toFixed(1)} ha total`, icon: Map },
    { label: "Avg crop health", value: avgHealth != null ? `${avgHealth}/100` : "—", sub: `${scans.length} scans on record`, icon: Sparkles },
    { label: "Drones in flight", value: drones.length ? `${activeDrones}/${drones.length}` : "—", sub: drones.length ? "Fleet registered" : "No drones yet", icon: Plane },
    { label: "Open missions", value: openJobs, sub: `${jobs.length} total in queue`, icon: Droplets },
  ];

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl">Operations Dashboard</h1>
          <p className="text-muted-foreground">Live view of your fields, fleet, and AI scans.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/app/analyzer"><Button><Sparkles className="h-4 w-4" /> Run AI scan</Button></Link>
          <Link to="/app/planner"><Button variant="outline">Plan mission</Button></Link>
        </div>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => (
          <Card key={k.label} className="p-5">
            <div className="flex items-start justify-between mb-2">
              <div className="text-sm text-muted-foreground">{k.label}</div>
              <k.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="font-display text-3xl">{k.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{k.sub}</div>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg">Fleet status</h2>
            <Link to="/app/fleet" className="text-xs text-muted-foreground inline-flex items-center gap-1">Manage <ArrowUpRight className="h-3 w-3" /></Link>
          </div>
          {drones.length === 0 ? (
            <p className="text-sm text-muted-foreground">No drones registered. <Link to="/app/fleet" className="underline">Register one</Link>.</p>
          ) : (
            <ul className="space-y-3">
              {drones.map(d => (
                <li key={d.id} className="text-sm space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 truncate">
                      <span className={`h-2 w-2 rounded-full ${d.status === "in_flight" ? "bg-emerald-500 animate-pulse" : d.status === "charging" ? "bg-amber-500" : "bg-muted-foreground/40"}`} />
                      <span className="truncate">{d.name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground capitalize">{d.status.replace("_", " ")}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground pl-4">
                    <span className="flex items-center gap-1"><Battery className="h-3 w-3" /> {d.battery}%</span>
                    <span className="flex items-center gap-1"><Wifi className="h-3 w-3" /> {d.signal}%</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg">Fields</h2>
            <Link to="/app/fields" className="text-xs text-muted-foreground inline-flex items-center gap-1">View all <ArrowUpRight className="h-3 w-3" /></Link>
          </div>
          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">No fields yet. <Link to="/app/fields" className="underline">Add one</Link>.</p>
          ) : (
            <ul className="space-y-3">
              {fields.map(f => (
                <li key={f.id} className="flex items-center justify-between text-sm">
                  <span className="truncate">{f.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{Number(f.area_hectares).toFixed(1)} ha</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg">Upcoming missions</h2>
            <Link to="/app/planner" className="text-xs text-muted-foreground inline-flex items-center gap-1">Plan <ArrowUpRight className="h-3 w-3" /></Link>
          </div>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No missions scheduled.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {jobs.slice(0, 6).map(j => (
                <li key={j.id} className="flex items-center justify-between">
                  <span className="capitalize">{j.type}</span>
                  <span className="text-xs text-muted-foreground">{new Date(j.scheduled_at).toLocaleString()}</span>
                  <Badge variant="outline" className="text-[10px]">{j.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {avgHealth != null && (
        <Card className="p-6">
          <h2 className="font-display text-lg mb-3">Recent AI health scores</h2>
          <Progress value={avgHealth} className="h-2" />
          <p className="text-xs text-muted-foreground mt-2">Average across the last {healthScans.length} AI scans.</p>
        </Card>
      )}
    </div>
  );
}
