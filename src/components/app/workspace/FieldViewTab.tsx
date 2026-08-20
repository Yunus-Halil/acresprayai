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
  CheckCircle2, XCircle, Trash2, Hexagon, Grid3x3,
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
  type BasemapId,
  AiZonesLayer, AnnotateTool, BasemapLayer, BasemapToggle, BoundaryTool, FitBounds,
  LayerRow, MapControls,
  MeasurePanel, MeasureTool, MouseReadout, USER_POLY_ISSUES, UserPolyLayer,
  escapeHtml, loadAnnotations, loadBasemap, saveAnnotations, saveBasemap, sevColor,
  USER_POLY_COLORS,
} from "./layers";
import GridAnomaliesLayer from "./GridAnomaliesLayer";
import { type GridZonesLoad, clearGridZones, loadGridZones } from "@/lib/gridAnomalies";
import { fmtArea } from "@/lib/units";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { AnalysisGrid } from "./AiTab";

// ----------------------------- Field View tab -------------------------------
export function FieldViewTab(props: {
  center: [number, number];
  bounds: L.LatLngBoundsExpression;
  tileUrl: string;
  ndviUrl: string | null;
  maxNative: number;
  layers: LayerState;
  setLayers: React.Dispatch<React.SetStateAction<LayerState>>;
  ndviInfo: {
    bands: number; spectralBands?: number; hasAlpha?: boolean; hasNDVI?: boolean;
    ambiguousMultispectral?: boolean;
    roles?: Partial<Record<"red" | "green" | "blue" | "nir" | "rededge", number>>;
    method?: string; available?: string[]; fingerprint?: string;
    reason?: string; index: "ndvi" | "ndre" | "vari"; label: string;
  } | null;
  cursorCoordRef: React.MutableRefObject<HTMLDivElement | null>;
  cursorZoomRef: React.MutableRefObject<HTMLDivElement | null>;
  layersOpen: boolean;
  setLayersOpen: (v: boolean) => void;
  drawerOpen: boolean;
  setDrawerOpen: (v: boolean) => void;
  analysis: any;
  analyzing: boolean;
  analysisErr: string | null;
  runAnalysis: () => void;
  showAiZones: boolean;
  setShowAiZones: (v: boolean) => void;
  selectedZone: string | null;
  setSelectedZone: (id: string | null) => void;
  updateZoneRing: (id: string, ring: { lat: number; lng: number }[]) => void;
  deleteZone: (id: string) => void;
  exportFlightPlan: () => void;
  taskId: string;
  annotations: Annotation[];
  setAnnotations: React.Dispatch<React.SetStateAction<Annotation[]>>;
  boundary: BoundaryRing[] | null;
  boundaryMode: "off" | "draw" | "edit";
  setBoundaryMode: React.Dispatch<React.SetStateAction<"off" | "draw" | "edit">>;
  boundaryDirty: boolean;
  boundarySaving: boolean;
  saveBoundary: () => void;
  clearBoundary: () => void;
  handleBoundaryCreated: (ring: BoundaryRing) => void;
  handleBoundaryEdited: (index: number, ring: BoundaryRing) => void;
  handleBoundaryDeleteRing: (index: number) => void;
  fieldAreaHa: number | null;
  activeBoundaryIdx: number | null;
  setActiveBoundaryIdx: React.Dispatch<React.SetStateAction<number | null>>;
  userPolys: UserPoly[];
  userPolyToolActive: boolean;
  setUserPolyToolActive: React.Dispatch<React.SetStateAction<boolean>>;
  draftUserPoly: DraftPolygon | null;
  setDraftUserPoly: React.Dispatch<React.SetStateAction<DraftPolygon | null>>;
  saveUserPolygon: (f: { name: string; issue_type: string; color: string; notes: string }) => Promise<void>;
  deleteUserPolygon: (id: string) => Promise<void>;
  clearAnalysis: () => Promise<void>;
  settings: FarmerSettings;
  /** Opens the workspace's Settings tab, which may not currently be open. */
  openSettings: () => void;
  /** For loading the treatment grid's zones as an anomaly overlay. */
  fieldId: string | null;
}) {
  const [basemap, setBasemap] = useState<BasemapId>(loadBasemap);
  const {
    bounds, tileUrl, ndviUrl, maxNative, layers, setLayers, ndviInfo,
    cursorCoordRef, cursorZoomRef, layersOpen, setLayersOpen,
    drawerOpen, setDrawerOpen,
    analysis, analyzing, analysisErr, runAnalysis,
    showAiZones, setShowAiZones, selectedZone, setSelectedZone,
    updateZoneRing, deleteZone, exportFlightPlan,
    taskId, annotations, setAnnotations,
    boundary, boundaryMode, setBoundaryMode, boundaryDirty, boundarySaving,
    saveBoundary, clearBoundary, handleBoundaryCreated, handleBoundaryEdited, handleBoundaryDeleteRing,
    fieldAreaHa, activeBoundaryIdx, setActiveBoundaryIdx,
    userPolys, userPolyToolActive, setUserPolyToolActive,
    draftUserPoly, setDraftUserPoly, saveUserPolygon, deleteUserPolygon, clearAnalysis,
    settings,
  } = props;

  const [measureActive, setMeasureActive] = useState(false);
  const [annotateActive, setAnnotateActive] = useState(false);
  const [annotateMode, setAnnotateMode] = useState<"pen" | "text" | "select">("pen");
  const [annotateColor, setAnnotateColor] = useState<string>("#facc15");
  const [annotateWidth, setAnnotateWidth] = useState<number>(3);
  const [measureStats, setMeasureStats] = useState<MeasureStats>({
    active: false, finished: false, count: 0, distM: 0, areaM2: 0, liveDistM: 0,
  });
  const handleStats = useCallback((s: MeasureStats) => setMeasureStats(s), []);

  // Treatment-grid zones as an anomaly overlay. Derived on mount from the
  // stored grid — the grid cell is the record, this is a projection of it.
  const [gridZoneLoad, setGridZoneLoad] = useState<GridZonesLoad | null>(null);
  const [clearingZones, setClearingZones] = useState(false);
  const gridUnits = useUnitSystem();
  const [gridZoneNonce, setGridZoneNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setGridZoneLoad(null);
    loadGridZones(props.fieldId, props.boundary as LatLng2[][] | null)
      .then(r => { if (!cancelled) setGridZoneLoad(r); })
      .catch(e => console.error("[fieldview] grid zones load failed", e));
    return () => { cancelled = true; };
  }, [props.fieldId, props.boundary, gridZoneNonce]);

  /**
   * Wipe every treated cell for this field.
   *
   * Destructive, and about somebody's painted afternoon — so the confirmation
   * quotes the real cost (zones, cells, ground) rather than asking "are you
   * sure?" about an unknown quantity. Skips survive deliberately: they are not
   * zones, and they are the negative examples Find Similar learns from.
   */
  const clearZones = async () => {
    const zones = gridZoneLoad?.zones ?? [];
    if (!props.fieldId || !props.boundary || zones.length === 0) return;
    const cells = zones.reduce((a, z) => a + z.cellCount, 0);
    const area = fmtArea(zones.reduce((a, z) => a + z.areaM2, 0), gridUnits).text;
    if (!window.confirm(
      `Clear all ${zones.length} treatment grid zone${zones.length === 1 ? "" : "s"}?

` +
      `${cells} painted cell${cells === 1 ? "" : "s"} covering ${area} will return to ` +
      `no-decision-yet. Cells you deliberately skipped are kept, so Find Similar ` +
      `still has its examples. This cannot be undone.`,
    )) return;
    setClearingZones(true);
    try {
      const summary = await clearGridZones(props.fieldId, props.boundary as LatLng2[][]);
      setGridZoneNonce(n => n + 1);
      if (summary) {
        toast.success(
          `Cleared ${summary.zones} zone${summary.zones === 1 ? "" : "s"}` +
          (summary.skipsKept ? ` · ${summary.skipsKept} skipped cell${summary.skipsKept === 1 ? "" : "s"} kept` : ""),
        );
      }
    } catch (e) {
      toast.error(`Could not clear zones: ${(e as Error)?.message ?? e}`);
    } finally {
      setClearingZones(false);
    }
  };

  const ToolButton = ({ icon: Icon, label, onClick, active }: any) => (
    <button
      onClick={onClick} title={label}
      className={`h-10 w-10 grid place-items-center rounded-sm border transition-colors
        ${active
          ? "bg-[#1a1a1a] border-[#4CAF50] text-[#4CAF50]"
          : "bg-[#141414]/90 border-[#222] text-neutral-300 hover:text-[#f0f0f0] hover:bg-[#1a1a1a]"}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );

  return (
    <div className="absolute inset-0 bg-[#0a0a0a]">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [40, 40] }}
        minZoom={1}
        maxZoom={22}
        preferCanvas
        zoomControl={false}
        attributionControl={false}
        style={{ height: "100%", width: "100%", background: "#0a0a0a" }}
      >
        <BasemapLayer id={basemap} />
        {layers.orthomosaic && tileUrl && (
          <TileLayer
            key={tileUrl}
            url={tileUrl}
            opacity={1.0}
            maxNativeZoom={Math.min(20, maxNative)}
            maxZoom={22}
            tileSize={256}
            keepBuffer={8}
            updateWhenIdle={false}
            updateWhenZooming={false}
            bounds={bounds}
            noWrap
            zIndex={10}
          />
        )}
        {layers.ndvi && ndviUrl && (
          <TileLayer
            key={`ndvi-${ndviUrl}`}
            url={ndviUrl}
            opacity={0.75}
            maxNativeZoom={Math.min(20, maxNative)}
            maxZoom={22}
            tileSize={256}
            keepBuffer={8}
            updateWhenIdle={false}
            updateWhenZooming={false}
            bounds={bounds}
            noWrap
            zIndex={20}
          />
        )}
        <FitBounds bounds={bounds} />
        <MouseReadout coordRef={cursorCoordRef} zoomRef={cursorZoomRef} />
        <MapControls fitTo={bounds} />
        <BasemapToggle value={basemap} onChange={(id) => { setBasemap(id); saveBasemap(id); }} />
        {showAiZones && analysis?.zones && analysis.zones.length > 0 && (
          <AiZonesLayer
            zones={analysis.zones}
            selectedId={selectedZone}
            onSelect={setSelectedZone}
            onUpdate={updateZoneRing}
            onDelete={deleteZone}
            boundaryAreaHa={fieldAreaHa}
            settings={settings}
          />
        )}
        <MeasureTool active={measureActive} visible={layers.measurements} onStats={handleStats} />
        <AnnotateTool
          active={annotateActive}
          mode={annotateMode}
          color={annotateColor}
          width={annotateWidth}
          visible={layers.annotations}
          annotations={annotations}
          setAnnotations={setAnnotations}
          taskId={taskId}
        />
        <BoundaryTool
          mode={boundaryMode}
          boundary={boundary}
          visible={layers.boundary}
          onCreated={handleBoundaryCreated}
          onEdited={handleBoundaryEdited}
          onDeleteRing={handleBoundaryDeleteRing}
          activeIdx={activeBoundaryIdx}
          setActiveIdx={setActiveBoundaryIdx}
        />
        {layers.userAnnotations && userPolys.length > 0 && (
          <UserPolyLayer polys={userPolys} onDelete={deleteUserPolygon} />
        )}
        {layers.gridZones && gridZoneLoad && gridZoneLoad.zones.length > 0 && (
          <GridAnomaliesLayer zones={gridZoneLoad.zones} />
        )}
        {userPolyToolActive && (
          <UserPolygonTool
            active={userPolyToolActive}
            onComplete={(p) => setDraftUserPoly(p)}
          />
        )}
      </MapContainer>

      {/* Floating icon toolbar */}
      <div className="absolute top-4 left-4 z-[1000] flex flex-col gap-1.5">
        <ToolButton icon={Layers} label="Layers" active={layersOpen}
          onClick={() => { setLayersOpen(!layersOpen); }} />
        <ToolButton icon={Ruler} label="Measure" active={measureActive}
          onClick={() => {
            setMeasureActive(v => !v); setAnnotateActive(false); setLayersOpen(false);
          }} />
        <ToolButton icon={Pencil} label={annotateActive ? "Pen on, drag to draw" : "Pen marker"} active={annotateActive}
          onClick={() => {
            setAnnotateActive(v => !v); setMeasureActive(false); setLayersOpen(false);
          }} />
        <ToolButton
          icon={MapPin}
          label={boundary ? "Edit field boundary" : "Define field boundary"}
          active={boundaryMode !== "off"}
          onClick={() => {
            setBoundaryMode(m => m !== "off" ? "off" : (boundary ? "edit" : "draw"));
            setMeasureActive(false);
            setAnnotateActive(false);
            setLayersOpen(false);
            setUserPolyToolActive(false);
          }}
        />
        <ToolButton
          icon={Hexagon}
          label="Mark anomaly polygon"
          active={userPolyToolActive}
          onClick={() => {
            setUserPolyToolActive(v => !v);
            setMeasureActive(false);
            setAnnotateActive(false);
            setBoundaryMode("off");
            setLayersOpen(false);
          }}
        />
        {/* This had no onClick at all — it rendered, highlighted on hover, and
            did nothing, which reads as a broken app rather than a missing
            feature. Settings is not in the default tab set, so it has to be
            opened as well as selected. */}
        <ToolButton icon={Settings} label="Settings" onClick={props.openSettings} />
      </div>

      {/* Measure panel */}
      {(measureActive || measureStats.count > 0) && layers.measurements && !layersOpen && (
        <MeasurePanel stats={measureStats} />
      )}
      {annotateActive && !layersOpen && (
        <div className="absolute top-4 left-16 z-[1001] w-72 rounded-md border border-[#222] shadow-2xl p-3 text-[#f0f0f0]"
             style={{ background: "#161616" }}>
          <div className="flex items-center gap-2 pb-2 mb-2 border-b border-[#222]">
            <Pencil className="h-3.5 w-3.5" style={{ color: annotateColor }} />
            <div className="text-xs font-medium">Annotate</div>
            <div className="ml-auto text-[10px] uppercase tracking-wider text-neutral-500">
              {annotateMode === "pen"
                ? "Drag to draw"
                : annotateMode === "text"
                  ? "Click to place"
                  : "Drag labels"}
            </div>
          </div>

          {/* mode tabs */}
          <div className="grid grid-cols-3 gap-1 mb-2">
            {(["pen", "text", "select"] as const).map(m => (
              <button
                key={m}
                onClick={() => setAnnotateMode(m)}
                className={`text-[11px] py-1.5 rounded border transition-colors ${
                  annotateMode === m
                    ? "bg-[#1a1a1a] border-[#4CAF50] text-[#4CAF50]"
                    : "bg-[#141414] border-[#222] text-neutral-400 hover:text-[#f0f0f0]"
                }`}
              >
                {m === "pen" ? "Pen" : m === "text" ? "Text" : "Select"}
              </button>
            ))}
          </div>

          {/* colors */}
          <div className="mb-2">
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Color</div>
            <div className="flex items-center gap-1.5">
              {["#facc15", "#ef4444", "#22c55e", "#3b82f6", "#a855f7", "#f0f0f0"].map(c => (
                <button key={c} onClick={() => setAnnotateColor(c)}
                  className={`h-5 w-5 rounded-full border ${annotateColor === c ? "border-white scale-110" : "border-[#333]"}`}
                  style={{ background: c }} title={c} />
              ))}
              <input type="color" value={annotateColor}
                onChange={(e) => setAnnotateColor(e.target.value)}
                className="h-5 w-5 ml-1 bg-transparent border border-[#333] rounded cursor-pointer" />
            </div>
          </div>

          {/* width (pen only) */}
          {annotateMode === "pen" && (
            <div className="mb-2">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
                <span>Stroke</span>
                <span className="font-mono">{annotateWidth}px</span>
              </div>
              <input type="range" min={1} max={10} step={1}
                value={annotateWidth}
                onChange={(e) => setAnnotateWidth(Number(e.target.value))}
                className="w-full accent-[#4CAF50]" />
            </div>
          )}

          {annotateMode === "select" && (
            <div className="mb-2 text-[10px] text-neutral-400 bg-[#1a1a1a] border border-[#222] rounded px-2 py-1.5 leading-relaxed">
              Drag a label to move it. Double-click to edit or clear its text.
            </div>
          )}

          {!layers.annotations && (
            <div className="mb-2 text-[10px] text-yellow-400/80 bg-yellow-900/20 border border-yellow-700/40 rounded px-2 py-1">
              Annotations layer is hidden. Enable it in Layers to see your marks.
            </div>
          )}

          {/* list */}
          <div className="border-t border-[#222] pt-2">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">
                Marks ({annotations.length})
              </div>
              {annotations.length > 0 && (
                <button
                  onClick={() => { if (window.confirm("Clear all annotations on this scan?")) { setAnnotations([]); saveAnnotations(taskId, []); } }}
                  className="inline-flex items-center gap-1 text-[10px] text-red-400 hover:underline">
                  <Trash2 className="h-3 w-3" /> Clear all
                </button>
              )}
            </div>
            {annotations.length === 0 ? (
              <div className="text-[11px] text-neutral-500 italic py-1">
                {annotateMode === "pen"
                  ? "Press and drag on the map to draw."
                  : annotateMode === "text"
                    ? "Click on the map to place a label."
                    : "No labels yet, place one with the Text tool."}
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto -mr-1 pr-1 space-y-1">
                {annotations.slice().reverse().map(a => (
                  <div key={a.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-[#1a1a1a] group">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: a.color }} />
                    <span className="text-[11px] truncate flex-1">
                      {a.kind === "text" ? `"${a.text}"` : `Stroke · ${(a.stroke ?? []).length} pts`}
                    </span>
                    <button
                      onClick={() => {
                        setAnnotations(prev => {
                          const next = prev.filter(x => x.id !== a.id);
                          saveAnnotations(taskId, next);
                          return next;
                        });
                      }}
                      className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-red-400 transition-opacity"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Layers popover */}
      {layersOpen && (
        <div className="absolute top-4 left-16 z-[1001] w-64 rounded-md border border-[#222] shadow-2xl p-2"
             style={{ background: "#161616" }}>
          <div className="flex items-center justify-between px-1.5 pb-2 border-b border-[#222] mb-1">
            <div className="text-xs font-medium text-[#f0f0f0]">Layers</div>
            <button onClick={() => setLayersOpen(false)} className="text-neutral-500 hover:text-[#f0f0f0]">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <LayerRow label="Orthomosaic" icon={ImageIcon}
            checked={layers.orthomosaic}
            onToggle={() => setLayers(s => ({ ...s, orthomosaic: !s.orthomosaic }))} />
          <LayerRow
            label={
              ndviInfo?.index === "ndvi" ? "NDVI"
              : ndviInfo?.index === "ndre" ? "NDRE"
              : "Vegetation index (VARI, not NDVI)"
            }
            icon={Activity}
            checked={layers.ndvi}
            onToggle={() => setLayers(s => ({ ...s, ndvi: !s.ndvi }))}
          />
          <LayerRow label="Annotations" icon={MapPin}
            checked={layers.annotations}
            onToggle={() => setLayers(s => ({ ...s, annotations: !s.annotations }))} />
          <LayerRow label="Measurements" icon={Ruler}
            checked={layers.measurements}
            onToggle={() => setLayers(s => ({ ...s, measurements: !s.measurements }))} />
          <LayerRow label="Field boundary" icon={MapPin}
            checked={layers.boundary}
            onToggle={() => setLayers(s => ({ ...s, boundary: !s.boundary }))} />
          <LayerRow label="AI treatment zones" icon={Sparkles}
            checked={showAiZones}
            onToggle={() => setShowAiZones(!showAiZones)} />
          <LayerRow label={`Annotations · my polygons (${userPolys.length})`} icon={Hexagon}
            checked={layers.userAnnotations}
            onToggle={() => setLayers(s => ({ ...s, userAnnotations: !s.userAnnotations }))} />
          <LayerRow
            label={`Treatment grid zones${gridZoneLoad ? ` (${gridZoneLoad.zones.length})` : ""}`}
            icon={Grid3x3}
            checked={layers.gridZones}
            onToggle={() => setLayers(s => ({ ...s, gridZones: !s.gridZones }))} />
          {gridZoneLoad?.stale && (
            <div className="pl-6 text-[10px] text-amber-500/90 leading-relaxed">
              Built for an older boundary, open the Treatment Grid tab to migrate it.
            </div>
          )}
          {!!gridZoneLoad?.zones.length && (
            <button
              onClick={clearZones}
              disabled={clearingZones}
              className="ml-6 mt-1 inline-flex items-center gap-1.5 text-[10px] text-neutral-500 hover:text-red-300 transition-colors disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" />
              {clearingZones ? "Clearing…" : "Clear all treatment grid zones"}
            </button>
          )}
        </div>
      )}

      {/* Boundary tool panel */}
      {boundaryMode !== "off" && !layersOpen && (
        <div className="absolute top-4 left-16 z-[1001] w-72 rounded-md border border-[#222] shadow-2xl p-3 text-[#f0f0f0]"
             style={{ background: "#161616" }}>
          <div className="flex items-center gap-2 pb-2 mb-2 border-b border-[#222]">
            <MapPin className="h-3.5 w-3.5 text-cyan-400" />
            <div className="text-xs font-medium">Field boundary</div>
            <div className="ml-auto text-[10px] uppercase tracking-wider text-neutral-500">
              {boundaryMode === "draw" ? "Drawing" : boundaryDirty ? "Unsaved" : "Editing"}
            </div>
          </div>
          <div className="text-[11px] text-neutral-400 leading-relaxed mb-3">
            {boundaryMode === "draw"
              ? "Click to drop vertices, click the first point to close. Finish one shape and immediately start the next, perfect for fragmented fields."
              : "Click a part to select it, then drag vertices to adjust. Right-click a vertex to remove just that point. Use Delete part to remove only the selected fragment."}
          </div>
          {boundary && boundary.length > 0 && (
            <div className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">
              Selected: {activeBoundaryIdx === null ? "none, click a part on the map" : `part ${activeBoundaryIdx + 1} of ${boundary.length}`}
            </div>
          )}
          {boundaryMode === "edit" && (
            <button
              onClick={() => setBoundaryMode("draw")}
              className="w-full mb-2 inline-flex items-center justify-center gap-1.5 border border-cyan-700/60 text-cyan-300 hover:bg-cyan-900/20 rounded-sm px-3 py-1.5 text-[11px]"
            >
              + Add another part
            </button>
          )}
          {boundary && boundary.length > 0 && (() => {
            const m2 = boundary.reduce(
              (sum, ring) =>
                sum + (ring.length >= 3 ? polygonAreaM2(ring.map(p => L.latLng(p.lat, p.lng))) : 0),
              0,
            );
            const ha = m2 / 10000;
            const ac = m2 / 4046.8564224;
            return (
              <div className="mb-3 grid grid-cols-2 gap-2 text-[11px]">
                <div className="col-span-2 text-[10px] uppercase tracking-wider text-neutral-500">
                  {boundary.length} part{boundary.length === 1 ? "" : "s"} · total area
                </div>
                <div className="rounded border border-[#222] px-2 py-1.5" style={{ background: "#0f0f0f" }}>
                  <div className="text-[10px] uppercase text-neutral-500">Hectares</div>
                  <div className="font-mono text-cyan-400 tabular-nums">{ha.toFixed(3)} ha</div>
                </div>
                <div className="rounded border border-[#222] px-2 py-1.5" style={{ background: "#0f0f0f" }}>
                  <div className="text-[10px] uppercase text-neutral-500">Acres</div>
                  <div className="font-mono text-cyan-400 tabular-nums">{ac.toFixed(3)} ac</div>
                </div>
              </div>
            );
          })()}
          <div className="flex flex-wrap gap-1.5">
            <button
              disabled={!boundary || boundary.length === 0 || boundarySaving || !boundaryDirty}
              onClick={saveBoundary}
              className="flex-1 inline-flex items-center justify-center gap-1.5 bg-[#4CAF50] hover:bg-[#43a047] disabled:bg-[#1a1a1a] disabled:text-neutral-600 text-black rounded-sm px-3 py-1.5 text-[11px] font-semibold"
            >
              {boundarySaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Save boundary
            </button>
            <button
              onClick={() => setBoundaryMode("off")}
              className="inline-flex items-center justify-center gap-1.5 border border-[#222] hover:bg-[#1a1a1a] text-neutral-300 rounded-sm px-3 py-1.5 text-[11px]"
            >
              Done
            </button>
          </div>
          {boundary && boundary.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <button
                disabled={activeBoundaryIdx === null}
                onClick={() => {
                  if (activeBoundaryIdx === null || !boundary) return;
                  if (window.confirm(`Remove boundary part ${activeBoundaryIdx + 1}? Other parts stay.`)) {
                    handleBoundaryDeleteRing(activeBoundaryIdx);
                  }
                }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 border border-red-900/50 text-red-400 hover:bg-red-900/20 disabled:opacity-40 disabled:cursor-not-allowed rounded-sm px-2 py-1.5 text-[11px]"
                title="Delete only the selected part"
              >
                <Trash2 className="h-3 w-3" /> Delete part
              </button>
              <button
                onClick={clearBoundary}
                className="text-[10px] text-neutral-500 hover:text-red-400 underline"
                title="Remove every boundary part"
              >
                Clear all
              </button>
            </div>
          )}
          {!layers.boundary && (
            <div className="mt-2 text-[10px] text-yellow-400/80 bg-yellow-900/20 border border-yellow-700/40 rounded px-2 py-1">
              Boundary layer is hidden. Toggle it on in Layers to see your outline.
            </div>
          )}
        </div>
      )}

      {/* NDVI legend */}
      {layers.ndvi && (
        <div className="absolute bottom-[72px] left-1/2 -translate-x-1/2 z-[1000] rounded-sm border border-[#222] px-3 py-2 text-[11px] shadow-xl"
             style={{ background: "#161616", color: "#f0f0f0" }}>
          <div className="flex items-center gap-2 mb-1">
            <Activity className="h-3.5 w-3.5 text-[#4CAF50]" />
            <span className="font-medium">
              {ndviInfo?.index === "vari" ? "Vegetation Index (VARI · RGB-derived)" : "NDVI"}
            </span>
            {ndviInfo && (
              <span
                className={ndviInfo.ambiguousMultispectral ? "text-amber-500 font-mono" : "text-neutral-500 font-mono"}
                title={ndviInfo.reason ?? ""}
              >
                {ndviInfo.spectralBands ?? ndviInfo.bands}-band
                {ndviInfo.hasAlpha ? " +α" : ""}
                {/* Multispectral imagery whose band roles could not be resolved
                    would otherwise silently render as VARI, looking identical to
                    an ordinary RGB scan. Say so instead. */}
                {ndviInfo.ambiguousMultispectral ? " · bands unlabelled" : ""}
                {/* Naming the resolved bands and how they were found lets the
                    mapping be sanity-checked against the camera's datasheet. */}
                {ndviInfo.hasNDVI && ndviInfo.roles?.nir && ndviInfo.roles?.red
                  ? ` · NIR b${ndviInfo.roles.nir} / red b${ndviInfo.roles.red}`
                  : ""}
                {ndviInfo.method && ndviInfo.method !== "unresolved" ? ` · via ${ndviInfo.method}` : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-red-400">Stressed</span>
            <div className="h-1.5 w-40"
              style={{ background: "linear-gradient(to right,#a50026,#d73027,#f46d43,#fdae61,#fee08b,#d9ef8b,#a6d96a,#66bd63,#1a9850,#006837)" }} />
            <span className="text-[#4CAF50]">Healthy</span>
          </div>
        </div>
      )}

      {/* Slide-up AI drawer */}
      <div
        className="absolute bottom-0 left-0 right-0 z-[1100] border-t border-[#222] transition-[max-height] duration-300 ease-out"
        style={{
          background: "#0f0f0f",
          maxHeight: drawerOpen ? "60vh" : 42,
        }}
      >
        <button
          onClick={() => setDrawerOpen(!drawerOpen)}
          className="w-full h-[42px] px-4 flex items-center gap-3 text-left hover:bg-[#141414]"
        >
          <Sparkles className="h-4 w-4 text-[#4CAF50]" />
          <div className="text-xs font-medium">
            Field Health:{" "}
            <span className={
              analysis ? (analysis.health_score >= 70 ? "text-[#4CAF50]" : analysis.health_score >= 40 ? "text-yellow-400" : "text-red-400") : "text-neutral-500"
            }>
              {analysis ? `${analysis.health_score}/100` : "Not analyzed"}
            </span>
          </div>
          {analysis && (
            <div className="text-[11px] text-neutral-500 truncate hidden md:block">
              {analysis.zones.length} treatment zone{analysis.zones.length === 1 ? "" : "s"} · {analysis.issues.length} issue{analysis.issues.length === 1 ? "" : "s"}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2 text-neutral-500">
            {drawerOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </div>
        </button>

        {drawerOpen && (
          <div className="px-4 pb-4 overflow-auto" style={{ maxHeight: "calc(60vh - 42px)" }}>
            {!analysis && !analyzing && (
              <div className="flex items-center gap-3 py-3">
                <p className="text-xs text-neutral-400 leading-relaxed flex-1">
                  Run AI vision over this orthomosaic to detect bare patches, waterlogging,
                  discoloration and row gaps, and auto-draw treatment zones you can export.
                </p>
                <button onClick={runAnalysis}
                  className="inline-flex items-center gap-2 bg-[#4CAF50] hover:bg-[#43a047] text-black rounded-sm px-3 py-2 text-xs font-semibold whitespace-nowrap">
                  <Sparkles className="h-3.5 w-3.5" /> Analyze field
                </button>
              </div>
            )}
            {analysisErr && <div className="text-red-400 text-xs py-2">{analysisErr}</div>}
            {analyzing && (
              <div className="flex items-center gap-2 py-4 text-neutral-300 text-xs">
                <Loader2 className="h-4 w-4 animate-spin text-[#4CAF50]" />
                Analyzing imagery…
              </div>
            )}
            {analysis && <AnalysisGrid
              analysis={analysis} runAnalysis={runAnalysis}
              showAiZones={showAiZones} setShowAiZones={setShowAiZones}
              selectedZone={selectedZone} setSelectedZone={setSelectedZone}
              deleteZone={deleteZone} exportFlightPlan={exportFlightPlan}
              clearAnalysis={clearAnalysis}
            />}
          </div>
        )}
      </div>

      {/* User-polygon tool hint */}
      {userPolyToolActive && !draftUserPoly && !layersOpen && (
        <div className="absolute top-4 left-16 z-[1001] w-72 rounded-md border border-[#222] shadow-2xl p-3 text-[#f0f0f0]"
             style={{ background: "#161616" }}>
          <div className="flex items-center gap-2 pb-2 mb-2 border-b border-[#222]">
            <Hexagon className="h-3.5 w-3.5 text-orange-400" />
            <div className="text-xs font-medium">Mark anomaly</div>
            <button onClick={() => setUserPolyToolActive(false)} className="ml-auto text-neutral-500 hover:text-[#f0f0f0]">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="text-[11px] text-neutral-400 leading-relaxed">
            Click on the map to drop vertices around the area you want to flag.
            Click the first point to close the shape. A form will pop up to label it.
          </div>
        </div>
      )}

      {/* User polygon metadata form */}
      {draftUserPoly && (
        <UserPolyForm
          draft={draftUserPoly}
          onCancel={() => { setDraftUserPoly(null); setUserPolyToolActive(false); }}
          onSave={(form) => saveUserPolygon(form)}
        />
      )}
    </div>
  );
}

// ---- User polygon save dialog -----------------------------------------------
export function UserPolyForm({
  draft, onCancel, onSave,
}: {
  draft: DraftPolygon;
  onCancel: () => void;
  onSave: (f: { name: string; issue_type: string; color: string; notes: string }) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [issueType, setIssueType] = useState<string>("Bare soil");
  const [color, setColor] = useState<string>("orange");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try { await onSave({ name, issue_type: issueType, color, notes }); }
    finally { setSaving(false); }
  };

  return (
    <div className="absolute inset-0 z-[2000] flex items-center justify-center p-6"
         style={{ background: "rgba(0,0,0,0.65)" }}
         onClick={onCancel}>
      <div className="w-full max-w-md rounded-md border border-[#222] shadow-2xl text-[#f0f0f0]"
           style={{ background: "#161616" }}
           onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-[#222] flex items-center gap-2">
          <Hexagon className="h-4 w-4 text-orange-400" />
          <div className="text-sm font-semibold">New annotation</div>
          <div className="ml-auto text-[10px] uppercase tracking-wider text-neutral-500 font-mono">
            {draft.areaHa.toFixed(3)} ha · {(draft.areaHa * 2.4710538147).toFixed(2)} ac
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-500">Annotation name</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. NW bare patch"
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              className="mt-1 w-full bg-[#0f0f0f] border border-[#222] focus:border-[#4CAF50] outline-none rounded-sm px-2.5 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-500">Issue type</label>
            <select value={issueType} onChange={(e) => setIssueType(e.target.value)}
              className="mt-1 w-full bg-[#0f0f0f] border border-[#222] focus:border-[#4CAF50] outline-none rounded-sm px-2.5 py-1.5 text-sm">
              {USER_POLY_ISSUES.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-500">Color</label>
            <div className="mt-1 flex items-center gap-2">
              {(["orange", "red", "yellow"] as const).map(c => (
                <button key={c} type="button" onClick={() => setColor(c)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm border text-xs capitalize ${
                    color === c ? "border-[#4CAF50] text-[#f0f0f0]" : "border-[#222] text-neutral-400 hover:text-[#f0f0f0]"
                  }`}>
                  <span className="h-3 w-3 rounded-sm" style={{ background: USER_POLY_COLORS[c] }} />
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-500">Notes (optional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              className="mt-1 w-full bg-[#0f0f0f] border border-[#222] focus:border-[#4CAF50] outline-none rounded-sm px-2.5 py-1.5 text-sm resize-none" />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-[#222] flex items-center justify-end gap-2">
          <button onClick={onCancel}
            className="text-xs border border-[#222] hover:bg-[#1a1a1a] text-neutral-300 rounded-sm px-3 py-1.5">Cancel</button>
          <button onClick={submit} disabled={!name.trim() || saving}
            className="inline-flex items-center gap-1.5 text-xs bg-[#4CAF50] hover:bg-[#43a047] disabled:bg-[#1a1a1a] disabled:text-neutral-600 text-black rounded-sm px-3 py-1.5 font-semibold">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            Save annotation
          </button>
        </div>
      </div>
    </div>
  );
}

export default FieldViewTab;
