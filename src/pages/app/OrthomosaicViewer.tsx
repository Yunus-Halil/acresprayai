import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import { supabase } from "@/integrations/supabase/client";
import { Unzip, UnzipInflate } from "fflate";
import {
  ArrowLeft, ChevronUp, ChevronDown, Eye, EyeOff,
  Layers, Image as ImageIcon, Ruler, Settings,
  Maximize2, Plus, Minus, Loader2, MapPin, Activity,
  Sparkles, Download, AlertTriangle, X, Plane, CloudSun,
  FileBarChart, Map as MapIcon, Bot, Pencil, Cloud,
  Wind, Droplets, ThermometerSun, CloudRain, Sun, CloudSnow, CloudFog,
  CheckCircle2, XCircle, Trash2, Hexagon, Grid3x3,
  Play, Pause, RotateCcw, FastForward, History,
} from "lucide-react";
import UserPolygonTool, { type DraftPolygon } from "@/components/app/UserPolygonTool";
import ReportsTab from "@/components/app/ReportsTab";
import {
  type DroneSpec, DRONE_SPECS, resolveDroneSpec,
} from "@/lib/droneSpecs";
import {
  type CustomInput, type FarmerSettings, type LastFlownMission,
  COST_MAP, DEFAULT_FARMER_SETTINGS, INPUT_LABELS,
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
// The workspace's tabs and map layers live under components/app/workspace/.
// This file owns only the shell: loading a scan, driving the tile bake, and the
// state the tabs share.
import type { BoundaryRing, FieldRow, TaskRow } from "@/components/app/workspace/types";
import {
  FN_BASE, MAX_BAKE_PASSES, MAX_STALLED_BAKE_PASSES, MAX_WAIT_ATTEMPTS,
  NDVI_BASE, TILE_BASE,
} from "@/components/app/workspace/constants";
import type { Annotation, LayerState, UserPoly } from "@/components/app/workspace/layers";
import FieldViewTab from "@/components/app/workspace/FieldViewTab";
import PlannerTab from "@/components/app/workspace/PlannerTab";
import TreatmentTab from "@/components/app/workspace/TreatmentTab";
import FlightLogTab from "@/components/app/workspace/FlightLogTab";
import { seedUnitSystem } from "@/hooks/useUnitSystem";
import WeatherTab, { HeaderWeather } from "@/components/app/workspace/WeatherTab";
import SettingsTab from "@/components/app/workspace/SettingsTab";
import { loadAnnotations } from "@/components/app/workspace/layers";
import Seo from "@/components/Seo";
import { useNdviLayerDefault } from "@/lib/ndviLayer";
import { renderVersion } from "@/lib/scanLayers";

// Endpoints and load-loop bounds live in ./workspace/constants, imported above.

// Streams the all.zip from a signed URL, pulls out odm_orthophoto.tif WITHOUT
// buffering the full archive in RAM, and PUTs the .tif to a Supabase signed
// upload URL. Designed for the WebODM Lightning case where the edge function
// can't extract the orthomosaic itself within its 256 MB memory cap.
async function extractAndUpload(
  zipUrl: string,
  upload: { path: string; token: string; bucket: string },
  onProgress: (stage: string, pct: number) => void,
): Promise<void> {
  onProgress("Downloading processing archive…", 1);
  const res = await fetch(zipUrl);
  if (!res.ok || !res.body) throw new Error(`zip download failed (${res.status})`);
  const totalHeader = res.headers.get("content-length");
  const total = totalHeader ? Number(totalHeader) : 0;

  const matcher = /odm_orthophoto[\\/]odm_orthophoto\.tif$/i;
  const fallbackMatcher = /(^|[\\/])orthophoto\.tif$/i;

  const tifBytes = await new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let matchedName: string | null = null;
    let done = false;

    const unz = new Unzip((file) => {
      if (done) return;
      const primary = matcher.test(file.name);
      const fallback = !matchedName && fallbackMatcher.test(file.name);
      if (!primary && !fallback) return;
      if (primary) { chunks.length = 0; size = 0; }
      matchedName = file.name;
      file.ondata = (err, chunk, final) => {
        if (done) return;
        if (err) { done = true; reject(err); return; }
        chunks.push(chunk);
        size += chunk.byteLength;
        if (final && file.name === matchedName) {
          done = true;
          const out = new Uint8Array(size);
          let off = 0;
          for (const c of chunks) { out.set(c, off); off += c.byteLength; }
          resolve(out);
        }
      };
      file.start();
    });
    unz.register(UnzipInflate);

    const reader = res.body!.getReader();
    let read = 0;
    (async () => {
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (done) { try { reader.cancel(); } catch { /* noop */ } return; }
          const { value, done: rdone } = await reader.read();
          if (rdone) { unz.push(new Uint8Array(0), true); break; }
          if (value && value.byteLength) {
            read += value.byteLength;
            unz.push(value, false);
            const pct = total ? Math.min(95, (read / total) * 95) : Math.min(95, (read / (50_000_000)) * 95);
            onProgress(matchedName ? "Extracting orthomosaic…" : "Downloading processing archive…", pct);
          }
        }
        if (!done) reject(new Error("orthomosaic file not found in archive"));
      } catch (e) {
        if (!done) { done = true; reject(e as Error); }
      }
    })();
  });

  onProgress("Uploading orthomosaic…", 96);
  const buf = tifBytes.buffer.slice(tifBytes.byteOffset, tifBytes.byteOffset + tifBytes.byteLength) as ArrayBuffer;
  const blob = new Blob([buf], { type: "image/tiff" });
  const { error } = await supabase.storage
    .from(upload.bucket)
    .uploadToSignedUrl(upload.path, upload.token, blob, { contentType: "image/tiff", upsert: true });
  if (error) throw error;
  onProgress("Finalizing…", 100);
}

