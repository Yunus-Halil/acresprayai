// Extracted from OrthomosaicViewer.tsx. Mechanical move only - no
// behaviour changes. See docs/features/workspace.md.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowLeft, ChevronUp, ChevronDown, Eye, EyeOff,
  Layers, Image as ImageIcon, Ruler, Settings,
  Maximize2, Plus, Minus, Loader2, MapPin, Activity,
  Sparkles, Download, AlertTriangle, X, Plane, CloudSun,
  FileBarChart, Map as MapIcon, Bot, Pencil, Cloud,
  Wind, Droplets, ThermometerSun, CloudRain, Sun, CloudSnow, CloudFog,
  CheckCircle2, XCircle, Trash2, Hexagon,
  Play, Pause, RotateCcw, FastForward, History,
} from "lucide-react";
import UserPolygonTool, { type DraftPolygon } from "@/components/app/UserPolygonTool";
import ReportsTab from "@/components/app/ReportsTab";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  costPerAreaToPerAcre, costPerAreaValue, costPerAreaUnit,
} from "@/lib/units";
import { setUnitSystem, useUnitSystem } from "@/hooks/useUnitSystem";
import {
  type DroneSpec, DRONE_SPECS, resolveDroneSpec,
} from "@/lib/droneSpecs";
import {
  type AiZone, type CustomInput, type FarmerSettings, type LastFlownMission,
  COST_MAP, CURRENCIES, DEFAULT_FARMER_SETTINGS, INPUT_LABELS, currencySymbol,
  growthStage, issueToCostKey, mergeFarmerSettings, normalizeBoundary,
} from "@/lib/farmerSettings";
import {
  type LatLng2,
  M_PER_DEG_LAT,
  bboxOfRings, centroidOfRings, centroidSafe, distM, lerp, mPerDegLng,
  pointInAnyRing, pointInRing, polygonAreaM2, polylineLengthM,
  principalAxisAngle, ringContaining, ringsAreaM2, rotateLL,
  routeInsideBoundary, segRingIntersections, segSegT, segmentInsideRings,
} from "@/lib/geo";
import {
  type Mission, type MissionAction, type MissionParams, type MissionWP,
  buildFieldSweep, buildMission, exportMissionFile,
} from "@/lib/mission";
import {
  type BoundaryRing, type FieldRow, type TaskRow,
} from "./types";
import { FN_BASE, NDVI_BASE, TILE_BASE } from "./constants";
import {
  type Annotation, type LayerState, type MeasureStats, type UserPoly,
  AiZonesLayer, AnnotateTool, BoundaryTool, FitBounds, LayerRow, MapControls,
  MeasurePanel, MeasureTool, MouseReadout, USER_POLY_ISSUES, UserPolyLayer,
  escapeHtml, loadAnnotations, saveAnnotations, sevColor,
} from "./layers";


export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">{label}</div>
      {children}
    </label>
  );
}
export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-neutral-800/60 last:border-0">
      <span className="text-neutral-400">{label}</span>
      <span className="text-neutral-200 font-mono">{value}</span>
    </div>
  );
}

// =============================== Settings tab ===============================
export const CROP_OPTIONS = [
  "Wheat", "Corn", "Soybeans", "Cotton", "Rice", "Barley", "Oats", "Sorghum", "Other",
];

