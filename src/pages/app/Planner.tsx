import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CalendarClock, Plus, Plane } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

export default function Planner() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<any[]>([]);
  const [fields, setFields] = useState<any[]>([]);
  const [drones, setDrones] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ field_id: "", drone_id: "", type: "spray", scheduled_at: "", chemical: "", dose_l_ha: "", area_ha: "" });

  const load = async () => {
    const [j, f, d] = await Promise.all([
      supabase.from("jobs").select("*, fields(name), drones(name)").order("scheduled_at"),
      supabase.from("fields").select("id, name, area_hectares"),
      supabase.from("drones").select("id, name, status, battery"),
    ]);
    setJobs(j.data ?? []);
    setFields(f.data ?? []);
    setDrones(d.data ?? []);
  };
  useEffect(() => { load(); }, []);

  const addDrone = async () => {
    const n = prompt("Drone name", `Drone ${drones.length + 1}`);
    if (!n) return;
    const { error } = await supabase.from("drones").insert({ user_id: user!.id, name: n });
    if (error) return toast.error(error.message);
    load();
  };

  const schedule = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("jobs").insert({
      user_id: user!.id,
      field_id: form.field_id || null,
      drone_id: form.drone_id || null,
      type: form.type,
      scheduled_at: form.scheduled_at,
      chemical: form.chemical || null,
      dose_l_ha: form.dose_l_ha ? Number(form.dose_l_ha) : null,
      area_ha: form.area_ha ? Number(form.area_ha) : null,
    });
    if (error) return toast.error(error.message);
    toast.success("Mission scheduled");
    setOpen(false);
    setForm({ field_id: "", drone_id: "", type: "spray", scheduled_at: "", chemical: "", dose_l_ha: "", area_ha: "" });
    load();
  };

  const setStatus = async (id: string, status: string) => {
    await supabase.from("jobs").update({ status }).eq("id", id);
    load();
  };

  const statusColor = (s: string) =>
    s === "completed" ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"
    : s === "in_progress" ? "bg-blue-500 text-white"
    : s === "cancelled" ? "bg-muted text-muted-foreground"
    : "bg-[hsl(var(--field))] text-[hsl(var(--primary-foreground))]";

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl">Mission Planner</h1>
          <p className="text-muted-foreground">Schedule scans and precision sprays across your fleet.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={addDrone}><Plane className="h-4 w-4" /> Add drone</Button>
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
                  <Select value={form.field_id} onValueChange={v => setForm({ ...form, field_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select field" /></SelectTrigger>
                    <SelectContent>
                      {fields.map(f => <SelectItem key={f.id} value={f.id}>{f.name} ({f.area_hectares} ha)</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Drone</Label>
                  <Select value={form.drone_id} onValueChange={v => setForm({ ...form, drone_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select drone" /></SelectTrigger>
                    <SelectContent>
                      {drones.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>When</Label><Input type="datetime-local" required value={form.scheduled_at} onChange={e => setForm({ ...form, scheduled_at: e.target.value })} /></div>
                {form.type === "spray" && (
                  <>
                    <div><Label>Chemical</Label><Input placeholder="e.g. Glyphosate 360" value={form.chemical} onChange={e => setForm({ ...form, chemical: e.target.value })} /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Dose (L/ha)</Label><Input type="number" step="0.1" value={form.dose_l_ha} onChange={e => setForm({ ...form, dose_l_ha: e.target.value })} /></div>
                      <div><Label>Area (ha)</Label><Input type="number" step="0.1" value={form.area_ha} onChange={e => setForm({ ...form, area_ha: e.target.value })} /></div>
                    </div>
                  </>
                )}
                <Button type="submit" className="w-full">Schedule</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-6">
          <h2 className="font-display text-lg mb-4">Mission queue</h2>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No missions scheduled. Plan one above.</p>
          ) : (
            <ul className="divide-y">
              {jobs.map(j => (
                <li key={j.id} className="py-3 flex items-center gap-4">
                  <CalendarClock className="h-5 w-5 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium capitalize">{j.type}</span>
                      <Badge className={statusColor(j.status)}>{j.status}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {j.fields?.name ?? "—"} · {j.drones?.name ?? "no drone"} · {new Date(j.scheduled_at).toLocaleString()}
                      {j.chemical && ` · ${j.chemical} @ ${j.dose_l_ha} L/ha`}
                    </div>
                  </div>
                  <Select value={j.status} onValueChange={v => setStatus(j.id, v)}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="in_progress">In progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="font-display text-lg mb-4">Fleet</h2>
          {drones.length === 0 ? (
            <p className="text-sm text-muted-foreground">No drones yet.</p>
          ) : (
            <ul className="space-y-3">
              {drones.map(d => (
                <li key={d.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2"><Plane className="h-4 w-4" /> {d.name}</div>
                  <div className="text-xs text-muted-foreground">{d.battery}% · {d.status}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}