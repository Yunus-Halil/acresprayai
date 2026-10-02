// The field walk: go to each patch the map flagged, look, photograph it, and
// say what is there. Built for a phone in a field: one column, big buttons,
// the nearest unvisited patch first, directions one tap away.
//
// What is recorded here is the label the patch-level weed work learns from,
// so nothing is filled in for the person: "what is here" comes first and on
// its own, species are typed or picked by them, and "not sure which weed" is
// a valid answer.
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Camera, CheckCircle2, Loader2, MapPin, Navigation, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { fmtArea, fmtDistance } from "@/lib/units";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listWalkPatches, pastSpeciesNames, saveGroundTruth, visitsBySpot } from "@/lib/groundTruth/repo";
import {
  type Confidence, GROWTH_STAGES, type GrowthStage, type IdentifiedBy, type Position, type SpeciesEntry,
  UNKNOWN_WEED, WHAT_IS_HERE, WHAT_IS_HERE_LABEL, type WalkItem, type WalkPatch, type WhatIsHere,
  compass, directionsUrl, validateGroundTruth, walkList,
} from "@/lib/groundTruth/walk";

type Scan = { id: string; created_at: string };

export default function FieldWalk() {
  const { id: fieldId } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const units = useUnitSystem();
  const [fieldName, setFieldName] = useState("");
  const [scans, setScans] = useState<Scan[]>([]);
  const scanId = params.get("scan") ?? scans[0]?.id ?? null;
  const [patches, setPatches] = useState<WalkPatch[] | null>(null);
  const [visits, setVisits] = useState<Record<string, number>>({});
  const [here, setHere] = useState<Position | null>(null);
  const [gpsNote, setGpsNote] = useState<string | null>(null);
  const [open, setOpen] = useState<WalkPatch | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fieldId) return;
    supabase.from("fields").select("name").eq("id", fieldId).maybeSingle()
      .then(({ data }) => setFieldName((data as { name?: string } | null)?.name ?? ""));
    supabase.from("odm_tasks").select("id, created_at").eq("field_id", fieldId).eq("status", "completed")
      .order("created_at", { ascending: false })
      .then(({ data }) => setScans((data ?? []) as Scan[]));
    visitsBySpot(fieldId).then(setVisits).catch(() => setVisits({}));
    pastSpeciesNames().then(setNames).catch(() => setNames([]));
  }, [fieldId]);

  useEffect(() => {
    if (!scanId) return;
    setPatches(null); setError(null);
    listWalkPatches(scanId).then(setPatches).catch(e => setError((e as Error).message));
  }, [scanId]);

  // The phone's position, live, so the list re-orders as the walker moves.
  useEffect(() => {
    if (!("geolocation" in navigator)) { setGpsNote("This device has no location; the list keeps the scan's order."); return; }
    const watch = navigator.geolocation.watchPosition(
      p => { setHere({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }); setGpsNote(null); },
      () => setGpsNote("Location is off; the list keeps the scan's order and records are saved without your position."),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);

  const items = useMemo(() => (patches ? walkList(patches, here, visits) : []), [patches, here, visits]);
  const done = items.filter(i => i.visits > 0).length;

  return (
    <div className="max-w-xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link to={`/app/fields/${fieldId}`} className="text-sm text-muted-foreground inline-flex items-center gap-1"><ArrowLeft className="h-4 w-4" /> {fieldName || "Field"}</Link>
      </div>
      <div>
        <h1 className="text-xl font-semibold">Field walk</h1>
        <p className="text-sm text-muted-foreground">
          Walk to each patch the map flagged, look, take a photo and say what is there. What you record here is what the
          weed estimates will learn from.
        </p>
      </div>

      {scans.length > 1 && (
        <select className="w-full border rounded-md p-2 text-sm bg-background" value={scanId ?? ""}
          onChange={e => setParams({ scan: e.target.value })}>
          {scans.map(s => <option key={s.id} value={s.id}>Scan of {new Date(s.created_at).toLocaleDateString()}</option>)}
        </select>
      )}

      {gpsNote && <p className="text-xs text-amber-600">{gpsNote}</p>}
      {here && <p className="text-xs text-muted-foreground"><MapPin className="inline h-3 w-3" /> Your position is known to about {fmtDistance(here.accuracyM ?? 0, units).text}.</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!scanId && <Card className="p-4 text-sm">This field has no finished scan yet.</Card>}
      {patches && !patches.length && (
        <Card className="p-4 text-sm">
          No patches saved for this scan yet. Open the scan, run Weed Scout, and press "Save spots" so the flagged patches
          land here.
        </Card>
      )}
      {patches && patches.length > 0 && <p className="text-sm">{done} of {items.length} patches visited.</p>}
      {!patches && scanId && !error && <p className="text-sm text-muted-foreground inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading the patches.</p>}

      <div className="space-y-2">
        {items.map((it, n) => (
          <PatchRow key={it.observationId} item={it} index={n} units={units} onRecord={() => setOpen(it)} />
        ))}
      </div>

      {open && user && (
        <RecordSheet patch={open} here={here} names={names} userId={user.id}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setVisits(v => ({ ...v, [open.candidateId]: (v[open.candidateId] ?? 0) + 1 }));
            setOpen(null);
          }} />
      )}
    </div>
  );
}