export function SettingsTab({
  settings, onSave, saving, savedAt, fieldAreaHa,
}: {
  settings: FarmerSettings;
  onSave: (s: FarmerSettings) => Promise<void> | void;
  saving: boolean;
  savedAt: number | null;
  fieldAreaHa: number | null;
}) {
  const [local, setLocal] = useState<FarmerSettings>(settings);
  useEffect(() => { setLocal(settings); }, [settings]);

  const units = useUnitSystem();
  // Costs are stored per acre at full precision. Rounding only what is SHOWN
  // keeps a metric farmer's typed 111.20 from drifting the stored 45.
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const update = (patch: Partial<FarmerSettings>) => setLocal(s => ({ ...s, ...patch }));
  const updateCost = (k: keyof FarmerSettings["input_costs"], v: number) =>
    setLocal(s => ({ ...s, input_costs: { ...s.input_costs, [k]: v } }));
  const updateAvail = (k: keyof FarmerSettings["available_inputs"], v: boolean) =>
    setLocal(s => ({ ...s, available_inputs: { ...s.available_inputs, [k]: v } }));
  const updateCustom = (i: number, patch: Partial<CustomInput>) =>
    setLocal(s => {
      const next = s.custom_inputs.slice();
      next[i] = { ...next[i], ...patch };
      return { ...s, custom_inputs: next };
    });
  const addCustom = () =>
    setLocal(s => s.custom_inputs.length >= 3 ? s
      : { ...s, custom_inputs: [...s.custom_inputs, { name: "", cost: 0 }] });
  const removeCustom = (i: number) =>
    setLocal(s => ({ ...s, custom_inputs: s.custom_inputs.filter((_, idx) => idx !== i) }));

  const acresFromBoundary = fieldAreaHa ? fieldAreaHa * 2.4710538 : null;
  const dirty = JSON.stringify(local) !== JSON.stringify(settings);
  const gs = growthStage(local.crop_type, local.planting_date);

  const inputCls = "w-full bg-[#0f0f0f] border border-[#222] rounded-sm px-2.5 py-1.5 text-sm text-[#f0f0f0] focus:outline-none focus:border-[#4CAF50]";
  const labelCls = "text-[10px] uppercase tracking-wider text-neutral-500 mb-1 block";

  return (
    <div className="absolute inset-0 overflow-y-auto" style={{ background: "#0f0f0f" }}>
      <div className="max-w-4xl mx-auto p-6 pb-24 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Field Settings</h1>
            <p className="text-xs text-neutral-500 mt-1">Drives cost calculations and AI recommendations for this field.</p>
          </div>
          <div className="flex items-center gap-2">
            {savedAt && !dirty && !saving && (
              <span className="text-[11px] text-[#4CAF50]">Saved {new Date(savedAt).toLocaleTimeString()}</span>
            )}
            <button
              disabled={!dirty || saving}
              onClick={() => onSave(local)}
              className="text-xs bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-40 disabled:cursor-not-allowed text-black rounded-sm px-4 py-2 font-semibold inline-flex items-center gap-2"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </button>
          </div>
        </div>

        {/* Crop info */}
        <section className="rounded-sm border border-[#222] p-5" style={{ background: "#161616" }}>
          <h2 className="text-sm font-semibold mb-1">1. Crop Information</h2>
          <p className="text-[11px] text-neutral-500 mb-4">Used to estimate growth stage and tune AI recommendations.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Crop type</label>
              <select className={inputCls} value={local.crop_type}
                onChange={e => update({ crop_type: e.target.value })}>
                <option value="">, Select crop ,</option>
                {CROP_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Field size (acres)</label>
              <input
                type="number" min={0} step="0.01"
                className={inputCls}
                placeholder={acresFromBoundary ? acresFromBoundary.toFixed(2) : "Not defined yet"}
                value={local.area_acres_override ?? ""}
                onChange={e => update({ area_acres_override: e.target.value === "" ? null : Number(e.target.value) })}
              />
              <div className="text-[10px] text-neutral-500 mt-1">
                {acresFromBoundary
                  ? `Boundary calc: ${acresFromBoundary.toFixed(2)} ac · leave blank to use this.`
                  : "Define a boundary on the Field View to auto-fill."}
              </div>
            </div>
            <div>
              <label className={labelCls}>Planting date</label>
              <input type="date" className={inputCls} value={local.planting_date}
                onChange={e => update({ planting_date: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Expected harvest date</label>
              <input type="date" className={inputCls} value={local.harvest_date}
                onChange={e => update({ harvest_date: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Units</label>
              <div className="inline-flex rounded-sm border border-[#222] bg-[#0f0f0f] overflow-hidden">
                {([
                  { v: "imperial", label: "Imperial (acres · gal)" },
                  { v: "metric",   label: "Metric (hectares · L)" },
                ] as const).map(o => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => { setUnitSystem(o.v); update({ unit_system: o.v }); }}
                    className={`px-3 py-1.5 text-xs ${local.unit_system === o.v
                      ? "bg-[#4CAF50] text-black font-semibold"
                      : "text-neutral-400 hover:text-neutral-200"}`}
                  >{o.label}</button>
                ))}
              </div>
              <div className="text-[10px] text-neutral-500 mt-1">
                Applies everywhere, areas, volumes, rates, altitudes, speeds and
                temperatures across the whole app. Display only: your stored figures
                never change, so switching can never alter a dose or a bill.
              </div>
            </div>
          </div>
          {gs && (
            <div className="mt-3 text-[11px] text-neutral-400">
              Growth stage estimate: <span className="text-[#4CAF50]">{gs}</span>
            </div>
          )}
        </section>

        {/* Input costs */}
        <section className="rounded-sm border border-[#222] p-5" style={{ background: "#161616" }}>
          <h2 className="text-sm font-semibold mb-1">2. Input Costs <span className="text-neutral-500 font-normal">(per {units === "metric" ? "hectare" : "acre"})</span></h2>
          <p className="text-[11px] text-neutral-500 mb-3">Uncheck inputs you don't carry. The AI will avoid recommending them.</p>

          {/* Currency relabels, it never converts: these are the prices you
              typed, in the currency you actually buy in. */}
          <div className="flex items-center gap-3 mb-4 pb-3 border-b border-[#222]">
            <label className="text-[11px] uppercase tracking-wider text-neutral-500">Currency</label>
            <select
              className={`${inputCls} w-56`}
              value={local.currency ?? "USD"}
              onChange={e => setLocal(s => ({ ...s, currency: e.target.value }))}
            >
              {CURRENCIES.map(c => (
                <option key={c.code} value={c.code}>{c.code}, {c.label}</option>
              ))}
            </select>
            <span className="text-[11px] text-neutral-600">
              Changes the label only, your prices are not converted.
            </span>
          </div>
          <div className="space-y-2">
            {(Object.keys(local.input_costs) as (keyof FarmerSettings["input_costs"])[]).map(k => (
              <div key={k} className="grid grid-cols-[24px_1fr_140px] gap-3 items-center">
                <input type="checkbox" checked={local.available_inputs[k]}
                  onChange={e => updateAvail(k, e.target.checked)}
                  className="h-4 w-4 accent-[#4CAF50]" />
                <div className={`text-sm ${local.available_inputs[k] ? "text-[#f0f0f0]" : "text-neutral-600 line-through"}`}>
                  {INPUT_LABELS[k]}
                </div>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500 text-xs">{currencySymbol(local.currency)}</span>
                  {/* Shown in the viewer's units, ALWAYS stored per acre.
                      This is an input, not a readout, so the conversion has to
                      run in both directions, otherwise the first edit a metric
                      farmer makes multiplies that price by 2.47. */}
                  <input type="number" min={0} step="0.01"
                    className={`${inputCls} pl-5 pr-9 text-right font-mono`}
                    value={round2(costPerAreaValue(local.input_costs[k], units))}
                    onChange={e => updateCost(k, costPerAreaToPerAcre(Number(e.target.value) || 0, units))}
                    disabled={!local.available_inputs[k]}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-600 text-[10px] font-mono pointer-events-none">
                    {costPerAreaUnit(units)}
                  </span>
                </div>
              </div>
            ))}

            <div className="pt-3 mt-3 border-t border-[#222]">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] uppercase tracking-wider text-neutral-500">Custom inputs ({local.custom_inputs.length}/3)</div>
                <button onClick={addCustom} disabled={local.custom_inputs.length >= 3}
                  className="text-[11px] text-[#4CAF50] hover:underline disabled:text-neutral-600 disabled:no-underline disabled:cursor-not-allowed inline-flex items-center gap-1">
                  <Plus className="h-3 w-3" /> Add custom
                </button>
              </div>
              {local.custom_inputs.length === 0 && (
                <div className="text-[11px] text-neutral-600">No custom inputs.</div>
              )}
              {local.custom_inputs.map((c, i) => (
                <div key={i} className="grid grid-cols-[24px_1fr_140px_28px] gap-3 items-center mb-2">
                  <span />
                  <input className={inputCls} placeholder="Custom input name"
                    value={c.name} onChange={e => updateCustom(i, { name: e.target.value })} />
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500 text-xs">{currencySymbol(local.currency)}</span>
                    <input type="number" min={0} step="0.01"
                      className={`${inputCls} pl-5 text-right font-mono`}
                      value={c.cost} onChange={e => updateCustom(i, { cost: Number(e.target.value) || 0 })} />
                  </div>
                  <button onClick={() => removeCustom(i)}
                    className="h-7 w-7 grid place-items-center rounded-sm text-neutral-500 hover:text-red-400 hover:bg-[#1f1f1f]">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it's used */}
        <section className="rounded-sm border border-[#222] p-5" style={{ background: "#161616" }}>
          <h2 className="text-sm font-semibold mb-3">3. How these settings are used</h2>
          <ul className="text-[12px] text-neutral-400 space-y-1.5 list-disc pl-5">
            <li>Treatment zones detected by AI Analysis are priced as <span className="font-mono text-neutral-200">{units === "metric" ? "hectares × your per-hectare cost" : "acres × your per-acre cost"}</span>.</li>
            <li>Issues map to inputs via a fixed table (e.g. <span className="text-neutral-300">bare soil → reseeding</span>, <span className="text-neutral-300">nitrogen deficiency → nitrogen fertilizer</span>).</li>
            <li>The AI is told which inputs you carry. It won't recommend a product you don't have available.</li>
            <li>Waterlogged zones show "Drainage work required, consult agronomist" instead of a cost.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

// ============= Log Flight (Spray Log) modal ==============================
// Captures the audit-trail record after a real mission is flown. Writes a
// row to public.flight_logs and updates the drone's stored battery so the
// planner pre-fills "Pre-flight battery" with the last known landed value.
export function LogFlightModal({
  open, onOpenChange, fieldId, scanId, droneId, droneName,
  batteryStart, zones, totalAcres, estLiters, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fieldId: string | null;
  scanId: string;
  droneId: string | null;
  droneName: string | null;
  batteryStart: number;
  zones: { id: string; label: string; issue: string | null; acres: number }[];
  totalAcres: number;
  estLiters: number | null;
  onSaved: (log: LastFlownMission) => void | Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [dateFlown, setDateFlown] = useState(today);
  const [batteryEnd, setBatteryEnd] = useState<number>(25);
  const [refills, setRefills] = useState<number>(0);
  const [completed, setCompleted] = useState<Set<string>>(() => new Set(zones.map(z => z.id)));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset whenever the modal is reopened so the zone list / starting battery
  // reflect the current mission.
  useEffect(() => {
    if (!open) return;
    setDateFlown(today);
    setBatteryEnd(Math.max(0, Math.min(batteryStart, 25)));
    setRefills(0);
    setCompleted(new Set(zones.map(z => z.id)));
    setNotes("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleZone = (id: string) => {
    setCompleted(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const acresDone = zones
    .filter(z => completed.has(z.id))
    .reduce((a, z) => a + z.acres, 0);
  const coverageRatio = totalAcres > 0 ? Math.min(1, acresDone / totalAcres) : 1;
  const litersDone = estLiters != null ? estLiters * (refills + 1) * coverageRatio : null;

  const save = async () => {
    if (!fieldId || saving) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Not signed in", { description: "Please log in to save flight logs." });
        setSaving(false);
        return;
      }
      const snapshotBase: LastFlownMission = {
        id: `field-snapshot-${fieldId}-${Date.now()}`,
        source: "field_snapshot",
        field_id: fieldId,
        scan_id: scanId,
        drone_id: droneId,
        date_flown: dateFlown,
        battery_start: batteryStart,
        battery_end: batteryEnd,
        tank_refills: refills,
        zones_completed: Array.from(completed),
        acres_treated: +acresDone.toFixed(2),
        liters_applied: litersDone != null ? +litersDone.toFixed(2) : null,
        notes: notes.trim() || null,
        created_at: new Date().toISOString(),
      };
      const row = {
        user_id: user.id,
        field_id: snapshotBase.field_id,
        scan_id: snapshotBase.scan_id,
        drone_id: snapshotBase.drone_id,
        date_flown: snapshotBase.date_flown,
        battery_start: snapshotBase.battery_start,
        battery_end: snapshotBase.battery_end,
        tank_refills: snapshotBase.tank_refills,
        zones_completed: snapshotBase.zones_completed,
        acres_treated: snapshotBase.acres_treated,
        liters_applied: snapshotBase.liters_applied,
        notes: snapshotBase.notes,
      };
      const { data: inserted, error } = await supabase.from("flight_logs")
        .insert(row)
        .select("id, field_id, scan_id, drone_id, date_flown, battery_start, battery_end, tank_refills, zones_completed, acres_treated, liters_applied, notes, created_at")
        .single();
      if (error) {
        // Keep the user flow unblocked: the field-level snapshot is what the
        // Reports tab actually needs. We still surface the database issue in
        // console for debugging, but do not lose the mission values.
        console.warn("[flight_logs] insert failed; using field snapshot fallback", error);
      }

      // Update drone battery so next planner session pre-fills with landed %.
      if (droneId) {
        await supabase.from("drones").update({ battery: batteryEnd }).eq("id", droneId);
      }
      const savedLog: LastFlownMission = inserted
        ? { ...(inserted as LastFlownMission), source: "flight_logs" }
        : snapshotBase;
      toast.success(inserted ? "Flight logged" : "Mission saved to field", {
        description: `${acresDone.toFixed(2)} ac recorded for ${dateFlown}.`,
      });
      await onSaved(savedLog);
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Couldn't save flight log", { description: e?.message ?? String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0f0f0f] border-[#1f1f1f] text-neutral-200 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-4 w-4 text-[#4CAF50]" />
            Mission Complete, Log Flight
          </DialogTitle>
          <p className="text-[11px] text-neutral-500 mt-1">
            This becomes part of the spray log, a timestamped record for compliance and audit.
          </p>
        </DialogHeader>

        <div className="space-y-4">
          {/* Date */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Date flown</div>
            <input
              type="date"
              value={dateFlown}
              max={today}
              onChange={e => setDateFlown(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1.5 text-sm font-mono text-neutral-200"
            />
          </div>

          {/* Battery */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">Battery used</div>
              <div className="text-[11px] font-mono text-neutral-400">
                Started {batteryStart}% → Landed <span className="text-neutral-100">{batteryEnd}%</span>
              </div>
            </div>
            <input
              type="range" min={0} max={100} step={1}
              value={batteryEnd}
              onChange={e => setBatteryEnd(Number(e.target.value))}
              className={`w-full ${batteryEnd < 20 ? "accent-red-500" : "accent-[#4CAF50]"}`}
            />
            {batteryEnd < 20 && (
              <div className="mt-1 text-[10px] text-red-400">Landed below 20%, pushing the battery limit.</div>
            )}
          </div>

          {/* Tank refills */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Tank refills</div>
            <div className="flex gap-2">
              {[0, 1, 2, 3].map(n => (
                <button
                  key={n}
                  onClick={() => setRefills(n)}
                  className={`flex-1 py-1.5 text-xs font-mono rounded-sm border transition-colors ${
                    refills === n
                      ? "bg-[#4CAF50] text-black border-[#4CAF50]"
                      : "bg-[#0a0a0a] border-[#222] text-neutral-400 hover:border-[#333]"
                  }`}
                >
                  {n === 3 ? "3+" : n}
                </button>
              ))}
            </div>
          </div>

          {/* Zones completed */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Zones completed</div>
            {zones.length === 0 ? (
              <div className="text-[11px] text-neutral-500 italic">No zones in this mission.</div>
            ) : (
              <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                {zones.map((z, i) => {
                  const done = completed.has(z.id);
                  return (
                    <label
                      key={z.id}
                      className="flex items-center gap-2 text-[12px] bg-[#0a0a0a] border border-[#1a1a1a] rounded-sm px-2 py-1.5 cursor-pointer hover:border-[#2a2a2a]"
                    >
                      <input
                        type="checkbox" checked={done}
                        onChange={() => toggleZone(z.id)}
                        className="accent-[#4CAF50]"
                      />
                      <span className="flex-1 truncate">
                        Zone {i + 1}, {z.issue ?? z.label}
                      </span>
                      <span className="font-mono text-neutral-500">{z.acres.toFixed(2)} ac</span>
                    </label>
                  );
                })}
              </div>
            )}
            <div className="mt-2 text-[11px] text-neutral-500 flex justify-between">
              <span>Treated</span>
              <span className="font-mono text-neutral-300">
                {acresDone.toFixed(2)} ac
                {litersDone != null && <> · {litersDone.toFixed(1)} L (est.)</>}
              </span>
            </div>
          </div>

          {/* Notes */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Pilot notes (optional)</div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Wind picked up over zone 2, skipped the back corner…"
              className="w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1.5 text-[12px] text-neutral-200 placeholder:text-neutral-600 resize-none"
            />
          </div>

          {droneName && (
            <div className="text-[10px] text-neutral-500">
              Will update <span className="text-neutral-400">{droneName}</span>'s stored battery to {batteryEnd}%.
            </div>
          )}
          {!fieldId && (
            <div className="text-[10px] text-amber-400">
              Field reference missing, cannot save without a field.
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <button
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="px-3 py-1.5 text-xs rounded-sm border border-[#222] text-neutral-400 hover:bg-[#1a1a1a]"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !fieldId}
            className="px-3 py-1.5 text-xs font-semibold rounded-sm bg-[#4CAF50] hover:bg-[#43a047] text-black disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Flight Log"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SettingsTab;
