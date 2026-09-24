import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fmtAreaHa } from "@/lib/units";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, ArrowRight, Leaf, MapPin, Pencil, Check, X } from "lucide-react";
import { backfillLocations } from "@/lib/fields/geocode";
import {
  type DerivedLocation, displayLocation, fieldsNeedingGeocode,
} from "@/lib/fields/location";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PAGE_SIZE, appendPage, hasMore, pageRange } from "@/lib/pagination";
import { ASSUMED_REGION_WARNING } from "@/lib/weedCatalog/region";

type DBField = {
  id: string;
  name: string;
  crop: string;
  area_hectares: number;
  /** The operator's own words for where this is. Nothing in the app overwrites it. */
  location: string | null;
  notes: string | null;
  created_at: string;
  boundary: unknown | null;
  boundary_area_hectares: number | null;
  /** What the boundary reverse-geocodes to. Always second to `location`. */
  derived_location: DerivedLocation | null;
};

const HA_TO_AC = 2.4710538147;

export default function Fields() {
  const units = useUnitSystem();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dbFields, setDbFields] = useState<DBField[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", location: "", notes: "" });
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);

  // Paged rather than fetching every field: a contractor managing many parcels
  // should not pay to download all of them to see the first screenful.
  const load = async (opts: { page?: number; reload?: boolean } = {}) => {
    const targetPage = opts.reload ? 0 : opts.page ?? 0;
    const span = opts.reload
      ? [0, (page + 1) * PAGE_SIZE - 1] as [number, number]
      : pageRange(targetPage);
    const { data: fields, error } = await supabase
      .from("fields")
      .select("*")
      .order("created_at", { ascending: false })
      .range(span[0], span[1]);
    if (error) {
      // A failed load must never render as "No fields yet" — a person with
      // real fields and no connection would read that as their data being gone.
      setLoadFailed(error.message);
      return;
    }
    setLoadFailed(null);
    const rows = (fields as unknown as DBField[]) ?? [];
    setDbFields(prev => (opts.reload || targetPage === 0 ? rows : appendPage(prev, rows)));
    setMore(hasMore(rows, span[1] - span[0] + 1));
    if (!opts.reload) setPage(targetPage);
  };
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  useEffect(() => { load(); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data, error } = await supabase.from("fields").insert({
      user_id: user!.id, name: form.name, crop: "",
      area_hectares: 0,
      location: form.location || null, notes: form.notes || null,
    }).select().single();
    if (error) {
      return toast.error("Couldn't create the field", {
        description: `Nothing was created. Check your connection and try again. (${error.message})`,
      });
    }
    toast.success(`Field created, now upload drone images for ${data.name}`);
    setForm({ name: "", location: "", notes: "" });
    setOpen(false);
    navigate(`/app/fields/${data.id}`);
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this field and all its scans?")) return;
    const { error } = await supabase.from("fields").delete().eq("id", id);
    if (error) {
      toast.error("Couldn't delete the field", {
        description: "Nothing was deleted. Check your connection and try again.",
      });
      return;
    }
    load({ reload: true });
  };

  // Fields that have a boundary and no location get one, worked out from that
  // boundary. Only the ones that need it, one request per second, and each
  // answer is written as it arrives so navigating away keeps what was learned.
  //
  // Deliberately here and not on the dashboard: the service is asked in one
  // place in the app, and everywhere else reads the persisted answer.
  useEffect(() => {
    const todo = fieldsNeedingGeocode(dbFields);
    if (!todo.length) return;
    const ac = new AbortController();
    void backfillLocations(todo, ({ id, derived }) => {
      setDbFields(prev => prev.map(f => (f.id === id ? { ...f, derived_location: derived } : f)));
    }, ac.signal);
    return () => ac.abort();
  }, [dbFields]);

  /**
   * Save the operator's own words for where a field is.
   *
   * Writes `location` and never `derived_location`, and an empty box clears it
   * back to null so the derived answer shows again. That is the whole
   * arrangement: the operator can override, and can also take the override off.
   */
  const setLocation = async (id: string, text: string) => {
    const value = text.trim() || null;
    const { error } = await supabase.from("fields").update({ location: value }).eq("id", id);
    if (error) { toast.error("Couldn't save the location", { description: error.message }); return; }
    setDbFields(prev => prev.map(f => (f.id === id ? { ...f, location: value } : f)));
    toast.success(value ? "Location saved" : "Location cleared");
  };

  const rename = async (id: string, name: string) => {
    const { error } = await supabase.from("fields").update({ name }).eq("id", id);
    if (error) {
      toast.error("Couldn't rename the field", {
        description: `The name was not changed. Check your connection and try again. (${error.message})`,
      });
      return;
    }
    setDbFields(prev => prev.map(f => f.id === id ? { ...f, name } : f));
    toast.success("Field renamed");
  };

  return (
    <div className="p-8 space-y-6">
      {/* Testing assumption, said where the fields are. See lib/weedCatalog/region.ts. */}
      <Card role="status" className="p-4 text-sm border-amber-500/60 bg-amber-500/10 text-amber-900 dark:text-amber-200">
        <span className="font-semibold">Weed reference list: </span>{ASSUMED_REGION_WARNING}
      </Card>
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl">Fields</h1>
          <p className="text-muted-foreground max-w-2xl">
            Start by creating a field. Then upload drone images for that field. We'll process them with OpenDroneMap
            and build a tiled orthomosaic you can review, scan after scan.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> New field</Button></DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Step 1 · Create a field</DialogTitle>
              <div className="text-xs text-muted-foreground">After saving, you'll be taken to the field where you can review it.</div>
            </DialogHeader>
            <form onSubmit={add} className="space-y-3">
              <div><Label>Name</Label><Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="North vineyard" /></div>
              <div><Label>Location</Label><Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="optional" /></div>
              <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="optional" /></div>
              <p className="text-xs text-muted-foreground">Crop and field size are set later, crop in Settings, size measured from your boundary.</p>
              <Button type="submit" className="w-full">Create field & continue <ArrowRight className="h-4 w-4" /></Button>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      {loadFailed && (
        <Card className="p-4 text-sm border-destructive/50 text-destructive">
          Couldn&rsquo;t load your fields ({loadFailed}). This is a loading failure, not an
          empty account. Check your connection and{" "}
          <button className="underline" onClick={() => void load({ reload: true })}>retry</button>.
        </Card>
      )}
      {dbFields.length === 0 && !loadFailed && (
        <Card className="p-10 text-center space-y-3">
          <Leaf className="h-10 w-10 mx-auto text-primary" />
          <div className="font-display text-xl">No fields yet</div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Every scan and orthomosaic in SwathWise lives inside a field. Create your first field to start.
          </p>
          <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Create your first field</Button>
        </Card>
      )}

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {dbFields.map(f => {
          const defined = !!f.boundary;
          const realHa = Number(f.boundary_area_hectares ?? f.area_hectares ?? 0);
          return (
            <Card key={f.id} className="p-5 cursor-pointer hover:shadow-lg hover:-translate-y-0.5 transition group"
              onClick={() => navigate(`/app/fields/${f.id}`)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <InlineRename name={f.name} onSave={(n) => rename(f.id, n)} />
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {f.crop} · {fmtAreaHa(realHa, units).text}
                    {defined && <span className="ml-1 text-emerald-500">(measured)</span>}
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0"
                  onClick={(e) => { e.stopPropagation(); remove(f.id); }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="mt-4 flex items-center gap-2">
                {defined ? (
                  <Badge variant="outline" className="gap-1 border-emerald-500 text-emerald-600">
                    <MapPin className="h-3 w-3" /> Boundary defined
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-amber-500 text-amber-600">
                    Boundary not defined
                  </Badge>
                )}
              </div>
              <div className="mt-3 pt-3 border-t text-xs text-muted-foreground flex items-center justify-between gap-2">
                <InlineLocation
                  value={displayLocation(f)}
                  own={f.location}
                  road={f.location ? null : f.derived_location?.road ?? null}
                  onSave={(v) => setLocation(f.id, v)} />
                <span className="inline-flex items-center gap-1 text-primary opacity-0 group-hover:opacity-100 transition shrink-0">
                  Open <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </Card>
          );
        })}
      </div>

      {more && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => load({ page: page + 1 })}>
            Load more fields
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The location line, editable in place.
 *
 * Mirrors InlineRename above rather than introducing a second way to edit a
 * field on this card. Two differences, both deliberate:
 *
 *   an empty value is allowed, and clears the operator's override so the
 *   derived label comes back, which is the only way to undo an override
 *
 *   the derived answer is shown greyed with the road under it, so it is visible
 *   that the app worked it out rather than the operator having typed it
 */
function InlineLocation({ value, own, road, onSave }: {
  value: string | null;
  own: string | null;
  road: string | null;
  onSave: (v: string) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(own ?? value ?? "");
  useEffect(() => { setVal(own ?? value ?? ""); }, [own, value]);
  const stop = (e: React.SyntheticEvent) => { e.stopPropagation(); };

  if (!editing) {
    return (
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="truncate">
          {value ?? "No location set"}
          {road && <span className="opacity-60"> · {road}</span>}
        </span>
        <button onClick={(e) => { stop(e); setEditing(true); }}
          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition p-0.5 shrink-0"
          aria-label="Edit location">
          <Pencil className="h-3 w-3" />
        </button>
      </span>
    );
  }
  const commit = async () => { await onSave(val); setEditing(false); };
  return (
    <span className="flex items-center gap-1 min-w-0 flex-1" onClick={stop}>
      <input autoFocus value={val} onChange={e => setVal(e.target.value)} onClick={stop}
        placeholder={value ?? "Where is this field?"}
        onKeyDown={e => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setEditing(false); setVal(own ?? value ?? ""); }
        }}
        className="text-xs bg-transparent border-b border-primary outline-none min-w-0 flex-1" />
      <button onClick={(e) => { stop(e); commit(); }} className="p-0.5" aria-label="Save location">
        <Check className="h-3 w-3 text-emerald-500" />
      </button>
      <button onClick={(e) => { stop(e); setEditing(false); setVal(own ?? value ?? ""); }}
        className="p-0.5" aria-label="Cancel">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function InlineRename({ name, onSave }: { name: string; onSave: (n: string) => Promise<void> | void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(name);
  useEffect(() => { setVal(name); }, [name]);
  const stop = (e: React.SyntheticEvent) => { e.stopPropagation(); };
  if (!editing) {
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        <div className="font-display text-xl leading-tight truncate">{name}</div>
        <button onClick={(e) => { stop(e); setEditing(true); }}
          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition p-1" aria-label="Rename">
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    );
  }
  const commit = async () => {
    const v = val.trim();
    if (!v || v === name) { setEditing(false); setVal(name); return; }
    await onSave(v); setEditing(false);
  };
  return (
    <div className="flex items-center gap-1 min-w-0" onClick={stop}>
      <input autoFocus value={val} onChange={e => setVal(e.target.value)}
        onClick={stop}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditing(false); setVal(name); } }}
        className="font-display text-xl leading-tight bg-transparent border-b border-primary outline-none min-w-0 flex-1" />
      <button onClick={(e) => { stop(e); commit(); }} className="p-1" aria-label="Save"><Check className="h-3.5 w-3.5 text-emerald-500" /></button>
      <button onClick={(e) => { stop(e); setEditing(false); setVal(name); }} className="p-1" aria-label="Cancel"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
}