function PatchRow({ item, index, units, onRecord }: { item: WalkItem; index: number; units: ReturnType<typeof useUnitSystem>; onRecord: () => void }) {
  return (
    <Card className="p-3" data-testid="walk-patch">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-sm">#{index + 1} · {item.label}</div>
          <div className="text-xs text-muted-foreground">
            {item.distanceM != null ? `${fmtDistance(item.distanceM, units).text} ${compass(item.bearingDeg ?? 0)}` : "distance unknown"}
            {item.areaM2 ? ` · ${fmtArea(item.areaM2, units).text}` : ""}
            {item.verdict ? ` · marked ${item.verdict.replace("_", " ")}` : ""}
          </div>
        </div>
        {item.visits > 0 && <Badge variant="outline" className="shrink-0"><CheckCircle2 className="h-3 w-3 mr-1" /> {item.visits} visit{item.visits === 1 ? "" : "s"}</Badge>}
      </div>
      <div className="flex gap-2 mt-2">
        <Button size="sm" variant="outline" asChild>
          <a href={directionsUrl(item)} target="_blank" rel="noopener noreferrer"><Navigation className="h-3.5 w-3.5" /> Directions</a>
        </Button>
        <Button size="sm" onClick={onRecord}><Camera className="h-3.5 w-3.5" /> Record what's here</Button>
      </div>
    </Card>
  );
}

