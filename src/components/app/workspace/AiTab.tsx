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
  AiZonesLayer, AnnotateTool, BoundaryTool, FitBounds, LayerRow, MapControls,
  MeasurePanel, MeasureTool, MouseReadout, USER_POLY_ISSUES, UserPolyLayer,
  escapeHtml, loadAnnotations, saveAnnotations, sevColor,
} from "./layers";


export function AnalysisGrid({
  analysis, runAnalysis, showAiZones, setShowAiZones,
  selectedZone, setSelectedZone, deleteZone, exportFlightPlan, clearAnalysis,
}: any) {
  const isNDVI = analysis?.data_source === "NDVI+RGB";
  return (
    <div className="pt-3">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[10px] font-semibold uppercase tracking-wider border ${
            isNDVI
              ? "bg-[#0f2a16] text-[#4CAF50] border-[#4CAF50]/40"
              : "bg-[#1a1a1a] text-neutral-300 border-[#333]"
          }`}
          title={isNDVI
            ? `Multispectral data detected (${analysis.band_count} bands). NDVI cross-referenced with RGB.`
            : "RGB imagery only. Specific nutrient deficiencies cannot be diagnosed without multispectral data."}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${isNDVI ? "bg-[#4CAF50]" : "bg-neutral-500"}`} />
          {isNDVI ? "NDVI + RGB Analysis" : "RGB Analysis Only"}
        </span>
        {isNDVI && analysis.ndvi_cells?.length > 0 && (
          <span className="text-[10px] text-neutral-500">
            {analysis.ndvi_cells.length} NDVI zones sampled
          </span>
        )}
      </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className="rounded-sm p-3 border border-[#222]" style={{ background: "#1a1a1a" }}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500">Overall health</div>
          <div className="flex items-center gap-2">
            <button onClick={runAnalysis} className="text-[10px] text-[#4CAF50] hover:underline">Re-run</button>
            {clearAnalysis && (
              <button onClick={clearAnalysis} className="text-[10px] text-red-400 hover:underline">Clear analysis</button>
            )}
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div className={`text-4xl font-semibold tabular-nums ${analysis.health_score >= 70 ? "text-[#4CAF50]" : analysis.health_score >= 40 ? "text-yellow-400" : "text-red-400"}`}>
            {analysis.health_score}
          </div>
          <div className="text-neutral-500 text-xs mb-1.5">/ 100</div>
        </div>
        <div className="h-1 bg-[#0f0f0f] mt-2 overflow-hidden">
          <div className={`h-full ${analysis.health_score >= 70 ? "bg-[#4CAF50]" : analysis.health_score >= 40 ? "bg-yellow-400" : "bg-red-500"}`}
            style={{ width: `${analysis.health_score}%` }} />
        </div>
        {analysis.summary && <div className="text-neutral-300 text-xs mt-3 leading-relaxed">{analysis.summary}</div>}
        {analysis.zones.length > 0 && (
          <button onClick={exportFlightPlan}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 bg-[#4CAF50] hover:bg-[#43a047] text-black rounded-sm px-3 py-2 text-xs font-semibold">
            <Download className="h-3.5 w-3.5" /> Export flight plan
          </button>
        )}
      </div>

      <div className="rounded-sm p-3 border border-[#222] overflow-auto max-h-[42vh]" style={{ background: "#1a1a1a" }}>
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Detected issues ({analysis.issues.length})</div>
        {analysis.issues.length === 0 ? (
          <div className="text-xs text-neutral-500 italic">No visible issues.</div>
        ) : (
          <div className="space-y-1.5">
            {analysis.issues.map((iss: any, i: number) => (
              <div key={i} className="border border-[#222] rounded-sm p-2" style={{ background: "#0f0f0f" }}>
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className={`h-3 w-3 ${iss.severity === "high" ? "text-red-400" : iss.severity === "medium" ? "text-yellow-400" : "text-neutral-400"}`} />
                  <div className="font-medium text-xs">{iss.label}</div>
                  <span className="ml-auto text-[10px] uppercase text-neutral-500">{iss.severity}</span>
                </div>
                {iss.description && <div className="text-neutral-400 text-[11px] mt-1 leading-relaxed">{iss.description}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-sm p-3 border border-[#222] overflow-auto max-h-[42vh]" style={{ background: "#1a1a1a" }}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500">Treatment zones ({analysis.zones.length})</div>
          <label className="flex items-center gap-1 text-[10px] text-neutral-400 cursor-pointer">
            <input type="checkbox" checked={showAiZones} onChange={e => setShowAiZones(e.target.checked)}
              className="h-3 w-3 accent-[#4CAF50]" />
            On map
          </label>
        </div>
        {analysis.zones.length === 0 ? (
          <div className="text-xs text-neutral-500 italic">No treatment zones — field looks healthy.</div>
        ) : (
          <div className="space-y-1.5">
            {analysis.zones.map((z: AiZone) => (
              <div key={z.id}
                onClick={() => setSelectedZone(z.id)}
                className={`border rounded-sm p-2 cursor-pointer transition-colors ${selectedZone === z.id ? "border-[#4CAF50]" : "border-[#222] hover:border-[#333]"}`}
                style={{ background: "#0f0f0f" }}>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: sevColor(z.severity) }} />
                  <div className="font-medium text-xs truncate">{z.name}</div>
                  <span className="ml-auto text-[10px] text-neutral-500 font-mono">{z.coverage_pct}%</span>
                </div>
                <div className="text-neutral-400 text-[11px] mt-0.5">{z.issue}</div>
                {z.recommendation && (
                  <div className="mt-1.5 pt-1.5 border-t border-[#222] text-[11px] text-neutral-300">
                    <span className="text-[#4CAF50] font-medium capitalize">{z.recommendation.action}</span>
                    {z.recommendation.product && <> · {z.recommendation.product}</>}
                    {z.recommendation.dose && <span className="text-neutral-500"> · {z.recommendation.dose}</span>}
                  </div>
                )}
                {selectedZone === z.id && (
                  <button onClick={(e) => { e.stopPropagation(); deleteZone(z.id); }}
                    className="mt-1.5 text-[10px] text-red-400 hover:underline">Delete zone</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    {analysis?.disclaimer && (
      <div className="mt-3 rounded-sm border border-[#222] p-3 text-[11px] text-neutral-400 leading-relaxed" style={{ background: "#141414" }}>
        ⚠️ {analysis.disclaimer}
      </div>
    )}
    {analysis?.watch_list?.length > 0 && (
      <div className="mt-3 rounded-sm border border-[#222] p-3" style={{ background: "#141414" }}>
        <div className="flex items-center gap-2 mb-2">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500">Watch list</div>
          <span className="text-[10px] text-neutral-600">monitor — no treatment zone drawn</span>
        </div>
        <ul className="space-y-1.5">
          {analysis.watch_list.map((w: any, i: number) => (
            <li key={i} className="text-[11px] text-neutral-400 leading-relaxed flex gap-2">
              <span className="text-neutral-600 mt-0.5">•</span>
              <span>
                <span className="text-neutral-200 font-medium">{w.name}</span>
                {w.issue ? <span className="text-neutral-500"> — {w.issue}</span> : null}
                {w.what_you_see ? <span className="text-neutral-500">. {w.what_you_see}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
    )}
    </div>
  );
}

export function AiTab({ analysis, analyzing, analysisErr, runAnalysis, exportFlightPlan, clearAnalysis, deleteZone }: any) {
  return (
    <div className="absolute inset-0 overflow-auto p-8" style={{ background: "#0f0f0f" }}>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Bot className="h-5 w-5 text-[#4CAF50]" />
          <h1 className="text-xl font-semibold tracking-tight">AI Field Analysis</h1>
        </div>
        {!analysis && !analyzing && (
          <div className="rounded-sm border border-[#222] p-6" style={{ background: "#1a1a1a" }}>
            <p className="text-sm text-neutral-400 mb-4 max-w-2xl leading-relaxed">
              Run conservative RGB vision over this orthomosaic. We only flag what we can confirm visually —
              bare soil, waterlogging, row gaps, visible discoloration and field boundary issues.
            </p>
            <button onClick={runAnalysis}
              className="inline-flex items-center gap-2 bg-[#4CAF50] hover:bg-[#43a047] text-black rounded-sm px-4 py-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4" /> Analyze field
            </button>
            {analysisErr && <div className="text-red-400 text-xs mt-3">{analysisErr}</div>}
          </div>
        )}
        {analyzing && (
          <div className="flex items-center gap-2 text-sm text-neutral-300">
            <Loader2 className="h-4 w-4 animate-spin text-[#4CAF50]" /> Analyzing imagery…
          </div>
        )}
        {analysis && (
          <AnalysisGrid
            analysis={analysis} runAnalysis={runAnalysis}
            showAiZones={true} setShowAiZones={() => {}}
            selectedZone={null} setSelectedZone={() => {}}
            deleteZone={deleteZone} exportFlightPlan={exportFlightPlan}
            clearAnalysis={clearAnalysis}
          />
        )}
      </div>
    </div>
  );
}

// =========================== Flight Planner tab ==============================
// Generates a lawnmower (boustrophedon) spray path over each AI treatment zone
// that lies inside the field boundary. The boundary is treated as the hard
// no-fly constraint — every flight line is clipped to (boundary ∩ zone).

// Geometry (`@/lib/geo`) and the sweep/mission builders (`@/lib/mission`) are
// imported at the top of this file — see those modules for the maths and
// `src/test/` for their unit tests.



export default AiTab;
