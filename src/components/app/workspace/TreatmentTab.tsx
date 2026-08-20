// Treatment grid: the screen where a prescription becomes something you can
// see and change.
//
// It deliberately does NOT sit inside the Flight Planner. The planner refuses
// to open until AI analysis or a hand-drawn anomaly exists, and the entire
// premise of this grid is that a rate can be assigned without either — an
// operator who knows their own field should not have to run a model first to
// tell the software where to spray.
//
// Rates only. Detection scores have a home in every cell and nothing writes
// them yet; that is the next stage. Keeping assignment visibly separate is the
// point: when scoring does arrive it writes `detection` and never `rate`, and
// that distinction is only meaningful if there is a rate here an operator
// recognises as their own.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  AlertTriangle, Brush, Grid3x3, Info, Loader2, MousePointer, Save, Trash2,
} from "lucide-react";
import { type FarmerSettings } from "@/lib/farmerSettings";
import { type DroneSpec } from "@/lib/droneSpecs";
import { type LatLng2, ringsAreaM2 } from "@/lib/geo";
import {
  type CellId, type CellRate, type GridDefinition, type TreatmentGrid,
  GridTooLargeError, buildTreatmentGrid, gridDefinitionFor, gridIdFor, gridTotals,
  regenerationImpact,
} from "@/lib/treatmentGrid";
import { GridStoreTooLargeError, applyStored, packGrid } from "@/lib/treatmentGridStore";
import { SupabaseTreatmentGridRepository } from "@/lib/treatmentGridRepo";
import type { GridRenderInfo } from "./TreatmentGridLayer";
import TreatmentGridLayer from "./TreatmentGridLayer";
import { type BasemapId, BasemapLayer, BasemapToggle, FitBounds, loadBasemap, saveBasemap } from "./layers";
import type { BoundaryRing } from "./types";
import {
  fmtArea, fmtAreaHa, fmtRate, fmtVolume, rateToLha, rateUnit, rateValue,
} from "@/lib/units";
import { useUnitSystem } from "@/hooks/useUnitSystem";

const repo = new SupabaseTreatmentGridRepository();

/** What a click does. */
type Tool = "inspect" | "paint";

