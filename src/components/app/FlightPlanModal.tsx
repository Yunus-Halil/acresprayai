// Plan the survey flight, on a map, before anything has been flown.
//
// THIS IS THE STEP BEFORE A SCAN EXISTS. Every other map in this app draws on
// top of imagery the operator already has; this one runs over a basemap,
// because the whole point is to plan the flight that produces that imagery.
//
// The field almost always has a boundary already, drawn once in Field View and
// shared by every scan, so the common path opens with the polygon in place and
// nothing to draw. Redrawing is available for the case where the survey area is
// deliberately not the field: a corner to re-fly, a strip that matters.
//
// Every number on screen comes from lib/flightPlan, which is pure and tested.
// This component chooses nothing: it collects parameters, draws what the
// resolver returns, and hands the same object to the exporter.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import {
  AlertTriangle, Camera, Download, ListOrdered, Loader2, Pencil, Save, Search, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { type LatLng2, centroidOfRings } from "@/lib/geo";
import {
  altitudeToM, altitudeUnit, altitudeValue, fmtAltitude, fmtArea, fmtDistance, speedToMs, speedUnit,
  speedValue,
} from "@/lib/units";
import { CAMERAS } from "@/lib/flightPlan/camera";
import {
  DEFAULT_FLIGHT_PLAN_PARAMS, type FlightPlanParams, LOW_ALTITUDE_M, MAX_ALTITUDE_M,
  MIN_ALTITUDE_M, generateKmz, kmzFilename, lowAltitudeCaution, resolveFlightPlan,
} from "@/lib/flightPlan/generateKmz";
import type { FlightDirection } from "@/lib/flightPlan/grid";
import { cornerName, routeEnds, routeSteps } from "@/lib/flightPlan/routeSteps";
import { type FlightPlan, markExported, saveFlightPlan } from "@/lib/flightPlan/repo";

/**
 * A number box you can actually empty.
 *
 * A controlled `<input type="number">` whose handler rejects whatever it cannot
 * parse snaps straight back to the old number, so the LAST DIGIT CANNOT BE
 * DELETED. At "3" the backspace produces "", the handler keeps 3 because "" is
 * not a number, React re-renders "3", and the operator is stuck on 3 with
 * nothing on screen to explain it. That is not a hypothetical: it was reported
 * as "I can't make the altitude go below 3".
 *
 * So the box keeps whatever was typed for as long as it has focus, including
 * nothing at all, and commits only the values that parse. On blur the draft is
 * dropped and the canonical number returns, which is what makes an abandoned
 * empty box harmless rather than a way to store a blank altitude.
 *
 * `min` and `max` stay advisory here, as HTML defines them: they bound the
 * spinner and mark the field, and they never silently rewrite a typed number.
 */
