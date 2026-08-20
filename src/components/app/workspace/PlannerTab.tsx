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
  CheckCircle2, XCircle, Trash2, Hexagon, CalendarDays, Info,
  Play, Pause, RotateCcw, FastForward, History,
} from "lucide-react";
import UserPolygonTool, { type DraftPolygon } from "@/components/app/UserPolygonTool";
import ReportsTab from "@/components/app/ReportsTab";
import HistoryTab from "@/components/app/HistoryTab";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  type DroneSpec, DRONE_SPECS, resolveDroneSpec,
} from "@/lib/droneSpecs";
import {
  type AiZone, type CustomInput, type FarmerSettings, type LastFlownMission,
  COST_MAP, DEFAULT_FARMER_SETTINGS, INPUT_LABELS,
  growthStage, issueToCostKey, mergeFarmerSettings, normalizeBoundary,
  resolveZoneRateLha,
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
import { AGRAS_IMPORT_STEPS, RX_RATE_UNIT } from "@/lib/djiAgras";
import { type ExportContext, userFacingExporters } from "@/lib/exporters";
import {
  type BoundaryRing, type FieldRow, type TaskRow,
} from "./types";
import { FN_BASE, NDVI_BASE, TILE_BASE } from "./constants";
import {
  type Annotation, type LayerState, type MeasureStats, type UserPoly,
  type BasemapId,
  AiZonesLayer, AnnotateTool, BasemapLayer, BasemapToggle, BoundaryTool, FitBounds,
  LayerRow, MapControls,
  MeasurePanel, MeasureTool, MouseReadout, USER_POLY_ISSUES, UserPolyLayer,
  escapeHtml, loadAnnotations, loadBasemap, saveAnnotations, saveBasemap, sevColor,
} from "./layers";
// Lives in SettingsTab.tsx purely because of where the file split fell.
import { LogFlightModal } from "./SettingsTab";
import { readCachedWeather } from "@/lib/weather";
import { computeMissionStats } from "@/lib/missionStats";
import { physicsFor } from "@/lib/dronePhysics";
import { buildTankProfile, sampleTankAt } from "@/lib/tankProfile";
import TankDynamicsWidget from "./TankDynamicsWidget";
import FloatingPanel from "./FloatingPanel";
import {
  type PanelLayout, loadLayout, clearLayout, saveLayout,
} from "@/lib/panelLayout";
import ScheduleMissionModal from "./ScheduleMissionModal";
// Farmer-facing quantities follow the unit setting. Flight-physics figures —
// turn radius, climb rate, the m/s speeds — deliberately do NOT: they are the
// aircraft's own spec-sheet numbers and the values the DJI parameters take, and
// a pilot cross-checking against either should see the same figure here.
import {
  fmtAltitude, fmtAreaAc, fmtDistance, fmtVolume, rateToLha, rateUnit, rateValue,
} from "@/lib/units";
import { useUnitSystem } from "@/hooks/useUnitSystem";


/**
 * A paragraph folded into an icon.
 *
 * The sidebar was carrying several multi-line explainers that were each read
 * once and then occupied the screen forever. The words are worth keeping — the
 * Agras/QGC distinction in particular is the difference between a file that
 * flies and one that does not — so they move behind a hover rather than being
 * deleted.
 */
function InfoTip({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`relative inline-flex ${className}`}>
      <button type="button"
        aria-label="More information"
        onClick={() => setOpen(v => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="text-neutral-600 hover:text-neutral-300 transition-colors">
        <Info className="h-3 w-3" />
      </button>
      {open && (
        <span className="absolute bottom-full right-0 mb-1.5 z-[600] w-64 rounded-sm border border-[#2a2a2a] bg-[#0a0a0a] p-2.5 text-[10px] leading-relaxed text-neutral-300 shadow-xl normal-case tracking-normal font-normal">
          {children}
        </span>
      )}
    </span>
  );
}

export function PlannerTab({
  analysis, boundary, tileUrl, bounds, maxNative, taskId, runAnalysis, setActiveTab,
  settings, onSaveSettings, onFlightLogged, center, userPolys, fieldId, fieldName,
}: {
  analysis: any;
  boundary: BoundaryRing[] | null;
  tileUrl: string;
  bounds: L.LatLngBoundsExpression | null;
  maxNative: number;
  taskId: string;
  fieldId: string | null;
  /** Used to pre-fill the schedule form's location label. */
  fieldName?: string;
  runAnalysis: () => void;
  setActiveTab: (k: any) => void;
  settings: FarmerSettings;
  onSaveSettings: (s: FarmerSettings) => Promise<void> | void;
  onFlightLogged: (log: LastFlownMission) => void;
  center: [number, number];
  userPolys: UserPoly[];
}) {
  const units = useUnitSystem();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [sideTab, setSideTab] = useState<"setup" | "mission">("setup");
  // Floating map panels. Defaults chosen so nothing overlaps out of the box;
  // an operator can then put them wherever suits the field they are looking at.
  const PANEL_DEFAULTS: PanelLayout = useMemo(() => ({
    tank: { anchor: "top-center", size: { w: 300, h: 132 }, visible: true, collapsed: false },
    sim: { anchor: "bottom-center", size: { w: 560, h: 236 }, visible: true, collapsed: false },
    legend: { anchor: "top-left", size: { w: 216, h: 108 }, visible: true, collapsed: false },
  }), []);
  const [panels, setPanels] = useState<PanelLayout>(() => loadLayout(PANEL_DEFAULTS));
  const [mapRect, setMapRect] = useState({ w: 1000, h: 600 });
  const mapWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { saveLayout(panels); }, [panels]);

  // Snapping is relative to the map, so the map's size has to be known. A
  // ResizeObserver rather than a window listener: the sidebar can change width
  // without the window changing at all.
  useEffect(() => {
    const el = mapWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect;
      setMapRect({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const setPanel = useCallback((id: string, next: PanelLayout[string]) =>
    setPanels(p => ({ ...p, [id]: next })), []);
  const resetPanels = useCallback(() => {
    clearLayout();
    setPanels(loadLayout(PANEL_DEFAULTS));
  }, [PANEL_DEFAULTS]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [basemap, setBasemap] = useState<BasemapId>(loadBasemap);
  const [spacingM, setSpacingM] = useState<number>(15);
  const [transitAltM, setTransitAltM] = useState<number>(30);
  const [sprayAltM, setSprayAltM] = useState<number>(3);
  const [transitSpeed, setTransitSpeed] = useState<number>(10);
  const [spraySpeed, setSpraySpeed] = useState<number>(3);
  // How many times the drone re-covers each anomaly zone. 1 = single pass set,
  // 2 = double coverage (e.g. heavy infestation), 3 = triple. Linearly scales
  // spray distance, time, and tank/battery usage.
  const [repeats, setRepeats] = useState<number>(1);
  const [home, setHome] = useState<LatLng2 | null>(null);

  // Pre-flight battery — user can simulate "what if I launch at 60%?" without
  // leaving the planner. Defaults to the active drone's stored battery; if no
  // drone is registered, the slider is hidden and a placeholder is shown.
  const [preFlightBattery, setPreFlightBattery] = useState<number>(100);

  // ---- Simulation playback ---------------------------------------------
  // Animates a virtual drone along the planned mission. Spray pulse appears
  // when the current segment is sprayer-ON. Speed multiplier lets users
  // fast-forward through long missions.
  const [simPlaying, setSimPlaying] = useState(false);
  const [simSpeed, setSimSpeed] = useState<number>(8);  // realtime * multiplier
  const [simT, setSimT] = useState(0);

  // ---- Drone fleet ------------------------------------------------------
  type FleetDrone = { id: string; name: string; model: string; battery: number; status: string };
  const [drones, setDrones] = useState<FleetDrone[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("drones")
        .select("id, name, model, battery, status").order("created_at", { ascending: false });
      if (!cancelled) setDrones((data as any) ?? []);
    })();
    return () => { cancelled = true; };
  }, []);

  // Local mirror of flight_plan so slider drags don't hit the DB on every tick.
  // We persist on a 600ms idle debounce.
  const [fp, setFp] = useState<FarmerSettings["flight_plan"]>(settings.flight_plan);
  useEffect(() => { setFp(settings.flight_plan); }, [settings.flight_plan]);
  useEffect(() => {
    if (JSON.stringify(fp) === JSON.stringify(settings.flight_plan)) return;
    const t = setTimeout(() => {
      onSaveSettings({ ...settings, flight_plan: fp });
    }, 600);
    return () => clearTimeout(t);
  }, [fp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Per-severity target rates in L/ha, mirrored locally so typing does not hit
  // the DB on every keystroke. Same 600ms idle debounce as flight_plan above.
  const [rates, setRates] = useState<FarmerSettings["spray_rates_lha"]>(settings.spray_rates_lha);
  useEffect(() => { setRates(settings.spray_rates_lha); }, [settings.spray_rates_lha]);
  useEffect(() => {
    if (JSON.stringify(rates) === JSON.stringify(settings.spray_rates_lha)) return;
    const t = setTimeout(() => {
      onSaveSettings({ ...settings, spray_rates_lha: rates });
    }, 600);
    return () => clearTimeout(t);
  }, [rates]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeDrone = drones.find(d => d.id === fp.drone_id) ?? null;
  useEffect(() => {
    if (activeDrone) setPreFlightBattery(activeDrone.battery);
  }, [activeDrone?.id, activeDrone?.battery]);

  // ---- Spray log / "Mark as Flown" -------------------------------------
  // Fetches the most recent flight_log for this field so we can show the
  // compliance summary ("X acres treated · Y L applied · logged DATE")
  // directly under the export button, and so the modal opens pre-filled
  // for repeat flights.
  type FlightLogRow = {
    id: string; date_flown: string; battery_start: number | null;
    battery_end: number | null; tank_refills: number;
    zones_completed: string[]; acres_treated: number | null;
    liters_applied: number | null; notes: string | null;
  };
  const [logOpen, setLogOpen] = useState(false);
  const [lastLog, setLastLog] = useState<FlightLogRow | null>(null);
  const refreshLastLog = useCallback(async () => {
    if (!fieldId && !taskId) return;
    const selectCols = "id, date_flown, battery_start, battery_end, tank_refills, zones_completed, acres_treated, liters_applied, notes";
    const { data } = fieldId
      ? await supabase.from("flight_logs")
          .select(selectCols)
          .eq("field_id", fieldId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : await supabase.from("flight_logs")
          .select(selectCols)
          .eq("scan_id", taskId as string)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
    setLastLog((data as FlightLogRow | null) ?? null);
  }, [fieldId, taskId]);
  useEffect(() => { void refreshLastLog(); }, [refreshLastLog]);
  const droneModelKey = activeDrone?.model ?? "Custom";
  const baseSpec = DRONE_SPECS[droneModelKey] ?? fp.custom_specs;
  const isCustom = !DRONE_SPECS[droneModelKey] || droneModelKey === "Custom";
  // Merge defaults so older saved custom_specs (missing newer fields like
  // min_turn_radius_m / climb_rate_ms) still pass maneuverability checks.
  const SPEC_DEFAULTS = DRONE_SPECS["Custom"];
  const spec: DroneSpec = { ...SPEC_DEFAULTS, ...(isCustom ? fp.custom_specs : baseSpec) };

  const updateFlightPlan = (patch: Partial<FarmerSettings["flight_plan"]>) =>
    setFp(prev => ({ ...prev, ...patch }));

  // LOAD-BEARING COUPLING — do not "tidy" without reading
  // docs/features/workspace.md. The planner reads wind and temperature from the
  // very same localStorage entry WeatherTab writes. If the Weather tab has never
  // been opened for this location there is no entry, and the battery estimate
  // silently runs without wind or temperature derating rather than erroring.
  // Left as-is deliberately: fixing it is a behaviour change, not a file move.
  // ---- Weather (read planner-side from the same 20-min localStorage cache
  // the Weather tab writes). Falls back to "no weather data".
  const wx = (() => {
    const c = readCachedWeather(center[0], center[1]);
    if (!c?.data?.current) return null;
    const cur = c.data.current;
    return {
      wind_ms: (cur.wind_kmh ?? 0) / 3.6,
      wind_dir: cur.wind_dir ?? 0,    // meteorological "from" direction in degrees
      temp_c: cur.temp_c ?? 20,
      savedAt: c.savedAt,
    };
  })();

  // Combine AI treatment zones + farmer-drawn manual annotations into a single
  // list of polygons the planner will lawnmower over. Both are filtered to
  // those whose centroid lies inside the field boundary.
  type PlannerZone = { id: string; ring: LatLng2[]; severity: AiZone["severity"]; source: "ai" | "user" };
  const aiZonesRaw: PlannerZone[] = ((analysis?.zones ?? []) as AiZone[])
    .map(z => ({ id: z.id, ring: z.ring, severity: z.severity, source: "ai" as const }));
  const userZonesRaw: PlannerZone[] = (userPolys ?? [])
    .filter(u => u.ring && u.ring.length >= 3)
    .map(u => ({ id: `user:${u.id}`, ring: u.ring, severity: "medium" as const, source: "user" as const }));
  const allZonesRaw: PlannerZone[] = [...aiZonesRaw, ...userZonesRaw];
  const validZones = (() => {
    if (!boundary || boundary.length === 0) return [];
    return allZonesRaw.filter(z => {
      if (!z.ring || z.ring.length < 3) return false;
      const cx = z.ring.reduce((a, p) => a + p.lng, 0) / z.ring.length;
      const cy = z.ring.reduce((a, p) => a + p.lat, 0) / z.ring.length;
      return pointInAnyRing({ lat: cy, lng: cx }, boundary as LatLng2[][]);
    });
  })();

  // Default home = centroid of boundary, but only set once so user drags persist.
  const defaultHome = boundary && boundary.length > 0 ? centroidOfRings(boundary as LatLng2[][]) : null;
  const effectiveHome = home ?? defaultHome;

  // ---- Coverage-max spacing ----------------------------------------------
  // The largest row spacing that still guarantees at least one sweep line
  // passes through every anomaly zone. Computed in the same rotated frame
  // buildFieldSweep uses (field's principal axis), so it matches the actual
  // pattern that gets generated. If any zone is narrower than this, it can
  // be missed entirely.
  const coverageMaxM = (() => {
    if (!boundary || boundary.length === 0 || validZones.length === 0) return null;
    const fieldCenter = centroidOfRings(boundary as LatLng2[][]);
    const theta = principalAxisAngle(boundary as LatLng2[][]);
    const cF = Math.cos(-theta), sF = Math.sin(-theta);
    const rot = (p: LatLng2) => rotateLL(p, fieldCenter, cF, sF);
    let minHeightM = Infinity;
    for (const z of validZones) {
      const rr = z.ring.map(rot);
      let lo = Infinity, hi = -Infinity;
      for (const p of rr) { if (p.lat < lo) lo = p.lat; if (p.lat > hi) hi = p.lat; }
      const h = (hi - lo) * M_PER_DEG_LAT;
      if (h < minHeightM) minHeightM = h;
    }
    if (!isFinite(minHeightM) || minHeightM <= 0) return null;
    // Floor by 0.5 m so the slider always lands inside, not exactly on the edge.
    return Math.max(1, Math.floor(minHeightM * 2) / 2 - 0.5);
  })();

  // ---- Recommended spacing -----------------------------------------------
  // Home-aware: wider spacing = fewer passes = fewer long returns to/from
  // home, so the recommendation widens as the home pin moves away from the
  // field. Capped by both the coverage-max (every anomaly must still be hit)
  // and the active drone's physical spray swath.
  const recommendedSpacing = (() => {
    const base = 15;
    let rec = base;
    if (effectiveHome && boundary && boundary.length > 0) {
      const c = centroidOfRings(boundary as LatLng2[][]);
      const dHome = distM(effectiveHome, c);
      const adj = Math.round(Math.max(-5, Math.min(8, (dHome - 60) / 60)));
      rec = base + adj;
    }
    if (coverageMaxM && rec > coverageMaxM) rec = Math.floor(coverageMaxM);
    const droneSwath = spec?.spray_swath_m && spec.spray_swath_m > 0 ? spec.spray_swath_m : null;
    if (droneSwath && rec > droneSwath) rec = Math.floor(droneSwath);
    return Math.max(5, Math.min(22, rec));
  })();

  // Auto-snap spacing to the recommended value until the user manually moves
  // the slider. Re-applies whenever the recommendation changes (e.g. home pin
  // moves, drone changes, zones recomputed).
  const userTouchedSpacingRef = useRef(false);
  useEffect(() => {
    if (userTouchedSpacingRef.current) return;
    if (spacingM !== recommendedSpacing) setSpacingM(recommendedSpacing);
  }, [recommendedSpacing]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Maneuverability check ---------------------------------------------
  // Verifies the current pattern (spacing + speeds + altitude deltas) is
  // physically flyable by the active drone:
  //   1. U-turn radius at row ends must be ≥ drone's tightest physical
  //      turn radius (spec.min_turn_radius_m). Required radius = spacing / 2.
  //   2. Bank-limited turn radius at transit speed (r = v² / (g·tan 25°))
  //      must also fit inside spacing / 2 — otherwise the drone overshoots.
  //   3. The climb between spray and transit altitude must be sustainable
  //      at the spec'd climb rate within the row-end distance available.
  const G = 9.81;
  const BANK_RAD = (25 * Math.PI) / 180;
  const maneuver = (() => {
    const rUturnNeeded = spacingM / 2;
    const rBankTransit = (transitSpeed * transitSpeed) / (G * Math.tan(BANK_RAD));
    const altDelta = Math.abs(transitAltM - sprayAltM);
    const climbTimeS = altDelta / Math.max(0.5, spec.climb_rate_ms);
    const climbHorizM = climbTimeS * transitSpeed;
    const failPhysical = rUturnNeeded < spec.min_turn_radius_m;
    const failBank = rUturnNeeded < rBankTransit;
    const failClimb = climbHorizM > spacingM * 4;  // need a comfortable runway
    const issues: string[] = [];
    if (failPhysical) issues.push(
      `Spacing ${spacingM} m forces a ${rUturnNeeded.toFixed(1)} m U-turn — tighter than the ${spec.min_turn_radius_m} m physical minimum for this drone.`);
    if (failBank) issues.push(
      `Transit speed ${transitSpeed} m/s needs a ${rBankTransit.toFixed(1)} m banked turn radius — wider than the ${rUturnNeeded.toFixed(1)} m available between rows.`);
    if (failClimb) issues.push(
      `${altDelta.toFixed(0)} m climb at ${spec.climb_rate_ms} m/s needs ~${climbHorizM.toFixed(0)} m of horizontal runway — more than the row-end space allows.`);
    return { ok: issues.length === 0, issues, rUturnNeeded, rBankTransit, climbHorizM };
  })();

  // ---- Auto-fix ----------------------------------------------------------
  // When the pattern fails maneuverability, nudge parameters until it passes:
  //   • bank-limited fail → drop transit speed to v = sqrt(spacing/2 · g·tan25°)
  //   • physical-radius fail → widen spacing to 2 · min_turn_radius_m
  //   • climb fail → drop transit/spray altitude delta by raising spray alt
  // Records what changed so the UI can report the auto-adjustment.
  const [autoFixNote, setAutoFixNote] = useState<string | null>(null);
  const fixingRef = useRef(false);
  useEffect(() => {
    if (maneuver.ok) { setAutoFixNote(null); return; }
    if (fixingRef.current) return;
    fixingRef.current = true;
    const fixes: string[] = [];

    // 1) Widen spacing if drone physically can't U-turn at current spacing.
    let newSpacing = spacingM;
    const minSpacing = Math.ceil(spec.min_turn_radius_m * 2);
    if (spacingM / 2 < spec.min_turn_radius_m && newSpacing < minSpacing) {
      newSpacing = Math.min(25, minSpacing);
      fixes.push(`spacing → ${newSpacing} m`);
    }

    // 2) Cap transit speed by bank-limited radius for the (possibly new) spacing.
    let newTransit = transitSpeed;
    const vMax = Math.sqrt((newSpacing / 2) * G * Math.tan(BANK_RAD));
    if (vMax < transitSpeed) {
      newTransit = Math.max(3, Math.floor(vMax * 2) / 2);
      fixes.push(`transit speed → ${newTransit} m/s`);
    }

    // 3) Reduce climb runway by trimming the altitude delta.
    let newSprayAlt = sprayAltM;
    const altDelta = Math.abs(transitAltM - sprayAltM);
    const climbHoriz = (altDelta / Math.max(0.5, spec.climb_rate_ms)) * newTransit;
    if (climbHoriz > newSpacing * 4) {
      const allowedDelta = (newSpacing * 4) * spec.climb_rate_ms / Math.max(1, newTransit);
      newSprayAlt = Math.max(1, Math.round((transitAltM - allowedDelta) * 2) / 2);
      if (newSprayAlt !== sprayAltM) fixes.push(`spray altitude → ${newSprayAlt} m`);
    }

    if (fixes.length) {
      if (newSpacing !== spacingM) { userTouchedSpacingRef.current = true; setSpacingM(newSpacing); }
      if (newTransit !== transitSpeed) setTransitSpeed(newTransit);
      if (newSprayAlt !== sprayAltM) setSprayAltM(newSprayAlt);
      setAutoFixNote(`Auto-adjusted: ${fixes.join(" · ")}`);
    }
    // Release after a tick so subsequent renders re-check the fixed values.
    setTimeout(() => { fixingRef.current = false; }, 50);
  }, [maneuver.ok, spacingM, transitSpeed, sprayAltM, transitAltM, spec.min_turn_radius_m, spec.climb_rate_ms]);

  const mission = (() => {
    if (!boundary || validZones.length === 0 || !effectiveHome) return null;
    return buildMission(
      boundary as LatLng2[][],
      validZones.map(z => ({ id: z.id, ring: z.ring })),
      { home: effectiveHome, transitAltM, sprayAltM, transitSpeed, spraySpeed, spacingM, repeats },
    );
  })();

  // ---- Simulation timeline (rebuilt whenever the mission changes) -------
  const simTimeline = useMemo(() => buildSimTimeline(mission), [mission]);
  // Reset playhead when the mission changes shape.
  useEffect(() => { setSimT(0); setSimPlaying(false); }, [simTimeline.total]);
  // RAF loop — advances simT by (dt * simSpeed). Stops at the end.
  useEffect(() => {
    if (!simPlaying || simTimeline.total <= 0) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setSimT(prev => {
        const next = prev + dt * simSpeed;
        if (next >= simTimeline.total) { setSimPlaying(false); return simTimeline.total; }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [simPlaying, simSpeed, simTimeline.total]);
  // Tank state across the whole mission, built once per plan rather than
  // stepped live — the scrubber can jump to a moment that was never played, and
  // slosh is stateful, so it has to be precomputed to answer that honestly.
  const tankPhysics = useMemo(() => physicsFor(droneModelKey), [droneModelKey]);
  const tankProfile = useMemo(() => {
    if (!simTimeline.segs.length || simTimeline.total <= 0) return null;
    return buildTankProfile(simTimeline.segs, simTimeline.total, {
      config: tankPhysics,
      startLitres: tankPhysics.tankCapacityL * (Math.max(0, Math.min(100, fp.tank_load_pct)) / 100),
      flowLpm: spec.spray_rate_lpm > 0 ? spec.spray_rate_lpm : undefined,
      tempC: wx?.temp_c,
    });
  }, [simTimeline, tankPhysics, fp.tank_load_pct, spec.spray_rate_lpm, wx?.temp_c]);

  const simState = simPosAt(simTimeline, simT);

  const saveBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  // ---- Exports -----------------------------------------------------------
  // Driven entirely by the registry in src/lib/exporters.ts. Which formats a
  // grower is offered is decided there, not here — the WPML route exporter is
  // still built and tested, but marked experimental and so never listed.
  const zonesWithRates = validZones.map(z => ({
    id: z.id,
    ring: z.ring,
    severity: z.severity,
    rateLha: resolveZoneRateLha(z, { ...settings, spray_rates_lha: rates }),
  }));

  const exportCtx: ExportContext = {
    taskId,
    mission,
    boundary: (boundary as LatLng2[][] | null) ?? null,
    zones: zonesWithRates,
    transitSpeed,
    spraySpeed,
    transitAltM,
  };

  const runExport = (exporter: ReturnType<typeof userFacingExporters>[number]) => {
    const blocked = exporter.blockedReason(exportCtx);
    if (blocked) { toast.error(blocked); return; }
    try {
      const out = exporter.build(exportCtx);
      saveBlob(out.blob, out.filename);
      toast.success(`${exporter.label} ready`, { description: out.detail });
    } catch (e) {
      toast.error(`${exporter.label} failed`, { description: (e as Error).message });
    }
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60); const sec = Math.round(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // ---- Battery / endurance estimation ------------------------------------
  // Formula per spec: base flight time × wind × altitude × payload × temp.
  // Wind only counts as a headwind when blowing into the dominant pass axis;
  // a crosswind gets half the penalty, a tailwind helps a little.
  const battery = (() => {
    // The model itself now lives in lib/missionStats.ts, because the schedule
    // snapshot has to be produced by the SAME calculation the planner shows
    // live. Two endurance models is two that drift, and you find out when a
    // pilot packs three batteries for a job the calendar promised needed two.
    const stats = computeMissionStats({
      mission, spec, sprayAltM, transitAltM,
      tankLoadPct: fp.tank_load_pct,
      zones: zonesWithRates.map(z => ({ areaM2: polygonAreaM2(z.ring), rateLha: z.rateLha })),
      wx,
    });
    if (!mission || stats.flightTimeMinutes <= 0) return null;
    const d = stats.derating;
    const pct = (f: number) => `${f >= 1 ? "+" : ""}${((f - 1) * 100).toFixed(0)}%`;
    return {
      baseFlightMin: d.baseFlightMin,
      estimatedFlightMin: stats.flightTimeMinutes,
      batteryPercent: d.batteryPercent,
      batteriesNeeded: stats.batteriesNeeded,
      windPctLabel: pct(d.windFactor), windKind: d.windKind, windMs: wx?.wind_ms ?? 0,
      altPctLabel: pct(d.altitudeFactor), avgAlt: d.avgAltM,
      payloadPctLabel: pct(d.payloadFactor),
      tempPctLabel: pct(d.tempFactor), tempC: wx?.temp_c ?? 20,
      cruiseMs: d.cruiseMs, recommendedTankL: d.recommendedTankL,
      stats,
    };
  })();

  // Midpoint along the mission path — surfaced as a yellow pin when a battery
  // swap is required, so the pilot can see where they'll be when the first
  // pack runs out.
  const swapPoint: LatLng2 | null = (() => {
    if (!mission || !battery || battery.batteriesNeeded <= 1) return null;
    // Walk waypoints in order; halt at fraction (battery 1 exhausts at ~80%
    // of estimated time of *that* battery).
    const wps = mission.waypoints;
    if (wps.length < 2) return null;
    const target = (mission.sprayDistM + mission.transitDistM) * (1 / battery.batteriesNeeded);
    let acc = 0;
    for (let i = 1; i < wps.length; i++) {
      const seg = distM(wps[i - 1], wps[i]);
      if (acc + seg >= target) {
        const t = (target - acc) / Math.max(0.01, seg);
        return {
          lat: wps[i - 1].lat + (wps[i].lat - wps[i - 1].lat) * t,
          lng: wps[i - 1].lng + (wps[i].lng - wps[i - 1].lng) * t,
        };
      }
      acc += seg;
    }
    return null;
  })();

  // ---- Live telemetry during playback ------------------------------------
  // Battery drains linearly over mission time (scaled to the estimated draw),
  // spray tank drains in proportion to spray distance covered, and distance
  // counters tick up segment-by-segment so the readout feels like real
  // telemetry instead of a static summary.
  const liveStats = useMemo(() => {
    if (!mission || simTimeline.total <= 0) return null;
    const totalDist = mission.sprayDistM + mission.transitDistM;
    const totalSprayDist = Math.max(0.01, mission.sprayDistM);
    let segIdx = -1;
    let distCovered = 0;
    let sprayCovered = 0;
    for (let i = 0; i < simTimeline.segs.length; i++) {
      const s = simTimeline.segs[i];
      if (simT >= s.tEnd) {
        distCovered += s.dist;
        if (s.spray) sprayCovered += s.dist;
      } else if (simT > s.tStart) {
        const f = (simT - s.tStart) / Math.max(0.0001, s.tEnd - s.tStart);
        distCovered += s.dist * f;
        if (s.spray) sprayCovered += s.dist * f;
        segIdx = i;
        break;
      } else { segIdx = i; break; }
    }
    if (segIdx === -1) segIdx = simTimeline.segs.length - 1;
    const cur = simTimeline.segs[segIdx];
    const lastIdx = simTimeline.segs.length - 1;
    const landed = simT >= simTimeline.total;
    const isRth = !landed && segIdx === lastIdx && cur && !cur.spray;
    const phase: "idle" | "spraying" | "transit" | "rth" | "landed" =
      landed ? "landed"
      : !simPlaying && simT === 0 ? "idle"
      : cur?.spray ? "spraying"
      : isRth ? "rth"
      : "transit";
    const drawPct = battery?.batteryPercent ?? 0;
    // Charge is spent by AMP-SECONDS, not by wall-clock. A linear-in-time drain
    // makes a full tank cost exactly what an empty one does per second, which is
    // wrong in the direction that matters: the aircraft is at its heaviest on the
    // outbound leg, and hover power goes as mass^1.5. The tank profile already
    // integrates the real draw, so the bar follows that curve — steep while
    // loaded, shallower on the way home.
    const consumedFrac = tankProfile && tankProfile.totalAmpS > 0
      ? (sampleTankAt(tankProfile, simT)?.cumAmpS ?? 0) / tankProfile.totalAmpS
      : Math.min(1, simT / simTimeline.total);
    const batteryRemaining = Math.max(0, 100 - consumedFrac * drawPct);
    const tankStart = Math.max(0, Math.min(100, fp.tank_load_pct || 100));
    const tankRemaining = Math.max(0, tankStart * (1 - sprayCovered / totalSprayDist));
    return {
      phase, distCovered, totalDist, sprayCovered, totalSprayDist,
      batteryRemaining, batteryStart: 100, tankRemaining, tankStart,
    };
  }, [simT, simTimeline, mission, battery, fp.tank_load_pct, simPlaying, tankProfile]);

  // Empty states ------------------------------------------------------------
  if (!boundary || boundary.length === 0) {
    return (
      <div className="absolute inset-0 grid place-items-center text-center p-8" style={{ background: "#0f0f0f" }}>
        <div className="max-w-md">
          <Plane className="h-8 w-8 mx-auto mb-3 text-[#4CAF50]" />
          <h2 className="text-lg font-semibold mb-1">Flight Planner</h2>
          <p className="text-sm text-neutral-500 mb-4">Define your field boundary first — the planner needs a hard no-fly perimeter before it can lay down flight lines.</p>
          <button onClick={() => setActiveTab("field")} className="text-xs bg-[#4CAF50] hover:bg-[#43a047] text-black rounded-sm px-3 py-2 font-semibold">
            Go to Field View
          </button>
        </div>
      </div>
    );
  }
  if (allZonesRaw.length === 0) {
    return (
      <div className="absolute inset-0 grid place-items-center text-center p-8" style={{ background: "#0f0f0f" }}>
        <div className="max-w-md">
          <Plane className="h-8 w-8 mx-auto mb-3 text-[#4CAF50]" />
          <h2 className="text-lg font-semibold mb-1">Flight Planner</h2>
          <p className="text-sm text-neutral-500 mb-4">Run AI analysis or draw a manual anomaly first — the planner generates lawnmower patterns over treatment zones.</p>
          <button onClick={runAnalysis} className="text-xs bg-[#4CAF50] hover:bg-[#43a047] text-black rounded-sm px-3 py-2 font-semibold inline-flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5" /> Analyze field
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex" style={{ background: "#0f0f0f" }}>
      {/* Map preview */}
      <div className="flex-1 relative">
        <MapContainer
          bounds={bounds ?? undefined}
          boundsOptions={{ padding: [40, 40] }}
          minZoom={1} maxZoom={22} preferCanvas
          zoomControl={false} attributionControl={false}
          style={{ height: "100%", width: "100%", background: "#0a0a0a" }}
        >
          <BasemapLayer id={basemap} />
          {tileUrl && bounds && (
            <TileLayer
              key={tileUrl} url={tileUrl}
              maxNativeZoom={Math.min(20, maxNative)} maxZoom={22}
              tileSize={256} keepBuffer={4}
              bounds={bounds} noWrap zIndex={10}
            />
          )}
          <PlannerOverlay
            boundary={boundary} zones={validZones}
            mission={mission} home={effectiveHome}
            onHomeChange={(p) => setHome(p)}
            swapPoint={swapPoint}
          />
          <BasemapToggle
            value={basemap}
            onChange={(id) => { setBasemap(id); saveBasemap(id); }}
            className="absolute bottom-4 right-4 z-[1000]"
          />
          <DroneSimMarker sim={simState} />
        </MapContainer>
        {/* Top-right of the plan display, alongside the map's own controls. */}
        <div className="absolute top-3 right-3 z-[500]">
          {/* Deliberately NOT disabled when there is no plan. A disabled button
              that only explains itself in a title attribute is a button that
              does nothing for a reason nobody can see — say the reason out loud
              instead. */}
          <button
            onClick={() => {
              if (!mission) {
                toast.error("Mark at least one treatment zone first — there is no flight plan to schedule yet.");
                return;
              }
              setScheduleOpen(true);
            }}
            title="Put this plan on the schedule"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-sm text-xs font-semibold transition-colors bg-[#4CAF50] hover:bg-[#43a047] text-black"
          >
            <CalendarDays className="h-3.5 w-3.5" /> Schedule
          </button>
        </div>
        {/* Panel control. Hiding every panel must never be a one-way door, so
            the way back is always on screen — and Reset puts every panel back
            where it started, which is what makes experimenting with the layout
            safe. */}
        <div className="absolute top-3 right-3 z-[560] flex items-center gap-1 rounded-md border border-[#222] px-1 py-1"
             style={{ background: "rgba(10,10,10,0.86)", backdropFilter: "blur(4px)" }}>
          {([
            ["tank", "Tank", Droplets],
            ["sim", "Sim", Play],
            ["legend", "Legend", MapIcon],
          ] as const).map(([id, label, Icon]) => (
            <button key={id}
              onClick={() => setPanel(id, { ...panels[id], visible: !panels[id].visible })}
              title={`${panels[id].visible ? "Hide" : "Show"} ${label}`}
              aria-pressed={panels[id].visible}
              className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-[10px] transition-colors ${
                panels[id].visible
                  ? "bg-[#4CAF50]/15 text-[#4CAF50]"
                  : "text-neutral-500 hover:text-neutral-300"}`}>
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
          <span className="w-px self-stretch bg-[#222] mx-0.5" />
          <button onClick={resetPanels} title="Reset panel layout"
            className="inline-flex items-center rounded-sm px-1.5 py-1 text-neutral-500 hover:text-neutral-200 transition-colors">
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>

        {tankProfile && panels.tank.visible && (
          <FloatingPanel
            title="Tank dynamics"
            state={panels.tank}
            limits={{ min: { w: 250, h: 110 }, max: { w: 460, h: 260 } }}
            rect={mapRect}
            badge={<span className="font-mono normal-case tracking-normal text-neutral-500">
              {((sampleTankAt(tankProfile, simT)?.litres ?? 0) * tankPhysics.fluidDensityKgPerL).toFixed(1)} kg
            </span>}
            onChange={n => setPanel("tank", n)}
            onHide={() => setPanel("tank", { ...panels.tank, visible: false })}
          >
            <TankDynamicsWidget
              profile={tankProfile}
              cfg={tankPhysics}
              simT={simT}
              open
              onToggle={() => {}}
              chrome={false}
            />
          </FloatingPanel>
        )}

        {/* Simulation transport floats over the map rather than living in the
            sidebar: it controls what the MAP shows, and parking it hundreds of
            pixels of scroll away meant driving the video from another room. */}
        {mission && simTimeline.total > 0 && panels.sim.visible && (
          <FloatingPanel
            title="Simulation"
            state={panels.sim}
            limits={{ min: { w: 320, h: 150 }, max: { w: 760, h: 420 } }}
            rect={mapRect}
            badge={<span className="font-mono normal-case tracking-normal text-neutral-500">
              {fmtTime(simT)} / {fmtTime(simTimeline.total)}
            </span>}
            onChange={n => setPanel("sim", n)}
            onHide={() => setPanel("sim", { ...panels.sim, visible: false })}
          >
            <div className="rounded-sm border border-[#222] p-3 space-y-3" style={{ background: "#0f0f0f" }}>
              {/* Progress scrubber */}
              <div className="relative">
                <input
                  type="range" min={0} max={simTimeline.total} step={0.1} value={simT}
                  onChange={(e) => { setSimT(parseFloat(e.target.value)); }}
                  className="w-full accent-[#4CAF50]"
                />
                {/* Spray-segment heatmap under the scrubber */}
                <div className="relative h-1.5 -mt-1 rounded-sm overflow-hidden bg-[#1a1a1a]">
                  {simTimeline.segs.filter(s => s.spray).map((s, i) => (
                    <div key={i}
                      className="absolute top-0 bottom-0 bg-cyan-400/70"
                      style={{
                        left: `${(s.tStart / simTimeline.total) * 100}%`,
                        width: `${Math.max(0.3, ((s.tEnd - s.tStart) / simTimeline.total) * 100)}%`,
                      }}
                    />
                  ))}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-white"
                    style={{ left: `${(simT / Math.max(0.001, simTimeline.total)) * 100}%` }}
                  />
                </div>
              </div>
              {/* Transport controls */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (simT >= simTimeline.total) setSimT(0);
                    setSimPlaying(p => !p);
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 bg-[#4CAF50] hover:bg-[#43a047] text-black rounded-sm px-3 py-2 text-xs font-semibold"
                >
                  {simPlaying
                    ? (<><Pause className="h-3.5 w-3.5" /> Pause</>)
                    : (<><Play className="h-3.5 w-3.5" /> {simT > 0 && simT < simTimeline.total ? "Resume" : "Play"}</>)}
                </button>
                <button
                  onClick={() => { setSimPlaying(false); setSimT(0); }}
                  className="inline-flex items-center justify-center gap-1 border border-[#222] hover:border-[#333] text-neutral-300 rounded-sm px-2.5 py-2 text-xs"
                  title="Reset"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>
              {/* Speed selector */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1 flex items-center gap-1.5">
                  <FastForward className="h-3 w-3" /> Playback speed
                </div>
                <div className="grid grid-cols-6 gap-1">
                  {[1, 2, 4, 8, 16, 32].map(m => (
                    <button key={m}
                      onClick={() => setSimSpeed(m)}
                      className={`text-[11px] font-mono py-1 rounded-sm border ${
                        simSpeed === m
                          ? "bg-[#4CAF50] text-black border-[#4CAF50]"
                          : "bg-[#1a1a1a] text-neutral-400 border-[#222] hover:border-[#333]"
                      }`}
                    >{m}×</button>
                  ))}
                </div>
              </div>
              {/* Status readout — phase-tinted dot for scan-at-a-glance */}
              {(() => {
                const phase = liveStats?.phase ?? "idle";
                const styleByPhase: Record<string, { text: string; dot: string; label: string; pulse: boolean }> = {
                  spraying: { text: "text-green-300",   dot: "bg-green-400",   label: "Spraying", pulse: true  },
                  transit:  { text: "text-yellow-300",  dot: "bg-yellow-400",  label: "Transit",  pulse: false },
                  rth:      { text: "text-red-400",     dot: "bg-red-500",     label: "RTH",      pulse: true  },
                  landed:   { text: "text-neutral-400", dot: "bg-neutral-500", label: "Landed",   pulse: false },
                  idle:     { text: "text-neutral-400", dot: "bg-neutral-500", label: "Idle",     pulse: false },
                };
                const s = styleByPhase[phase];
                return (
                  <div className="flex items-center justify-between text-[11px] pt-1 border-t border-[#222]">
                    <span className="text-neutral-500">Status</span>
                    <span className={`font-mono inline-flex items-center gap-1.5 ${s.text}`}>
                      <span className={`inline-block w-2 h-2 rounded-full ${s.dot} ${s.pulse ? "animate-pulse" : ""}`} />
                      {s.label}
                    </span>
                  </div>
                );
              })()}
              {/* Live telemetry — battery / tank / distance tick down as the
                  drone flies. Hidden until the user hits play so the panel
                  doesn't show 100% / 0 km when nothing's happening. */}
              {liveStats && (simT > 0 || simPlaying) && (
                <div className="space-y-2 pt-2 border-t border-[#222]">
                  {/* Battery */}
                  <div>
                    <div className="flex justify-between text-[10px] mb-0.5">
                      <span className="text-neutral-500 uppercase tracking-wider">Battery</span>
                      <span className={`font-mono ${liveStats.batteryRemaining < 20 ? "text-red-400" : liveStats.batteryRemaining < 40 ? "text-yellow-300" : "text-green-300"}`}>
                        {liveStats.batteryRemaining.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-sm overflow-hidden bg-[#1a1a1a]">
                      <div className={`h-full transition-[width] duration-150 ${
                        liveStats.batteryRemaining < 20 ? "bg-red-500"
                        : liveStats.batteryRemaining < 40 ? "bg-yellow-400"
                        : "bg-green-500"
                      }`} style={{ width: `${liveStats.batteryRemaining}%` }} />
                    </div>
                  </div>
                  {/* Spray tank */}
                  <div>
                    <div className="flex justify-between text-[10px] mb-0.5">
                      <span className="text-neutral-500 uppercase tracking-wider">Spray tank</span>
                      <span className="font-mono text-cyan-300">
                        {liveStats.tankRemaining.toFixed(1)}% <span className="text-neutral-600">of {liveStats.tankStart.toFixed(0)}%</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-sm overflow-hidden bg-[#1a1a1a]">
                      <div className="h-full bg-cyan-400 transition-[width] duration-150"
                        style={{ width: `${(liveStats.tankRemaining / Math.max(1, liveStats.tankStart)) * 100}%` }} />
                    </div>
                  </div>
                  {/* Distance */}
                  <div className="flex justify-between text-[11px] pt-0.5">
                    <span className="text-neutral-500">Distance flown</span>
                    <span className="font-mono text-neutral-300">
                      {fmtDistance(liveStats.distCovered, units).value.toFixed(2)} <span className="text-neutral-600">/ {fmtDistance(liveStats.totalDist, units).text}</span>
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-neutral-500">Sprayed</span>
                    <span className="font-mono text-cyan-300">
                      {fmtDistance(liveStats.sprayCovered, units).value.toFixed(2)} <span className="text-neutral-600">/ {fmtDistance(liveStats.totalSprayDist, units).text}</span>
                    </span>
                  </div>
                </div>
              )}
            </div>
          </FloatingPanel>
        )}

        {panels.legend.visible && (
          <FloatingPanel
            title="Legend"
            state={panels.legend}
            limits={{ min: { w: 180, h: 84 }, max: { w: 340, h: 220 } }}
            rect={mapRect}
            onChange={n => setPanel("legend", n)}
            onHide={() => setPanel("legend", { ...panels.legend, visible: false })}
          >
            <div className="text-[10px] uppercase tracking-wider flex flex-col gap-1 text-[10px] uppercase tracking-wider px-2 py-1.5 rounded-sm border border-[#222] flex flex-col gap-1">
          <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-full bg-red-500" /> Home (drag or click map)</div>
          <div className="flex items-center gap-2"><span className="inline-block w-4 border-t-2 border-dashed border-yellow-400" /> Transit (sprayer off)</div>
          <div className="flex items-center gap-2"><span className="inline-block w-4 border-t-2 border-cyan-400" /> Spray pattern</div>
          {swapPoint && (
            <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-full bg-yellow-400 border border-black" /> Battery swap</div>
          )}
            </div>
          </FloatingPanel>
        )}
      </div>

      {/* scanId is null, NOT taskId. `jobs.scan_id` is a foreign key onto
          `scans`, the older single-image table; this workspace runs on
          `odm_tasks`, and the two are independent — both keyed to a field,
          neither referencing the other. So there is no scan id to give, and the
          odm_task id goes to flight_plan_id instead, which carries no
          constraint and is what links the calendar entry back to this plan. */}
      <ScheduleMissionModal
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        mission={mission}
        zones={zonesWithRates.map(z => ({ areaM2: polygonAreaM2(z.ring), rateLha: z.rateLha }))}
        drones={drones}
        fallbackSpec={spec}
        sprayAltM={sprayAltM}
        transitAltM={transitAltM}
        tankLoadPct={fp.tank_load_pct}
        fieldId={fieldId}
        scanId={null}
        flightPlanId={taskId}
        center={{ lat: center[0], lng: center[1] }}
        fieldName={fieldName ?? ""}
        initialDroneId={fp.drone_id}
        onScheduled={() => { /* the Schedule tab reads on mount */ }}
      />

      {/* Right control panel */}
      <div className="w-80 shrink-0 border-l border-[#222] overflow-auto p-4" style={{ background: "#161616" }}>
        <div className="flex items-center gap-2 mb-4">
          <Plane className="h-4 w-4 text-[#4CAF50]" />
          <div className="text-sm font-semibold">Flight Planner</div>
        </div>

        {/* Two tabs, not one scroll. Setup is what you touch before a job;
            Mission is what the job tells you back. Nothing was cut — deep
            control is the point, the fix is grouping. */}
        <div className="grid grid-cols-2 gap-1 mb-4 rounded-sm border border-[#222] p-1" style={{ background: "#0f0f0f" }}>
          {([["setup", "Config & Hardware"], ["mission", "Telemetry & Export"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setSideTab(k)}
              className={`text-[11px] py-1.5 rounded-sm transition-colors ${
                sideTab === k
                  ? "bg-[#4CAF50] text-black font-semibold"
                  : "text-neutral-400 hover:text-neutral-200"}`}>
              {label}
            </button>
          ))}
        </div>

        {sideTab === "setup" && (<>
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Pre-flight battery</div>
        <div className="rounded-sm border border-[#222] p-3 mb-4" style={{ background: "#0f0f0f" }}>
          {drones.length === 0 ? (
            <div className="text-[11px] text-neutral-600 italic leading-relaxed">
              Register a drone in <span className="text-neutral-400">Fleet</span> to enable battery simulation
            </div>
          ) : !activeDrone ? (
            <div className="text-[11px] text-neutral-500 leading-relaxed">
              Select an active drone below to simulate pre-flight battery.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-neutral-500">Launch with</span>
                <span className={`font-mono text-sm ${preFlightBattery < 30 ? "text-red-400" : preFlightBattery < 60 ? "text-yellow-300" : "text-[#4CAF50]"}`}>
                  {preFlightBattery}%
                </span>
              </div>
              <input
                type="range" min={0} max={100} step={1}
                value={preFlightBattery}
                onChange={(e) => setPreFlightBattery(Number(e.target.value))}
                className="w-full accent-[#4CAF50]"
              />
              <div className="text-[10px] text-neutral-600 mt-1">
                Stored: {activeDrone.battery}% — adjust to simulate a partial charge.
              </div>
            </>
          )}
        </div>

        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Pattern</div>
        <div className="rounded-sm border border-[#222] p-3 mb-4 space-y-3" style={{ background: "#0f0f0f" }}>
          <button
            type="button"
            onClick={() => {
              userTouchedSpacingRef.current = false;
              setSpacingM(recommendedSpacing);
              setRepeats(1);
              setTransitAltM(30);
              setSprayAltM(3);
              setTransitSpeed(10);
              setSpraySpeed(3);
            }}
            className="w-full rounded-sm border border-[#4CAF50]/40 bg-[#4CAF50]/10 hover:bg-[#4CAF50]/20 text-[#4CAF50] text-[11px] font-medium py-2 transition"
          >
            ✨ Generate recommended flight plan
          </button>
          {(() => {
            const recommended = recommendedSpacing;
            const atRec = spacingM === recommended;
            return (
              <>
                <Slider2
                  label={`Swath spacing  ·  recommended ${recommended} m${atRec ? "  ·  auto" : ""}`}
                  value={spacingM}
                  setValue={(n) => { userTouchedSpacingRef.current = true; setSpacingM(n); }}
                  min={3} max={25} step={1} unit="m"
                />
                {!atRec && (
                  <button
                    type="button"
                    onClick={() => { userTouchedSpacingRef.current = false; setSpacingM(recommended); }}
                    className="text-[10px] text-[#4CAF50] hover:underline -mt-1"
                  >
                    ↺ Reset to recommended ({recommended} m)
                  </button>
                )}
              </>
            );
          })()}
          <Slider2
            label={`Spray coverage  ·  ${repeats}× pass${repeats > 1 ? "es" : ""}`}
            value={repeats}
            setValue={setRepeats}
            min={1} max={4} step={1} unit="×"
          />
          <div className="text-[10px] text-neutral-500 -mt-1">
            Each anomaly zone gets its own lawnmower. Increase pass count for heavy infestation — multiplies tank, time, and battery usage.
          </div>
          {/* Altitude and speed matter, but not every job: the recommended plan
              sets them, and an operator who wants them digs exactly one level.
              Spacing and coverage stay out front because those are the two that
              change per field. Nothing is removed — only folded. */}
          <button type="button"
            onClick={() => setAdvancedOpen(v => !v)}
            aria-expanded={advancedOpen}
            className="w-full flex items-center justify-between text-[10px] uppercase tracking-wider text-neutral-500 hover:text-neutral-300 transition-colors pt-2 border-t border-[#1f1f1f]">
            <span>Advanced flight dynamics</span>
            <span className="inline-flex items-center gap-1.5 normal-case tracking-normal font-mono text-neutral-600">
              {!advancedOpen && `${transitAltM}/${sprayAltM} m · ${transitSpeed}/${spraySpeed} m/s`}
              {advancedOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </span>
          </button>
          {advancedOpen && (
            <div className="space-y-3 pt-1">
            <Slider2 label="Transit altitude (AGL)" value={transitAltM} setValue={setTransitAltM} min={10} max={120} step={1} unit="m" />
            <Slider2 label="Spray altitude (AGL)" value={sprayAltM} setValue={setSprayAltM} min={1} max={10} step={0.5} unit="m" />
            <Slider2 label="Transit speed" value={transitSpeed} setValue={setTransitSpeed} min={3} max={20} step={0.5} unit="m/s" />
            <Slider2 label="Spray speed" value={spraySpeed} setValue={setSpraySpeed} min={1} max={8} step={0.5} unit="m/s" />
            </div>
          )}
        </div>

        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Drone</div>
        <div className="rounded-sm border border-[#222] p-3 mb-4 text-xs space-y-3" style={{ background: "#0f0f0f" }}>
          {drones.length === 0 ? (
            <div className="text-[11px] text-neutral-400 leading-relaxed">
              No drones in your fleet yet. Register one on the <span className="text-[#4CAF50]">Fleet</span> page to get accurate battery estimates.
            </div>
          ) : (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-500">Active drone</label>
              <select
                value={fp.drone_id ?? ""}
                onChange={(e) => updateFlightPlan({ drone_id: e.target.value || null })}
                className="mt-1 w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1.5 text-xs text-[#f0f0f0] focus:outline-none focus:border-[#4CAF50]"
              >
                <option value="">— Select drone —</option>
                {drones.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name} · {d.model}{d.status !== "idle" ? ` · ${d.status.replace("_", " ")}` : ""}
                  </option>
                ))}
              </select>
              {activeDrone && (
                <div className="mt-2 text-[10px] text-neutral-500 font-mono">
                  Battery now: <span className="text-neutral-300">{activeDrone.battery}%</span> · Spec: {fmtVolume(spec.tank_l, units, 0).text} / {spec.max_flight_min} min / {spec.max_speed_ms} m/s
                </div>
              )}
            </div>
          )}
          {isCustom && (
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#1f1f1f]">
              <div className="col-span-2 text-[10px] uppercase tracking-wider text-neutral-500">Custom specs</div>
              <label className="text-[10px] text-neutral-500">Tank (L)
                <input type="number" min={0} step={1} value={fp.custom_specs.tank_l}
                  onChange={(e) => updateFlightPlan({ custom_specs: { ...fp.custom_specs, tank_l: Number(e.target.value) || 0 } })}
                  className="mt-0.5 w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1 text-xs font-mono" />
              </label>
              <label className="text-[10px] text-neutral-500">Payload (kg)
                <input type="number" min={0} step={1} value={fp.custom_specs.payload_kg}
                  onChange={(e) => updateFlightPlan({ custom_specs: { ...fp.custom_specs, payload_kg: Number(e.target.value) || 0 } })}
                  className="mt-0.5 w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1 text-xs font-mono" />
              </label>
              <label className="text-[10px] text-neutral-500">Flight time (min)
                <input type="number" min={1} step={1} value={fp.custom_specs.max_flight_min}
                  onChange={(e) => updateFlightPlan({ custom_specs: { ...fp.custom_specs, max_flight_min: Number(e.target.value) || 1 } })}
                  className="mt-0.5 w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1 text-xs font-mono" />
              </label>
              <label className="text-[10px] text-neutral-500">Max speed (m/s)
                <input type="number" min={1} step={0.5} value={fp.custom_specs.max_speed_ms}
                  onChange={(e) => updateFlightPlan({ custom_specs: { ...fp.custom_specs, max_speed_ms: Number(e.target.value) || 1 } })}
                  className="mt-0.5 w-full bg-[#0a0a0a] border border-[#222] rounded-sm px-2 py-1 text-xs font-mono" />
              </label>
            </div>
          )}
          <div className="pt-2 border-t border-[#1f1f1f]">
            <Slider2 label="Tank load" value={fp.tank_load_pct}
              setValue={(n) => updateFlightPlan({ tank_load_pct: n })}
              min={0} max={100} step={5} unit="%" />
          </div>
        </div>

        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Home / Takeoff</div>
        <div className="rounded-sm border border-[#222] p-3 mb-4 text-xs space-y-1.5" style={{ background: "#0f0f0f" }}>
          <div className="flex justify-between"><span className="text-neutral-500">Latitude</span>
            <span className="font-mono">{effectiveHome?.lat.toFixed(6) ?? "—"}</span></div>
          <div className="flex justify-between"><span className="text-neutral-500">Longitude</span>
            <span className="font-mono">{effectiveHome?.lng.toFixed(6) ?? "—"}</span></div>
          <button onClick={() => setHome(null)} className="text-[10px] text-[#4CAF50] hover:underline">Reset to field centroid</button>
        </div>

        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">
          Application rate
        </div>
        <div className="rounded-sm border border-[#1f3a1f] p-3 mb-4 text-xs">
          <div className="grid grid-cols-3 gap-2">
            {(["low", "medium", "high"] as const).map(sev => (
              <label key={sev} className="block">
                <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-neutral-500">
                  <span className="h-2 w-2 rounded-full" style={{ background: sevColor(sev) }} />
                  {sev}
                </span>
                <input
                  type="number" min={0} max={200} step={0.5}
                  value={rates[sev]}
                  onChange={e => setRates({ ...rates, [sev]: Math.max(0, Number(e.target.value)) })}
                  className="mt-1 w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded-sm px-1.5 py-1 font-mono text-xs text-neutral-200"
                />
              </label>
            ))}
          </div>
          <div className="mt-2 text-[10px] text-neutral-500 leading-relaxed">
            Litres per hectare, by zone severity. This is the dose the DJI prescription raster is
            built from — the .waypoints export only carries a pump on/off, so it has no rate to
            inherit. Set it from your product label, not from the AI's written recommendation.
          </div>
          {zonesWithRates.length > 0 && (
            <div className="mt-2 border-t border-[#1f3a1f] pt-2 space-y-1">
              {zonesWithRates.map((z, i) => (
                <div key={z.id} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: sevColor(z.severity) }} />
                  <span className="text-[11px] text-neutral-400 truncate flex-1">
                    Zone {i + 1}
                    {settings.zone_rate_overrides?.[z.id] != null && (
                      <span className="text-neutral-600"> · pinned</span>
                    )}
                  </span>
                  {/* Shown in the viewer's units, ALWAYS stored as L/ha.
                      The label alone following the setting would be the worst
                      of both: the same 15 relabelled gal/ac is a nine-fold
                      overdose on the aircraft. */}
                  <input
                    type="number" min={0}
                    max={units === "metric" ? 200 : 21}
                    step={units === "metric" ? 0.5 : 0.05}
                    value={Number(rateValue(z.rateLha, units).toFixed(units === "metric" ? 1 : 2))}
                    onChange={e => {
                      const v = rateToLha(Math.max(0, Number(e.target.value)), units);
                      onSaveSettings({
                        ...settings,
                        zone_rate_overrides: { ...settings.zone_rate_overrides, [z.id]: v },
                      });
                    }}
                    className="w-16 bg-[#0f0f0f] border border-[#2a2a2a] rounded-sm px-1.5 py-0.5 font-mono text-[11px] text-right text-neutral-200"
                  />
                  <span className="text-[10px] text-neutral-600 w-12">{rateUnit(units)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        </>)}

        {sideTab === "mission" && (<>
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2 flex items-center justify-between">
          <span>Maneuverability</span>
          <InfoTip>
            Min turn radius {spec.min_turn_radius_m} m · climb {spec.climb_rate_ms} m/s. Spacing and
            transit speed are auto-tuned so every U-turn fits within the drone&rsquo;s physical limits.
          </InfoTip>
        </div>
        <div className={`rounded-sm border p-3 mb-4 text-xs space-y-2 ${maneuver.ok ? "border-[#1f3a1f]" : "border-amber-900/60"}`}
             style={{ background: maneuver.ok ? "#0c1a0c" : "#1a140a" }}>
          <div className="flex items-center justify-between">
            <span className={`font-medium ${maneuver.ok ? "text-[#4CAF50]" : "text-amber-300"}`}>
              {maneuver.ok ? "✓ Flyable by " : "⚠ Adjusting for "} {droneModelKey}
            </span>
            <span className="font-mono text-[10px] text-neutral-500">
              U-turn need {maneuver.rUturnNeeded.toFixed(1)} m · bank {maneuver.rBankTransit.toFixed(1)} m
            </span>
          </div>
          {!maneuver.ok && maneuver.issues.map((m, i) => (
            <div key={i} className="text-[11px] text-amber-200/80 leading-relaxed">• {m}</div>
          ))}
          {autoFixNote && (
            <div className="text-[11px] text-[#4CAF50] leading-relaxed pt-1 border-t border-[#1f1f1f]">
              {autoFixNote}
            </div>
          )}
        </div>

        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">
          Mission estimate
        </div>
        {/* The Agras re-plans its own lines on the aircraft from the boundary and
            Rx map, so these figures describe our pattern, not the one it flies.
            Close enough to plan a day around; not a guarantee. Say so. */}
        <div className="mb-2 text-[10px] text-neutral-500 leading-relaxed">
          Estimated from our own flight pattern. An Agras plans its own lines on the aircraft, so
          the figures it reports will differ — use these to plan tank loads, batteries and time,
          not as a guarantee.
        </div>
        <div className="rounded-sm border border-[#222] p-3 mb-4 text-xs space-y-1.5" style={{ background: "#0f0f0f" }}>
          <div className="flex justify-between"><span className="text-neutral-500">Zones</span>
            <span className="font-mono">{validZones.length} of {allZonesRaw.length} <span className="text-neutral-600">(AI {aiZonesRaw.length} · marks {userZonesRaw.length})</span></span></div>
          <div className="flex justify-between"><span className="text-neutral-500">Waypoints (our pattern)</span>
            <span className="font-mono">{mission?.waypoints.length ?? 0}</span></div>
          <div className="flex justify-between"><span className="text-neutral-500">Est. spray distance</span>
            <span className="font-mono text-cyan-300">{fmtDistance(mission?.sprayDistM ?? 0, units).text}</span></div>
          <div className="flex justify-between"><span className="text-neutral-500">Est. transit distance</span>
            <span className="font-mono text-yellow-300">{fmtDistance(mission?.transitDistM ?? 0, units).text}</span></div>
          <div className="border-t border-[#222] my-1.5" />
          <div className="flex justify-between"><span className="text-neutral-500">Est. spray time</span>
            <span className="font-mono text-cyan-300">{mission ? fmtTime(mission.sprayTimeS) : "0:00"}</span></div>
          <div className="flex justify-between"><span className="text-neutral-500">Est. transit time</span>
            <span className="font-mono text-yellow-300">{mission ? fmtTime(mission.transitTimeS) : "0:00"}</span></div>
          <div className="flex justify-between font-semibold"><span>Est. total time</span>
            <span className="font-mono">{mission ? fmtTime(mission.sprayTimeS + mission.transitTimeS) : "0:00"}</span></div>
          <div className="border-t border-[#222] my-1.5" />
          <div className="flex justify-between"><span className="text-neutral-500">Spray activations</span>
            <span className="font-mono">{mission?.sprayOnCount ?? 0}</span></div>
        </div>

        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2 flex items-center justify-between">
          <span>Battery / endurance (estimated)</span>
          {!wx && <span className="text-[10px] text-neutral-600 normal-case font-normal tracking-normal">No weather — open Weather tab</span>}
        </div>
        <div className="rounded-sm border border-[#222] p-3 mb-4 text-xs space-y-1.5" style={{ background: "#0f0f0f" }}>
          {!battery ? (
            <div className="text-[11px] text-neutral-500">Generate a mission to see battery estimate.</div>
          ) : (
            <>
              <div className="flex justify-between"><span className="text-neutral-500">Est. flight time</span>
                <span className="font-mono">{battery.estimatedFlightMin.toFixed(1)} min</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Est. battery used</span>
                <span className={`font-mono ${battery.batteryPercent > 80 ? "text-red-400" : battery.batteryPercent > 60 ? "text-yellow-300" : "text-[#4CAF50]"}`}>
                  {Math.round(battery.batteryPercent)}% of {spec.max_flight_min} min
                </span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Est. batteries needed</span>
                <span className={`font-mono ${battery.batteriesNeeded > 1 ? "text-red-400" : "text-[#4CAF50]"}`}>{battery.batteriesNeeded}</span></div>
              <div className="border-t border-[#222] my-1.5" />
              <div className="flex justify-between"><span className="text-neutral-500">Wind impact</span>
                <span className="font-mono">
                  {battery.windPctLabel}
                  <span className="text-neutral-500"> ({battery.windKind}{battery.windMs > 0 ? ` ${battery.windMs.toFixed(1)} m/s` : ""})</span>
                </span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Altitude impact</span>
                <span className="font-mono">{battery.altPctLabel} <span className="text-neutral-500">(avg {fmtAltitude(battery.avgAlt, units).text} AGL)</span></span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Payload impact</span>
                <span className="font-mono">{battery.payloadPctLabel} <span className="text-neutral-500">({fp.tank_load_pct}% tank)</span></span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Temp impact</span>
                <span className="font-mono">{battery.tempPctLabel} <span className="text-neutral-500">({battery.tempC.toFixed(0)}°C)</span></span></div>
              {spec.tank_l > 0 && (
                <>
                  <div className="border-t border-[#222] my-1.5" />
                  <div className="flex justify-between"><span className="text-neutral-500">Tank capacity</span>
                    <span className="font-mono">{droneModelKey} — {fmtVolume(spec.tank_l, units, 0).text}</span></div>
                  <div className="flex justify-between"><span className="text-neutral-500">Recommended load</span>
                    <span className="font-mono text-[#4CAF50]">{fmtVolume(battery.recommendedTankL, units, 1).text}</span></div>
                </>
              )}
            </>
          )}
        </div>

        {battery && battery.batteriesNeeded > 1 && (
          <div className="mb-4 text-[11px] text-red-400 bg-red-950/40 border border-red-800/50 rounded px-2 py-2 leading-relaxed">
            <div className="font-semibold mb-0.5">Mission requires {battery.batteriesNeeded} batteries</div>
            Plan a landing zone near the yellow swap pin on the map between passes.
          </div>
        )}

        {battery && activeDrone && Math.round(battery.batteryPercent) > preFlightBattery && (
          <div className="mb-4 text-[11px] text-yellow-300 bg-yellow-950/40 border border-yellow-700/50 rounded px-2 py-2 leading-relaxed">
            ⚠️ Insufficient battery — mission requires ~{Math.round(battery.batteryPercent)}% but drone starts at {preFlightBattery}%. Consider splitting into 2 flights.
          </div>
        )}

        {validZones.length < allZonesRaw.length && (
          <div className="mb-4 text-[11px] text-yellow-400/80 bg-yellow-900/20 border border-yellow-700/40 rounded px-2 py-1.5">
            {allZonesRaw.length - validZones.length} zone(s) excluded — centroid outside boundary.
          </div>
        )}

        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2 flex items-center justify-between">
          <span>Export</span>
          <InfoTip>
            <b className="text-neutral-400">Agras .zip</b> — unzip onto the card so <code>DJI/</code>
            sits at the root. Boundary shapefile plus a prescription raster, both WGS84. The aircraft
            plans its own flight lines from these; the pattern below is our estimate of what it will
            fly, not a route we hand it.
            <br />
            <b className="text-neutral-400">.waypoints</b> — QGC WPL 110 with takeoff, transit
            (sprayer off), spray (servo ON/OFF on servo 8), RTH and land. For Mission Planner or
            QGroundControl. Agras cannot read it.
          </InfoTip>
        </div>
        {userFacingExporters().map((exp, i) => {
          const blocked = exp.blockedReason(exportCtx);
          return (
            <div key={exp.id} className="mb-2">
              <button
                onClick={() => runExport(exp)}
                disabled={!!blocked}
                title={blocked ?? exp.description}
                className={`w-full inline-flex items-center justify-center gap-2 rounded-sm px-3 py-2 text-xs font-semibold ${
                  i === 0
                    ? "bg-[#4CAF50] hover:bg-[#43a047] disabled:bg-[#1a1a1a] disabled:text-neutral-600 text-black"
                    : "bg-[#1a1a1a] hover:bg-[#222] disabled:opacity-50 text-neutral-200 border border-[#2a2a2a]"
                }`}
              >
                <Download className={`h-3.5 w-3.5 ${i === 0 ? "" : "text-[#4CAF50]"}`} />
                {exp.label}
              </button>
              <div className="mt-1 text-[10px] text-neutral-500 leading-relaxed">
                {blocked ?? exp.description}
              </div>
            </div>
          );
        })}

        {/* Safety-relevant, not a nicety. The raster carries no unit of its own —
            the operator picks one on the controller, and picking the wrong one
            mis-doses the field with no warning anywhere in the chain. */}
        <div className="mb-3 mt-3 text-[11px] text-amber-200/90 bg-amber-950/30 border border-amber-700/40 rounded px-2 py-2 leading-relaxed">
          <div className="font-semibold text-amber-300 mb-1 flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3" /> On the Agras controller, select exactly:
          </div>
          <div className="font-mono text-[11px] text-neutral-200">
            Map Source: {AGRAS_IMPORT_STEPS.mapSource}
            <br />
            Source unit: {AGRAS_IMPORT_STEPS.sourceUnit}
          </div>
          <div className="mt-1 text-amber-200/70">
            We write rates in <b>{RX_RATE_UNIT}</b>. The file does not state its own unit, so a
            different selection here mis-doses the field without any warning.
          </div>
        </div>
        <button
          onClick={() => setLogOpen(true)}
          disabled={!mission || mission.waypoints.length === 0 || !fieldId}
          className="w-full inline-flex items-center justify-center gap-2 bg-[#1a1a1a] hover:bg-[#222] disabled:opacity-50 text-neutral-200 border border-[#2a2a2a] rounded-sm px-3 py-2 text-xs font-semibold mb-2"
        >
          <CheckCircle2 className="h-3.5 w-3.5 text-[#4CAF50]" /> Mark as Flown
        </button>

        {lastLog && (
          <div className="mb-3 text-[11px] bg-[#0f1a12] border border-[#1f3a25] rounded px-2 py-2 leading-relaxed">
            <div className="flex items-center gap-1.5 text-[#4CAF50] font-semibold mb-0.5">
              <CheckCircle2 className="h-3 w-3" /> Spray log
            </div>
            <div className="text-neutral-300 font-mono">
              {fmtAreaAc(lastLog.acres_treated ?? 0, units).text} treated
              {lastLog.liters_applied != null && <> · {fmtVolume(lastLog.liters_applied, units).text} applied (est.)</>}
            </div>
            <div className="text-neutral-500">
              logged {lastLog.date_flown}
              {lastLog.battery_end != null && lastLog.battery_start != null && (
                <> · battery {lastLog.battery_start}% → {lastLog.battery_end}%</>
              )}
            </div>
          </div>
        )}

        </>)}
      </div>

      <LogFlightModal
        open={logOpen}
        onOpenChange={setLogOpen}
        fieldId={fieldId}
        scanId={taskId}
        droneId={fp.drone_id ?? null}
        droneName={activeDrone?.name ?? null}
        batteryStart={preFlightBattery}
        zones={validZones.map(z => {
          const ai = (analysis?.zones ?? []).find((a: AiZone) => a.id === z.id);
          const m2 = polygonAreaM2(z.ring.map(p => L.latLng(p.lat, p.lng)));
          const acres = (m2 / 4046.8564224);
          return {
            id: z.id,
            label: ai?.name ?? (z.source === "user" ? "Manual annotation" : "Zone"),
            issue: ai?.issue ?? null,
            acres,
          };
        })}
        totalAcres={
          // Sprayed acres = sprayed distance × effective swath
          mission ? (mission.sprayDistM * spacingM) / 4046.8564224 : 0
        }
        estLiters={
          // Single-tank estimate at the configured load. Modal multiplies by
          // (refills + 1) once the pilot reports how many times they refilled.
          spec.tank_l > 0
            ? +(spec.tank_l * (Math.max(0, Math.min(100, fp.tank_load_pct)) / 100)).toFixed(2)
            : null
        }
        onSaved={async (log) => {
          onFlightLogged(log);
          await onSaveSettings({ ...settings, flight_plan: fp, last_flown_mission: log });
          await refreshLastLog();
          // refresh drone roster so the planner picks up the new battery level
          const { data } = await supabase.from("drones")
            .select("id, name, model, battery, status").order("created_at", { ascending: false });
          setDrones((data as any) ?? []);
        }}
      />
    </div>
  );
}

export function Slider2({ label, value, setValue, min, max, step, unit, maxSafe, warning }: {
  label: string; value: number; setValue: (n: number) => void;
  min: number; max: number; step: number; unit: string;
  // Optional "max-safe" threshold rendered as a green tick on the track.
  // Values above it are highlighted amber and `warning` is shown below.
  maxSafe?: number;
  warning?: string;
}) {
  const over = maxSafe != null && value > maxSafe;
  const tickPct = maxSafe != null
    ? Math.max(0, Math.min(100, ((maxSafe - min) / Math.max(0.0001, max - min)) * 100))
    : null;
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</label>
      <div className="flex items-center gap-2 mt-1">
        <div className="relative flex-1">
          <input type="range" min={min} max={max} step={step}
            value={value} onChange={(e) => setValue(Number(e.target.value))}
            className={`w-full ${over ? "accent-amber-400" : "accent-[#4CAF50]"}`} />
          {tickPct != null && (
            <div
              className="pointer-events-none absolute -top-0.5 h-3 w-px bg-[#4CAF50]"
              style={{ left: `${tickPct}%` }}
              title={`Max safe: ${maxSafe!.toFixed(step < 1 ? 1 : 0)} ${unit}`}
            />
          )}
        </div>
        <div className={`font-mono text-sm w-20 text-right ${over ? "text-amber-400" : ""}`}>
          {value.toFixed(step < 1 ? 1 : 0)} {unit}
        </div>
      </div>
      {over && warning && (
        <div className="mt-1 text-[10px] text-amber-400/80 leading-snug">{warning}</div>
      )}
    </div>
  );
}

export function PlannerOverlay({ boundary, zones, mission, home, onHomeChange, swapPoint }: {
  boundary: BoundaryRing[];
  zones: { ring: { lat: number; lng: number }[]; severity?: AiZone["severity"] }[];
  mission: Mission | null;
  home: LatLng2 | null;
  onHomeChange: (p: LatLng2) => void;
  swapPoint: LatLng2 | null;
}) {
  // (moved below — DroneSimMarker + simulation helpers live just after this fn)
  const map = useMap();
  useEffect(() => {
    const group = L.layerGroup().addTo(map);

    boundary.forEach(ring => {
      L.polygon(ring.map(p => [p.lat, p.lng] as [number, number]), {
        color: "#22d3ee", weight: 2, dashArray: "6 4",
        fillColor: "#22d3ee", fillOpacity: 0.04, interactive: false,
      }).addTo(group);
    });
    zones.forEach(z => {
      const color = sevColor(z.severity ?? "medium");
      L.polygon(z.ring.map(p => [p.lat, p.lng] as [number, number]), {
        color, weight: 1, fillColor: color, fillOpacity: 0.12, interactive: false,
      }).addTo(group);
    });

    if (mission) {
      // Transit segments (sprayer OFF). First = home → start (RED),
      // last = end → home (GREEN), in-between row connectors = yellow dashed.
      const lastIdx = mission.transitSegments.length - 1;
      mission.transitSegments.forEach((seg, i) => {
        const isStart = i === 0;
        const isEnd = i === lastIdx && lastIdx > 0;
        const color = isStart ? "#ef4444" : isEnd ? "#22c55e" : "#facc15";
        const weight = isStart || isEnd ? 4 : 2;
        L.polyline(seg.map(p => [p.lat, p.lng] as [number, number]), {
          color, weight, dashArray: isStart || isEnd ? undefined : "8 6",
          opacity: 1, interactive: false,
        }).addTo(group);
        // Endpoint marker at the serpentine start / end
        if (isStart || isEnd) {
          const pt = isStart ? seg[seg.length - 1] : seg[0];
          L.circleMarker([pt.lat, pt.lng], {
            radius: 7, color: "#000", weight: 2,
            fillColor: color, fillOpacity: 1, interactive: false,
          }).addTo(group).bindTooltip(isStart ? "START" : "END", {
            permanent: true, direction: "top", offset: [0, -8], className: "mission-endpoint-label",
          });
        }
      });
      // Cyan solid spray pattern (sprayer ON)
      mission.spraySegments.forEach(path => {
        L.polyline(path.map(p => [p.lat, p.lng] as [number, number]), {
          color: "#22d3ee", weight: 3, opacity: 1, interactive: false,
        }).addTo(group);
      });
      // Markers at SPRAY_ON / SPRAY_OFF (chemical activations)
      mission.waypoints.forEach(w => {
        if (w.action === "SPRAY_ON" || w.action === "SPRAY_OFF") {
          L.circleMarker([w.lat, w.lng], {
            radius: 4, color: "#000", weight: 1,
            fillColor: w.action === "SPRAY_ON" ? "#22d3ee" : "#94a3b8",
            fillOpacity: 1, interactive: false,
          }).addTo(group);
        }
      });
    }

    // Draggable red home pin
    let homeMarker: L.Marker | null = null;
    if (home) {
      const icon = L.divIcon({
        className: "home-pin",
        html: `<div style="width:18px;height:18px;border-radius:50%;background:#ef4444;border:3px solid #fff;box-shadow:0 0 0 1px #000,0 2px 8px rgba(0,0,0,.6);"></div>`,
        iconSize: [18, 18], iconAnchor: [9, 9],
      });
      homeMarker = L.marker([home.lat, home.lng], { icon, draggable: true, zIndexOffset: 1000 }).addTo(group);
      homeMarker.bindTooltip("Home / Takeoff", { permanent: false, direction: "top", offset: [0, -10] });
      homeMarker.on("dragend", (e) => {
        const ll = (e.target as L.Marker).getLatLng();
        onHomeChange({ lat: ll.lat, lng: ll.lng });
      });
    }

    // Yellow battery-swap pin (only when mission needs >1 battery)
    if (swapPoint) {
      const icon = L.divIcon({
        className: "swap-pin",
        html: `<div style="width:16px;height:16px;border-radius:50%;background:#facc15;border:2px solid #000;box-shadow:0 0 0 1px #fff,0 2px 6px rgba(0,0,0,.6);"></div>`,
        iconSize: [16, 16], iconAnchor: [8, 8],
      });
      L.marker([swapPoint.lat, swapPoint.lng], { icon, interactive: true, zIndexOffset: 900 })
        .addTo(group)
        .bindTooltip("Battery swap", { permanent: true, direction: "top", offset: [0, -10], className: "mission-endpoint-label" });
    }

    // Click on map sets new home
    const onClick = (e: L.LeafletMouseEvent) => onHomeChange({ lat: e.latlng.lat, lng: e.latlng.lng });
    map.on("click", onClick);

    return () => { map.off("click", onClick); group.remove(); };
  }, [map, boundary, zones, mission, home, onHomeChange, swapPoint]);
  return null;
}

// ---------------------------------------------------------------------------
// Mission playback: build a flat timeline of positional segments with the
// sprayer-state at each moment, then drive a draggable map marker.
// ---------------------------------------------------------------------------
export type SimSeg = {
  from: LatLng2; to: LatLng2; dist: number; speed: number;
  spray: boolean; tStart: number; tEnd: number;
};
export type SimTimeline = { segs: SimSeg[]; total: number };

export function buildSimTimeline(m: Mission | null): SimTimeline {
  if (!m) return { segs: [], total: 0 };
  const segs: SimSeg[] = [];
  let t = 0;
  let sprayOn = false;
  let prev: MissionWP | null = null;
  for (const wp of m.waypoints) {
    if (wp.action === "SPRAY_ON") { sprayOn = true; continue; }
    if (wp.action === "SPRAY_OFF") { sprayOn = false; continue; }
    if (wp.action === "SPEED_CHANGE" || wp.action === "ALTITUDE_CHANGE") continue;
    if (!prev) { prev = wp; continue; }
    const d = distM(prev, wp);
    if (d < 0.1) { prev = wp; continue; }
    const speed = Math.max(0.5, wp.speed || prev.speed || 5);
    const dur = d / speed;
    segs.push({ from: prev, to: wp, dist: d, speed, spray: sprayOn, tStart: t, tEnd: t + dur });
    t += dur;
    prev = wp;
  }
  return { segs, total: t };
}

export function simPosAt(tl: SimTimeline, t: number): { pos: LatLng2; spraying: boolean } | null {
  if (!tl.segs.length) return null;
  if (t <= 0) {
    const s = tl.segs[0];
    return { pos: s.from, spraying: s.spray };
  }
  if (t >= tl.total) {
    const s = tl.segs[tl.segs.length - 1];
    return { pos: s.to, spraying: false };
  }
  // Linear scan — N is small (hundreds of segments at most).
  for (const s of tl.segs) {
    if (t <= s.tEnd) {
      const f = (t - s.tStart) / Math.max(0.0001, s.tEnd - s.tStart);
      return {
        pos: {
          lat: s.from.lat + (s.to.lat - s.from.lat) * f,
          lng: s.from.lng + (s.to.lng - s.from.lng) * f,
        },
        spraying: s.spray,
      };
    }
  }
  return null;
}

export function DroneSimMarker({ sim }: { sim: { pos: LatLng2; spraying: boolean } | null }) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);

  // Inject the spray pulse keyframe once per page.
  useEffect(() => {
    if (document.getElementById("sim-spray-style")) return;
    const s = document.createElement("style");
    s.id = "sim-spray-style";
    s.textContent = `
      @keyframes simSprayPulse { 0% { transform: scale(.5); opacity: .75 } 100% { transform: scale(2.6); opacity: 0 } }
      .sim-drone-icon { pointer-events: none; }
    `;
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    if (!sim) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const pulse = sim.spraying
      ? `<span style="position:absolute;inset:-10px;border-radius:50%;background:#22d3ee;opacity:.5;animation:simSprayPulse 1s ease-out infinite;"></span>
         <span style="position:absolute;inset:-10px;border-radius:50%;background:#22d3ee;opacity:.5;animation:simSprayPulse 1s ease-out .5s infinite;"></span>`
      : "";
    const ring = sim.spraying
      ? "0 0 0 2px #22d3ee, 0 0 14px 2px rgba(34,211,238,.6)"
      : "0 0 0 2px #4CAF50";
    const html = `
      <div style="position:relative;width:24px;height:24px;display:flex;align-items:center;justify-content:center;">
        ${pulse}
        <div style="position:relative;width:24px;height:24px;border-radius:50%;background:#fff;border:2px solid #000;box-shadow:${ring},0 2px 8px rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>
        </div>
      </div>`;
    const icon = L.divIcon({
      className: "sim-drone-icon", html,
      iconSize: [24, 24], iconAnchor: [12, 12],
    });
    if (!markerRef.current) {
      markerRef.current = L.marker([sim.pos.lat, sim.pos.lng], {
        icon, interactive: false, zIndexOffset: 2000, keyboard: false,
      }).addTo(map);
    } else {
      markerRef.current.setLatLng([sim.pos.lat, sim.pos.lng]);
      markerRef.current.setIcon(icon);
    }
  }, [map, sim]);

  useEffect(() => () => { markerRef.current?.remove(); markerRef.current = null; }, []);
  return null;
}

export default PlannerTab;
