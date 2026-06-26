import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plane, Plus, Battery, Trash2, Sparkles, Loader2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from "recharts";
import { toast } from "sonner";
import { z } from "zod";
type Drone = {
  id: string; name: string; model: string;
  battery: number; signal: number; health: number; status: string;
  serial?: string | null; notes?: string | null; specs?: any;
};

const DRONE_SPECS: Record<string, {
  role: string; drainPerMin: number; range_m: number;
  weight: string; tank: string; swath: string; maxSpeed: string;
  flightTime: string; sprayRate: string; wingspan: string;
  maxPayload: string; ip: string;
}> = {
  "DJI Agras T40": {
    role: "Sprayer", drainPerMin: 4.85, range_m: 1500,
    weight: "65.5 kg (loaded)", tank: "40 L", swath: "9 m", maxSpeed: "10 m/s",
    flightTime: "17 min (full load)", sprayRate: "24 L/min",
    wingspan: "2.8 m folded → 6.2 m deployed", maxPayload: "50 kg", ip: "IP67",
  },
  "DJI Agras T25": {
    role: "Sprayer", drainPerMin: 3.80, range_m: 1200,
    weight: "42 kg (loaded)", tank: "25 L", swath: "7 m", maxSpeed: "10 m/s",
    flightTime: "15 min (full load)", sprayRate: "10.8 L/min",
    wingspan: "2.2 m folded → 4.7 m deployed", maxPayload: "30 kg", ip: "IP67",
  },
  "XAG P100 Pro": {
    role: "Sprayer", drainPerMin: 5.10, range_m: 1000,
    weight: "75 kg (loaded)", tank: "50 L", swath: "10 m", maxSpeed: "12 m/s",
    flightTime: "18 min (full load)", sprayRate: "28 L/min",
    wingspan: "3.2 m folded", maxPayload: "60 kg", ip: "IP67",
  },
  "XAG V40": {
    role: "Sprayer", drainPerMin: 4.40, range_m: 1000,
    weight: "52 kg (loaded)", tank: "40 L", swath: "8 m", maxSpeed: "10 m/s",
    flightTime: "16 min", sprayRate: "20 L/min",
    wingspan: "2.6 m folded", maxPayload: "45 kg", ip: "IP67",
  },
};
const MODEL_IDS = Object.keys(DRONE_SPECS);

const schema = z.object({
  name: z.string().trim().min(2, "Name too short").max(40),
  model: z.string().min(1),
  battery: z.number().int().min(0).max(100),
  serial: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(500).optional(),
});

function forecast(d: Drone) {
  const m = DRONE_SPECS[d.model] ?? DRONE_SPECS[MODEL_IDS[0]];
  const drain = m.drainPerMin;
  const out: { t: number; battery: number }[] = [];
  for (let t = 0; t <= 60; t++) {
    const bat = Math.max(0, d.battery - drain * t);
    out.push({ t, battery: +bat.toFixed(1) });
  }
  const tBatLow = out.find(p => p.battery <= 25)?.t ?? null;
  const recallAt = tBatLow;
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
    name: "", model: MODEL_IDS[0], battery: 100, serial: "", notes: "",
  });
  const selectedSpec = DRONE_SPECS[form.model];

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("drones")
      .select("id, name, model, battery, signal, health, status, serial, notes, specs")
      .order("created_at", { ascending: false });
    setDrones((data as any) ?? []);
    if (data?.length) setActive(prev => prev ?? (data[0] as any));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({
      name: form.name,
      model: form.model,
      battery: Number(form.battery),
      serial: form.serial || undefined,
      notes: form.notes || undefined,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    const spec = DRONE_SPECS[parsed.data.model];
    const { data, error } = await supabase.from("drones").insert({
      user_id: user!.id,
      name: parsed.data.name,
      model: parsed.data.model,
      battery: parsed.data.battery,
      signal: 100,
      health: 100,
      status: "idle",
      serial: parsed.data.serial ?? null,
      notes: parsed.data.notes ?? null,
      specs: spec as any,
    } as any).select().single();
    if (error) { toast.error(error.message); return; }
    toast.success("Drone added · forecasting telemetry");
    setActive(data as any);
    setOpen(false);
    setForm({ name: "", model: MODEL_IDS[0], battery: 100, serial: "", notes: "" });
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
          <p className="text-muted-foreground">Register a drone with its current battery — we'll forecast endurance and the safe-recall window for the next 60 minutes.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> Register drone</Button></DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>New drone</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label>Call sign</Label>
                  <Input required maxLength={40} value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. AGV-01" />
                </div>
                <div>
                  <Label>Model</Label>
                  <Select value={form.model} onValueChange={v => setForm({ ...form, model: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MODEL_IDS.map(id => (
                        <SelectItem key={id} value={id}>{id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Manufacturer specs</Label>
                  <Badge variant="outline" className="text-[10px]">Auto-filled · read only</Badge>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { k: "Tank", v: selectedSpec.tank },
                    { k: "Swath", v: selectedSpec.swath },
                    { k: "Max speed", v: selectedSpec.maxSpeed },
                    { k: "Flight time", v: selectedSpec.flightTime },
                    { k: "Spray rate", v: selectedSpec.sprayRate },
                    { k: "Weight", v: selectedSpec.weight },
                    { k: "Wingspan", v: selectedSpec.wingspan },
                    { k: "IP rating", v: selectedSpec.ip },
                  ].map(s => (
                    <div key={s.k} className="rounded-md border bg-muted/30 p-2">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.k}</div>
                      <div className="text-xs font-medium leading-tight mt-0.5">{s.v}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Label>Serial number <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input maxLength={60} value={form.serial}
                  onChange={e => setForm({ ...form, serial: e.target.value })}
                  placeholder="e.g. T40-2024-001847" />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2"><Battery className="h-3.5 w-3.5" /> Current battery</Label>
                  <span className="font-display text-lg tabular-nums">{form.battery}%</span>
                </div>
                <Slider min={0} max={100} step={1} value={[form.battery]}
                  onValueChange={([v]) => setForm({ ...form, battery: v })}
                  className="mt-2" />
                <p className="text-[11px] text-muted-foreground mt-1">The only field that changes per flight - update this before each mission.</p>
              </div>

              <div>
                <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Textarea rows={2} maxLength={500} value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  placeholder="Maintenance log, hangar location, etc." />
              </div>

              <Button type="submit" className="w-full">Save & forecast</Button>
            </form>
          </DialogContent>
        </Dialog>
      </header>

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
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <p className="text-xs text-muted-foreground mt-3">
                Forecast based on the {active.model}'s typical draw at current battery {active.battery}%. Recall is triggered when battery reaches the 25% safety threshold.
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}