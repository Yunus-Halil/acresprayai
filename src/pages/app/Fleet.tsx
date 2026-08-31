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
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plane, Plus, Battery, Trash2, Sparkles, Loader2, ExternalLink, PencilRuler } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from "recharts";
import { toast } from "sonner";
import { z } from "zod";
import {
  DRONE_SPECS, DRONE_SPEC_KNOWN, drainPerMin, resolveDroneSpec, roleLabel, specSheet,
} from "@/lib/droneSpecs";
import {
  type AircraftEntry, type AircraftOverride, type AircraftRole, type CustomAircraft,
  aircraftById, aircraftByMake, customModelLabel, EMPTY_CUSTOM_AIRCRAFT,
  isSprayer, missingSeededFields, rolesLabel, validateCustomAircraft,
} from "@/lib/aircraftDirectory";

type Drone = {
  id: string; name: string; model: string;
  battery: number; signal: number; health: number; status: string;
  serial?: string | null; notes?: string | null; specs?: any;
};

/** The sentinel the model picker uses for "this aircraft is not in the list". */
const CUSTOM_CHOICE = "__custom__";

const schema = z.object({
  name: z.string().trim().min(2, "Name too short").max(40),
  model: z.string().min(1),
  battery: z.number().int().min(0).max(100),
  serial: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(500).optional(),
});

// Straight-line depletion from the drone's current charge. `drainPerMin` is
// derived from the same `max_flight_min` the flight planner budgets against, so
// this forecast and the planner's battery estimate describe one aircraft.
function forecast(d: Drone) {
  const { spec } = resolveDroneSpec(d.model, d.specs ?? null);
  const drain = drainPerMin(spec);
  const out: { t: number; battery: number }[] = [];
  for (let t = 0; t <= 60; t++) {
    const bat = Math.max(0, d.battery - drain * t);
    out.push({ t, battery: +bat.toFixed(1) });
  }
  const recallAt = out.find(p => p.battery <= 25)?.t ?? null;
  return { series: out, recallAt, role: roleLabel(spec) };
}

const statusColor = (s: string) =>
  s === "in_flight" ? "border-sky-500 text-sky-500" :
  s === "charging" ? "border-amber-500 text-amber-600" :
  "border-emerald-500 text-emerald-600";

