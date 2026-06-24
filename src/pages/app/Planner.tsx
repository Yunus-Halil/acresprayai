import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { CalendarClock, Plus, Plane, Trash2, Battery, Wifi, Sparkles, Droplets } from "lucide-react";
import { toast } from "sonner";

type Field = { id: string; name: string; area_hectares: number };
type Drone = { id: string; name: string; model: string; status: string; battery: number; signal: number };
type Job = {
  id: string; type: string; status: string; scheduled_at: string;
  chemical: string | null; dose_l_ha: number | null; area_ha: number | null;
  field_id: string | null; drone_id: string | null; notes: string | null;
};

export default function Planner() {
  const { user } = useAuth();
  const [fields, setFields] = useState<Field[]>([]);
  const [drones, setDrones] = useState<Drone[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    type: "spray", field_id: "", drone_id: "", scheduled_at: "",
    chemical: "", dose_l_ha: "", area_ha: "", notes: "",
  });

  const load = async () => {
    const [f, d, j] = await Promise.all([
      supabase.from("fields").select("id, name, area_hectares").order("name"),
      supabase.from("drones").select("id, name, model, status, battery, signal").order("name"),
      supabase.from("jobs").select("*").order("scheduled_at", { ascending: false }),
    ]);
    setFields((f.data as Field[]) ?? []);
    setDrones((d.data as Drone[]) ?? []);
    setJobs((j.data as Job[]) ?? []);
  };
  useEffect(() => { load(); }, []);

  const fieldName = (id: string | null) => fields.find(f => f.id === id)?.name ?? "—";
  const droneName = (id: string | null) => drones.find(d => d.id === id)?.name ?? "—";

  const schedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.scheduled_at) { toast.error("Pick a date/time"); return; }
    const { error } = await supabase.from("jobs").insert({
      user_id: user!.id,
      type: form.type,
      status: "scheduled",
      scheduled_at: new Date(form.scheduled_at).toISOString(),
      field_id: form.field_id || null,
      drone_id: form.drone_id || null,
      chemical: form.chemical || null,
      dose_l_ha: form.dose_l_ha ? Number(form.dose_l_ha) : null,
      area_ha: form.area_ha ? Number(form.area_ha) : null,
      notes: form.notes || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Mission scheduled");
    setOpen(false);
    setForm({ type: "spray", field_id: "", drone_id: "", scheduled_at: "", chemical: "", dose_l_ha: "", area_ha: "", notes: "" });
    load();
  };

  const setStatus = async (id: string, status: string) => {
    await supabase.from("jobs").update({ status }).eq("id", id);
    load();
  };
  const remove = async (id: string) => {
    await supabase.from("jobs").delete().eq("id", id);
    load();
  };

  const statusColor = (s: string) =>
    s === "completed" ? "border-emerald-500 text-emerald-600" :
    s === "in_progress" ? "border-sky-500 text-sky-600" :
    s === "cancelled" ? "border-muted text-muted-foreground" :
    "border-amber-500 text-amber-600";

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl">Mission Planner</h1>
          <p className="text-muted-foreground">Schedule scans and precision sprays against your registered fields and drones.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button disabled={fields.length === 0 || drones.length === 0}>
              <Plus className="h-4 w-4" /> Schedule mission
            </Button>
          </DialogTrigger>
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
                <Select value={form.field_id} onValueChange={v => setForm({ ...form, field_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select field" /></SelectTrigger>
                  <SelectContent>
                    {fields.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Drone</Label>
                <Select value={form.drone_id} onValueChange={v => setForm({ ...form, drone_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select drone" /></SelectTrigger>
                  <SelectContent>
                    {drones.map(d => <SelectItem key={d.id} value={d.id}>{d.name} · {d.model}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>When</Label><Input type="datetime-local" required value={form.scheduled_at} onChange={e => setForm({ ...form, scheduled_at: e.target.value })} /></div>
              <div><Label>Area (ha)</Label><Input type="number" step="0.1" value={form.area_ha} onChange={e => setForm({ ...form, area_ha: e.target.value })} /></div>
              {form.type === "spray" && (
                <>
                  <div><Label>Chemical</Label><Input value={form.chemical} onChange={e => setForm({ ...form, chemical: e.target.value })} /></div>
                  <div><Label>Dose (L/ha)</Label><Input type="number" step="0.1" value={form.dose_l_ha} onChange={e => setForm({ ...form, dose_l_ha: e.target.value })} /></div>
                </>
              )}
              <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
              <Button type="submit" className="w-full">Schedule</Button>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      {(fields.length === 0 || drones.length === 0) && (
        <Card className="p-4 text-sm text-muted-foreground">
          You need at least one field and one drone to schedule a mission.{" "}
          {fields.length === 0 && <>Add a <strong>field</strong>.</>} {drones.length === 0 && <> Register a <strong>drone</strong>.</>}
        </Card>
      )}

      <div className="grid lg:grid-cols-[2fr_1fr] gap-4">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-lg flex items-center gap-2"><CalendarClock className="h-4 w-4" /> Mission queue</h2>
            <span className="text-xs text-muted-foreground">{jobs.length} total</span>
          </div>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No missions yet.</p>
          ) : (
            <ul className="space-y-2">
              {jobs.map(m => {
                const Mi = m.type === "spray" ? Droplets : Sparkles;
                return (
                  <li key={m.id} className="p-3 rounded-lg border">
                    <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                      <div className="flex items-center gap-2 text-sm font-medium truncate">
                        <Mi className="h-3.5 w-3.5" /> {fieldName(m.field_id)}
                      </div>
                      <Badge variant="outline" className={`text-[10px] ${statusColor(m.status)}`}>{m.status.replace("_", " ")}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3">
                      <span>{droneName(m.drone_id)}</span>
                      <span>{new Date(m.scheduled_at).toLocaleString()}</span>
                      {m.area_ha && <span>{m.area_ha} ha</span>}
                      {m.chemical && <span>{m.chemical}{m.dose_l_ha ? ` · ${m.dose_l_ha} L/ha` : ""}</span>}
                    </div>
                    <div className="flex gap-2 mt-2">
                      {m.status === "scheduled" && <Button size="sm" variant="outline" className="h-7" onClick={() => setStatus(m.id, "in_progress")}>Mark in progress</Button>}
                      {m.status === "in_progress" && <Button size="sm" variant="outline" className="h-7" onClick={() => setStatus(m.id, "completed")}>Mark complete</Button>}
                      {m.status !== "completed" && m.status !== "cancelled" && (
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => setStatus(m.id, "cancelled")}>Cancel</Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => remove(m.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-display text-lg flex items-center gap-2 mb-3"><Plane className="h-4 w-4" /> Fleet</h2>
          {drones.length === 0 ? (
            <p className="text-sm text-muted-foreground">No drones registered.</p>
          ) : (
            <ul className="space-y-3">
              {drones.map(d => (
                <li key={d.id} className="text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 truncate">
                      <span className={`h-2 w-2 rounded-full ${d.status === "in_flight" ? "bg-emerald-500 animate-pulse" : d.status === "charging" ? "bg-amber-500" : "bg-muted-foreground/40"}`} />
                      <span className="font-medium truncate">{d.name}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground uppercase">{d.model}</span>
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
      </div>
    </div>
  );
}