export function TreatmentTab({
  boundary, tileUrl, bounds, maxNative, fieldId, spec, settings, setActiveTab,
}: {
  boundary: BoundaryRing[] | null;
  tileUrl: string;
  bounds: L.LatLngBoundsExpression | null;
  maxNative: number;
  fieldId: string | null;
  spec: DroneSpec;
  settings: FarmerSettings;
  /** Narrow on purpose: the only tab this screen sends anyone to is Field View. */
  setActiveTab: (k: "field") => void;
}) {
  const units = useUnitSystem();
  const [basemap, setBasemap] = useState<BasemapId>(loadBasemap);
  const [cellMultiple, setCellMultiple] = useState<1 | 2 | 3>(1);
  const [tool, setTool] = useState<Tool>("inspect");
  const [brushCells, setBrushCells] = useState(1);
  const [rateLha, setRateLha] = useState<number>(settings.spray_rates_lha.medium);
  const [paintAction, setPaintAction] = useState<"treat" | "skip" | "clear">("treat");
  const [grid, setGrid] = useState<TreatmentGrid | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<CellId>>(new Set());
  const [render, setRender] = useState<GridRenderInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const rings = (boundary ?? []) as unknown as LatLng2[][];
  const swathM = spec.spray_swath_m > 0 ? spec.spray_swath_m : 6;

  const definition: GridDefinition | null = useMemo(
    () => (rings.length ? gridDefinitionFor(rings, swathM, cellMultiple) : null),
    // `rings` is a fresh array each render; the boundary itself is what matters.
    [boundary, swathM, cellMultiple], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ---- Build, then reattach whatever was stored --------------------------
  //
  // Geometry is never persisted, so every load recomputes it and reattaches the
  // sparse state by cell id. That is the whole reason ids are derived: if the
  // definition still matches, the operator's rates land back on the same
  // ground; if it does not, the gridId differs and nothing reattaches, which is
  // the correct outcome rather than a bug.
  useEffect(() => {
    if (!definition) { setGrid(null); setLoading(false); return; }
    const wantId = gridIdFor(definition);
    let cancelled = false;
    setLoading(true);
    (async () => {
      let built: TreatmentGrid;
      try {
        built = buildTreatmentGrid(rings, definition);
        setBuildError(null);
      } catch (e) {
        if (cancelled) return;
        setGrid(null);
        setBuildError(e instanceof GridTooLargeError ? e.message : String((e as Error)?.message ?? e));
        setLoading(false);
        return;
      }
      let stored = null;
      if (fieldId) {
        try { stored = await repo.load(fieldId); } catch (e) { console.error("[grid] load failed", e); }
      }
      if (cancelled) return;
      // A stored grid built from a different definition must not be reattached:
      // same col/row, different ground.
      const usable = stored && gridIdFor(stored.definition) === wantId ? stored : null;
      setGrid(applyStored(built, usable));
      setSelected(new Set());
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [definition, fieldId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Persist on idle ----------------------------------------------------
  // Painting fires per cell under the brush; writing each one would be a
  // request per cell. Debounced, and skipped entirely until the initial load
  // has attached, so a slow load cannot save an empty grid over a real one.
  const dirty = useRef(false);
  useEffect(() => {
    if (!grid || !fieldId || !dirty.current) return;
    const t = setTimeout(async () => {
      setSaving(true);
      setSaveError(null);
      try {
        await repo.save(fieldId, packGrid(grid));
        dirty.current = false;
        setSavedAt(Date.now());
      } catch (e) {
        const msg = e instanceof GridStoreTooLargeError
          ? e.message
          : `Could not save: ${(e as Error)?.message ?? e}`;
        setSaveError(msg);
        console.error("[grid] save failed", e);
      } finally {
        setSaving(false);
      }
    }, 700);
    return () => clearTimeout(t);
  }, [grid, fieldId]);

  const mutate = useCallback((ids: readonly CellId[], next: (cur: CellRate) => CellRate) => {
    const touch = new Set(ids);
    if (!touch.size) return;
    dirty.current = true;
    setGrid(g => g && ({
      ...g,
      cells: g.cells.map(c => (touch.has(c.id) ? { ...c, rate: next(c.rate) } : c)),
    }));
  }, []);

  const onPaintCells = useCallback((ids: CellId[]) => {
    // `source: "operator"` is the marker a later threshold pass must respect.
    // Everything painted here is a hand decision, including "leave this alone".
    if (paintAction === "treat") {
      mutate(ids, () => ({ state: "treated", rateLha, source: "operator" }));
    } else if (paintAction === "skip") {
      mutate(ids, () => ({ state: "untreated", source: "operator" }));
    } else {
      mutate(ids, () => ({ state: "untreated", source: "default" }));
    }
  }, [paintAction, rateLha, mutate]);

  const onPickCell = useCallback((id: CellId | null) => {
    setSelected(id ? new Set([id]) : new Set());
  }, []);

  const tankL = Math.max(0, spec.tank_l * (settings.flight_plan.tank_load_pct / 100));
  const totals = grid ? gridTotals(grid, tankL) : null;
  const selectedCell = grid && selected.size === 1
    ? grid.cells.find(c => selected.has(c.id)) ?? null
    : null;

  const impact = useMemo(
    () => (grid && definition ? regenerationImpact(grid, definition) : null),
    [grid, definition],
  );

  const clearAll = () => {
    if (!grid) return;
    const assigned = grid.cells.filter(c => c.rate.source !== "default" || c.rate.state === "treated").length;
    if (!assigned) return;
    if (!window.confirm(`Clear rates on ${assigned.toLocaleString()} cells? This cannot be undone.`)) return;
    dirty.current = true;
    setGrid(g => g && ({
      ...g,
      cells: g.cells.map(c => ({ ...c, rate: { state: "untreated", source: "default" } as CellRate })),
    }));
  };

  // ---- Empty states -------------------------------------------------------
  if (!boundary || boundary.length === 0) {
    return (
      <div className="absolute inset-0 grid place-items-center text-center p-8" style={{ background: "#0f0f0f" }}>
        <div className="max-w-md">
          <Grid3x3 className="h-8 w-8 mx-auto mb-3 text-[#4CAF50]" />
          <h2 className="text-lg font-semibold mb-1">Treatment Grid</h2>
          <p className="text-sm text-neutral-500 mb-4">
            Draw the field boundary first. Cells are laid out inside it and sized from the
            aircraft&rsquo;s swath, so there is nothing to divide up until the field has an edge.
          </p>
          <button onClick={() => setActiveTab("field")}
            className="text-xs bg-[#4CAF50] hover:bg-[#43a047] text-black rounded-sm px-3 py-2 font-semibold">
            Go to Field View
          </button>
        </div>
      </div>
    );
  }

  const boundaryHa = ringsAreaM2(rings) / 10_000;

  return (
    <div className="absolute inset-0 flex" style={{ background: "#0f0f0f" }}>
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
          <FitBounds bounds={bounds} />
          {grid && (
            <TreatmentGridLayer
              grid={grid}
              selected={selected}
              brushM={tool === "paint" ? (brushCells * grid.cellSizeM) / 2 : null}
              onPaintCells={onPaintCells}
              onPickCell={onPickCell}
              onRender={setRender}
            />
          )}
          <BasemapToggle
            value={basemap}
            onChange={(id) => { setBasemap(id); saveBasemap(id); }}
            className="absolute bottom-4 right-4 z-[1000]"
          />
        </MapContainer>

        {/* Legend + what the renderer is actually showing right now. The detail
            level is surfaced rather than hidden: at low zoom the undecided
            majority is not drawn, and an operator who is not told that will
            read the empty ground as "no cells here". */}
        <div className="absolute top-3 left-3 z-[400] bg-black/75 text-[10px] px-2.5 py-2 rounded-sm border border-[#222] flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "rgba(250,204,61,0.55)" }} /> Treated (low rate)
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "rgba(250,54,21,0.65)" }} /> Treated (high rate)
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "rgba(56,189,248,0.4)" }} /> Skipped on purpose
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "rgba(148,163,184,0.25)" }} /> No decision yet
          </div>
          {render && (
            <div className="border-t border-[#222] pt-1.5 mt-0.5 text-neutral-500 font-mono">
              {render.painted.toLocaleString()}/{render.visible.toLocaleString()} drawn · {render.cellPx.toFixed(1)} px/cell
              {render.level === "sparse" && (
                <div className="text-yellow-500/90 normal-case">Zoom in — only assigned cells drawn at this scale</div>
              )}
              {render.level === "fill" && (
                <div className="text-neutral-600 normal-case">Cell borders hidden at this scale</div>
              )}
            </div>
          )}
        </div>

        {loading && (
          <div className="absolute inset-0 grid place-items-center z-[500] bg-black/40">
            <div className="flex items-center gap-2 text-xs text-neutral-300">
              <Loader2 className="h-4 w-4 animate-spin" /> Building grid…
            </div>
          </div>
        )}
      </div>

      {/* Right control panel */}
      <div className="w-80 shrink-0 border-l border-[#222] overflow-auto p-4" style={{ background: "#161616" }}>
        <div className="flex items-center gap-2 mb-4">
          <Grid3x3 className="h-4 w-4 text-[#4CAF50]" />
          <div className="text-sm font-semibold">Treatment Grid</div>
        </div>

        {buildError && (
          <div className="rounded-sm border border-red-900/60 bg-red-950/30 p-3 mb-4 text-[11px] text-red-300 leading-relaxed">
            <div className="flex items-center gap-1.5 font-semibold mb-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Grid not generated
            </div>
            {buildError}
          </div>
        )}

        {/* Cell size ---------------------------------------------------- */}
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Cell size</div>
        <div className="rounded-sm border border-[#222] p-3 mb-4" style={{ background: "#0f0f0f" }}>
          <div className="flex gap-1.5 mb-2">
            {([1, 2, 3] as const).map(m => (
              <button key={m}
                onClick={() => setCellMultiple(m)}
                className={`flex-1 text-xs rounded-sm px-2 py-1.5 border transition-colors ${
                  cellMultiple === m
                    ? "border-[#4CAF50] text-[#4CAF50] bg-[#4CAF50]/10"
                    : "border-[#222] text-neutral-400 hover:text-neutral-200"}`}>
                {m}×
              </button>
            ))}
          </div>
          <div className="text-[11px] text-neutral-500 font-mono">
            {(swathM * cellMultiple).toFixed(1)} m cells · {swathM.toFixed(1)} m swath
          </div>
          <div className="text-[10px] text-neutral-600 mt-1.5 leading-relaxed">
            Cells are whole multiples of the swath because the aircraft cannot vary its
            rate within one boom width.
          </div>
          {impact?.changes && impact.assignedCells > 0 && (
            <div className="text-[10px] text-yellow-500 mt-2 leading-relaxed">
              Changing this rebuilds the grid and discards {impact.assignedCells.toLocaleString()} assigned
              cells ({impact.overriddenCells.toLocaleString()} hand-set).
            </div>
          )}
        </div>

        {/* Warnings ------------------------------------------------------ */}
        {grid?.warnings.map((w, i) => (
          <div key={i} className="rounded-sm border border-yellow-900/60 bg-yellow-950/20 p-3 mb-3 text-[11px] text-yellow-300/90 leading-relaxed">
            <div className="flex items-center gap-1.5 font-semibold mb-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              {w.kind === "narrower-than-swath" ? "Plot narrower than the swath" : "Cells below one swath"}
            </div>
            {w.message}
          </div>
        ))}

        {/* Tool ---------------------------------------------------------- */}
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Tool</div>
        <div className="flex gap-1.5 mb-3">
          <button onClick={() => setTool("inspect")}
            className={`flex-1 text-xs rounded-sm px-2 py-2 border inline-flex items-center justify-center gap-1.5 transition-colors ${
              tool === "inspect"
                ? "border-[#4CAF50] text-[#4CAF50] bg-[#4CAF50]/10"
                : "border-[#222] text-neutral-400 hover:text-neutral-200"}`}>
            <MousePointer className="h-3.5 w-3.5" /> Inspect
          </button>
          <button onClick={() => setTool("paint")}
            className={`flex-1 text-xs rounded-sm px-2 py-2 border inline-flex items-center justify-center gap-1.5 transition-colors ${
              tool === "paint"
                ? "border-[#4CAF50] text-[#4CAF50] bg-[#4CAF50]/10"
                : "border-[#222] text-neutral-400 hover:text-neutral-200"}`}>
            <Brush className="h-3.5 w-3.5" /> Assign
          </button>
        </div>

        {tool === "paint" && (
          <div className="rounded-sm border border-[#222] p-3 mb-4" style={{ background: "#0f0f0f" }}>
            <div className="flex gap-1.5 mb-3">
              {([
                { k: "treat", label: "Treat" },
                { k: "skip", label: "Skip" },
                { k: "clear", label: "Clear" },
              ] as const).map(a => (
                <button key={a.k}
                  onClick={() => setPaintAction(a.k)}
                  className={`flex-1 text-[11px] rounded-sm px-2 py-1.5 border transition-colors ${
                    paintAction === a.k
                      ? "border-[#4CAF50] text-[#4CAF50] bg-[#4CAF50]/10"
                      : "border-[#222] text-neutral-400 hover:text-neutral-200"}`}>
                  {a.label}
                </button>
              ))}
            </div>

            {paintAction === "treat" && (
              <>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] text-neutral-500">Rate</span>
                  <span className="font-mono text-sm text-[#4CAF50]">{fmtRate(rateLha, units).text}</span>
                </div>
                {/* The slider moves in the operator's own units; `rateLha` stays
                    canonical L/ha, so a prescription means the same thing
                    whoever opens it. */}
                <input type="range"
                  min={units === "metric" ? 1 : 0.1}
                  max={units === "metric" ? 120 : 13}
                  step={units === "metric" ? 1 : 0.1}
                  value={Number(rateValue(rateLha, units).toFixed(units === "metric" ? 0 : 1))}
                  onChange={e => setRateLha(rateToLha(Number(e.target.value), units))}
                  className="w-full accent-[#4CAF50] mb-2" />
                <div className="flex gap-1.5 mb-1">
                  {(["low", "medium", "high"] as const).map(k => (
                    <button key={k} onClick={() => setRateLha(settings.spray_rates_lha[k])}
                      className="flex-1 text-[10px] rounded-sm px-1.5 py-1 border border-[#222] text-neutral-400 hover:text-neutral-200 transition-colors">
                      {k} {rateValue(settings.spray_rates_lha[k], units).toFixed(units === "metric" ? 0 : 1)}
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-neutral-600">Target rate in {rateUnit(units)}.</div>
              </>
            )}
            {paintAction === "skip" && (
              <div className="text-[10px] text-neutral-500 leading-relaxed mb-1">
                Marks cells as deliberately not sprayed — which is a decision, and reads
                differently from a cell nobody has looked at yet.
              </div>
            )}
            {paintAction === "clear" && (
              <div className="text-[10px] text-neutral-500 leading-relaxed mb-1">
                Returns cells to no-decision-yet.
              </div>
            )}

            <div className="flex items-center justify-between mt-3 mb-1">
              <span className="text-[11px] text-neutral-500">Brush</span>
              <span className="font-mono text-xs text-neutral-300">
                {brushCells} cell{brushCells > 1 ? "s" : ""}
              </span>
            </div>
            <input type="range" min={1} max={9} step={2} value={brushCells}
              onChange={e => setBrushCells(Number(e.target.value))}
              className="w-full accent-[#4CAF50]" />
            <div className="text-[10px] text-neutral-600 mt-1.5">Click or drag on the map to assign.</div>
          </div>
        )}

        {/* Selected cell -------------------------------------------------- */}
        {tool === "inspect" && (
          <div className="rounded-sm border border-[#222] p-3 mb-4" style={{ background: "#0f0f0f" }}>
            {!selectedCell ? (
              <div className="text-[11px] text-neutral-600 italic">Click a cell to inspect it.</div>
            ) : (
              <>
                <div className="font-mono text-[10px] text-neutral-500 mb-2 truncate">{selectedCell.id}</div>
                <div className="text-[11px] text-neutral-400 grid grid-cols-2 gap-y-1">
                  <div>Area</div>
                  <div className="text-right font-mono text-neutral-200">
                    {fmtArea(selectedCell.areaM2, units).text}
                  </div>
                  <div>State</div>
                  <div className="text-right font-mono text-neutral-200">
                    {selectedCell.rate.state === "treated"
                      ? fmtRate(selectedCell.rate.rateLha, units).text
                      : "untreated"}
                  </div>
                  <div>Set by</div>
                  <div className="text-right font-mono text-neutral-200">{selectedCell.rate.source}</div>
                  {selectedCell.clipped && (
                    <div className="col-span-2 text-[10px] text-neutral-600 mt-1">
                      Edge cell — volume is billed on the clipped area, not a full cell.
                    </div>
                  )}
                  <div className="col-span-2 text-[10px] text-neutral-600 mt-1">
                    Detection: {selectedCell.detection
                      ? `${selectedCell.detection.score.toFixed(3)} (${selectedCell.detection.modelVersion})`
                      : "not scored"}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Totals --------------------------------------------------------- */}
        {totals && (
          <>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Prescription</div>
            <div className="rounded-sm border border-[#222] p-3 mb-4 text-[11px]" style={{ background: "#0f0f0f" }}>
              <Row label="Cells" value={totals.cellCount.toLocaleString()} />
              <Row label="Treated" value={`${totals.treatedCellCount.toLocaleString()} cells`} />
              <Row label="Field area" value={fmtAreaHa(totals.fieldAreaHa, units).text} />
              <Row label="Treated area" value={fmtAreaHa(totals.treatedAreaHa, units).text} />
              <Row label="Volume" value={fmtVolume(totals.totalVolumeL, units).text} />
              <Row label="Tank loads" value={
                tankL > 0 ? `${totals.tankLoads} × ${fmtVolume(tankL, units, 0).text}` : "no sprayer tank"
              } />
              {Math.abs(totals.fieldAreaHa - boundaryHa) / Math.max(boundaryHa, 1e-9) > 0.02 && (
                <div className="text-[10px] text-neutral-600 mt-2 leading-relaxed">
                  Grid covers {fmtAreaHa(totals.fieldAreaHa, units).text} of a {fmtAreaHa(boundaryHa, units).text} boundary —
                  the difference is edge slivers too small to treat.
                </div>
              )}
            </div>
          </>
        )}

        {/* Save state ----------------------------------------------------- */}
        <div className="flex items-center justify-between text-[10px] text-neutral-500 mb-3">
          <span className="inline-flex items-center gap-1.5">
            {saving
              ? <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>
              : savedAt
                ? <><Save className="h-3 w-3" /> Saved</>
                : <><Info className="h-3 w-3" /> Changes save automatically</>}
          </span>
          {!fieldId && <span className="text-yellow-600">No field — not saved</span>}
        </div>
        {saveError && (
          <div className="rounded-sm border border-red-900/60 bg-red-950/30 p-2.5 mb-3 text-[10px] text-red-300 leading-relaxed">
            {saveError}
          </div>
        )}

        <button onClick={clearAll}
          className="w-full text-[11px] rounded-sm px-2 py-2 border border-[#222] text-neutral-400 hover:text-red-300 hover:border-red-900/60 inline-flex items-center justify-center gap-1.5 transition-colors">
          <Trash2 className="h-3.5 w-3.5" /> Clear all rates
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-neutral-500">{label}</span>
      <span className="font-mono text-neutral-200">{value}</span>
    </div>
  );
}

export default TreatmentTab;