/** Text input that reads back "" for an unset number instead of 0. */
function numText(n: number | null): string {
  return n == null ? "" : String(n);
}
function parseNum(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export default function Fleet() {
  const { user } = useAuth();
  const [drones, setDrones] = useState<Drone[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Drone | null>(null);

  const groups = useMemo(() => aircraftByMake(), []);
  const [form, setForm] = useState({
    name: "", choice: "DJI Agras T40", battery: 100, serial: "", notes: "",
  });
  // Operator-entered figures. Two shapes, deliberately separate: `custom` is a
  // whole airframe the operator described, `seededOverride` is the one or two
  // numbers a seeded airframe's maker never published. Neither is ever
  // pre-filled from a "similar" model.
  const [custom, setCustom] = useState<CustomAircraft>(EMPTY_CUSTOM_AIRCRAFT);
  const [seededOverride, setSeededOverride] = useState<AircraftOverride>({
    kind: "override", tank_l: null, swath_m: null,
  });

  const isCustomChoice = form.choice === CUSTOM_CHOICE;
  const entry: AircraftEntry | null = isCustomChoice ? null : aircraftById(form.choice);
  const missing = entry ? missingSeededFields(entry, seededOverride) : { tank: false, swath: false };

  const resetForm = () => {
    setForm({ name: "", choice: "DJI Agras T40", battery: 100, serial: "", notes: "" });
    setCustom(EMPTY_CUSTOM_AIRCRAFT);
    setSeededOverride({ kind: "override", tank_l: null, swath_m: null });
  };

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

    // What actually gets stored: a model string that resolves, plus whatever
    // the operator had to supply because nobody published it.
    let model: string;
    let specs: CustomAircraft | AircraftOverride;
    if (isCustomChoice) {
      const errors = validateCustomAircraft(custom);
      if (errors.length) { toast.error(errors[0]); return; }
      model = customModelLabel(custom);
      specs = { ...custom, make: custom.make.trim(), model: custom.model.trim() };
    } else {
      if (!entry) { toast.error("Pick an aircraft."); return; }
      if (missing.tank) {
        toast.error("Enter the tank capacity", {
          description: `${entry.make} no longer publishes a capacity for the ${entry.model}. Spray reports reconcile logged volume against it, so it cannot be left blank.`,
        });
        return;
      }
      model = entry.id;
      specs = seededOverride;
    }

    const parsed = schema.safeParse({
      name: form.name,
      model,
      battery: Number(form.battery),
      serial: form.serial || undefined,
      notes: form.notes || undefined,
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
      signal: 100,
      health: 100,
      status: "idle",
      serial: parsed.data.serial ?? null,
      notes: parsed.data.notes ?? null,
      specs: specs as any,
    } as any).select().single();
    if (error) {
      toast.error("Couldn't add the drone", {
        description: `Nothing was saved. Check your connection and try again. (${error.message})`,
      });
      return;
    }
    toast.success("Drone added · forecasting telemetry");
    setActive(data as any);
    setOpen(false);
    resetForm();
    load();
  };

  const remove = async (id: string) => {
    await supabase.from("drones").delete().eq("id", id);
    if (active?.id === id) setActive(null);
    load();
  };

  const f = useMemo(() => active ? forecast(active) : null, [active]);
  const activeResolved = useMemo(
    () => active ? resolveDroneSpec(active.model, active.specs ?? null) : null,
    [active],
  );

  // The spec card in the dialog. For a seeded aircraft this is the resolved
  // spec plus whatever the operator has typed so far; for a custom one it is
  // only what they typed, because there is nothing else it could honestly be.
  const previewResolved = useMemo(() => {
    if (isCustomChoice) return resolveDroneSpec(null, custom);
    return resolveDroneSpec(form.choice, seededOverride);
  }, [isCustomChoice, form.choice, custom, seededOverride]);

  const toggleRole = (role: AircraftRole) =>
    setCustom(c => ({
      ...c,
      roles: c.roles.includes(role) ? c.roles.filter(r => r !== role) : [...c.roles, role],
    }));

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl">Drone Fleet</h1>
          <p className="text-muted-foreground">Register a drone with its current battery. We'll forecast endurance and the safe-recall window for the next 60 minutes.</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
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
                  <Label>Aircraft</Label>
                  <Select value={form.choice} onValueChange={v => setForm({ ...form, choice: v })}>
                    <SelectTrigger data-testid="aircraft-picker"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-[60vh]">
                      {/* Custom sits at the top, above every make, because an
                          operator whose aircraft is not on the list should find
                          the way in before they have scrolled past thirty that
                          are not theirs. */}
                      <SelectItem value={CUSTOM_CHOICE}>
                        <span className="flex items-center gap-2">
                          <PencilRuler className="h-3.5 w-3.5" /> Custom aircraft…
                        </span>
                      </SelectItem>
                      <SelectSeparator />
                      {groups.map(g => (
                        <SelectGroup key={g.make}>
                          <SelectLabel>{g.make}</SelectLabel>
                          {g.aircraft.map(a => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.model}
                              {a.status === "legacy" && (
                                <span className="text-muted-foreground"> · discontinued</span>
                              )}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* ---- Custom aircraft --------------------------------------- */}
              {isCustomChoice && (
                <div className="rounded-md border p-3 space-y-3" data-testid="custom-aircraft-fields">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Custom aircraft</Label>
                    <Badge variant="outline" className="text-[10px]">Your figures</Badge>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <Label>Make</Label>
                      <Input maxLength={40} value={custom.make} placeholder="e.g. Hylio"
                        onChange={e => setCustom({ ...custom, make: e.target.value })} />
                    </div>
                    <div>
                      <Label>Model</Label>
                      <Input maxLength={40} value={custom.model} placeholder="e.g. AG-118"
                        onChange={e => setCustom({ ...custom, model: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">This aircraft</Label>
                    <div className="flex gap-2 mt-1.5">
                      {(["spray", "mapping"] as AircraftRole[]).map(r => (
                        <Button key={r} type="button" size="sm"
                          variant={custom.roles.includes(r) ? "default" : "outline"}
                          onClick={() => toggleRole(r)}>
                          {r === "spray" ? "Sprays" : "Maps"}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <Label>
                        Tank capacity (L)
                        {custom.roles.includes("spray")
                          ? <span className="text-destructive"> *</span>
                          : <span className="text-muted-foreground font-normal"> (not applicable)</span>}
                      </Label>
                      <Input type="number" min={0} step="any" inputMode="decimal"
                        disabled={!custom.roles.includes("spray")}
                        value={numText(custom.tank_l)} placeholder="Enter from your aircraft"
                        onChange={e => setCustom({ ...custom, tank_l: parseNum(e.target.value) })} />
                    </div>
                    <div>
                      <Label>Swath width (m) <span className="text-muted-foreground font-normal">(optional)</span></Label>
                      <Input type="number" min={0} step="any" inputMode="decimal"
                        disabled={!custom.roles.includes("spray")}
                        value={numText(custom.swath_m)} placeholder="Leave blank if unsure"
                        onChange={e => setCustom({ ...custom, swath_m: parseNum(e.target.value) })} />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Nothing here is filled in from a similar model. Spray reports reconcile the
                    volume you log against tank capacity times refills, so the capacity has to be
                    the one on your aircraft, and a swath you did not state is better than one we
                    invented.
                  </p>
                </div>
              )}

              {/* ---- Seeded aircraft: what the maker publishes -------------- */}
              {entry && (
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                        {entry.make} {entry.model} · {rolesLabel(entry.roles)}
                      </Label>
                      <Badge variant="outline" className="text-[10px]">
                        {entry.verified ? `Manufacturer figures · read ${entry.verified}` : "Not verified"}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {specSheet(previewResolved.spec, previewResolved.known).map(s => (
                        <div key={s.k} className="rounded-md border bg-muted/30 p-2">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.k}</div>
                          <div className="text-xs font-medium leading-tight mt-0.5">{s.v}</div>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                      {entry.note}
                      {entry.source && (
                        <>
                          {" "}
                          <a href={entry.source} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-0.5 underline underline-offset-2">
                            Source <ExternalLink className="h-3 w-3" />
                          </a>
                        </>
                      )}
                    </p>
                  </div>

                  {/* Only asked for when the maker genuinely publishes nothing. */}
                  {isSprayer(entry) && (entry.tank_l == null || entry.swath_m == null) && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-3"
                         data-testid="seeded-override-fields">
                      <div className="text-[11px] leading-relaxed">
                        {entry.make} does not publish
                        {entry.tank_l == null && entry.swath_m == null
                          ? " a tank capacity or a single swath figure"
                          : entry.tank_l == null ? " a tank capacity" : " a single swath figure"}
                        {" "}for this aircraft, so read it off yours rather than inheriting one from a
                        {" "}model that looks close.
                      </div>
                      <div className="grid sm:grid-cols-2 gap-3">
                        {entry.tank_l == null && (
                          <div>
                            <Label>Tank capacity (L) <span className="text-destructive">*</span></Label>
                            <Input type="number" min={0} step="any" inputMode="decimal"
                              value={numText(seededOverride.tank_l)} placeholder="Enter from your aircraft"
                              onChange={e => setSeededOverride({ ...seededOverride, tank_l: parseNum(e.target.value) })} />
                          </div>
                        )}
                        {entry.swath_m == null && (
                          <div>
                            <Label>Swath width (m) <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Input type="number" min={0} step="any" inputMode="decimal"
                              value={numText(seededOverride.swath_m)} placeholder={
                                entry.swath_published_m
                                  ? `Published range ${entry.swath_published_m[0]}-${entry.swath_published_m[1]} m`
                                  : "Leave blank if unsure"
                              }
                              onChange={e => setSeededOverride({ ...seededOverride, swath_m: parseNum(e.target.value) })} />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

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
            <button key={d.id} type="button" onClick={() => setActive(d)}
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
          {!active || !f || !activeResolved ? (
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
                      <ReferenceLine x={f.recallAt} stroke="#fb923c" strokeWidth={2} strokeDasharray="2 4" label={{ value: "Recall", fontSize: 10, fill: "#fb923c", position: "insideTopRight" }} />
                    )}
                    <Line type="monotone" dataKey="battery" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Battery" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* The registered aircraft's specs, labelled by where they came
                  from. An operator comparing two drones needs to know which
                  numbers are the maker's, which are theirs, and which are the
                  fallback shape standing in for a figure nobody published. */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                {specSheet(activeResolved.spec, activeResolved.known).map(s => (
                  <div key={s.k} className="rounded-md border bg-muted/30 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.k}</div>
                    <div className="text-xs font-medium leading-tight mt-0.5">{s.v}</div>
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground mt-3">
                Forecast based on the {active.model}'s typical draw at current battery {active.battery}%. Recall is triggered when battery reaches the 25% safety threshold.
                {!activeResolved.known.has("max_flight_min") && (
                  <> Flight time for this aircraft is not published, so the forecast runs on the generic {DRONE_SPECS["Custom"].max_flight_min}-minute fallback and should be treated as a shape, not a number.</>
                )}
              </p>
              {activeResolved.spec.role === "sprayer" && !activeResolved.known.has("tank_l") && (
                <p className="text-xs text-amber-600 mt-2">
                  No tank capacity on file for this aircraft. Spray reports reconcile logged volume
                  against capacity times refills, and that check cannot run until one is set.
                </p>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
