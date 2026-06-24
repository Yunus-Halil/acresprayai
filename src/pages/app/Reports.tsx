import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

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

  const chartData = [...scans].reverse().map(s => ({
    date: new Date(s.created_at).toLocaleDateString(),
    health: s.health_score ?? 0,
  }));

  const historyRows = jobs.map(j => ({
        id: j.id,
        date: new Date(j.scheduled_at).toLocaleDateString(),
        field: j.fields?.name ?? "-",
        type: j.type,
        chemical: j.chemical ?? "-",
        dose: j.dose_l_ha ?? 0,
        area: j.area_ha ?? 0,
        status: j.status,
      }));

  const totalScans = scans.length;
  const completedSprays = historyRows.filter(h => h.status === "completed" && h.type === "spray").length;
  const totalChemical = historyRows
    .filter(h => h.status === "completed" && h.dose && h.area)
    .reduce((a, h) => a + Number(h.dose) * Number(h.area), 0);

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="font-display text-3xl">Reports</h1>
        <p className="text-muted-foreground">Crop health trends, spray history, and compliance-ready records.</p>
      </header>

      <div className="grid md:grid-cols-3 gap-4">
        <Card className="p-5"><div className="text-sm text-muted-foreground">Total scans</div><div className="font-display text-3xl">{totalScans}</div></Card>
        <Card className="p-5"><div className="text-sm text-muted-foreground">Sprays completed</div><div className="font-display text-3xl">{completedSprays}</div></Card>
        <Card className="p-5">
          <div className="text-sm text-muted-foreground">Chemical applied</div>
          <div className="font-display text-3xl">{totalChemical.toFixed(1)} L</div>
        </Card>
      </div>

      <Card className="p-6">
        <h2 className="font-display text-lg mb-4">Crop health over time</h2>
        {chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground">No AI scans yet. Run a scan from the Analyzer to build this chart.</p>
        ) : (
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
        )}
      </Card>

      <Card className="p-6">
        <h2 className="font-display text-lg mb-4">Spray history</h2>
        {historyRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No jobs scheduled yet. Plan a mission to populate this log.</p>
        ) : (
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
        )}
      </Card>
    </div>
  );
}