// Field configuration, drone capability data, geometry and mission building now
// live in `src/lib/*` so they can be unit-tested and imported without pulling in
// this component. Re-exported from here for modules that still import them by
// this path.
export type {
  CustomInput, FarmerSettings, LastFlownMission,
} from "@/lib/farmerSettings";
export {
  COST_MAP, DEFAULT_FARMER_SETTINGS, INPUT_LABELS, growthStage, issueToCostKey,
} from "@/lib/farmerSettings";
export type { DroneSpec } from "@/lib/droneSpecs";
export { DRONE_SPECS } from "@/lib/droneSpecs";
export type { Mission, MissionAction, MissionParams, MissionWP } from "@/lib/mission";

// -----------------------------------------------------------------------------
export default function OrthomosaicViewer() {
  const { taskId } = useParams<{ taskId: string }>();
  const [task, setTask] = useState<TaskRow | null>(null);
  const [field, setField] = useState<FieldRow | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [bounds, setBounds] = useState<L.LatLngBoundsExpression | null>(null);
  const [maxNative, setMaxNative] = useState<number>(20);
  const [tileTemplate, setTileTemplate] = useState<string | null>(null);
  const [baking, setBaking] = useState<{ completed: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<{ status: string; progress: number } | null>(null);
  const [extracting, setExtracting] = useState<{ stage: string; pct: number } | null>(null);

  const [layers, setLayers] = useState<LayerState>({
    annotations: true, design: false, orthomosaic: true, ndvi: false, measurements: true, boundary: true, userAnnotations: true, gridZones: true,
  });
  const [ndviInfo, setNdviInfo] = useState<{
    bands: number; spectralBands?: number; hasAlpha?: boolean; hasNDVI?: boolean;
    ambiguousMultispectral?: boolean;
    roles?: Partial<Record<"red" | "green" | "blue" | "nir" | "rededge", number>>;
    method?: string; available?: string[]; fingerprint?: string;
    reason?: string; index: "ndvi" | "ndre" | "vari"; label: string;
  } | null>(null);
  // "history" is gone as a destination: the scan timeline and compare live as
  // a panel over Field View now (ScanTimeline/SwipeCompare), not a second map.
  // "ai" is gone too — the legacy vision-analysis tab went with the deleted
  // analyze-ortho path; the treatment grid is the one analysis system.
  type TabKey = "field" | "weather" | "treatment" | "planner" | "reports" | "flightlog" | "settings";
  const [activeTab, setActiveTab] = useState<TabKey>("field");
  const [openTabs, setOpenTabs] = useState<TabKey[]>(["field"]);
  const [newTabOpen, setNewTabOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  // Bumped whenever a scan's stored state changed (grid assessment snapshot,
  // tiles rebaked) so the scan panel refetches; also busts the tile cache.
  const [scansNonce, setScansNonce] = useState(0);
  const [tileRev, setTileRev] = useState(0);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  // Database-backed manual polygon annotations (farmer's anomalies).
  const [userPolys, setUserPolys] = useState<UserPoly[]>([]);
  // Draft polygon waiting for the metadata form modal.
  const [draftUserPoly, setDraftUserPoly] = useState<DraftPolygon | null>(null);
  const [userPolyToolActive, setUserPolyToolActive] = useState(false);
  const [boundary, setBoundary] = useState<BoundaryRing[] | null>(null);
  const [boundaryMode, setBoundaryMode] = useState<"off" | "draw" | "edit">("off");
  const [boundaryDirty, setBoundaryDirty] = useState(false);
  // A traced-but-unsaved boundary lives only in memory; leaving the page is
  // the one way to lose it, so leaving gets challenged.
  useEffect(() => {
    if (!boundaryDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [boundaryDirty]);
  const [boundarySaving, setBoundarySaving] = useState(false);
  const [activeBoundaryIdx, setActiveBoundaryIdx] = useState<number | null>(null);
  const cursorCoordRef = useRef<HTMLDivElement | null>(null);
  const cursorZoomRef = useRef<HTMLDivElement | null>(null);
  // Bounded wait for a scan that isn't ready yet, plus a nonce so the retry
  // button can re-run the whole load sequence.
  const waitAttempts = useRef(0);
  const [reloadNonce, setReloadNonce] = useState(0);
  const retryLoad = useCallback(() => {
    waitAttempts.current = 0;
    setErr(null);
    setPending(null);
    setReloadNonce(n => n + 1);
  }, []);

  // Farmer-defined settings (crop, dates, input costs, available inputs).
  // Lives in fields.settings (JSON) and gates AI recommendations + cost math.
  const [settings, setSettings] = useState<FarmerSettings>(DEFAULT_FARMER_SETTINGS);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSavedAt, setSettingsSavedAt] = useState<number | null>(null);

  // Lightweight copies of fleet + last-flight data for the Reports tab so it
  // doesn't depend on the PlannerTab being mounted.
  type ParentDrone = { id: string; name: string; model: string; battery: number };
  type ParentFlightLog = LastFlownMission;
  const [parentDrones, setParentDrones] = useState<ParentDrone[]>([]);
  const [parentLastLog, setParentLastLog] = useState<ParentFlightLog | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("drones")
        .select("id, name, model, battery").order("created_at");
      if (!cancelled) setParentDrones((data as ParentDrone[] | null) ?? []);
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const fid = field?.id;
    if (!fid) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("flight_logs")
        .select("id, field_id, scan_id, drone_id, date_flown, battery_start, battery_end, tank_refills, zones_completed, acres_treated, liters_applied, notes, created_at")
        .eq("field_id", fid)
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      if (cancelled) return;
      if (error) console.warn("[flight_logs] field lookup failed", error);
      const savedSnapshot = settings.last_flown_mission;
      const dbLog = data ? ({ ...(data as ParentFlightLog), source: "flight_logs" as const }) : null;
      setParentLastLog(dbLog ?? savedSnapshot ?? null);
    })();
    return () => { cancelled = true; };
  }, [field?.id, activeTab, settings.last_flown_mission?.id]);
  const parentActiveDrone = parentDrones.find(d => d.id === settings.flight_plan.drone_id) ?? null;

  // Load saved annotations whenever the active scan changes.
  useEffect(() => {
    if (!taskId) return;
    setAnnotations(loadAnnotations(taskId));
  }, [taskId]);

  // Load DB-backed user annotations whenever the active scan changes.
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("user_annotations")
        .select("id, name, issue_type, color, notes, ring, area_hectares, created_at")
        .eq("task_id", taskId)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) { console.warn("[user_annotations] load failed", error); return; }
      setUserPolys((data ?? []).map((r: any) => ({
        id: r.id, name: r.name, issue_type: r.issue_type, color: r.color,
        notes: r.notes, ring: r.ring as { lat: number; lng: number }[],
        area_hectares: Number(r.area_hectares ?? 0),
        created_at: r.created_at,
      })));
    })();
    return () => { cancelled = true; };
  }, [taskId]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const run = async () => {
      console.log("[OrthoViewer] taskId from route:", taskId);
      // Always start clean - never reuse cached bounds / tile template across opens.
      setTileTemplate(null);
      setBounds(null);
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) { setErr("Please sign in."); return; }
      setToken(s.session.access_token);

      const { data: t } = await supabase.from("odm_tasks")
        .select("odm_uuid, field_id, created_at, ai_analysis, ai_analysis_at").eq("id", taskId).maybeSingle();
      console.log("[OrthoViewer] task row:", t);
      if (!t?.odm_uuid) { setErr("Scan not found"); return; }
      setTask(t as TaskRow);

      const { data: f } = await supabase.from("fields")
        .select("id, name, boundary, boundary_area_hectares, settings").eq("id", t.field_id).maybeSingle();
      if (f) {
        setField(f as FieldRow);
        setBoundary(normalizeBoundary((f as any).boundary));
        const saved = (f as { settings?: unknown }).settings;
        if (saved && typeof saved === "object") {
          const merged = mergeFarmerSettings(saved);
          setSettings(merged);
          // The unit preference is site-wide now, but fields configured before
          // that still carry one. Adopt it once, and only for a user who has
          // never chosen for themselves.
          seedUnitSystem(merged.unit_system);
        }
      }

      // 1) Mint a signed URL to the orthophoto.tif sitting in Supabase Storage.
      // 2) Hand that URL to TiTiler to get bounds + tiles.
      try {
        // Cache-bust so neither the browser nor any intermediate CDN serves a
        // stale ortho-url response (which would contain an expired signed URL).
        const r = await fetch(`${FN_BASE}/ortho-url?task_id=${taskId}&_t=${Date.now()}`, {
          headers: { Authorization: `Bearer ${s.session.access_token}` },
          cache: "no-store",
        });
        const j = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (r.status === 409) {
          // Still processing. Back off rather than hammering every 5s forever,
          // and stop at a bounded number of attempts with a retry the user can
          // press - an unbounded loop looks identical to a hang.
          waitAttempts.current += 1;
          if (waitAttempts.current > MAX_WAIT_ATTEMPTS) {
            setPending(null);
            setErr(
              `This scan still isn't ready (${j?.status ?? "processing"}${
                typeof j?.progress === "number" ? `, ${Math.round(j.progress)}%` : ""
              }). Large scans can take hours, reopen this page later, or retry now.`,
            );
            return;
          }
          setPending({ status: j?.status ?? "processing", progress: j?.progress ?? 0 });
          setErr(null);
          // 5s for the first minute, easing to 30s.
          const delay = Math.min(30_000, 5000 * 1.25 ** Math.max(0, waitAttempts.current - 12));
          timer = window.setTimeout(run, delay);
          return;
        }
        if (r.status === 202 && j?.needsExtract) {
          // Backend can't produce the .tif directly (WebODM Lightning only serves
          // all.zip and extracting that on the edge OOMs). Stream-extract in the
          // browser, push the .tif straight to storage, then retry.
          setPending(null);
          setErr(null);
          try {
            await extractAndUpload(j.zipUrl, j.upload, (stage, pct) => {
              if (!cancelled) setExtracting({ stage, pct });
            });
            if (cancelled) return;
            setExtracting(null);
            timer = window.setTimeout(run, 200);
            return;
          } catch (e: any) {
            console.error("[OrthoViewer] client extraction failed", e);
            setExtracting(null);
            setErr(`Could not extract orthomosaic in browser: ${e?.message ?? e}`);
            return;
          }
        }
        if (!r.ok || !j?.url) {
          setPending(null);
          setErr(j?.error ?? "Orthomosaic not available yet.");
          return;
        }
        setPending(null);

        // Pull bounds from the tilejson the edge function returned (it called
        // TiTiler server-side to bypass browser CORS).
        const tj = j.tilejson;
        const b: any = tj?.bounds;
        if (Array.isArray(b) && b.length === 4) {
          // TiTiler returns bounds as [west, south, east, north] in WGS84.
          // Sanity-check: lat ∈ [-90,90], lng ∈ [-180,180]. If we see UTM-style
          // numbers we bail so the map doesn't fly off to a black void.
          const [w, s, e, n] = b as number[];
          console.log("[OrthoViewer] tilejson bounds (W,S,E,N):", w, s, e, n);
          if (Math.abs(s) > 90 || Math.abs(n) > 90 || Math.abs(w) > 180 || Math.abs(e) > 180) {
            setErr("Orthomosaic bounds are not in WGS84 (got projected coordinates). Re-process the scan.");
            return;
          }
          setBounds([[b[1], b[0]], [b[3], b[2]]] as L.LatLngBoundsExpression);
        } else {
          setErr("Could not load orthomosaic bounds.");
          return;
        }
        if (typeof tj?.maxzoom === "number") setMaxNative(Math.min(22, tj.maxzoom));

        // Drive the tile baker until it reports done, then point Leaflet at the
        // static pre-baked tiles served through the `tile` edge function.
        if (!t.odm_uuid) { setErr("Missing scan id"); return; }
        // Drive the baker until it reports done. It only reports done when every
        // tile actually stored, so a pass with failures loops back and retries
        // exactly those tiles instead of leaving holes in the map.
        let bakePasses = 0;
        let stalledPasses = 0;
        let lastCompleted = -1;
        while (!cancelled) {
          bakePasses += 1;
          const br = await fetch(`${FN_BASE}/bake-tiles?task_id=${taskId}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${s.session.access_token}` },
          });
          const bj = await br.json().catch(() => ({}));
          if (!br.ok) {
            // 503 is the tile service being briefly unavailable - worth waiting out.
            if (br.status === 503 && bakePasses < MAX_BAKE_PASSES) {
              await new Promise((r) => setTimeout(r, 3000));
              continue;
            }
            setErr(bj?.error ?? "Could not build the map tiles for this scan.");
            return;
          }
          if (typeof bj.total === "number") {
            setBaking({ completed: bj.completed ?? 0, total: bj.total });
          }
          if (bj.done) break;

          // Guard against a baker that can neither finish nor progress.
          if (bj.completed === lastCompleted) stalledPasses += 1;
          else { stalledPasses = 0; lastCompleted = bj.completed ?? -1; }
          if (stalledPasses >= MAX_STALLED_BAKE_PASSES || bakePasses > MAX_BAKE_PASSES) {
            setErr(
              `Map tiles stopped building at ${bj.completed ?? 0} of ${bj.total ?? "?"}. ` +
              `The tile service may be having trouble, retry in a moment.`,
            );
            return;
          }
          // Ease off when the baker is retrying failures rather than advancing.
          await new Promise((r) => setTimeout(r, bj.retrying ? 2000 : 250));
        }
        if (cancelled) return;
        setBaking(null);
        setTileTemplate(`${TILE_BASE}/${t.odm_uuid}/{z}/{x}/{y}.png`);
      } catch (e) {
        console.error("[OrthoViewer] info failed", e);
        setErr("Could not load orthomosaic metadata.");
      }
    };
    run();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
    // reloadNonce lets the retry button re-run the whole sequence.
  }, [taskId, reloadNonce]);

  // Keep the access token fresh. Tile URLs embed it (Leaflet's <img> requests
  // can't send headers), so when supabase silently refreshes the session the
  // template has to change with it or tiles start 401-ing after ~1h. The
  // TileLayers are keyed on the URL, so they remount with the new token.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s?.access_token) setToken(s.access_token);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // `rev` busts the browser's immutable tile cache after an in-session rebake;
  // `v` (the render plan, from /info once it loads) does the same across
  // sessions — a rebake changes the plan, the plan changes the URL, so a
  // browser holding tiles baked with the old plan cannot keep serving them.
  const renderV = renderVersion(ndviInfo as Parameters<typeof renderVersion>[0]);
  const tileUrl = tileTemplate && token
    ? `${tileTemplate}?token=${token}${tileRev ? `&rev=${tileRev}` : ""}`
      + (renderV ? `&v=${encodeURIComponent(renderV)}` : "")
    : null;
  // The fingerprint identifies the resolved band mapping. Embedding it means a
  // corrected mapping yields a different URL, so the browser's 24h tile cache
  // cannot keep serving tiles rendered with the old expression.
  const ndviUrl = task?.odm_uuid && token
    ? `${NDVI_BASE}/${taskId}/{z}/{x}/{y}.png?token=${token}`
      + (ndviInfo?.fingerprint ? `&v=${encodeURIComponent(ndviInfo.fingerprint)}` : "")
    : null;

  // The legacy analyze-ortho vision path is gone. Analysis is the treatment
  // grid: the operator marks reference cells in the Treatment Grid tab, the
  // system extrapolates, and every grid write snapshots the zones onto this
  // scan (lib/scanAssessment.ts). Nothing here runs a model.

  // Boundary persistence ------------------------------------------------------
  // Multi-polygon: each ring is one fragment of the field. Users can keep
  // drawing more rings after the first one is closed.
  const handleBoundaryCreated = useCallback((ring: BoundaryRing) => {
    setBoundary(prev => {
      const next = prev ? [...prev, ring] : [ring];
      setActiveBoundaryIdx(next.length - 1);
      return next;
    });
    setBoundaryDirty(true);
  }, []);
  const handleBoundaryEdited = useCallback((index: number, ring: BoundaryRing) => {
    setBoundary(prev => {
      if (!prev) return prev;
      const next = prev.slice();
      next[index] = ring;
      return next;
    });
    setBoundaryDirty(true);
  }, []);
  const handleBoundaryDeleteRing = useCallback((index: number) => {
    setBoundary(prev => {
      if (!prev) return prev;
      const next = prev.filter((_, i) => i !== index);
      return next.length ? next : null;
    });
    setActiveBoundaryIdx(prev => {
      if (prev === null) return null;
      if (prev === index) return null;
      return prev > index ? prev - 1 : prev;
    });
    setBoundaryDirty(true);
  }, []);
  const saveBoundary = async () => {
    if (!field || !boundary || boundary.length === 0) return;
    setBoundarySaving(true);
    try {
      const areaM2 = boundary.reduce(
        (sum, ring) => sum + polygonAreaM2(ring.map(p => L.latLng(p.lat, p.lng))),
        0,
      );
      const ha = areaM2 / 10000;
      const { error } = await supabase.from("fields")
        .update({
          boundary: boundary as any,
          boundary_area_hectares: Number(ha.toFixed(4)),
        } as any)
        .eq("id", field.id);
      if (error) throw error;
      setBoundaryDirty(false);
      setBoundaryMode("off");
      setField(prev => prev ? { ...prev, boundary_area_hectares: Number(ha.toFixed(4)) } : prev);
    } catch (e) {
      console.error("save boundary failed", e);
      toast.error("Couldn't save the boundary", {
        description: "Nothing was saved. Your traced outline is still on screen; check your connection and press Save boundary again.",
      });
    } finally {
      setBoundarySaving(false);
    }
  };
  const clearBoundary = async () => {
    if (!field) return;
    if (!window.confirm("Remove this field's saved boundary?")) return;
    setBoundarySaving(true);
    try {
      const { error } = await supabase.from("fields")
        .update({ boundary: null, boundary_area_hectares: null } as any)
        .eq("id", field.id);
      if (error) {
        toast.error("Couldn't remove the boundary", {
          description: "Nothing was changed. Check your connection and try again.",
        });
        return;
      }
      setBoundary(null);
      setBoundaryDirty(false);
      setBoundaryMode("off");
      setField(prev => prev ? { ...prev, boundary_area_hectares: null } : prev);
    } finally {
      setBoundarySaving(false);
    }
  };

  // ---- User annotations CRUD (DB-backed) ------------------------------------
  const saveUserPolygon = async (form: { name: string; issue_type: string; color: string; notes: string }) => {
    if (!draftUserPoly || !taskId) return;
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) return;
    const row = {
      user_id: s.session.user.id,
      task_id: taskId,
      field_id: field?.id ?? null,
      name: form.name.trim() || "Annotation",
      issue_type: form.issue_type,
      color: form.color,
      notes: form.notes.trim() || null,
      ring: draftUserPoly.ring as any,
      area_hectares: Number(draftUserPoly.areaHa.toFixed(4)),
    };
    const { data, error } = await supabase.from("user_annotations").insert(row).select("*").single();
    if (error) {
      console.error(error);
      toast.error("Couldn't save this annotation", {
        description: "Nothing was saved. Your drawing is still on screen; check your connection and press Save again.",
      });
      return;
    }
    setUserPolys(prev => [...prev, {
      id: data.id, name: data.name, issue_type: data.issue_type, color: data.color,
      notes: data.notes, ring: data.ring as any, area_hectares: Number(data.area_hectares ?? 0),
      created_at: data.created_at,
    }]);
    setDraftUserPoly(null);
    setUserPolyToolActive(false);
  };
  const deleteUserPolygon = async (id: string) => {
    const existing = userPolys.find(p => p.id === id);
    setUserPolys(prev => prev.filter(p => p.id !== id));
    const { error } = await supabase.from("user_annotations").delete().eq("id", id);
    if (error) {
      console.error(error);
      if (existing) setUserPolys(prev => prev.some(p => p.id === id) ? prev : [...prev, existing]);
      toast.error("Couldn't delete the annotation", {
        description: "It was restored to the list. Check your connection and try again.",
      });
    }
  };

  // ---- Farmer settings save (debounced via explicit Save button) -----------
  // Returns whether the write LANDED. Spray rates, flight-plan params and the
  // last-flown-mission snapshot all pass through here; a swallowed failure
  // used to mean an operator was shown success while compliance data
  // evaporated. Callers that need the truth (the Log Flight fallback) read
  // the return value; everyone sees the toast.
  const saveSettings = async (next: FarmerSettings): Promise<boolean> => {
    if (!field?.id) return false;
    setSettings(next);
    setSettingsSaving(true);
    try {
      const { error } = await supabase.from("fields")
        .update({ settings: next as any } as any)
        .eq("id", field.id);
      if (error) throw error;
      setSettingsSavedAt(Date.now());
      return true;
    } catch (e) {
      console.error("[settings] save failed", e);
      toast.error("Couldn't save field settings", {
        description: "Nothing was saved. Check your connection and try again.",
      });
      return false;
    } finally {
      setSettingsSaving(false);
    }
  };

  // ---- Report map capture -------------------------------------------------
  // The report's map must show exactly what its tables describe: orthomosaic,
  // boundary, and the treatment-grid zones. Working overlays (annotations,
  // user polygons, measurements) are hidden for the capture and restored after
  // — the screenshotted map and the printed tables come from one data source.
  const captureRestore = useRef<{ layers: LayerState } | null>(null);
  const prepareMapCapture = useCallback(() => {
    captureRestore.current = { layers };
    // Field View listens and exits compare/panel state, which would otherwise
    // be captured over the ortho.
    window.dispatchEvent(new CustomEvent("swathwise:prepare-capture"));
    setLayers({
      annotations: false, design: false, orthomosaic: true, ndvi: false,
      measurements: false, boundary: true, userAnnotations: false, gridZones: true,
    });
  }, [layers]);
  const restoreMapCapture = useCallback(() => {
    if (!captureRestore.current) return;
    setLayers(captureRestore.current.layers);
    captureRestore.current = null;
  }, []);

  // Probe the COG once to figure out NDVI vs VARI and band count for the legend.
  useEffect(() => {
    if (!taskId || !token || !tileTemplate) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${NDVI_BASE}/info?task_id=${taskId}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const j = await r.json();
        if (!cancelled && r.ok) setNdviInfo(j);
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [taskId, token, tileTemplate]);

  // Real NDVI is worth showing unasked; the RGB-derived VARI proxy is not.
  // See src/lib/ndviLayer.ts - applied once per scan, then the toggle is the
  // farmer's.
  useNdviLayerDefault(taskId, ndviInfo, (visible) =>
    setLayers(l => (l.ndvi === visible ? l : { ...l, ndvi: visible })));

  // Ctrl/Cmd+T opens the new-tab menu
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setNewTabOpen(o => !o);
      }
      if (e.key === "Escape") { setNewTabOpen(false); setLayersOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (err) {
    return (
      <div className="h-screen w-screen bg-[#0f0f0f] flex flex-col items-center justify-center gap-4 text-sm text-[#f0f0f0]">
        <div className="text-red-400 max-w-md text-center px-6">{err}</div>
        <div className="flex items-center gap-4">
          {/* Every failure state here is retryable - none of them are the end of
              the road, and the page should never dead-end the farmer. */}
          <button
            onClick={retryLoad}
            className="px-3 py-1.5 rounded border border-[#4CAF50] text-[#4CAF50] hover:bg-[#4CAF50]/10 transition-colors"
          >
            Try again
          </button>
          <a href="/app/fields" className="text-[#4CAF50] underline">Back to fields</a>
        </div>
      </div>
    );
  }
  if (extracting) {
    return (
      <div className="h-screen w-screen bg-[#0f0f0f] flex flex-col items-center justify-center gap-3 text-sm text-[#f0f0f0]">
        <Loader2 className="h-5 w-5 animate-spin text-[#4CAF50]" />
        <div>{extracting.stage}</div>
        <div className="w-64 h-1 bg-[#1a1a1a] overflow-hidden">
          <div className="h-full bg-[#4CAF50] transition-all" style={{ width: `${Math.max(2, Math.min(100, extracting.pct))}%` }} />
        </div>
        <div className="text-xs text-neutral-500">Extracting orthomosaic on this device.</div>
      </div>
    );
  }
  if (baking) {
    const pct = baking.total ? Math.round((baking.completed / baking.total) * 100) : 0;
    return (
      <div className="h-screen w-screen bg-[#0f0f0f] flex flex-col items-center justify-center gap-3 text-sm text-[#f0f0f0]">
        <Loader2 className="h-5 w-5 animate-spin text-[#4CAF50]" />
        <div>Pre-rendering map tiles… {baking.completed} / {baking.total}</div>
        <div className="w-64 h-1 bg-[#1a1a1a] overflow-hidden">
          <div className="h-full bg-[#4CAF50] transition-all" style={{ width: `${Math.max(2, pct)}%` }} />
        </div>
        <div className="text-xs text-neutral-500">One-time bake. Future opens load instantly.</div>
      </div>
    );
  }
  if (pending) {
    return (
      <div className="h-screen w-screen bg-[#0f0f0f] flex flex-col items-center justify-center gap-3 text-sm text-[#f0f0f0]">
        <Loader2 className="h-5 w-5 animate-spin text-[#4CAF50]" />
        <div>{pending.status === "queued" ? "Queued on processing node…" : `Processing… ${pending.progress}%`}</div>
        <div className="text-xs text-neutral-500">Auto-refreshing every 5s.</div>
        <a href="/app/fields" className="text-[#4CAF50] underline text-xs">Back to fields</a>
      </div>
    );
  }
  if (!task || !token || !tileUrl || !bounds) {
    return (
      <div className="h-screen w-screen bg-[#0f0f0f] flex items-center justify-center text-sm text-neutral-400 gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading orthomosaic…
      </div>
    );
  }

  const taskName = field?.name ?? "Scan";
  const ts = new Date(task.created_at).toLocaleString();

  // Compute field center from bounds so OSM tiles around the ortho load first
  // (instead of starting at [0,0] and panning over).
  const b = bounds as unknown as [[number, number], [number, number]];
  const center: [number, number] = [
    (b[0][0] + b[1][0]) / 2,
    (b[0][1] + b[1][1]) / 2,
  ];

  const TAB_DEFS: { key: TabKey; label: string; icon: any }[] = [
    { key: "field", label: "Field View", icon: MapIcon },
    { key: "weather", label: "Weather", icon: CloudSun },
    { key: "treatment", label: "Treatment Grid", icon: Grid3x3 },
    { key: "planner", label: "Flight Planner", icon: Plane },
    { key: "reports", label: "Reports", icon: FileBarChart },
    { key: "flightlog", label: "Flight Log", icon: History },
    { key: "settings", label: "Settings", icon: Settings },
  ];
  const openTab = (k: TabKey) => {
    setOpenTabs(t => t.includes(k) ? t : [...t, k]);
    setActiveTab(k);
    setNewTabOpen(false);
  };
  const closeTab = (k: TabKey) => {
    if (k === "field") return; // field view is permanent
    setOpenTabs(t => {
      const next = t.filter(x => x !== k);
      if (activeTab === k) setActiveTab(next[next.length - 1] ?? "field");
      return next;
    });
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden font-sans"
         style={{ background: "#0f0f0f", color: "#f0f0f0" }}>
      <Seo title="SwathWise" noindex />
      {/* Top status bar: back · field · weather · analyze · health */}
      <div className="h-12 shrink-0 flex items-center gap-4 px-4 border-b border-[#1f1f1f]"
           style={{ background: "#0f0f0f" }}>
        {/* This view opens with target="_blank", so the tab has no history and
            window.history.back() silently did nothing. Link to the parent field
            instead: a real destination that works in a new tab or an old one,
            and supports middle-click. */}
        <a href={task.field_id ? `/app/fields/${task.field_id}` : "/app/fields"}
          className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-[#f0f0f0] transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to field
        </a>
        <div className="h-4 w-px bg-[#222]" />
        <div className="flex items-baseline gap-3 min-w-0">
          <div className="text-sm font-semibold tracking-tight truncate">{taskName}</div>
          <div className="text-[11px] text-neutral-500 font-mono">{ts}</div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <HeaderWeather center={center} onClick={() => {
            if (!openTabs.includes("weather")) setOpenTabs(t => [...t, "weather"]);
            setActiveTab("weather");
          }} />
          {/* The one analysis system, one click away from every tab. */}
          <button
            type="button"
            onClick={() => openTab("treatment")}
            className="inline-flex h-7 items-center gap-1.5 rounded-sm bg-[#4CAF50] px-3 text-xs font-semibold text-black transition-colors hover:bg-[#43a047]"
          >
            <Grid3x3 className="h-3.5 w-3.5" /> Treatment Grid
          </button>
        </div>
      </div>

      {/* Browser-style tab bar */}
      {/* overflow-x keeps every open tab reachable at tablet widths — the
          old fixed-width bar simply clipped Flight Log off-screen at 768px. */}
      <div className="h-10 shrink-0 flex items-end pl-2 pr-3 gap-0.5 border-b border-[#1f1f1f] relative overflow-x-auto overflow-y-hidden"
           style={{ background: "#141414" }}>
        {TAB_DEFS.filter(t => openTabs.includes(t.key)).map(t => {
          const Icon = t.icon;
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`group relative h-9 flex items-center gap-2 pl-3 pr-2 min-w-[96px] shrink-0 lg:min-w-[140px] max-w-[200px] text-xs border-t border-l border-r rounded-t-md -mb-px transition-colors
                ${active
                  ? "border-[#1f1f1f] text-[#f0f0f0]"
                  : "border-transparent text-neutral-500 hover:text-neutral-300 hover:bg-[#1a1a1a]"}`}
              style={active ? { background: "#0f0f0f" } : undefined}
            >
              {active && (
                <span className="absolute left-0 right-0 -top-px h-0.5 bg-[#4CAF50] rounded-t" />
              )}
              <Icon className={`h-3.5 w-3.5 ${active ? "text-[#4CAF50]" : ""}`} />
              <span className="truncate flex-1 text-left">{t.label}</span>
              {t.key !== "field" && (
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); closeTab(t.key); }}
                  className="h-4 w-4 grid place-items-center rounded-sm text-neutral-500 hover:text-[#f0f0f0] hover:bg-[#262626]"
                >
                  <X className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}
        <div className="relative">
          <button
            onClick={() => setNewTabOpen(o => !o)}
            title="New tab (Ctrl+T)"
            className="h-7 w-7 ml-1 grid place-items-center rounded-sm text-neutral-500 hover:text-[#f0f0f0] hover:bg-[#1a1a1a]"
          >
            <Plus className="h-4 w-4" />
          </button>
          {newTabOpen && (
            <div className="absolute z-[2000] top-9 left-0 w-56 rounded-md border border-[#222] bg-[#161616] shadow-2xl p-1">
              <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-neutral-500">Open in new tab</div>
              {TAB_DEFS.filter(t => !openTabs.includes(t.key)).map(t => {
                const Icon = t.icon;
                return (
                  <button key={t.key} onClick={() => openTab(t.key)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-neutral-200 hover:bg-[#1f1f1f] rounded-sm">
                    <Icon className="h-3.5 w-3.5 text-[#4CAF50]" />
                    {t.label}
                  </button>
                );
              })}
              {TAB_DEFS.every(t => openTabs.includes(t.key)) && (
                <div className="px-2 py-2 text-[11px] text-neutral-500">All tabs are open.</div>
              )}
              <div className="border-t border-[#222] mt-1 pt-1 px-2 pb-1 text-[10px] text-neutral-600 font-mono">⌘/Ctrl + T</div>
            </div>
          )}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 relative">
        {/* Field View is permanently mounted to preserve the Leaflet map and
            its layers/geoman state across tab switches. We only hide it. */}
        <div
          id="field-view-capture"
          style={{
            position: "absolute", inset: 0,
            visibility: activeTab === "field" ? "visible" : "hidden",
            pointerEvents: activeTab === "field" ? "auto" : "none",
          }}
        >
          <FieldViewTab
            center={center}
            bounds={bounds}
            tileUrl={tileUrl}
            ndviUrl={ndviUrl}
            maxNative={maxNative}
            layers={layers}
            setLayers={setLayers}
            ndviInfo={ndviInfo}
            cursorCoordRef={cursorCoordRef}
            cursorZoomRef={cursorZoomRef}
            layersOpen={layersOpen}
            setLayersOpen={setLayersOpen}
            taskId={taskId!}
            annotations={annotations}
            setAnnotations={setAnnotations}
            boundary={boundary}
            boundaryMode={boundaryMode}
            setBoundaryMode={setBoundaryMode}
            boundaryDirty={boundaryDirty}
            boundarySaving={boundarySaving}
            saveBoundary={saveBoundary}
            clearBoundary={clearBoundary}
            handleBoundaryCreated={handleBoundaryCreated}
            handleBoundaryEdited={handleBoundaryEdited}
            handleBoundaryDeleteRing={handleBoundaryDeleteRing}
            fieldAreaHa={field?.boundary_area_hectares ?? null}
            activeBoundaryIdx={activeBoundaryIdx}
            setActiveBoundaryIdx={setActiveBoundaryIdx}
            userPolys={userPolys}
            userPolyToolActive={userPolyToolActive}
            setUserPolyToolActive={setUserPolyToolActive}
            draftUserPoly={draftUserPoly}
            setDraftUserPoly={setDraftUserPoly}
            saveUserPolygon={saveUserPolygon}
            fieldId={field?.id ?? null}
            deleteUserPolygon={deleteUserPolygon}
            openSettings={() => openTab("settings")}
            settings={settings}
            scansApi={{
              token,
              fieldName: field?.name ?? "Field",
              currentTaskId: taskId!,
              scansNonce,
              bumpScansNonce: () => setScansNonce(n => n + 1),
              // Assessment is interactive by nature — reference points are a
              // human gesture — so the card action opens the Treatment Grid
              // rather than pretending analysis can run headless.
              openTreatmentGrid: () => openTab("treatment"),
              onTilesRebaked: (id) => {
                setScansNonce(n => n + 1);
                if (id === taskId) setTileRev(r => r + 1);
              },
              openScan: (id) => window.open(`/app/orthomosaic/${id}`, "_blank"),
            }}
          />
        </div>
        {activeTab === "weather" && <WeatherTab center={center} fieldName={taskName} />}
        {activeTab === "treatment" && (
          <TreatmentTab
            boundary={boundary}
            tileUrl={tileUrl}
            bounds={bounds}
            maxNative={maxNative}
            fieldId={field?.id ?? null}
            taskId={taskId!}
            scanCreatedAt={task.created_at ?? null}
            spec={resolveDroneSpec(parentActiveDrone?.model, settings.flight_plan.custom_specs).spec}
            settings={settings}
            setActiveTab={setActiveTab}
          />
        )}
        {activeTab === "planner" && (
          <PlannerTab
            boundary={boundary}
            tileUrl={tileUrl}
            bounds={bounds}
            maxNative={maxNative}
            taskId={taskId!}
            fieldId={field?.id ?? null}
            fieldName={field?.name ?? taskName}
            setActiveTab={setActiveTab}
            settings={settings}
            onSaveSettings={saveSettings}
            onFlightLogged={setParentLastLog}
            center={center}
            userPolys={userPolys}
          />
        )}
        {activeTab === "reports" && (
          <ReportsTab
            field={field ? { id: field.id, name: field.name, boundary_area_hectares: field.boundary_area_hectares ?? null } : null}
            task={{ id: taskId!, created_at: task.created_at }}
            settings={settings}
            activeDrone={parentActiveDrone}
            lastLog={parentLastLog}
            center={center}
            setActiveTab={setActiveTab}
            prepareMapCapture={prepareMapCapture}
            restoreMapCapture={restoreMapCapture}
          />
        )}
        {activeTab === "flightlog" && (
          <FlightLogTab
            fieldId={field?.id ?? null}
            fieldName={field?.name ?? taskName}
            settings={settings}
            openScan={(id) => {
              if (id === taskId) { setActiveTab("field"); return; }
              window.open(`/app/orthomosaic/${id}`, "_blank");
            }}
          />
        )}
        {activeTab === "settings" && (
          <SettingsTab
            settings={settings}
            onSave={saveSettings}
            saving={settingsSaving}
            savedAt={settingsSavedAt}
            fieldAreaHa={field?.boundary_area_hectares ?? null}
          />
        )}
      </div>

      {/* Bottom status bar */}
      <div className="h-7 shrink-0 px-3 flex items-center gap-4 text-[11px] text-neutral-500 border-t border-[#1f1f1f]"
           style={{ background: "#0f0f0f" }}>
        <div ref={cursorCoordRef} className="font-mono">,, ,</div>
        <div ref={cursorZoomRef} className="font-mono">Zoom 15</div>
        <div className="ml-auto truncate font-mono text-neutral-600">{task.odm_uuid?.slice(0, 8)}</div>
      </div>

      {/* .ai-zone-label / .ai-zone-popup are the map tooltip/popup styles shared
          by the grid-zone and user-polygon layers; the name predates the grid. */}
      <style>{`
        .ai-zone-label {
          background: #1a1a1a;
          color: #f0f0f0;
          border: 1px solid #2a2a2a;
          border-left: 2px solid #4CAF50;
          font-size: 11px;
          padding: 4px 8px;
          border-radius: 2px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.5);
          white-space: nowrap;
          pointer-events: none;
          font-family: inherit;
        }
        .ai-zone-label::before { display: none; }
        .leaflet-container { background: #0a0a0a; }
      `}</style>
    </div>
  );
}

