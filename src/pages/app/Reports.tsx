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

  const totalChemical = jobs
    .filter(j => j.status === "completed" && j.dose_l_ha && j.area_ha)
    .reduce((a, j) => a + Number(j.dose_l_ha) * Number(j.area_ha), 0);

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="font-display text-3xl">Reports</h1>
        <p className="text-muted-foreground">Crop health trends, spray history, and compliance-ready records.</p>
      </header>

      <div className="grid md:grid-cols-3 gap-4">
        <Card className="p-5"><div className="text-sm text-muted-foreground">Total scans</div><div className="font-display text-3xl">{scans.length}</div></Card>
        <Card className="p-5"><div className="text-sm text-muted-foreground">Sprays completed</div><div className="font-display text-3xl">{jobs.filter(j => j.status === "completed").length}</div></Card>
        <Card className="p-5"><div className="text-sm text-muted-foreground">Chemical applied</div><div className="font-display text-3xl">{totalChemical.toFixed(1)} L</div></Card>
      </div>

      <Card className="p-6">
        <h2 className="font-display text-lg mb-4">Crop health over time</h2>
        {chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground">Run AI scans to see your health trend.</p>
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
        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No missions logged yet.</p>
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
              {jobs.map(j => (
                <TableRow key={j.id}>
                  <TableCell>{new Date(j.scheduled_at).toLocaleDateString()}</TableCell>
                  <TableCell>{j.fields?.name ?? "—"}</TableCell>
                  <TableCell className="capitalize">{j.type}</TableCell>
                  <TableCell>{j.chemical ?? "—"}</TableCell>
                  <TableCell>{j.dose_l_ha ? `${j.dose_l_ha} L/ha` : "—"}</TableCell>
                  <TableCell><Badge variant="outline">{j.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}