import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plane, Plus, Battery, Wifi, Activity, Trash2, Sparkles, Loader2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from "recharts";
import { toast } from "sonner";
import { z } from "zod";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import FleetIntel from "@/components/app/FleetIntel";

type Drone = {
  id: string; name: string; model: string;
  battery: number; signal: number; health: number; status: string;
};

const MODELS = [
  { id: "DJI Mavic 3M",   role: "Scanner",  drainPerMin: 1.55, range_m: 1500 },
  { id: "DJI Agras T30",  role: "Sprayer",  drainPerMin: 4.20, range_m: 1200 },
  { id: "DJI Agras T40",  role: "Sprayer",  drainPerMin: 4.85, range_m: 1500 },
  { id: "Parrot Anafi USA", role: "Scanner", drainPerMin: 1.30, range_m: 4000 },
  { id: "XAG P100",       role: "Sprayer",  drainPerMin: 5.10, range_m: 1000 },
];

const schema = z.object({
  name: z.string().trim().min(2, "Name too short").max(40),
  model: z.string().min(1),
  battery: z.number().int().min(0).max(100),
  signal: z.number().int().min(0).max(100),
  health: z.number().int().min(0).max(100),
});

function forecast(d: Drone) {
  const m = MODELS.find(x => x.id === d.model) ?? MODELS[0];
  // adjust drain by component health: a less healthy drone drains faster
  const drain = m.drainPerMin * (1 + (100 - d.health) / 100);
  // signal degrades roughly with distance flown; assume 25 m/s outbound speed
  const out: { t: number; battery: number; signal: number }[] = [];
  for (let t = 0; t <= 60; t++) {
    const flownM = t * 60 * 25; // m flown after t minutes outbound
    // exponential signal falloff; tail noise
    const distFactor = Math.min(1, flownM / (m.range_m * 1.4));
    const sig = Math.max(0, d.signal * (1 - Math.pow(distFactor, 1.8)));
    const bat = Math.max(0, d.battery - drain * t);
    out.push({
      t,
      battery: +bat.toFixed(1),
      signal: +(sig + (Math.random() - 0.5) * 2).toFixed(1),
    });
  }
  // Time to safe-return threshold (battery=25%, signal=20%)
  const tBatLow = out.find(p => p.battery <= 25)?.t ?? null;
  const tSigLow = out.find(p => p.signal <= 20)?.t ?? null;
  const recallAt = [tBatLow, tSigLow].filter((v): v is number => v !== null).sort((a, b) => a - b)[0] ?? null;
  return { series: out, recallAt, role: m.role };
}

const statusColor = (s: string) =>
  s === "in_flight" ? "border-sky-500 text-sky-500" :
  s === "charging" ? "border-amber-500 text-amber-600" :
  "border-emerald-500 text-emerald-600";