function RecordSheet({ patch, here, names, userId, onClose, onSaved }: {
  patch: WalkPatch; here: Position | null; names: string[]; userId: string; onClose: () => void; onSaved: () => void;
}) {
  const [whatIsHere, setWhatIsHere] = useState<WhatIsHere | null>(null);
  const [species, setSpecies] = useState<SpeciesEntry[]>([{ name: "", catalogId: null, coverPct: null, dominant: true }]);
  const [growthStage, setGrowthStage] = useState<GrowthStage | null>(null);
  const [patchCoverPct, setPatchCoverPct] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<Confidence>("likely");
  const [identifiedBy, setIdentifiedBy] = useState<IdentifiedBy>("operator");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const input = { patch, visitor: here, whatIsHere, species, growthStage, patchCoverPct, confidence, identifiedBy, notes };
  const errors = validateGroundTruth(input);
  const previews = useMemo(() => photos.map(f => URL.createObjectURL(f)), [photos]);
  useEffect(() => () => previews.forEach(u => URL.revokeObjectURL(u)), [previews]);

  const setEntry = (i: number, patchE: Partial<SpeciesEntry>) =>
    setSpecies(list => list.map((s, j) => (j === i ? { ...s, ...patchE } : patchE.dominant ? { ...s, dominant: false } : s)));
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const save = async () => {
    if (errors.length) return;
    setSaving(true);
    try {
      const r = await saveGroundTruth(input, userId, photos);
      if (r.photoErrors.length) toast.warning("Saved, but some photos did not upload", { description: r.photoErrors[0] });
      else toast.success("Saved.");
      onSaved();
    } catch (e) {
      toast.error("Could not save", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const chip = (on: boolean) => `text-sm rounded-md border px-3 py-2 text-left ${on ? "border-primary bg-primary/10 font-medium" : "border-border"}`;

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto" data-testid="record-sheet">
      <div className="max-w-xl mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">What is in this patch?</h2>
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
        <p className="text-xs text-muted-foreground">The map called it "{patch.label}". Say what you actually see.</p>

        <div className="grid gap-2">
          {WHAT_IS_HERE.map(w => (
            <button key={w} type="button" className={chip(whatIsHere === w)} onClick={() => setWhatIsHere(w)}>{WHAT_IS_HERE_LABEL[w]}</button>
          ))}
        </div>

        {whatIsHere === "weeds" && (
          <div className="space-y-3">
            <div className="text-sm font-medium">Which weeds?</div>
            <datalist id="gt-names">
              {[UNKNOWN_WEED, ...names].map(n => <option key={n} value={n} />)}
            </datalist>
            {species.map((s, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input className="flex-1 border rounded-md p-2 text-sm bg-background" list="gt-names" placeholder="Weed name (type, or pick)"
                  value={s.name} onChange={e => setEntry(i, { name: e.target.value })} />
                <input className="w-20 border rounded-md p-2 text-sm bg-background" inputMode="numeric" placeholder="% cover"
                  value={s.coverPct ?? ""} onChange={e => setEntry(i, { coverPct: num(e.target.value) })} />
                <label className="text-xs inline-flex items-center gap-1"><input type="radio" checked={s.dominant} onChange={() => setEntry(i, { dominant: true })} /> main</label>
                {species.length > 1 && (
                  <button type="button" onClick={() => setSpecies(list => list.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="h-4 w-4 text-muted-foreground" /></button>
                )}
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setSpecies(l => [...l, { name: "", catalogId: null, coverPct: null, dominant: false }])}><Plus className="h-3.5 w-3.5" /> Another weed</Button>
            <div>
              <div className="text-sm font-medium mb-1">Growth stage</div>
              <div className="flex flex-wrap gap-2">
                {GROWTH_STAGES.map(g => <button key={g} type="button" className={chip(growthStage === g)} onClick={() => setGrowthStage(g)}>{g}</button>)}
              </div>
            </div>
          </div>
        )}

        {whatIsHere && (
          <>
            <div>
              <div className="text-sm font-medium mb-1">How much of the patch does it cover?</div>
              <input className="w-28 border rounded-md p-2 text-sm bg-background" inputMode="numeric" placeholder="%"
                value={patchCoverPct ?? ""} onChange={e => setPatchCoverPct(num(e.target.value))} />
            </div>
            <div>
              <div className="text-sm font-medium mb-1">How sure are you?</div>
              <div className="flex gap-2">
                {(["certain", "likely", "unsure"] as Confidence[]).map(c => <button key={c} type="button" className={chip(confidence === c)} onClick={() => setConfidence(c)}>{c}</button>)}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium mb-1">Who identified it?</div>
              <div className="flex gap-2">
                {(["operator", "agronomist", "other"] as IdentifiedBy[]).map(c => <button key={c} type="button" className={chip(identifiedBy === c)} onClick={() => setIdentifiedBy(c)}>{c === "operator" ? "me" : c}</button>)}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium mb-1">Photos</div>
              <label className="inline-flex items-center gap-2 border rounded-md px-3 py-2 text-sm cursor-pointer">
                <Camera className="h-4 w-4" /> Take or add photos
                <input type="file" accept="image/*" capture="environment" multiple className="hidden"
                  onChange={e => { const f = e.target.files ? Array.from(e.target.files) : []; e.target.value = ""; setPhotos(p => [...p, ...f]); }} />
              </label>
              {previews.length > 0 && (
                <div className="flex gap-2 flex-wrap mt-2">
                  {previews.map((u, i) => (
                    <div key={u} className="relative">
                      <img src={u} alt="" className="h-20 w-20 object-cover rounded-md" />
                      <button type="button" className="absolute top-0 right-0 bg-background/80 rounded-bl-md p-0.5" aria-label="Remove photo"
                        onClick={() => setPhotos(p => p.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1">One close-up of the plants and one wide shot of the patch help most.</p>
            </div>
            <textarea className="w-full border rounded-md p-2 text-sm bg-background" rows={3} placeholder="Notes (optional)" maxLength={1000}
              value={notes} onChange={e => setNotes(e.target.value)} />
          </>
        )}

        {errors.length > 0 && whatIsHere && <ul className="text-xs text-destructive list-disc pl-4">{errors.map(e => <li key={e}>{e}</li>)}</ul>}
        <Button className="w-full" disabled={!!errors.length || saving} onClick={save}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Save this patch
        </Button>
        {!here && <p className="text-xs text-muted-foreground">Your position is unknown, so this record will not say where you stood.</p>}
      </div>
    </div>
  );
}