function NumBox({ id, value, onCommit, min, max, step }: {
  id: string;
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      id={id} type="number" className={NUM} min={min} max={max} step={step}
      value={draft ?? String(value)}
      onChange={e => {
        const raw = e.target.value;
        setDraft(raw);
        const n = Number(raw);
        if (raw.trim() !== "" && Number.isFinite(n)) onCommit(n);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

/**
 * A numbered map pin, the shape everybody already reads as "a stop on a route".
 *
 * Built as HTML rather than an image so the number is real text: legible at any
 * zoom, and it survives a screenshot, which is how these previews get shared.
 *
 * The teardrop is a square with three rounded corners rotated 45 degrees, so
 * the one square corner ends up pointing straight down. That rotation moves the
 * tip to 0.707 of the box diagonal below centre, which is where the anchor has
 * to sit or every pin floats above the point it is marking.
 */
const pinIcon = (label: string, bg: string, fg: string, size = 26) => L.divIcon({
  className: "",
  html: `<div style="width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;`
    + `transform:rotate(-45deg);background:${bg};border:2px solid #fff;`
    + `box-shadow:0 2px 6px rgba(0,0,0,.55);display:grid;place-items:center">`
    + `<span style="transform:rotate(45deg);font:700 ${Math.round(size * 0.42)}px/1 `
    + `ui-sans-serif,system-ui,sans-serif;color:${fg}">${label}</span></div>`,
  iconSize: [size, size],
  iconAnchor: [size / 2, size / 2 + size * 0.707],
});

/**
 * The route's colours.
 *
 * Red on a casing of near-black, which is the standard way a route is drawn
 * over aerial imagery: satellite is green, brown and grey, and a thin line in
 * any of those disappears into it. The casing is what keeps the line readable
 * over a bright roof and a dark treeline in the same frame.
 */
const ROUTE = { line: "#ef4444", casing: "#1a0505", transit: "#fb923c", area: "#4ade80" };

/** Fits the map to the boundary whenever it changes. */
function FitTo({ rings }: { rings: LatLng2[][] }) {
  const map = useMap();
  useEffect(() => {
    if (!rings.length || !rings[0]?.length) return;
    const pts = rings.flat().map(p => [p.lat, p.lng] as [number, number]);
    try { map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] }); } catch { /* noop */ }
  }, [map, rings]);
  return null;
}

/**
 * Geoman polygon drawing, the same library Field View's boundary tool uses.
 *
 * Only mounted while the operator is actually drawing: geoman attaches global
 * handlers to the map, and leaving it armed makes every stray click on the
 * preview start a vertex.
 */
function DrawTool({ active, onDrawn }: { active: boolean; onDrawn: (ring: LatLng2[]) => void }) {
  const map = useMap();
  useEffect(() => {
    if (!active) return;
    const pm = (map as unknown as { pm: { enableDraw: (s: string, o?: unknown) => void; disableDraw: () => void } }).pm;
    pm.enableDraw("Polygon", { snappable: true, templineStyle: { color: "#4CAF50" }, hintlineStyle: { color: "#4CAF50", dashArray: "4 4" } });
    const onCreate = (e: { layer: L.Layer }) => {
      const layer = e.layer as L.Polygon;
      const latlngs = layer.getLatLngs()[0] as L.LatLng[];
      onDrawn(latlngs.map(p => ({ lat: p.lat, lng: p.lng })));
      map.removeLayer(layer);
    };
    map.on("pm:create", onCreate as never);
    return () => {
      map.off("pm:create", onCreate as never);
      try { pm.disableDraw(); } catch { /* noop */ }
    };
  }, [active, map, onDrawn]);
  return null;
}

const NUM = "w-full bg-background border rounded px-2 py-1 text-sm";

export type FlightPlanModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fieldId: string;
  fieldName: string;
  /** The field's own boundary, used as the survey area unless one is drawn. */
  fieldBoundary: LatLng2[][] | null;
  /** Reopening a saved plan, or null to start a new one. */
  existing: FlightPlan | null;
  onSaved: () => void;
};

