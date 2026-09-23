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
import { AlertTriangle, Camera, Download, Loader2, Pencil, Save, Search, Trash2 } from "lucide-react";
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
  DEFAULT_FLIGHT_PLAN_PARAMS, type FlightPlanParams, LOW_ALTITUDE_M, generateKmz, kmzFilename,
  lowAltitudeCaution, resolveFlightPlan,
} from "@/lib/flightPlan/generateKmz";
import type { FlightDirection } from "@/lib/flightPlan/grid";
import { bearingDeg, cornerName, routeEnds, routeSteps } from "@/lib/flightPlan/routeSteps";
import { type FlightPlan, markExported, saveFlightPlan } from "@/lib/flightPlan/repo";

/**
 * A small round badge on the map.
 *
 * Built as HTML rather than an image so the number is real text: it stays
 * legible at any zoom and survives a screenshot, which is how these previews
 * actually get shared.
 */
const badgeIcon = (label: string, bg: string, fg: string, size = 18) => L.divIcon({
  className: "",
  html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};`
    + `border:2px solid #0b1220;box-shadow:0 0 0 1px rgba(255,255,255,.7);display:grid;`
    + `place-items:center;font:700 ${size <= 18 ? 9 : 10}px/1 ui-monospace,monospace;color:${fg}">`
    + `${label}</div>`,
  iconSize: [size, size], iconAnchor: [size / 2, size / 2],
});

/**
 * An arrowhead pointing along the direction of travel.
 *
 * The one thing a drawn grid cannot say on its own. Two plans can draw the
 * identical picture and fly it in opposite directions, and the operator only
 * finds out once the aircraft is moving.
 */
const arrowIcon = (headingDeg: number, color: string) => L.divIcon({
  className: "",
  html: `<div style="transform:rotate(${headingDeg}deg);font:16px/1 sans-serif;color:${color};`
    + `text-shadow:0 0 3px #000,0 0 3px #000">&#9650;</div>`,
  iconSize: [16, 16], iconAnchor: [8, 8],
});

