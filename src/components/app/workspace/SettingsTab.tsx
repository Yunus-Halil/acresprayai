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
  fmtAreaAc, fmtVolume, tempFFromShown, tempFShown, tempUnit,
  volumeToLitres, volumeUnit, volumeValue, windMphFromShown, windMphShown, windUnit,
} from "@/lib/units";
import { setUnitSystem, useUnitSystem } from "@/hooks/useUnitSystem";
import {
  type DroneSpec, DRONE_SPECS, resolveDroneSpec,
} from "@/lib/droneSpecs";
import {
  type CustomInput, type FarmerSettings, type LastFlownMission,
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
  type ApplicationRecord, type ApplicationRecordDefaults,
  EMPTY_RECORD, WIND_DIRECTIONS,
} from "@/lib/reportRecord";
import {
  conditionFlags, endBeforeStartNote, overTankCapacityNote,
  rateVsBaselineNote, volumeVsPlanNote,
} from "@/lib/reportReconcile";
import ConditionLookup from "./ConditionLookup";
import {
  type Annotation, type LayerState, type MeasureStats, type UserPoly,
  AnnotateTool, BoundaryTool, FitBounds, LayerRow, MapControls,
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
  onSave: (s: FarmerSettings) => Promise<boolean | void> | boolean | void;
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
            <p className="text-xs text-neutral-500 mt-1">Drives cost calculations for this field.</p>
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
          <p className="text-[11px] text-neutral-500 mb-4">Used to estimate growth stage.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Crop type</label>
              <select className={inputCls} value={local.crop_type}
                onChange={e => update({ crop_type: e.target.value })}>
                <option value="">Select a crop</option>
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

        {/* Condition flag thresholds */}
        <section className="rounded-sm border border-[#222] p-5" style={{ background: "#161616" }}>
          <h2 className="text-sm font-semibold mb-1">3. Application Condition Flags</h2>
          <p className="text-[11px] text-neutral-500 mb-4">
            Wind or temperature beyond these values gets flagged in the Log Flight dialog and
            on the spray report. Flagged, never blocked, and never a compliance claim: product
            labels vary and only you know yours.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Flag wind above ({windUnit(units)})</label>
              <input
                type="number" min={0} step={0.5} className={inputCls}
                value={windMphShown(local.condition_limits?.wind_mph ?? 10, units)}
                onChange={e => update({
                  condition_limits: {
                    wind_mph: windMphFromShown(Number(e.target.value) || 0, units),
                    temp_f: local.condition_limits?.temp_f ?? 85,
                  },
                })}
              />
            </div>
            <div>
              <label className={labelCls}>Flag temperature above ({tempUnit(units)})</label>
              <input
                type="number" step={1} className={inputCls}
                value={tempFShown(local.condition_limits?.temp_f ?? 85, units)}
                onChange={e => update({
                  condition_limits: {
                    wind_mph: local.condition_limits?.wind_mph ?? 10,
                    temp_f: tempFFromShown(Number(e.target.value) || 0, units),
                  },
                })}
              />
            </div>
          </div>
        </section>

        {/* How it's used */}
        <section className="rounded-sm border border-[#222] p-5" style={{ background: "#161616" }}>
          <h2 className="text-sm font-semibold mb-3">4. How these settings are used</h2>
          <ul className="text-[12px] text-neutral-400 space-y-1.5 list-disc pl-5">
            <li>Marked treatment zones are priced as <span className="font-mono text-neutral-200">{units === "metric" ? "hectares × your per-hectare cost" : "acres × your per-acre cost"}</span>.</li>
            <li>Issues map to inputs via a fixed table (e.g. <span className="text-neutral-300">bare soil → reseeding</span>, <span className="text-neutral-300">nitrogen deficiency → nitrogen fertilizer</span>).</li>
            <li>Your product list is what the mission log and application record offer for prefill.</li>
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
// ---- Flight-log draft -----------------------------------------------------
// The Log Flight dialog is the most typing in the product; a closed tab or a
// dead battery must not erase it. The draft persists locally on every change
// and is cleared only by a confirmed save or an explicit discard.
const flightDraftKey = (scanId: string) => `swathwise:flight-draft:${scanId}`;
type FlightDraft = {
  dateFlown: string; batteryEnd: number | null; refills: number;
  completed: string[]; notes: string; volumeIn: string;
  rec: ApplicationRecord; savedAt?: string;
};
function readFlightDraft(scanId: string): FlightDraft | null {
  try {
    const raw = localStorage.getItem(flightDraftKey(scanId));
    return raw ? (JSON.parse(raw) as FlightDraft) : null;
  } catch {
    return null;
  }
}
function clearFlightDraft(scanId: string) {
  try { localStorage.removeItem(flightDraftKey(scanId)); } catch { /* nothing stored */ }
}

export function LogFlightModal({
  open, onOpenChange, fieldId, scanId, droneId, droneName,
  batteryStart, zones, totalAcres, estLiters, recordDefaults, baselineRateLha,
  center, conditionLimits, onSaved,
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
  /** Stable per-field record values (grower, product, certificates). */
  recordDefaults: ApplicationRecordDefaults | null;
  /** The configured medium rate (L/ha), for the at-entry rate sanity check. */
  baselineRateLha: number | null;
  /** Field centroid [lat, lng] for the NOAA condition lookup; null disables it. */
  center: [number, number] | null;
  /** Operator-configured condition-flag thresholds. */
  conditionLimits: { wind_mph: number; temp_f: number } | null;
  /** Return false when the write did NOT land — the modal must not claim success. */
  onSaved: (log: LastFlownMission) => void | boolean | Promise<void | boolean>;
}) {
  // Every quantity in this dialog follows the operator's unit preference — the
  // same one the planner, the grid and the report already use. STORAGE stays
  // canonical (litres, acres); only what is shown and typed is converted.
  const units = useUnitSystem();
  const today = new Date().toISOString().slice(0, 10);
  const [dateFlown, setDateFlown] = useState(today);
  // Landed battery starts EMPTY: an untouched control must log "not
  // recorded", never an invented 25% wearing the look of telemetry.
  const [batteryEnd, setBatteryEnd] = useState<number | null>(null);
  const [refills, setRefills] = useState<number>(0);
  // Zones start UNCHECKED: "completed" is the pilot's claim about what was
  // actually flown, not a default.
  const [completed, setCompleted] = useState<Set<string>>(() => new Set());
  const [notes, setNotes] = useState("");
  // What the pilot types, IN THEIR OWN UNITS. Prefilled from the plan estimate
  // as a CONVENIENCE and labelled as such — what gets stored is what the pilot
  // confirms or corrects, never the estimate wearing "logged".
  const [volumeIn, setVolumeIn] = useState<string>("");
  const [rec, setRec] = useState<ApplicationRecord>(EMPTY_RECORD);
  const [saving, setSaving] = useState(false);
  // An explicit failure state: when nothing was saved, the dialog says so and
  // keeps every typed value in place.
  const [saveFailure, setSaveFailure] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const pristine = useRef<string | null>(null);
  const dirtyRef = useRef(false);

  // Reset whenever the modal is reopened — from the local draft when one
  // exists (a closed tab mid-entry loses nothing), from honest defaults
  // otherwise.
  useEffect(() => {
    if (!open) return;
    const draft = readFlightDraft(scanId);
    if (draft) {
      setDateFlown(draft.dateFlown || today);
      setBatteryEnd(draft.batteryEnd ?? null);
      setRefills(draft.refills ?? 0);
      setCompleted(new Set(draft.completed ?? []));
      setNotes(draft.notes ?? "");
      setVolumeIn(draft.volumeIn ?? "");
      setRec({ ...EMPTY_RECORD, ...(recordDefaults ?? {}), ...(draft.rec ?? {}) });
      setDraftNote(
        `Restored your unsent entries${draft.savedAt ? ` from ${new Date(draft.savedAt).toLocaleString()}` : ""}.`,
      );
    } else {
      setDateFlown(today);
      setBatteryEnd(null);
      setRefills(0);
      setCompleted(new Set());
      setNotes("");
      setVolumeIn("");
      setRec({ ...EMPTY_RECORD, ...(recordDefaults ?? {}) });
      setDraftNote(null);
    }
    setSaveFailure(null);
    pristine.current = null; // captured by the draft effect's first run
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist the draft on every change past the initial state. try/catch: a
  // blocked localStorage downgrades to the unload warning below, never a crash.
  useEffect(() => {
    if (!open) return;
    const cur = JSON.stringify({
      dateFlown, batteryEnd, refills, completed: Array.from(completed), notes, volumeIn, rec,
    });
    if (pristine.current === null) { pristine.current = cur; dirtyRef.current = false; return; }
    if (cur === pristine.current) { dirtyRef.current = false; return; }
    dirtyRef.current = true;
    try {
      localStorage.setItem(flightDraftKey(scanId), JSON.stringify({
        dateFlown, batteryEnd, refills, completed: Array.from(completed),
        notes, volumeIn, rec, savedAt: new Date().toISOString(),
      } satisfies FlightDraft));
    } catch (e) {
      console.error("[flight-draft] write failed", e);
    }
  }, [open, scanId, dateFlown, batteryEnd, refills, completed, notes, volumeIn, rec]);

  // Belt over the draft's braces: a hard close mid-entry still warns.
  useEffect(() => {
    if (!open) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [open]);

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
  // Estimate only, shown as a prefill hint. It used to be STORED as
  // liters_applied — a planner estimate presented as a logged actual, which is
  // how a report once printed "3.3 gal applied" against a mission that flew
  // zero zones. What persists now is only what the pilot types.
  const estLitersApplied = estLiters != null && acresDone > 0
    ? +(estLiters * (refills + 1) * coverageRatio).toFixed(1)
    : null;
  /** The estimate hint, in the units the operator is typing in. */
  const estShown = estLitersApplied != null
    ? +volumeValue(estLitersApplied, units).toFixed(1)
    : null;
  // Typed in the operator's units, CONVERTED to litres for storage. Without
  // this conversion an imperial operator's "4.4" was stored as 4.4 L and read
  // back as 1.16 gal — a number they never entered, on a compliance record.
  const litersApplied = (() => {
    const t = volumeIn.trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) return null;
    return +volumeToLitres(n, units).toFixed(2);
  })();

  // ---- Warn AT ENTRY, with the same rules the report reconciles by. --------
  // A figure the report will later contradict is cheapest to catch while the
  // person who flew the mission is still holding the controller. Warnings
  // only — never blocked, never silently accepted.
  const fmtL = (l: number) => fmtVolume(l, units).text;
  const entryWarnings: string[] = [
    volumeVsPlanNote(litersApplied, estLitersApplied, fmtL),
    overTankCapacityNote(litersApplied, estLiters, refills, fmtL),
    baselineRateLha != null
      ? rateVsBaselineNote(
          litersApplied != null && acresDone > 0 ? litersApplied / acresDone : null,
          baselineRateLha,
          (lPerAc) => `${fmtVolume(lPerAc, units, 2).text}/ac`,
        )
      : null,
    endBeforeStartNote(rec.start_time, rec.end_time),
    // A check that cannot run is not a check that passed. `estLiters` is null
    // when the aircraft has no tank capacity on file, and overTankCapacityNote
    // returns null for that too — indistinguishable, from the pilot's side,
    // from a volume that reconciled. So say which one it was.
    litersApplied != null && estLiters == null
      ? "No tank capacity is on file for this aircraft, so the logged volume was not checked against what the tank could hold. Set the capacity on the Fleet page to turn that check back on."
      : null,
    ...conditionFlags(rec.wind_speed_mph, rec.temperature_f, conditionLimits ?? undefined),
  ].filter((w): w is string => !!w);

  const normalizedRecord = (): ApplicationRecord => ({
    grower_name: rec.grower_name.trim(),
    product_name: rec.product_name.trim(),
    epa_reg_no: rec.epa_reg_no.trim(),
    applicator_cert_no: rec.applicator_cert_no.trim(),
    part137_cert_no: rec.part137_cert_no.trim(),
    start_time: rec.start_time || null,
    end_time: rec.end_time || null,
    wind_speed_mph: rec.wind_speed_mph,
    wind_direction: rec.wind_direction || null,
    temperature_f: rec.temperature_f,
    // Per-value provenance. A value present without a tracked source was
    // typed by the person who was there = observed; an accepted NOAA
    // suggestion carries its model source; a fetched-but-declined suggestion
    // survives only as model_check, never as entered data.
    wind_source: rec.wind_speed_mph != null ? (rec.wind_source ?? "observed") : null,
    temp_source: rec.temperature_f != null ? (rec.temp_source ?? "observed") : null,
    model_check: rec.model_check ?? null,
  });

  const save = async () => {
    if (!fieldId || saving) return;
    setSaveFailure(null);
    // Detect a dead connection up front instead of attempting writes that
    // fail and then claiming success anyway.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setSaveFailure(
        "You appear to be offline. Nothing was saved; your entries stay here " +
        "(and are kept as a local draft); retry when you have signal.",
      );
      return;
    }
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
        liters_applied: litersApplied,
        notes: notes.trim() || null,
        created_at: new Date().toISOString(),
        record: normalizedRecord(),
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
      // Drone battery is a convenience update, never worth failing the log —
      // and never written from an unrecorded landing charge.
      if (droneId && batteryEnd != null) {
        try { await supabase.from("drones").update({ battery: batteryEnd }).eq("id", droneId); }
        catch (e) { console.error("[drones] battery update failed", e); }
      }

      // The flight_logs table has no column for the application record, so the
      // record rides along on the snapshot the settings JSON keeps.
      const savedLog: LastFlownMission = inserted
        ? { ...(inserted as LastFlownMission), source: "flight_logs", record: snapshotBase.record }
        : snapshotBase;

      if (inserted) {
        // Primary record confirmed persisted. The field summary rides behind
        // it; its failure downgrades the message, it does not un-save the log.
        clearFlightDraft(scanId);
        toast.success("Flight logged", {
          description: `${fmtAreaAc(acresDone, units).text} recorded for ${dateFlown}.`,
        });
        try {
          const ok = await onSaved(savedLog);
          if (ok === false) {
            toast.warning("Logged, but the field summary did not update", {
              description: "The flight log itself is saved. The field's last-mission summary will catch up on the next save.",
            });
          }
        } catch (e) {
          console.error("[flight] onSaved failed after insert", e);
          toast.warning("Logged, but the field summary did not update", {
            description: "The flight log itself is saved.",
          });
        }
        onOpenChange(false);
      } else {
        // Primary insert failed: the settings snapshot is now the ONLY copy,
        // so success may only be claimed after that write is CONFIRMED.
        console.warn("[flight_logs] insert failed; attempting field snapshot fallback", error);
        let persisted = false;
        try {
          persisted = (await onSaved(snapshotBase)) !== false;
        } catch (e) {
          console.error("[flight] snapshot fallback failed", e);
        }
        if (persisted) {
          clearFlightDraft(scanId);
          toast.success("Mission saved to field", {
            description:
              `${fmtAreaAc(acresDone, units).text} recorded for ${dateFlown}. ` +
              `The detailed flight log could not be written (${error?.message ?? "database error"}); ` +
              "the mission is kept on the field record.",
          });
          onOpenChange(false);
        } else {
          setSaveFailure(
            `Nothing was saved. The flight log could not be written (${error?.message ?? "database error"}) ` +
            "and the field snapshot write failed too, which usually means no connection. " +
            "Your entries are kept here and as a local draft; retry when you have signal.",
          );
        }
      }
    } catch (e: any) {
      setSaveFailure(
        `Nothing was saved: ${e?.message ?? String(e)}. Your entries are kept here and as a local draft; retry when you have signal.`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0f0f0f] border-[#1f1f1f] text-neutral-200 max-w-md max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-4 w-4 text-[#4CAF50]" />
            Mission complete: log the flight
          </DialogTitle>
          <p className="text-[11px] text-neutral-500 mt-1">
            This becomes part of the spray log, a timestamped record for compliance and audit.
          </p>
        </DialogHeader>

        <div className="space-y-4">
          {draftNote && (
            <div className="flex items-center justify-between gap-2 rounded-sm border border-[#2b4a2e] bg-[#4CAF50]/10 px-2.5 py-1.5 text-[11px] text-[#9ccc9f]">
              <span>{draftNote}</span>
              <button
                type="button"
                onClick={() => {
                  clearFlightDraft(scanId);
                  setDateFlown(today);
                  setBatteryEnd(null);
                  setRefills(0);
                  setCompleted(new Set());
                  setNotes("");
                  setVolumeIn("");
                  setRec({ ...EMPTY_RECORD, ...(recordDefaults ?? {}) });
                  setDraftNote(null);
                  pristine.current = null;
                }}
                className="shrink-0 text-[10px] text-neutral-400 underline hover:text-neutral-200"
              >
                Discard draft
              </button>
            </div>
          )}
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
                Started {batteryStart}% → Landed <span className="text-neutral-100">{batteryEnd != null ? `${batteryEnd}%` : "not recorded"}</span>
              </div>
            </div>
            <input
              type="range" min={0} max={100} step={1}
              value={batteryEnd ?? batteryStart}
              onChange={e => setBatteryEnd(Number(e.target.value))}
              className={`w-full ${batteryEnd != null && batteryEnd < 20 ? "accent-red-500" : "accent-[#4CAF50]"}`}
            />
            {batteryEnd == null && (
              <div className="mt-1 text-[10px] text-neutral-500">
                Move the slider to record the landed charge. Untouched, the log says &ldquo;not recorded&rdquo;.
              </div>
            )}
            {batteryEnd != null && batteryEnd < 20 && (
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
            {zones.length > 0 && (
              <div className="mb-1 text-[10px] text-neutral-600">
                Check only the zones you actually flew; nothing is assumed.
              </div>
            )}
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
                      <span className="font-mono text-neutral-500">{fmtAreaAc(z.acres, units).text}</span>
                    </label>
                  );
                })}
              </div>
            )}
            <div className="mt-2 text-[11px] text-neutral-500 flex justify-between">
              <span>Treated</span>
              <span className="font-mono text-neutral-300">{fmtAreaAc(acresDone, units).text}</span>
            </div>
          </div>

          {/* Volume actually applied. The estimate is a hint, never the value. */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
              Volume applied ({volumeUnit(units)})
            </div>
            <input
              type="number" min={0} step={0.1}
              value={volumeIn}
              onChange={e => setVolumeIn(e.target.value)}
              placeholder={estShown != null
                ? `plan estimated ~${estShown} ${volumeUnit(units)}`
                : units === "metric" ? "e.g. 12.5" : "e.g. 3.3"}
              className="w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1.5 text-sm font-mono text-neutral-200 placeholder:text-neutral-600"
            />
            <div className="mt-1 text-[10px] text-neutral-500">
              Enter what actually left the tank. Left empty, the report shows this as missing
              rather than borrowing the plan's estimate.
            </div>
          </div>

          {/* Application record: what the pesticide record keeper needs. */}
          <div className="pt-2 border-t border-[#1f1f1f] space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-neutral-500">
              Application record
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="col-span-2 text-[10px] text-neutral-500">
                Grower / customer
                <input value={rec.grower_name}
                  onChange={e => setRec(r => ({ ...r, grower_name: e.target.value }))}
                  className="mt-0.5 w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1.5 text-sm text-neutral-200" />
              </label>
              <label className="text-[10px] text-neutral-500">
                Product name
                <input value={rec.product_name}
                  onChange={e => setRec(r => ({ ...r, product_name: e.target.value }))}
                  className="mt-0.5 w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1.5 text-sm text-neutral-200" />
              </label>
              <label className="text-[10px] text-neutral-500">
                EPA reg. no.
                <input value={rec.epa_reg_no}
                  onChange={e => setRec(r => ({ ...r, epa_reg_no: e.target.value }))}
                  className="mt-0.5 w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1.5 text-sm font-mono text-neutral-200" />
              </label>
              <label className="text-[10px] text-neutral-500">
                Start time
                <input type="time" value={rec.start_time ?? ""}
                  onChange={e => setRec(r => ({ ...r, start_time: e.target.value || null }))}
                  className="mt-0.5 w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1.5 text-sm font-mono text-neutral-200" />
              </label>
              <label className="text-[10px] text-neutral-500">
                End time
                <input type="time" value={rec.end_time ?? ""}
                  onChange={e => setRec(r => ({ ...r, end_time: e.target.value || null }))}
                  className="mt-0.5 w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1.5 text-sm font-mono text-neutral-200" />
              </label>
              {/* Conditions. Typed values are observed; the NOAA lookup below
                  offers a station observation as a SUGGESTION — nothing fills
                  in until it is explicitly accepted, and an accepted value
                  carries model provenance, never "observed". Editing a value
                  by hand afterwards makes that value observed again. */}
              <label className="text-[10px] text-neutral-500">
                Wind speed ({windUnit(units)})
                <input type="number" min={0} step={0.5}
                  value={rec.wind_speed_mph != null ? windMphShown(rec.wind_speed_mph, units) : ""}
                  onChange={e => setRec(r => ({
                    ...r,
                    wind_speed_mph: e.target.value === "" ? null : windMphFromShown(Number(e.target.value), units),
                    wind_source: e.target.value === "" ? null : "observed",
                  }))}
                  className="mt-0.5 w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1.5 text-sm font-mono text-neutral-200" />
              </label>
              <label className="text-[10px] text-neutral-500">
                Wind direction
                <select value={rec.wind_direction ?? ""}
                  onChange={e => setRec(r => ({
                    ...r,
                    wind_direction: e.target.value || null,
                    // Direction travels with speed; a manual correction makes
                    // the wind pair the operator's own.
                    wind_source: r.wind_speed_mph != null || e.target.value ? "observed" : r.wind_source,
                  }))}
                  className="mt-0.5 w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1.5 text-sm text-neutral-200">
                  <option value="">Not recorded</option>
                  {WIND_DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label className="text-[10px] text-neutral-500">
                Temperature ({tempUnit(units)})
                <input type="number" step={1}
                  value={rec.temperature_f != null ? tempFShown(rec.temperature_f, units) : ""}
                  onChange={e => setRec(r => ({
                    ...r,
                    temperature_f: e.target.value === "" ? null : tempFFromShown(Number(e.target.value), units),
                    temp_source: e.target.value === "" ? null : "observed",
                  }))}
                  className="mt-0.5 w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1.5 text-sm font-mono text-neutral-200" />
              </label>
              <ConditionLookup
                center={center}
                dateYmd={dateFlown}
                timeHm={rec.start_time}
                onFetched={(s) => setRec(r => ({
                  ...r,
                  // Kept whether or not accepted: the report's condition
                  // flagging runs on what the station said either way.
                  model_check: {
                    provider: s.provider, station: s.station, station_name: s.station_name,
                    distance_mi: s.distance_mi, observed_at: s.observed_at,
                    wind_mph: s.wind_mph, wind_dir: s.wind_dir, temp_f: s.temp_f,
                    fetched_at: new Date().toISOString(),
                  },
                }))}
                onAccept={(s) => setRec(r => ({
                  ...r,
                  wind_speed_mph: s.wind_mph ?? r.wind_speed_mph,
                  wind_direction: s.wind_dir ?? r.wind_direction,
                  temperature_f: s.temp_f ?? r.temperature_f,
                  wind_source: s.wind_mph != null
                    ? { kind: "model", provider: s.provider, station: s.station, distance_mi: s.distance_mi, observed_at: s.observed_at }
                    : r.wind_source,
                  temp_source: s.temp_f != null
                    ? { kind: "model", provider: s.provider, station: s.station, distance_mi: s.distance_mi, observed_at: s.observed_at }
                    : r.temp_source,
                }))}
              />
              <label className="text-[10px] text-neutral-500">
                Applicator cert. no.
                <input value={rec.applicator_cert_no}
                  onChange={e => setRec(r => ({ ...r, applicator_cert_no: e.target.value }))}
                  className="mt-0.5 w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1.5 text-sm font-mono text-neutral-200" />
              </label>
              <label className="text-[10px] text-neutral-500">
                Part 137 cert. no.
                <input value={rec.part137_cert_no}
                  onChange={e => setRec(r => ({ ...r, part137_cert_no: e.target.value }))}
                  className="mt-0.5 w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1.5 text-sm font-mono text-neutral-200" />
              </label>
            </div>
            <div className="text-[10px] text-neutral-600 leading-snug">
              These become the report's application record. Anything left blank shows on the
              report as missing, and the report stays a draft until the record is complete.
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

          {/* At-entry sanity checks: same rules the report reconciles by,
              surfaced while the pilot is still holding the numbers. Warnings
              only — the figures save exactly as typed. */}
          {entryWarnings.length > 0 && (
            <div className="rounded-sm border border-amber-800/60 bg-amber-950/20 px-2.5 py-2 text-[11px] leading-relaxed text-amber-300/90">
              <div className="mb-1 flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" /> Check before saving
              </div>
              <ul className="list-disc space-y-1 pl-4">
                {entryWarnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
              <div className="mt-1 text-[10px] text-amber-500/70">
                Saving is not blocked; these will also print as reconciliation notes on the report.
              </div>
            </div>
          )}

          {droneName && batteryEnd != null && (
            <div className="text-[10px] text-neutral-500">
              Will update <span className="text-neutral-400">{droneName}</span>'s stored battery to {batteryEnd}%.
            </div>
          )}
          {saveFailure && (
            <div className="rounded-sm border border-red-900/60 bg-red-950/30 px-2.5 py-2 text-[11px] leading-relaxed text-red-300">
              <div className="mb-1 flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" /> Not saved
              </div>
              {saveFailure}
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
