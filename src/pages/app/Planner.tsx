import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  CalendarClock, Plus, Plane, Play, Battery, Wifi, MapPin, Clock,
  Droplets, Sparkles, CheckCircle2, Loader2, Pencil, Undo2, X,
} from "lucide-react";
import { toast } from "sonner";
import Field3D from "@/components/app/Field3D";
import { DEMO_MISSIONS, DEMO_DRONES, DEMO_FIELDS } from "@/lib/demo";

export default function Planner() {
  const { user } = useAuth();
  const [missions, setMissions] = useState(DEMO_MISSIONS);
  const [fields, setFields] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(missions[0]);
  const [form, setForm] = useState({ field: "", drone: "", type: "spray", when: "", chemical: "", dose: "" });
  const [drawMode, setDrawMode] = useState(false);
  const [customPaths, setCustomPaths] = useState<Record<string, [number, number][]>>({});

  const currentPath = customPaths[active.id];
  const setCurrentPath = (wp: [number, number][]) =>
    setCustomPaths(p => ({ ...p, [active.id]: wp }));

  useEffect(() => {
    supabase.from("fields").select("id, name, area_hectares").then(({ data }) => setFields(data ?? []));
  }, []);

  // animate progress of in_progress mission
  useEffect(() => {
    const t = setInterval(() => {
      setMissions(ms => ms.map(m => m.status === "in_progress" ? { ...m, progress: Math.min(100, m.progress + 0.4) } : m));
    }, 600);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // keep active in sync
    setActive(a => missions.find(m => m.id === a.id) ?? missions[0]);
  }, [missions]);

  const launch = (id: string) => {
    setMissions(ms => ms.map(m => m.id === id ? { ...m, status: "in_progress", progress: 5 } : m));
    toast.success("Mission launched — drone dispatched");
  };

  const schedule = (e: React.FormEvent) => {
    e.preventDefault();
    const id = `m${Date.now()}`;
    setMissions(ms => [...ms, {
      id, field: form.field || "B-04 North Quadrant",
      drone: form.drone || "AGV-03 DJI Mavic 3M",
      type: form.type, status: "scheduled", progress: 0,
      scheduled_at: form.when || "Tomorrow 08:00",
      chemical: form.chemical || "-",
      dose: Number(form.dose) || 0,
      area: 4.2, eta: "scheduled",
    }]);
    toast.success("Mission scheduled");
    setOpen(false);
    setForm({ field: "", drone: "", type: "spray", when: "", chemical: "", dose: "" });
  };

  const statusColor = (s: string) =>
    s === "completed" ? "border-emerald-500 text-emerald-600" :
    s === "in_progress" ? "border-sky-500 text-sky-600" :
    "border-amber-500 text-amber-600";
  const statusIcon = (s: string) =>
    s === "completed" ? CheckCircle2 : s === "in_progress" ? Loader2 : Clock;

  const fieldFor = (name: string) => DEMO_FIELDS.find(f => f.name === name) ?? DEMO_FIELDS[0];

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl">Mission Planner</h1>
          <p className="text-muted-foreground">Schedule scans and precision sprays. Watch live drone progress in 3D.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> Schedule mission</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New mission</DialogTitle></DialogHeader>
            <form onSubmit={schedule} className="space-y-3">
              <div>
                <Label>Type</Label>
                <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="scan">Scan</SelectItem>
                    <SelectItem value="spray">Spray</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Field</Label>
                <Select value={form.field} onValueChange={v => setForm({ ...form, field: v })}>
                  <SelectTrigger><SelectValue placeholder="Select field" /></SelectTrigger>
                  <SelectContent>
                    {DEMO_FIELDS.map(f => <SelectItem key={f.id} value={f.name}>{f.name}</SelectItem>)}
                    {fields.map(f => <SelectItem key={f.id} value={f.name}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Drone</Label>
                <Select value={form.drone} onValueChange={v => setForm({ ...form, drone: v })}>
                  <SelectTrigger><SelectValue placeholder="Auto-assign" /></SelectTrigger>
                  <SelectContent>
                    {DEMO_DRONES.map(d => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>When</Label><Input type="datetime-local" value={form.when} onChange={e => setForm({ ...form, when: e.target.value })} /></div>
              {form.type === "spray" && (
                <>
                  <div><Label>Chemical</Label><Input value={form.chemical} onChange={e => setForm({ ...form, chemical: e.target.value })} /></div>
                  <div><Label>Dose (L/ha)</Label><Input type="number" step="0.1" value={form.dose} onChange={e => setForm({ ...form, dose: e.target.value })} /></div>
                </>
              )}
              <Button type="submit" className="w-full">Schedule</Button>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-4">
        {/* Live 3D view of active mission */}
        <Card className="overflow-hidden">
          <div className="p-4 border-b flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Active mission · live 3D</div>
              <div className="font-display text-lg">{active.field}</div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={statusColor(active.status)}>
                {(() => { const I = statusIcon(active.status); return <I className={`h-3 w-3 mr-1 ${active.status === "in_progress" ? "animate-spin" : ""}`} />; })()}
                {active.status.replace("_", " ")}
              </Badge>
              <Badge variant="outline" className="capitalize">{active.type}</Badge>
            </div>
          </div>
          <div className="relative">
            <Field3D
              zones={fieldFor(active.field).zones}
              waypoints={currentPath}
              editable={drawMode}
              onWaypointsChange={setCurrentPath}
              height={380}
            />
            <div className="absolute top-3 right-3 flex gap-2">
              <Button
                size="sm"
                variant={drawMode ? "default" : "secondary"}
                onClick={() => {
                  if (!drawMode && !currentPath) setCurrentPath([]);
                  setDrawMode(d => !d);
                }}
              >
                <Pencil className="h-3 w-3" /> {drawMode ? "Done" : "Draw path"}
              </Button>
              {drawMode && currentPath && currentPath.length > 0 && (
                <Button size="sm" variant="secondary"
                  onClick={() => setCurrentPath(currentPath.slice(0, -1))}>
                  <Undo2 className="h-3 w-3" /> Undo
                </Button>
              )}
              {currentPath && (
                <Button size="sm" variant="secondary"
                  onClick={() => {
                    setCustomPaths(p => { const n = { ...p }; delete n[active.id]; return n; });
                    setDrawMode(false);
                    toast.success("Reverted to auto path");
                  }}>
                  <X className="h-3 w-3" /> Reset
                </Button>
              )}
            </div>
            {drawMode && (
              <div className="absolute bottom-3 left-3 right-3 text-[11px] font-mono bg-black/70 text-white px-3 py-1.5 rounded">
                Click on the field to place waypoints · {currentPath?.length ?? 0} placed · drag to rotate
              </div>
            )}
          </div>
          <div className="p-4 space-y-3 border-t">
            <div className="flex items-center justify-between text-sm">
              <span className="font-mono">{active.drone}</span>
              <span className="font-mono text-xs">{Math.round(active.progress)}% · ETA {active.eta}</span>
            </div>
            <Progress value={active.progress} className="h-2" />
            <div className="grid grid-cols-4 gap-3 text-xs">
              <div><div className="text-muted-foreground">Chemical</div><div className="truncate">{active.chemical}</div></div>
              <div><div className="text-muted-foreground">Dose</div><div>{active.dose} L/ha</div></div>
              <div><div className="text-muted-foreground">Area</div><div>{active.area} ha</div></div>
              <div><div className="text-muted-foreground">Scheduled</div><div>{active.scheduled_at}</div></div>
            </div>
          </div>
        </Card>

        {/* Mission queue + fleet */}
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-lg flex items-center gap-2"><CalendarClock className="h-4 w-4" /> Mission queue</h2>
              <span className="text-xs text-muted-foreground">{missions.length} total</span>
            </div>
            <ul className="space-y-2">
              {missions.map(m => {
                const I = statusIcon(m.status);
                const Mi = m.type === "spray" ? Droplets : Sparkles;
                return (
                  <li key={m.id}>
                    <button
                      onClick={() => setActive(m)}
                      className={`w-full text-left p-3 rounded-lg border transition ${active.id === m.id ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 text-sm font-medium truncate">
                          <Mi className="h-3.5 w-3.5" /> {m.field}
                        </div>
                        <Badge variant="outline" className={`text-[10px] ${statusColor(m.status)}`}>
                          <I className={`h-2.5 w-2.5 mr-1 ${m.status === "in_progress" ? "animate-spin" : ""}`} />
                          {m.status.replace("_", " ")}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center justify-between">
                        <span className="truncate">{m.drone} · {m.scheduled_at}</span>
                        {m.status === "in_progress" && <span className="font-mono">{Math.round(m.progress)}%</span>}
                      </div>
                      {m.status === "in_progress" && <Progress value={m.progress} className="h-1 mt-2" />}
                      {m.status === "scheduled" && (
                        <Button size="sm" variant="outline" className="mt-2 h-7 text-xs"
                          onClick={(e) => { e.stopPropagation(); launch(m.id); }}>
                          <Play className="h-3 w-3" /> Launch now
                        </Button>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card className="p-5">
            <h2 className="font-display text-lg flex items-center gap-2 mb-3"><Plane className="h-4 w-4" /> Fleet</h2>
            <ul className="space-y-3">
              {DEMO_DRONES.map(d => (
                <li key={d.id} className="text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 truncate">
                      <span className={`h-2 w-2 rounded-full ${d.status === "in_flight" ? "bg-emerald-500 animate-pulse" : d.status === "charging" ? "bg-amber-500" : "bg-muted-foreground/40"}`} />
                      <span className="font-medium truncate">{d.name}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground uppercase">{d.role}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground pl-4">
                    <span className="flex items-center gap-1"><Battery className="h-3 w-3" /> {d.battery}%</span>
                    <span className="flex items-center gap-1"><Wifi className="h-3 w-3" /> {d.signal}%</span>
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {d.location}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