const midpoint = (a: LatLng2, b: LatLng2) => ({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });

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
  const num = (v: string, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  // The boxes follow the one unit setting, like every readout beside them.
  // What is STORED and EXPORTED stays metres and m/s; only the box changes.
  // A panel that reports feet and asks for metres is how "100 ft" becomes
  // 100 m, which is a grid three times as coarse as the one the operator
  // pictured, with a tenth of the photographs, and nothing on screen says so.
  const shown = (v: number) => Math.round(v * 100) / 100;
  const lenUnit = altitudeUnit(units);
  const lenShown = (m: number) => shown(altitudeValue(m, units));
  const lenToM = (v: string, keepM: number) => {
    if (v.trim() === "") return keepM;
    const n = Number(v);
    return Number.isFinite(n) ? altitudeToM(n, units) : keepM;
  };
  const spdShown = (ms: number) => shown(speedValue(ms, units));
  const spdToMs = (v: string, keepMs: number) => {
    if (v.trim() === "") return keepMs;
    const n = Number(v);
    return Number.isFinite(n) ? speedToMs(n, units) : keepMs;
  };

  const centre = rings.length ? centroidOfRings(rings) : { lat: 39, lng: -98 };

  // The route in words, and the same object the map labels read, so the list
  // and the picture cannot describe different flights.
  const steps = useMemo(() => (resolved ? routeSteps(resolved.grid) : []), [resolved]);
  const ends = useMemo(() => (resolved ? routeEnds(resolved.grid) : null), [resolved]);
  const startCorner = ends && rings[0] ? cornerName(ends.start, rings[0]) : "";

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
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit flight plan" : "Create flight plan"} · {fieldName}</DialogTitle>
          <div className="text-xs text-muted-foreground">
            A survey flight over this field. Download it as a KMZ, fly it, then upload the photographs in step 2.
          </div>
        </DialogHeader>

        <div className="grid md:grid-cols-[1fr_300px] gap-4">
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input className="pl-8" placeholder="Search an address or place"
                  value={query} onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void search(); } }} />
              </div>
              <Button type="button" variant="outline" onClick={() => void search()} disabled={searching}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Find"}
              </Button>
            </div>
            {searchError && <div className="text-xs text-destructive">{searchError}</div>}

            <div className="h-[420px] rounded overflow-hidden border">
              <MapContainer center={[centre.lat, centre.lng]} zoom={rings.length ? 16 : 4}
                style={{ height: "100%", width: "100%", background: "#0a0a0a" }}
                ref={m => { mapRef.current = m; }}>
                {/* Satellite by default: a farmer recognises their own field
                    from the imagery, not from a road map of open farmland. */}
                <TileLayer
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  maxNativeZoom={19} maxZoom={21} />
                <FitTo rings={rings} />
                <DrawTool active={drawing} onDrawn={ring => { setRings([ring]); setDrawing(false); }} />
                {rings.map((r, i) => (
                  <Polygon key={i} positions={r.map(p => [p.lat, p.lng] as [number, number])}
                    pathOptions={{ color: "#4CAF50", weight: 2, fillOpacity: 0.08 }} />
                ))}
                {/* The route, exactly as the exporter will write it. */}
                {resolved?.grid.legs.map((leg, i) => (
                  <Polyline key={`leg${i}`}
                    positions={[[leg.a.lat, leg.a.lng], [leg.b.lat, leg.b.lng]]}
                    pathOptions={{ color: "#38bdf8", weight: 2 }} />
                ))}
                {resolved && resolved.grid.legs.length > 1 && (
                  <Polyline
                    positions={resolved.grid.legs.slice(0, -1).flatMap((leg, i) => [
                      [leg.b.lat, leg.b.lng] as [number, number],
                      [resolved.grid.legs[i + 1].a.lat, resolved.grid.legs[i + 1].a.lng] as [number, number],
                    ])}
                    pathOptions={{ color: "#38bdf8", weight: 1, dashArray: "4 4", opacity: 0.6 }} />
                )}
                {/* Every point the camera fires at, one marker per Placemark in
                    the file. The density of a survey is decided by altitude and
                    overlap, and it has to be visible here, before the download,
                    not discovered in a viewer afterwards. Past the airframe's
                    ceiling the plan is refused anyway, so the markers stop. */}
                {resolved && resolved.grid.waypoints.length <= 400 && resolved.grid.waypoints.map((p, i) => (
                  <CircleMarker key={`wp${i}`} center={[p.lat, p.lng]} radius={3}
                    pathOptions={{ color: "#38bdf8", weight: 1, fillColor: "#ffffff", fillOpacity: 1 }}>
                    <Tooltip direction="top" offset={[0, -4]}>
                      Waypoint {i + 1} of {resolved.grid.waypoints.length}, photo {i + 1}
                    </Tooltip>
                  </CircleMarker>
                ))}

                {/* Which way each line runs. Placed at the midpoint so it never
                    sits under a numbered badge at the corner. */}
                {resolved?.grid.legs.map((leg, i) => {
                  const m = midpoint(leg.a, leg.b);
                  return (
                    <Marker key={`dir${i}`} position={[m.lat, m.lng]} interactive={false}
                      icon={arrowIcon(bearingDeg(leg.a, leg.b), "#38bdf8")} />
                  );
                })}

                {/* The transit between lines: the ground the aircraft crosses
                    without photographing it. Drawn dimmer, and arrowed, because
                    it is still flight and it is where the turn happens. */}
                {resolved?.grid.legs.slice(0, -1).map((leg, i) => {
                  const next = resolved.grid.legs[i + 1].a;
                  const m = midpoint(leg.b, next);
                  return (
                    <Marker key={`turn${i}`} position={[m.lat, m.lng]} interactive={false}
                      icon={arrowIcon(bearingDeg(leg.b, next), "#7dd3fc")} />
                  );
                })}

                {/* The line numbers, matching the written list beside the map.
                    Skipped when there are too many to read, which is the point
                    at which they would be clutter rather than an answer. */}
                {resolved && resolved.grid.legs.length <= 40 && resolved.grid.legs.map((leg, i) => (
                  <Marker key={`num${i}`} position={[leg.a.lat, leg.a.lng]}
                    icon={badgeIcon(String(i + 1), "#0ea5e9", "#001018")}>
                    <Tooltip direction="top" offset={[0, -10]}>
                      Line {i + 1} starts here, {leg.captures.length} photo{leg.captures.length === 1 ? "" : "s"}
                    </Tooltip>
                  </Marker>
                ))}

                {ends && (
                  <>
                    <Marker position={[ends.start.lat, ends.start.lng]}
                      icon={badgeIcon("S", "#22c55e", "#04230f", 22)} zIndexOffset={1000}>
                      <Tooltip direction="top" offset={[0, -12]}>
                        Start, waypoint 1, {startCorner} corner
                      </Tooltip>
                    </Marker>
                    <Marker position={[ends.end.lat, ends.end.lng]}
                      icon={badgeIcon("E", "#f43f5e", "#2a0410", 22)} zIndexOffset={1000}>
                      <Tooltip direction="top" offset={[0, -12]}>
                        Last photo, waypoint {resolved!.grid.waypoints.length}
                      </Tooltip>
                    </Marker>
                  </>
                )}
              </MapContainer>
            </div>

            {/* What the colours mean. The green outline is the area, not a
                path: nothing flies it and no photo is taken on it, which is
                not obvious when it is the most prominent thing on the map. */}
            {resolved && rings.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-4 border-t-2 border-[#4CAF50]" />
                  Area you drew, not flown
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-4 border-t-2 border-[#38bdf8]" />
                  Flight line, camera firing
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-4 border-t-2 border-dashed border-[#7dd3fc]" />
                  Turn, no photos
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-white ring-1 ring-[#38bdf8]" />
                  One photo
                </span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setDrawing(d => !d)}>
                <Pencil className="h-3.5 w-3.5" /> {drawing ? "Cancel drawing" : rings.length ? "Redraw area" : "Draw area"}
              </Button>
              {rings.length > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setRings([])}>
                  <Trash2 className="h-3.5 w-3.5" /> Clear
                </Button>
              )}
              {!rings.length && (
                <span className="text-xs text-muted-foreground">
                  {fieldBoundary?.length
                    ? "Draw the area to survey."
                    : "This field has no boundary yet. Draw the area to survey."}
                </span>
              )}
            </div>
          </div>

          {/* Settings and what they work out to. */}
          <div className="space-y-3 text-sm">
            <div>
              <Label className="text-xs">Camera</Label>
              <select className={NUM} value={params.cameraKey} onChange={e => set("cameraKey", e.target.value)}>
                {Object.entries(CAMERAS).map(([k, c]) => <option key={k} value={k}>{c.name}</option>)}
              </select>
            </div>

            <div>
              <Label className="text-xs">Flight direction</Label>
              <div className="grid grid-cols-3 gap-1">
                {([["auto", "Auto"], ["ew", "East-west"], ["ns", "North-south"]] as [FlightDirection, string][]).map(([v, label]) => (
                  <button key={v} type="button" onClick={() => set("direction", v)}
                    className={`text-xs rounded border px-2 py-1.5 ${params.direction === v ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Altitude ({lenUnit})</Label>
                <input type="number" min={lenShown(5)} max={lenShown(500)} className={NUM}
                  value={lenShown(params.altitudeM)}
                  onChange={e => set("altitudeM", lenToM(e.target.value, params.altitudeM))} />
              </div>
              <div>
                <Label className="text-xs">Speed ({speedUnit(units)})</Label>
                <input type="number" min={spdShown(1)} max={spdShown(15)} step={0.5} className={NUM}
                  value={spdShown(params.speedMs)}
                  onChange={e => set("speedMs", spdToMs(e.target.value, params.speedMs))} />
              </div>
              <div>
                <Label className="text-xs">Front overlap (%)</Label>
                <input type="number" min={0} max={95} className={NUM} value={params.frontOverlapPct}
                  onChange={e => set("frontOverlapPct", num(e.target.value, 75))} />
              </div>
              <div>
                <Label className="text-xs">Side overlap (%)</Label>
                <input type="number" min={0} max={95} className={NUM} value={params.sideOverlapPct}
                  onChange={e => set("sideOverlapPct", num(e.target.value, 75))} />
              </div>
              <div>
                <Label className="text-xs">Gimbal (deg)</Label>
                <input type="number" min={-90} max={30} className={NUM} value={params.gimbalPitchDeg}
                  onChange={e => set("gimbalPitchDeg", num(e.target.value, -90))} />
              </div>
              <div>
                <Label className="text-xs">Inset ({lenUnit})</Label>
                <input type="number" min={0} max={lenShown(100)} className={NUM}
                  value={lenShown(params.insetM)}
                  onChange={e => set("insetM", lenToM(e.target.value, params.insetM))} />
              </div>
            </div>

            <div>
              <Label className="text-xs">
                Line spacing ({lenUnit})
                {!params.lineSpacingM && resolved && (
                  <span className="text-muted-foreground"> · {dist(resolved.computed.lineSpacingM)} from side overlap</span>
                )}
              </Label>
              <div className="flex gap-1">
                <input type="number" min={lenShown(1)} className={NUM} placeholder="from overlap"
                  value={params.lineSpacingM == null ? "" : lenShown(params.lineSpacingM)}
                  onChange={e => set("lineSpacingM", e.target.value.trim() === "" ? null : lenToM(e.target.value, params.lineSpacingM ?? 0))} />
                {params.lineSpacingM != null && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => set("lineSpacingM", null)}>Auto</Button>
                )}
              </div>
            </div>

            {/* What the settings actually produce. Every figure is the
                resolver's, and the map above is drawing the same object. */}
            {resolved && rings.length > 0 && (
              <div className="rounded border p-2 space-y-1 text-xs bg-muted/30">
                <Row k="Lines" v={String(resolved.grid.lineCount)} />
                <Row k="Photos" v={String(resolved.stats.photoCount)} />
                <Row k="Photo every" v={dist(resolved.computed.captureIntervalM)} />
                <Row k="Each photo covers" v={`${dist(resolved.computed.footprintAcrossM)} x ${dist(resolved.computed.footprintAlongM)}`} />
                <Row k="Flight distance" v={dist(resolved.stats.distanceM)} />
                <Row k="Flight time" v={`${mins(resolved.stats.flightTimeS)} at ${params.speedMs} m/s`} />
                <Row k="Area" v={area(resolved.stats.boundaryAreaM2)} />
                <div className="text-[10px] text-muted-foreground pt-1 border-t">
                  Time is distance over speed. It does not include climb, turns slowing the aircraft, or battery swaps.
                </div>
              </div>
            )}

            {/* Shown while they are still adjusting, not only at the button.
                The confirmation below repeats it, deliberately: one is a
                warning, the other is a decision. */}
            {lowAltitude && rings.length > 0 && (
              <div className="rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span><strong>Low altitude.</strong> {caution}</span>
              </div>
            )}

            {/* The order, in words. The map shows the same numbers. */}
            {resolved && steps.length > 0 && (
              <div className="rounded border">
                <button type="button" className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-medium"
                  onClick={() => setShowRoute(v => !v)}>
                  <span>What the drone does, in order</span>
                  <span className="text-muted-foreground">{showRoute ? "Hide" : `${steps.length} steps`}</span>
                </button>
                {showRoute && (
                  <ol className="border-t divide-y max-h-56 overflow-y-auto text-xs">
                    <li className="px-2 py-1.5 flex gap-2">
                      <span className="text-muted-foreground w-5 shrink-0">0</span>
                      <span>
                        Take off, climb to {fmtAltitude(params.altitudeM, units).text}, and fly to waypoint 1
                        at the {startCorner} corner.
                      </span>
                    </li>
                    {steps.map(step => (
                      <li key={step.n} className="px-2 py-1.5 flex gap-2">
                        <span className="text-muted-foreground w-5 shrink-0">{step.n}</span>
                        {step.kind === "line" && (
                          <span>
                            <strong>Line {step.lineNumber}</strong>: fly {step.compass} for {dist(step.distanceM)},
                            taking {step.photos} photo{step.photos === 1 ? "" : "s"}{" "}
                            (waypoints {step.firstWaypoint} to {step.lastWaypoint}).
                          </span>
                        )}
                        {step.kind === "turn" && (
                          <span className="text-muted-foreground">
                            Turn and cross {dist(step.distanceM)} to the {step.compass}. No photos.
                          </span>
                        )}
                        {step.kind === "finish" && (
                          <span>
                            Last photo taken. The aircraft then does whatever its own return-to-home
                            setting says, from the point it took off at. This plan does not set that point.
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}

            {resolved?.blocker && (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-500 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{resolved.blocker}</span>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-1">
              <Button type="button" onClick={() => run("save")} disabled={!rings.length || saving || !user}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {existing ? "Save changes" : "Save flight plan"}
              </Button>
              <Button type="button" variant="outline" onClick={() => run("download")}
                disabled={!resolved || !!resolved.blocker || !rings.length}>
                <Download className="h-4 w-4" /> Download KMZ
              </Button>
              <p className="text-[10px] text-muted-foreground">
                <Camera className="h-3 w-3 inline mr-1" />
                The camera fires every {resolved ? dist(resolved.computed.captureIntervalM) : "interval"} along each
                line, not only at the turns.
              </p>
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
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono">{v}</span>
    </div>
  );
}