export default function Fleet() {
  const { user } = useAuth();
  const [drones, setDrones] = useState<Drone[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Drone | null>(null);
  const [form, setForm] = useState({
    name: "", model: MODELS[0].id, battery: 100, signal: 100, health: 100,
  });

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("drones")
      .select("id, name, model, battery, signal, health, status")
      .order("created_at", { ascending: false });
    setDrones((data as any) ?? []);
    if (data?.length) setActive(prev => prev ?? (data[0] as any));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({
      ...form,
      battery: Number(form.battery), signal: Number(form.signal), health: Number(form.health),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    const { data, error } = await supabase.from("drones").insert({
      user_id: user!.id,
      name: parsed.data.name,
      model: parsed.data.model,
      battery: parsed.data.battery,
      signal: parsed.data.signal,
      health: parsed.data.health,
      status: "idle",
    }).select().single();
    if (error) { toast.error(error.message); return; }
    toast.success("Drone added · forecasting telemetry");
    setActive(data as any);
    setOpen(false);
    setForm({ name: "", model: MODELS[0].id, battery: 100, signal: 100, health: 100 });
    load();
  };

  const remove = async (id: string) => {
    await supabase.from("drones").delete().eq("id", id);
    if (active?.id === id) setActive(null);
    load();
  };

  const f = useMemo(() => active ? forecast(active) : null, [active]);

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl">Drone Fleet</h1>
          <p className="text-muted-foreground">Register a drone with its current battery, Wi-Fi signal and component health - we'll forecast endurance and recall window for the next 60 minutes.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> Register drone</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New drone</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <Label>Call sign</Label>
                <Input required maxLength={40} value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. AGV-04" />
              </div>
              <div>
                <Label>Model</Label>
                <Select value={form.model} onValueChange={v => setForm({ ...form, model: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODELS.map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.id} · {m.role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Battery %</Label>
                  <Input type="number" min={0} max={100} value={form.battery}
                    onChange={e => setForm({ ...form, battery: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Wi-Fi %</Label>
                  <Input type="number" min={0} max={100} value={form.signal}
                    onChange={e => setForm({ ...form, signal: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Health %</Label>
                  <Input type="number" min={0} max={100} value={form.health}
                    onChange={e => setForm({ ...form, health: Number(e.target.value) })} />
                </div>
              </div>
              <Button type="submit" className="w-full">Save & forecast</Button>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      <Tabs defaultValue="forecast" className="w-full">
        <TabsList>
          <TabsTrigger value="forecast">Live forecast</TabsTrigger>
          <TabsTrigger value="intel">Fleet intel</TabsTrigger>
        </TabsList>
        <TabsContent value="forecast">
        <div className="grid lg:grid-cols-[1fr_2fr] gap-6">
        {/* Fleet list */}
        <Card className="p-4 space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground px-2">Fleet ({drones.length})</div>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
          ) : drones.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No drones yet. Click <strong>Register drone</strong> to add your first one.
            </div>
          ) : drones.map(d => (
            <button key={d.id} onClick={() => setActive(d)}
              className={`w-full text-left p-3 rounded-lg border transition ${active?.id === d.id ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-2 truncate">
                    <Plane className="h-4 w-4 text-primary flex-shrink-0" /> {d.name}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{d.model}</div>
                </div>
                <Badge variant="outline" className={statusColor(d.status)}>{d.status.replace("_"," ")}</Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px] mt-2">
                <div className="flex items-center gap-1"><Battery className="h-3 w-3" /> {d.battery}%</div>
                <div className="flex items-center gap-1"><Wifi className="h-3 w-3" /> {d.signal}%</div>
                <div className="flex items-center gap-1"><Activity className="h-3 w-3" /> {d.health}%</div>
              </div>
            </button>
          ))}
        </Card>

        {/* Forecast */}
        <Card className="p-5">
          {!active || !f ? (
            <div className="h-80 flex items-center justify-center text-muted-foreground text-sm">
              Select a drone to see its predicted telemetry.
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between mb-4 gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-primary" /> Predicted endurance · next 60 min
                  </div>
                  <div className="font-display text-xl">{active.name} <span className="text-muted-foreground text-sm font-sans">· {active.model} · {f.role}</span></div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => remove(active.id)}>
                  <Trash2 className="h-3 w-3" /> Remove
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4">
                <Card className="p-3">
                  <div className="text-[11px] text-muted-foreground">Battery now</div>
                  <div className="font-display text-2xl">{active.battery}%</div>
                </Card>
                <Card className="p-3">
                  <div className="text-[11px] text-muted-foreground">Recall window</div>
                  <div className={`font-display text-2xl ${f.recallAt && f.recallAt < 10 ? "text-destructive" : f.recallAt && f.recallAt < 25 ? "text-amber-500" : "text-emerald-500"}`}>
                    {f.recallAt != null ? `T-${f.recallAt}m` : "60+ m"}
                  </div>
                </Card>
                <Card className="p-3">
                  <div className="text-[11px] text-muted-foreground">Battery @ 30 min</div>
                  <div className="font-display text-2xl">{f.series[30].battery}%</div>
                </Card>
              </div>

              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={f.series} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis dataKey="t" tickFormatter={v => `${v}m`} fontSize={11} stroke="hsl(var(--muted-foreground))" />
                    <YAxis domain={[0, 100]} fontSize={11} stroke="hsl(var(--muted-foreground))" tickFormatter={v => `${v}%`} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                      labelFormatter={v => `T+${v} min`}
                    />
                    <ReferenceLine y={25} stroke="hsl(var(--destructive))" strokeDasharray="4 4" label={{ value: "Min safe battery", fontSize: 10, fill: "hsl(var(--destructive))" }} />
                    {f.recallAt != null && (
                      <ReferenceLine x={f.recallAt} stroke="hsl(var(--accent))" strokeDasharray="2 4" label={{ value: "Recall", fontSize: 10, fill: "hsl(var(--accent))" }} />
                    )}
                    <Line type="monotone" dataKey="battery" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Battery" />
                    <Line type="monotone" dataKey="signal" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} name="Wi-Fi" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <p className="text-xs text-muted-foreground mt-3">
                Forecast based on the {active.model}'s typical draw, current battery {active.battery}%, signal {active.signal}%, and component health {active.health}% (lower health drains faster). Recall is triggered by whichever metric crosses its safety threshold first.
              </p>
            </>
          )}
        </Card>
      </div>
        </TabsContent>
        <TabsContent value="intel">
          <FleetIntel />
        </TabsContent>
      </Tabs>
    </div>
  );
}