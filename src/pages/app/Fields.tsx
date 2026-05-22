import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Map, Maximize2, Sparkles, Droplets, Leaf } from "lucide-react";
import { toast } from "sonner";
import Field3D from "@/components/app/Field3D";
import { DEMO_FIELDS, type DemoField } from "@/lib/demo";

type DBField = { id: string; name: string; crop: string; area_hectares: number; location: string | null; notes: string | null };

export default function Fields() {
  const { user } = useAuth();
  const [dbFields, setDbFields] = useState<DBField[]>([]);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<DemoField | null>(null);
  const [form, setForm] = useState({ name: "", crop: "Wheat", area_hectares: "", location: "", notes: "" });

  const load = async () => {
    const { data } = await supabase.from("fields").select("*").order("created_at", { ascending: false });
    setDbFields((data as DBField[]) ?? []);
  };
  useEffect(() => { load(); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("fields").insert({
      user_id: user!.id, name: form.name, crop: form.crop,
      area_hectares: Number(form.area_hectares) || 0,
      location: form.location || null, notes: form.notes || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Field added");
    setForm({ name: "", crop: "Wheat", area_hectares: "", location: "", notes: "" });
    setOpen(false); load();
  };

  const remove = async (id: string) => {
    await supabase.from("fields").delete().eq("id", id);
    load();
  };

  // merge demo + db (demos always shown for investor pitch)
  const allFields: DemoField[] = [
    ...DEMO_FIELDS,
    ...dbFields.map((f, i) => ({
      id: f.id, name: f.name, crop: f.crop, area_hectares: Number(f.area_hectares),
      location: f.location ?? "Location pending",
      health: 70 + ((i * 7) % 25),
      notes: f.notes ?? "Awaiting first AI scan.",
      zones: DEMO_FIELDS[i % DEMO_FIELDS.length].zones,
    })),
  ];

  const healthColor = (h: number) =>
    h >= 80 ? "border-emerald-500 text-emerald-600" :
    h >= 60 ? "border-amber-500 text-amber-600" :
    "border-destructive text-destructive";

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl">Fields</h1>
          <p className="text-muted-foreground">Your monitored parcels. Click any field to inspect the 3D AI overlay.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> Add field</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New field</DialogTitle></DialogHeader>
            <form onSubmit={add} className="space-y-3">
              <div><Label>Name</Label><Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Crop</Label><Input required value={form.crop} onChange={e => setForm({ ...form, crop: e.target.value })} /></div>
              <div><Label>Area (ha)</Label><Input type="number" step="0.1" required value={form.area_hectares} onChange={e => setForm({ ...form, area_hectares: e.target.value })} /></div>
              <div><Label>Location</Label><Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} /></div>
              <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
              <Button type="submit" className="w-full">Save field</Button>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {allFields.map(f => {
          const isDemo = f.id.startsWith("demo-");
          const high = f.zones.filter(z => z.severity === "high").length;
          return (
            <Card key={f.id} className="overflow-hidden group cursor-pointer hover:shadow-lg transition" onClick={() => setDetail(f)}>
              <div className="relative h-44 bg-gradient-to-b from-sky-900 to-slate-900">
                <Field3D zones={f.zones} height={176} />
                <div className="absolute top-3 left-3 right-3 flex items-start justify-between pointer-events-none">
                  <Badge variant="outline" className={`bg-background/90 ${healthColor(f.health)}`}>
                    Health {f.health}
                  </Badge>
                  {high > 0 && <Badge className="bg-destructive">{high} critical</Badge>}
                </div>
                <div className="absolute bottom-2 right-2 bg-background/80 rounded p-1 pointer-events-none">
                  <Maximize2 className="h-3 w-3" />
                </div>
              </div>
              <div className="p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-display text-lg leading-tight">{f.name}</div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">
                      {f.crop} · {f.area_hectares} ha
                    </div>
                  </div>
                  {!isDemo && (
                    <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); remove(f.id); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="text-xs text-muted-foreground font-mono">{f.location}</div>
                <Progress value={f.health} className="h-1.5" />
                <div className="flex gap-3 text-xs pt-1">
                  <span className="flex items-center gap-1"><Sparkles className="h-3 w-3" /> {f.zones.length} zones</span>
                  <span className="flex items-center gap-1"><Droplets className="h-3 w-3" /> spray ready</span>
                  <span className="flex items-center gap-1"><Leaf className="h-3 w-3" /> NDVI 0.{60 + Math.floor(f.health / 10)}</span>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-5xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center justify-between gap-4">
                  <span>{detail.name}</span>
                  <Badge variant="outline" className={healthColor(detail.health)}>Health {detail.health}</Badge>
                </DialogTitle>
              </DialogHeader>
              <Field3D zones={detail.zones} height={420} />
              <div className="grid md:grid-cols-3 gap-3 text-sm">
                <Card className="p-3">
                  <div className="text-xs text-muted-foreground">Crop</div>
                  <div className="font-display">{detail.crop}</div>
                  <div className="text-xs">{detail.area_hectares} ha · {detail.location}</div>
                </Card>
                <Card className="p-3">
                  <div className="text-xs text-muted-foreground">Detections</div>
                  <div className="font-display">{detail.zones.length} zones</div>
                  <div className="text-xs">{detail.zones.filter(z => z.severity === "high").length} critical</div>
                </Card>
                <Card className="p-3">
                  <div className="text-xs text-muted-foreground">Recommendation</div>
                  <div className="font-display text-sm leading-tight">Variable-rate spray</div>
                  <div className="text-xs">Saves ~87% chemical vs blanket</div>
                </Card>
              </div>
              <div className="text-sm text-muted-foreground">{detail.notes}</div>
              <div className="flex gap-2">
                <Button onClick={() => { setDetail(null); toast.success("Mission queued"); }}><Droplets className="h-4 w-4" /> Queue spray</Button>
                <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
