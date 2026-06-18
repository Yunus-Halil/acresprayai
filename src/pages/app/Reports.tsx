import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { DEMO_HEALTH_TREND, DEMO_SPRAY_HISTORY } from "@/lib/demo";
import { DemoBadge } from "@/components/app/DemoBadge";
import { Button } from "@/components/ui/button";
import { FileDown, Sparkles } from "lucide-react";

export default function Reports() {
  const [scans, setScans] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const [s, j] = await Promise.all([
        supabase.from("scans").select("*, fields(name)").order("created_at", { ascending: false }),
        supabase.from("jobs").select("*, fields(name)").order("scheduled_at", { ascending: false }),
      ]);
      setScans(s.data ?? []);
      setJobs(j.data ?? []);
    })();
  }, []);

  const realChart = [...scans].reverse().map(s => ({
    date: new Date(s.created_at).toLocaleDateString(),
    health: s.health_score ?? 0,
  }));
  const chartData = realChart.length > 0 ? realChart : DEMO_HEALTH_TREND;
  const chartIsDemo = realChart.length === 0;
  const historyIsDemo = jobs.length === 0;

  const historyRows = jobs.length > 0
    ? jobs.map(j => ({
        id: j.id,
        date: new Date(j.scheduled_at).toLocaleDateString(),
        field: j.fields?.name ?? "-",
        type: j.type,
        chemical: j.chemical ?? "-",
        dose: j.dose_l_ha ?? 0,
        area: j.area_ha ?? 0,
        status: j.status,
      }))
    : DEMO_SPRAY_HISTORY;

  const totalScans = scans.length > 0 ? scans.length : 14;
  const completedSprays = historyRows.filter(h => h.status === "completed" && h.type === "spray").length;
  const totalChemical = historyRows
    .filter(h => h.status === "completed" && h.dose && h.area)
    .reduce((a, h) => a + Number(h.dose) * Number(h.area), 0);
  const savedChemical = totalChemical * 5.2; // vs. blanket spraying baseline

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="font-display text-3xl">Reports</h1>
        <p className="text-muted-foreground">Crop health trends, spray history, and compliance-ready records.</p>
      </header>

      <Card className="p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-accent/40 bg-gradient-to-br from-card to-card/40">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-accent/15 text-accent p-3"><Sparkles className="h-5 w-5" /></div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-lg">Sample Field Intelligence Report</h2>
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-accent/15 text-accent">Demo · 6 pages</span>
            </div>
            <p className="text-sm text-muted-foreground max-w-xl">
              A fully rendered, audit-grade PDF showing what AcreSpray AI produces for a real field — KPIs, NDVI/NDRE trends,
              spectral bands, stress heatmap, AI pest detection, soil &amp; water balance, fleet ops, economics, and EU SUR compliance.
            </p>
          </div>
        </div>
        <Button asChild size="lg" className="shrink-0">
          <a href="/reports/AcreSpray-AI-Sample-Field-Report.pdf" download>
            <FileDown className="mr-2 h-4 w-4" /> Download sample PDF
          </a>
        </Button>
      </Card>

      {(chartIsDemo || historyIsDemo) && (
        <DemoBadge
          detail={
            chartIsDemo && historyIsDemo
              ? "No real scans or jobs yet - the trend and spray history below are sample data for demonstration."
              : chartIsDemo
                ? "The crop health trend below is sample data for demonstration - real data will appear once you run AI scans."
                : "The spray history below is sample data for demonstration - real records will appear once you schedule jobs."
          }
        />
      )}

      <div className="grid md:grid-cols-3 gap-4">
        <Card className="p-5"><div className="text-sm text-muted-foreground">Total scans</div><div className="font-display text-3xl">{totalScans}</div></Card>
        <Card className="p-5"><div className="text-sm text-muted-foreground">Sprays completed</div><div className="font-display text-3xl">{completedSprays}</div></Card>
        <Card className="p-5">
          <div className="text-sm text-muted-foreground">Chemical applied</div>
          <div className="font-display text-3xl">{totalChemical.toFixed(1)} L</div>
          <div className="text-xs text-muted-foreground mt-1">vs. {(totalChemical + savedChemical).toFixed(0)} L blanket - saved {savedChemical.toFixed(0)} L</div>
        </Card>
      </div>

      <Card className="p-6">
        <h2 className="font-display text-lg mb-4">Crop health over time</h2>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" domain={[0, 100]} fontSize={12} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Line type="monotone" dataKey="health" stroke="hsl(var(--field))" strokeWidth={2} dot={{ fill: "hsl(var(--accent))" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
      </Card>

      <Card className="p-6">
        <h2 className="font-display text-lg mb-4">Spray history</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Field</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Chemical</TableHead>
                <TableHead>Dose</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historyRows.map(h => (
                <TableRow key={h.id}>
                  <TableCell>{h.date}</TableCell>
                  <TableCell>{h.field}</TableCell>
                  <TableCell className="capitalize">{h.type}</TableCell>
                  <TableCell>{h.chemical}</TableCell>
                  <TableCell>{h.dose ? `${h.dose} L/ha` : "-"}</TableCell>
                  <TableCell><Badge variant="outline">{h.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
      </Card>
    </div>
  );
}