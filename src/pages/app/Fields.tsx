import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Map } from "lucide-react";
import { toast } from "sonner";

type Field = { id: string; name: string; crop: string; area_hectares: number; location: string | null; notes: string | null };

export default function Fields() {
  const { user } = useAuth();
  const [fields, setFields] = useState<Field[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", crop: "Wheat", area_hectares: "", location: "", notes: "" });

  const load = async () => {
    const { data } = await supabase.from("fields").select("*").order("created_at", { ascending: false });
    setFields((data as Field[]) ?? []);
  };
  useEffect(() => { load(); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("fields").insert({
      user_id: user!.id,
      name: form.name,
      crop: form.crop,
      area_hectares: Number(form.area_hectares) || 0,
      location: form.location || null,
      notes: form.notes || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Field added");
    setForm({ name: "", crop: "Wheat", area_hectares: "", location: "", notes: "" });
    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("fields").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl">Fields</h1>
          <p className="text-muted-foreground">Your monitored parcels. Add a field to start scheduling scans and sprays.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> Add field</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New field</DialogTitle></DialogHeader>
            <form onSubmit={add} className="space-y-3">
              <div><Label>Name</Label><Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Crop</Label><Input required value={form.crop} onChange={e => setForm({ ...form, crop: e.target.value })} /></div>
              <div><Label>Area (hectares)</Label><Input type="number" step="0.1" required value={form.area_hectares} onChange={e => setForm({ ...form, area_hectares: e.target.value })} /></div>
              <div><Label>Location</Label><Input placeholder="e.g. 51.5074, -0.1278 or Provence" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} /></div>
              <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
              <Button type="submit" className="w-full">Save field</Button>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      {fields.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <Map className="h-8 w-8 mx-auto mb-3 opacity-50" />
          No fields yet. Add your first one above.
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {fields.map(f => (
            <Card key={f.id} className="p-5 group">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-display text-xl">{f.name}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mt-1">{f.crop} · {f.area_hectares} ha</div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => remove(f.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
              {f.location && <div className="text-sm mt-3 text-muted-foreground">📍 {f.location}</div>}
              {f.notes && <div className="text-sm mt-2">{f.notes}</div>}
              <div className="mt-4 h-24 rounded bg-[hsl(var(--field))] grid-bg-dark" />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}