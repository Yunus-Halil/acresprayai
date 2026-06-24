import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, ArrowRight, Leaf, Box } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

type DBField = { id: string; name: string; crop: string; area_hectares: number; location: string | null; notes: string | null; created_at: string };
type ScanCount = { field_id: string; total: number; completed: number };

export default function Fields() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dbFields, setDbFields] = useState<DBField[]>([]);
  const [counts, setCounts] = useState<Record<string, ScanCount>>({});
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", crop: "Wheat", area_hectares: "", location: "", notes: "" });

  const load = async () => {
    const [{ data: fields }, { data: tasks }] = await Promise.all([
      supabase.from("fields").select("*").order("created_at", { ascending: false }),
      supabase.from("odm_tasks").select("field_id, status"),
    ]);
    setDbFields((fields as DBField[]) ?? []);
    const c: Record<string, ScanCount> = {};
    for (const t of (tasks ?? []) as { field_id: string; status: string }[]) {
      if (!t.field_id) continue;
      c[t.field_id] ??= { field_id: t.field_id, total: 0, completed: 0 };
      c[t.field_id].total++;
      if (t.status === "completed") c[t.field_id].completed++;
    }
    setCounts(c);
  };
  useEffect(() => { load(); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data, error } = await supabase.from("fields").insert({
      user_id: user!.id, name: form.name, crop: form.crop,
      area_hectares: Number(form.area_hectares) || 0,
      location: form.location || null, notes: form.notes || null,
    }).select().single();
    if (error) return toast.error(error.message);
    toast.success(`Field created — now upload drone images for ${data.name}`);
    setForm({ name: "", crop: "Wheat", area_hectares: "", location: "", notes: "" });
    setOpen(false);
    navigate(`/app/fields/${data.id}`);
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this field and all its scans?")) return;
    await supabase.from("fields").delete().eq("id", id);
    load();
  };

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl">Fields</h1>
          <p className="text-muted-foreground max-w-2xl">
            Start by creating a field. Then upload drone images for that field — we'll process them with OpenDroneMap
            and build a 3D model you can review, scan after scan.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> New field</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Step 1 · Create a field</DialogTitle>
              <div className="text-xs text-muted-foreground">After saving, you'll be taken to the field where you can upload drone images.</div>
            </DialogHeader>
            <form onSubmit={add} className="space-y-3">
              <div><Label>Name</Label><Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="North vineyard" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Crop</Label><Input required value={form.crop} onChange={e => setForm({ ...form, crop: e.target.value })} /></div>
                <div><Label>Area (ha)</Label><Input type="number" step="0.1" required value={form.area_hectares} onChange={e => setForm({ ...form, area_hectares: e.target.value })} /></div>
              </div>
              <div><Label>Location</Label><Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="optional" /></div>
              <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="optional" /></div>
              <Button type="submit" className="w-full">Create field & continue <ArrowRight className="h-4 w-4" /></Button>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      {dbFields.length === 0 && (
        <Card className="p-10 text-center space-y-3">
          <Leaf className="h-10 w-10 mx-auto text-primary" />
          <div className="font-display text-xl">No fields yet</div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Every scan and 3D model in AcreSpray lives inside a field. Create your first field to start.
          </p>
          <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Create your first field</Button>
        </Card>
      )}

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {dbFields.map(f => {
          const c = counts[f.id];
          return (
            <Card key={f.id} className="p-5 cursor-pointer hover:shadow-lg hover:-translate-y-0.5 transition group"
              onClick={() => navigate(`/app/fields/${f.id}`)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-display text-xl leading-tight truncate">{f.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{f.crop} · {f.area_hectares} ha</div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0"
                  onClick={(e) => { e.stopPropagation(); remove(f.id); }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="mt-4 flex items-center gap-2">
                {c?.total ? (
                  <>
                    <Badge variant="outline" className="gap-1">
                      <Box className="h-3 w-3" /> {c.total} scan{c.total === 1 ? "" : "s"}
                    </Badge>
                    {c.completed > 0 && (
                      <Badge variant="outline" className="border-emerald-500 text-emerald-600">
                        {c.completed} ready
                      </Badge>
                    )}
                  </>
                ) : (
                  <Badge variant="outline" className="border-amber-500 text-amber-600">No scans yet</Badge>
                )}
              </div>
              <div className="mt-3 pt-3 border-t text-xs text-muted-foreground flex items-center justify-between">
                <span className="truncate">{f.location ?? "No location set"}</span>
                <span className="inline-flex items-center gap-1 text-primary opacity-0 group-hover:opacity-100 transition">
                  Open <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
