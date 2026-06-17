import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import {
  Map, Sparkles, Plane, Droplets, ArrowUpRight, TrendingUp, TrendingDown,
  AlertTriangle, CheckCircle2, Battery, Wifi, Activity, CloudSun, Wind, Thermometer,
} from "lucide-react";
import { DEMO_FIELDS, DEMO_MISSIONS, DEMO_DRONES } from "@/lib/demo";
import { DemoBadge } from "@/components/app/DemoBadge";

const TREND = [62, 65, 64, 68, 70, 69, 72, 74, 73, 76, 75, 78, 77, 78];

function Sparkline({ data, color = "hsl(var(--primary))" }: { data: number[]; color?: string }) {
  const max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${100 - ((v - min) / (max - min || 1)) * 100}`).join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-12">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <polyline points={`0,100 ${pts} 100,100`} fill={color} opacity="0.12" />
    </svg>
  );
}

export default function Dashboard() {
  const [scanCount, setScanCount] = useState(0);

  useEffect(() => {
    supabase.from("scans").select("id", { count: "exact", head: true }).then(r => setScanCount(r.count ?? 0));
  }, []);

  const totalArea = DEMO_FIELDS.reduce((a, f) => a + f.area_hectares, 0);
  const avgHealth = Math.round(DEMO_FIELDS.reduce((a, f) => a + f.health, 0) / DEMO_FIELDS.length);
  const activeDrones = DEMO_DRONES.filter(d => d.status === "in_flight").length;
  const upcomingJobs = DEMO_MISSIONS.filter(m => m.status !== "completed").length;

  const kpis = [
    { label: "Fields monitored", value: DEMO_FIELDS.length, sub: `${totalArea.toFixed(1)} ha total`, icon: Map, trend: "+1 this week" },
    { label: "Avg crop health", value: `${avgHealth}/100`, sub: "+4 vs last week", icon: Sparkles, trend: "up", trendIcon: TrendingUp },
    { label: "Drones in flight", value: `${activeDrones}/${DEMO_DRONES.length}`, sub: "Fleet ready", icon: Plane, trend: "live" },
    { label: "Open missions", value: upcomingJobs, sub: "Next 24h", icon: Droplets, trend: `${scanCount} AI scans` },
  ];

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl">Operations Dashboard</h1>
          <p className="text-muted-foreground">Live view of your fleet, fields, and AI advisories - Domaine de la Vallée</p>
        </div>
        <div className="flex gap-2">
          <Link to="/app/analyzer"><Button><Sparkles className="h-4 w-4" /> Run AI scan</Button></Link>
          <Link to="/app/planner"><Button variant="outline">Plan mission</Button></Link>
        </div>
      </header>

      <DemoBadge detail="Fields, missions, and fleet shown here are sample data for demonstration - not live measurements from your operation." />

      {/* Live alert banner */}
      <Card className="p-4 border-amber-500/40 bg-amber-500/10 flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
        <div className="flex-1 text-sm">
          <span className="font-medium">Critical pest signature</span> detected on B-04 North Quadrant.
          Aphid colony (94% conf.) - spray queued for 06:12 tomorrow.
        </div>
        <Link to="/app/analyzer"><Button size="sm" variant="outline">Review</Button></Link>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => (
          <Card key={k.label} className="p-5">
            <div className="flex items-start justify-between mb-2">
              <div className="text-sm text-muted-foreground">{k.label}</div>
              <k.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="font-display text-3xl">{k.value}</div>
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              {k.trend === "up" && <TrendingUp className="h-3 w-3 text-emerald-500" />}
              {k.sub}
            </div>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Health trend */}
        <Card className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="font-display text-lg">Fleet health index</h2>
              <p className="text-xs text-muted-foreground">Last 14 days · across all fields</p>
            </div>
            <div className="text-right">
              <div className="font-display text-2xl">{avgHealth}</div>
              <div className="text-xs text-emerald-600 flex items-center gap-1 justify-end">
                <TrendingUp className="h-3 w-3" /> +5.2%
              </div>
            </div>
          </div>
          <Sparkline data={TREND} />
          <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t text-center text-xs">
            <div><div className="text-muted-foreground">NDVI avg</div><div className="font-display text-lg">0.71</div></div>
            <div><div className="text-muted-foreground">Chemical saved</div><div className="font-display text-lg">87%</div></div>
            <div><div className="text-muted-foreground">CO2 avoided</div><div className="font-display text-lg">214 kg</div></div>
          </div>
        </Card>

        {/* Weather */}
        <Card className="p-6 bg-gradient-to-br from-sky-500/20 to-indigo-500/10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-lg">Spray window</h2>
            <CloudSun className="h-5 w-5" />
          </div>
          <div className="font-display text-3xl">06:00 - 09:30</div>
          <Badge variant="outline" className="mt-1 border-emerald-500 text-emerald-600">Optimal · tomorrow</Badge>
          <div className="grid grid-cols-3 gap-2 mt-4 text-xs">
            <div className="flex items-center gap-1"><Thermometer className="h-3 w-3" /> 14°C</div>
            <div className="flex items-center gap-1"><Wind className="h-3 w-3" /> 8 km/h</div>
            <div className="flex items-center gap-1"><Droplets className="h-3 w-3" /> 62%</div>
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Fleet */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg">Fleet status</h2>
            <Link to="/app/planner" className="text-xs text-muted-foreground inline-flex items-center gap-1">Manage <ArrowUpRight className="h-3 w-3" /></Link>
          </div>
          <ul className="space-y-3">
            {DEMO_DRONES.map(d => (
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
                  <span>@ {d.location}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        {/* Field rollup */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg">Fields by health</h2>
            <Link to="/app/fields" className="text-xs text-muted-foreground inline-flex items-center gap-1">View all <ArrowUpRight className="h-3 w-3" /></Link>
          </div>
          <ul className="space-y-3">
            {DEMO_FIELDS.map(f => (
              <li key={f.id} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="truncate">{f.name}</span>
                  <span className="font-mono text-xs">{f.health}</span>
                </div>
                <Progress value={f.health} className="h-1.5" />
              </li>
            ))}
          </ul>
        </Card>

        {/* Activity feed */}
        <Card className="p-6">
          <h2 className="font-display text-lg mb-4">Live activity</h2>
          <ul className="space-y-3 text-sm">
            <li className="flex gap-2">
              <Activity className="h-4 w-4 text-emerald-500 mt-0.5" />
              <div className="flex-1">
                <div>AGV-04 spraying B-04 · 62%</div>
                <div className="text-xs text-muted-foreground">2 min ago</div>
              </div>
            </li>
            <li className="flex gap-2">
              <Sparkles className="h-4 w-4 text-primary mt-0.5" />
              <div className="flex-1">
                <div>AI flagged Septoria on C-11</div>
                <div className="text-xs text-muted-foreground">14 min ago</div>
              </div>
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5" />
              <div className="flex-1">
                <div>Scan completed · B-04 (14.2 ha)</div>
                <div className="text-xs text-muted-foreground">1h ago</div>
              </div>
            </li>
            <li className="flex gap-2">
              <Plane className="h-4 w-4 text-sky-500 mt-0.5" />
              <div className="flex-1">
                <div>AGV-01 returned to base · 64% battery</div>
                <div className="text-xs text-muted-foreground">2h ago</div>
              </div>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