export default function FlightPlanModal({
  open, onOpenChange, fieldId, fieldName, fieldBoundary, existing, onSaved,
}: FlightPlanModalProps) {
  const { user } = useAuth();
  const units = useUnitSystem();
  const [rings, setRings] = useState<LatLng2[][]>([]);
  const [params, setParams] = useState<FlightPlanParams>(DEFAULT_FLIGHT_PLAN_PARAMS);
  const [drawing, setDrawing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Which action is waiting on a low-altitude confirmation, if any. Held per
  // action rather than as a sticky "acknowledged" flag: saving a low plan and
  // exporting a file someone will fly are two different commitments, and an
  // acknowledgement made at 19 m must not still be in force at 5 m.
  const [confirming, setConfirming] = useState<null | "save" | "download">(null);
  const [showRoute, setShowRoute] = useState(false);
  const mapRef = useRef<L.Map | null>(null);

  // Reopening a plan restores exactly what it stored; a new plan starts from
  // the field's own boundary, which is usually the right survey area already.
  useEffect(() => {
    if (!open) return;
    if (existing) {
      setRings(existing.boundary);
      setParams(existing.params);
    } else {
      setRings(fieldBoundary ?? []);
      setParams(DEFAULT_FLIGHT_PLAN_PARAMS);
    }
    setDrawing(false);
    setConfirming(null);
  }, [open, existing, fieldBoundary]);

  const resolved = useMemo(
    () => (rings.length ? resolveFlightPlan(rings, params) : null),
    [rings, params],
  );
  const set = <K extends keyof FlightPlanParams>(k: K, v: FlightPlanParams[K]) =>
    setParams(p => ({ ...p, [k]: v }));
  // The boxes follow the one unit setting, like every readout beside them.
  // What is STORED and EXPORTED stays metres and m/s; only the box changes.
  // A panel that reports feet and asks for metres is how "100 ft" becomes
  // 100 m, which is a grid three times as coarse as the one the operator
  // pictured, with a tenth of the photographs, and nothing on screen says so.
  const shown = (v: number) => Math.round(v * 100) / 100;
  const lenUnit = altitudeUnit(units);
  const lenShown = (m: number) => shown(altitudeValue(m, units));
  const spdShown = (ms: number) => shown(speedValue(ms, units));
  // The spinner's ends, in the operator's units and on a round number. The
  // floor is 3 ft rather than the 3.28 the conversion gives, because a bound
  // that reads as an arbitrary decimal invites exactly the fight this box just
  // had with someone trying to type a whole number.
  const lenFloor = (m: number) => Math.floor(altitudeValue(m, units));

  const centre = rings.length ? centroidOfRings(rings) : { lat: 39, lng: -98 };

  // The route in words, and the same object the map labels read, so the list
  // and the picture cannot describe different flights.
  const steps = useMemo(() => (resolved ? routeSteps(resolved.grid) : []), [resolved]);
  const ends = useMemo(() => (resolved ? routeEnds(resolved.grid) : null), [resolved]);
  const startCorner = ends && rings[0] ? cornerName(ends.start, rings[0]) : "";

  // The turnaround drawn as it will be flown: the line end, the arc, the next
  // line start. Both ends included so the path joins the route with no gap.
  const turnPaths = useMemo(() => {
    if (!resolved) return [] as LatLng2[][];
    return resolved.grid.turns.map((arc, i) => [
      resolved.grid.legs[i].b, ...arc, resolved.grid.legs[i + 1].a,
    ]);
  }, [resolved]);

  // One wording, from the same module that decides the threshold, so the
  // panel and the confirmation cannot say different things.
  const lowAltitude = !!resolved?.lowAltitude;
  const caution = lowAltitudeCaution(
    fmtAltitude(params.altitudeM, units).text,
    fmtAltitude(LOW_ALTITUDE_M, units).text,
  );

  /**
   * Address search through Nominatim, which is free and needs no key.
   * Failure is reported rather than swallowed: a search box that silently does
   * nothing reads as a broken page.
   */
  const search = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Search service answered ${res.status}`);
      const hits = (await res.json()) as { lat: string; lon: string }[];
      if (!hits.length) { setSearchError(`Nothing found for "${q}".`); return; }
      mapRef.current?.setView([Number(hits[0].lat), Number(hits[0].lon)], 16);
    } catch (e) {
      setSearchError((e as Error)?.message ?? "Could not reach the search service.");
    } finally {
      setSearching(false);
    }
  }, [query]);

  const save = async () => {
    if (!user || !rings.length) return;
    setSaving(true);
    const r = await saveFlightPlan(user.id, { fieldId, boundary: rings, params, id: existing?.id });
    setSaving(false);
    if ("error" in r) { toast.error("Couldn't save the flight plan", { description: r.error }); return; }
    toast.success(existing ? "Flight plan updated." : "Flight plan saved.");
    onSaved();
    onOpenChange(false);
  };

  /**
   * Both buttons go through here.
   *
   * A low plan is not refused: flying low is a real choice and sometimes the
   * right one. It is interrupted once, so the altitude is something the
   * operator states rather than something they inherit from a default they
   * changed an hour ago.
   */
  const run = (action: "save" | "download") => {
    if (lowAltitude) { setConfirming(action); return; }
    void (action === "save" ? save() : download());
  };

  const confirmed = () => {
    const action = confirming;
    setConfirming(null);
    void (action === "save" ? save() : download());
  };

  const download = async () => {
    if (!resolved || resolved.blocker) return;
    try {
      const { pkg } = generateKmz(rings, params, { createTimeMs: Date.now() });
      const url = URL.createObjectURL(pkg.kmz);
      const a = document.createElement("a");
      a.href = url;
      a.download = kmzFilename(fieldName, new Date());
      a.click();
      URL.revokeObjectURL(url);
      if (existing) void markExported(existing.id);
      toast.success("Flight plan downloaded.", {
        description: "Copy it to the remote and open it from the aircraft's waypoint list.",
      });
    } catch (e) {
      toast.error("Couldn't build the flight file", { description: (e as Error)?.message });
    }
  };

  const area = (m2: number) => fmtArea(m2, units).text;
  const dist = (m: number) => fmtDistance(m, units).text;
  const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The map IS the screen. The previous layout squeezed it into two thirds
          of a medium dialog beside a 300px column of inputs, and the thing the
          operator was trying to read - where the aircraft goes - was the
          smallest element on it. */}
      <DialogContent className="max-w-[min(1400px,96vw)] w-[96vw] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b shrink-0">
          <DialogTitle className="text-base">
            {existing ? "Edit flight plan" : "Create flight plan"} · {fieldName}
          </DialogTitle>
          <div className="text-xs text-muted-foreground">
            A survey flight over this field. Download it as a KMZ, fly it, then upload the photographs in step 2.
          </div>
        </DialogHeader>

        {/* One row of things you do to the map, above the map. */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b shrink-0">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input className="pl-8 h-9" placeholder="Search an address or place"
              value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void search(); } }} />
          </div>
          <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => void search()} disabled={searching}>
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Find"}
          </Button>
          <div className="w-px h-6 bg-border" />
          <Button type="button" variant={drawing ? "default" : "outline"} size="sm" className="h-9"
            onClick={() => setDrawing(d => !d)}>
            <Pencil className="h-3.5 w-3.5" /> {drawing ? "Cancel" : rings.length ? "Redraw area" : "Draw area"}
          </Button>
          {rings.length > 0 && (
            <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setRings([])}>
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
          {resolved && steps.length > 0 && (
            <Button type="button" variant={showRoute ? "default" : "outline"} size="sm" className="h-9"
              onClick={() => setShowRoute(v => !v)}>
              <ListOrdered className="h-3.5 w-3.5" /> Step by step
            </Button>
          )}
          {/* The prompt to draw lives next to the button that does it. It used
              to be a panel in the middle of the map, which put it over the exact
              ground the operator was drawing on, and it showed while there was
              no boundary, which is the whole time they are making one. */}
          {!rings.length && !drawing && (
            <span className="text-xs text-muted-foreground">
              {fieldBoundary?.length ? "Draw the area to survey." : "No boundary yet. Draw the area to survey."}
            </span>
          )}
          {searchError && <span className="text-xs text-destructive">{searchError}</span>}
        </div>

        {/* The map, and everything that belongs on top of it rather than beside it. */}
        <div className="relative flex-1 min-h-0">
          <MapContainer center={[centre.lat, centre.lng]} zoom={rings.length ? 17 : 4}
            style={{ height: "100%", width: "100%", background: "#0a0a0a" }}
            ref={m => { mapRef.current = m; }}>
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxNativeZoom={19} maxZoom={21} />
            <FitTo rings={rings} />
            <DrawTool active={drawing} onDrawn={ring => { setRings([ring]); setDrawing(false); }} />

            {rings.map((r, i) => (
              <Polygon key={i} positions={r.map(p => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: ROUTE.area, weight: 2, fillOpacity: 0.06, dashArray: "6 5" }} />
            ))}

            {/* Casing first, then the line on top: a bare stroke vanishes over a
                bright roof or a dark treeline, and a survey crosses both. */}
            {resolved?.grid.legs.map((leg, i) => (
              <Polyline key={`case${i}`}
                positions={[[leg.a.lat, leg.a.lng], [leg.b.lat, leg.b.lng]]}
                pathOptions={{ color: ROUTE.casing, weight: 9, opacity: 0.75 }} />
            ))}
            {resolved?.grid.legs.map((leg, i) => (
              <Polyline key={`leg${i}`}
                positions={[[leg.a.lat, leg.a.lng], [leg.b.lat, leg.b.lng]]}
                pathOptions={{ color: ROUTE.line, weight: 5 }} />
            ))}

            {/* The transit between lines, in a different colour because it is a
                different thing: flight with the camera off. */}
            {turnPaths.map((path, i) => (
              <Polyline key={`turncase${i}`}
                positions={path.map(p => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: ROUTE.casing, weight: 7, opacity: 0.7 }} />
            ))}
            {turnPaths.map((path, i) => (
              <Polyline key={`turn${i}`}
                positions={path.map(p => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: ROUTE.transit, weight: 4 }} />
            ))}

            {/* Every point the camera fires at. Small, because they are the
                texture of the route rather than its structure. */}
            {resolved && resolved.grid.route.length <= 400 && resolved.grid.route.map((p, i) => (
              p.photo ? (
                <CircleMarker key={`wp${i}`} center={[p.at.lat, p.at.lng]} radius={5}
                  pathOptions={{ color: ROUTE.casing, weight: 1.5, fillColor: "#ffffff", fillOpacity: 1 }}>
                  <Tooltip direction="top" offset={[0, -4]}>
                    Waypoint {i + 1} of {resolved.grid.route.length}
                  </Tooltip>
                </CircleMarker>
              ) : null
            ))}

            {resolved && resolved.grid.route.length <= 400 && resolved.grid.route.map((p, i) => (
              !p.photo ? (
                <CircleMarker key={`tw${i}`} center={[p.at.lat, p.at.lng]} radius={3}
                  pathOptions={{ color: ROUTE.transit, weight: 2, fillColor: ROUTE.casing, fillOpacity: 1 }}>
                  <Tooltip direction="top" offset={[0, -4]}>
                    Waypoint {i + 1}, turnaround, no photo
                  </Tooltip>
                </CircleMarker>
              ) : null
            ))}

            {ends && (
              <>
                <Marker position={[ends.start.lat, ends.start.lng]} zIndexOffset={1000}
                  icon={pinIcon("S", "#22c55e", "#04230f", 32)}>
                  <Tooltip direction="top" offset={[0, -30]}>
                    Start, waypoint 1, {startCorner} corner
                  </Tooltip>
                </Marker>
                <Marker position={[ends.end.lat, ends.end.lng]} zIndexOffset={1000}
                  icon={pinIcon("E", "#0ea5e9", "#001018", 32)}>
                  <Tooltip direction="top" offset={[0, -30]}>
                    Last photo, waypoint {resolved!.grid.route.length}
                  </Tooltip>
                </Marker>
              </>
            )}
          </MapContainer>

          {/* What the plan comes to, over the map rather than in a column of
              its own, so the numbers sit next to the thing they describe. */}
          {resolved && rings.length > 0 && (
            <div className="absolute top-3 right-3 z-[1100] rounded-lg bg-background border shadow-xl p-3 text-xs w-56 space-y-1.5">
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-semibold leading-none tabular-nums">{resolved.stats.photoCount}</span>
                <span className="text-foreground/60">photos</span>
              </div>
              <div className="pt-1.5 space-y-1 border-t">
                <Row k="Lines" v={String(resolved.grid.lineCount)} />
                <Row k="Line spacing" v={dist(resolved.computed.lineSpacingM)} />
                <Row k="Photo interval" v={dist(resolved.computed.captureIntervalM)} />
                <Row k="Frame" v={`${dist(resolved.computed.footprintAcrossM)} x ${dist(resolved.computed.footprintAlongM)}`} />
                <Row k="Distance" v={dist(resolved.stats.distanceM)} />
                <Row k="Time" v={mins(resolved.stats.flightTimeS)} />
                <Row k="Area" v={area(resolved.stats.boundaryAreaM2)} />
                <Row k="Waypoints" v={String(resolved.stats.waypointCount)} />
                <Row k="Turn reach" v={dist(resolved.computed.turnExcursionM)} />
              </div>
              <div className="text-[10px] text-foreground/50 pt-1.5 border-t leading-snug">
                Time excludes climb, turn slowdown and battery swaps.
              </div>
            </div>
          )}

          {/* The order, in words, over the map so it can be read against it. */}
          {showRoute && resolved && steps.length > 0 && (
            <div className="absolute top-3 left-3 z-[1100] rounded-lg bg-background border shadow-xl w-[22rem] max-h-[calc(100%-1.5rem)] flex flex-col">
              <div className="px-3 py-2 border-b text-xs font-medium flex items-center justify-between">
                <span>Flight sequence</span>
                <button type="button" className="text-muted-foreground hover:text-foreground"
                  onClick={() => setShowRoute(false)}>Close</button>
              </div>
              <ol className="overflow-y-auto divide-y text-xs">
                <li className="px-3 py-1.5 flex gap-2 items-baseline">
                  <span className="text-foreground/50 w-4 shrink-0 tabular-nums">0</span>
                  <span className="flex-1">Take off, climb to {fmtAltitude(params.altitudeM, units).text}</span>
                  <span className="text-foreground/50 capitalize">{startCorner}</span>
                </li>
                {steps.map(step => (
                  <li key={step.n} className="px-3 py-1.5 flex gap-2 items-baseline">
                    <span className="text-foreground/50 w-4 shrink-0 tabular-nums">{step.n}</span>
                    {step.kind === "line" && (
                      <>
                        <span className="font-medium w-12 shrink-0">Line {step.lineNumber}</span>
                        <span className="text-foreground/60 w-16 shrink-0 capitalize">{step.compass}</span>
                        <span className="flex-1 tabular-nums">{dist(step.distanceM)}</span>
                        <span className="text-foreground/60 tabular-nums">
                          WP {step.firstWaypoint}-{step.lastWaypoint}
                        </span>
                      </>
                    )}
                    {step.kind === "turn" && (
                      <>
                        <span className="w-12 shrink-0 text-foreground/60">Turn</span>
                        <span className="text-foreground/60 w-16 shrink-0 capitalize">{step.compass}</span>
                        <span className="flex-1 tabular-nums text-foreground/60">{dist(step.distanceM)}</span>
                        <span className="text-foreground/40">no photos</span>
                      </>
                    )}
                    {step.kind === "finish" && (
                      <span className="flex-1">Route ends. Return to home per aircraft setting.</span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* What the colours mean. The green outline is the area, not a path:
              nothing flies it and no photo is taken on it, which is not obvious
              when it is the most prominent thing on the map. */}
          {resolved && rings.length > 0 && (
            <div className="absolute bottom-3 left-3 z-[1100] rounded-lg bg-background border shadow-xl px-3 py-2 text-[11px] space-y-1">
              <span className="flex items-center gap-2">
                <span className="inline-block w-5 border-t-[3px]" style={{ borderColor: ROUTE.line }} />
                Flight line
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block w-5 border-t-[3px] border-dashed" style={{ borderColor: ROUTE.transit }} />
                Turnaround
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: ROUTE.area }} />
                Survey area
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-white ring-1 ring-black" />
                Photo point
              </span>
            </div>
          )}

        </div>

        {/* Settings, in one band under the map instead of a narrow column. */}
        <div className="border-t shrink-0 px-4 py-2.5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <div className="sm:col-span-2 lg:col-span-1">
            <Label htmlFor="fp-camera" className="text-[11px] text-muted-foreground">Camera</Label>
            <select id="fp-camera" className={NUM} value={params.cameraKey} onChange={e => set("cameraKey", e.target.value)}>
              {Object.entries(CAMERAS).map(([k, c]) => <option key={k} value={k}>{c.name}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2 lg:col-span-1">
            <Label className="text-[11px] text-muted-foreground">Flight direction</Label>
            <div className="grid grid-cols-3 gap-1">
              {([["auto", "Auto"], ["ew", "E-W"], ["ns", "N-S"]] as [FlightDirection, string][]).map(([v, label]) => (
                <button key={v} type="button" onClick={() => set("direction", v)}
                  className={`text-xs rounded border px-1 py-1.5 ${params.direction === v ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-2">
            <div>
              <Label htmlFor="fp-altitude" className="text-[11px] text-muted-foreground">Altitude ({lenUnit})</Label>
              <NumBox id="fp-altitude" value={lenShown(params.altitudeM)} min={lenFloor(MIN_ALTITUDE_M)}
                max={lenFloor(MAX_ALTITUDE_M)}
                onCommit={n => set("altitudeM", altitudeToM(n, units))} />
            </div>
            <div>
              <Label htmlFor="fp-speed" className="text-[11px] text-muted-foreground">Speed ({speedUnit(units)})</Label>
              <NumBox id="fp-speed" value={spdShown(params.speedMs)} min={1} max={Math.ceil(speedValue(15, units))}
                step={0.5} onCommit={n => set("speedMs", speedToMs(n, units))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-2">
            <div>
              <Label htmlFor="fp-front" className="text-[11px] text-muted-foreground">Front overlap (%)</Label>
              <NumBox id="fp-front" value={params.frontOverlapPct} min={0} max={95}
                onCommit={n => set("frontOverlapPct", n)} />
            </div>
            <div>
              <Label htmlFor="fp-side" className="text-[11px] text-muted-foreground">Side overlap (%)</Label>
              <NumBox id="fp-side" value={params.sideOverlapPct} min={0} max={95}
                onCommit={n => set("sideOverlapPct", n)} />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:col-span-2 lg:col-span-4 xl:col-span-2">
            <div>
              <Label htmlFor="fp-gimbal" className="text-[11px] text-muted-foreground">Gimbal (deg)</Label>
              <NumBox id="fp-gimbal" value={params.gimbalPitchDeg} min={-90} max={30}
                onCommit={n => set("gimbalPitchDeg", n)} />
            </div>
            <div>
              <Label htmlFor="fp-inset" className="text-[11px] text-muted-foreground">Inset ({lenUnit})</Label>
              <NumBox id="fp-inset" value={lenShown(params.insetM)} min={0} max={lenFloor(100)}
                onCommit={n => set("insetM", altitudeToM(n, units))} />
            </div>
            <div>
              <Label htmlFor="fp-overshoot" className="text-[11px] text-muted-foreground">
                Turn overshoot ({lenUnit})
              </Label>
              <NumBox id="fp-overshoot" value={lenShown(params.turnOvershootM)} min={0} max={lenFloor(200)}
                onCommit={n => set("turnOvershootM", altitudeToM(n, units))} />
            </div>
            <div>
              <Label htmlFor="fp-spacing" className="text-[11px] text-muted-foreground">
                Spacing ({lenUnit}){!params.lineSpacingM && <span className="ml-1 opacity-70">auto</span>}
              </Label>
              {/* Not a NumBox: here an empty box is a real answer. It means
                  "work it out from the side overlap", so clearing it already
                  commits null rather than being rejected. */}
              <input id="fp-spacing" type="number" min={lenFloor(1)} className={NUM} placeholder="auto"
                value={params.lineSpacingM == null ? "" : lenShown(params.lineSpacingM)}
                onChange={e => {
                  const raw = e.target.value.trim();
                  if (raw === "") { set("lineSpacingM", null); return; }
                  const n = Number(raw);
                  if (Number.isFinite(n)) set("lineSpacingM", altitudeToM(n, units));
                }} />
            </div>
          </div>
        </div>

        {/* Warnings and the two things you can do, always in the same place. */}
        <div className="border-t shrink-0 px-4 py-2.5 space-y-2">
          {lowAltitude && rings.length > 0 && (
            <div className="rounded border border-destructive/50 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span><strong>Low altitude.</strong> {caution}</span>
            </div>
          )}
          {resolved?.computed.turnsAreTight && rings.length > 0 && (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-500 flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Turn radius {dist(resolved.computed.turnRadiusM)}, tighter than the{" "}
                {dist(resolved.computed.minTurnRadiusM)} this aircraft holds at{" "}
                {spdShown(params.speedMs)} {speedUnit(units)}. It will slow for each turn, so the
                flight runs longer than the estimate.
              </span>
            </div>
          )}

          {resolved?.blocker && (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-500 flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{resolved.blocker}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Camera className="h-3 w-3 shrink-0" />
              Shutter every {resolved ? dist(resolved.computed.captureIntervalM) : "interval"} along each line
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => run("download")}
                disabled={!resolved || !!resolved.blocker || !rings.length}>
                <Download className="h-4 w-4" /> Download KMZ
              </Button>
              <Button type="button" onClick={() => run("save")} disabled={!rings.length || saving || !user}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {existing ? "Save changes" : "Save flight plan"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>

      {/* Not a block. An interruption that has to be answered, and whose
          confirm button says what is being accepted rather than "OK". */}
      <AlertDialog open={confirming !== null} onOpenChange={o => { if (!o) setConfirming(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Fly at {fmtAltitude(params.altitudeM, units).text}?
            </AlertDialogTitle>
            <AlertDialogDescription>{caution}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Change the altitude</AlertDialogCancel>
            <AlertDialogAction onClick={confirmed}>
              I have checked the route, {confirming === "save" ? "save it" : "download it"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}


function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-foreground/60">{k}</span>
      <span className="font-medium tabular-nums">{v}</span>
    </div>
  );
}
