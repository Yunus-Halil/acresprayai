import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, Clock, FileBarChart, Plane, ChevronsLeftRight, X } from "lucide-react";
import { area as turfArea } from "@turf/area";
import { polygon as turfPolygon } from "@turf/helpers";

const PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const FN_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;
const TILE_BASE = `${FN_BASE}/tile`;
const NDVI_BASE = `${FN_BASE}/ndvi-tile`;

type Ring = { lat: number; lng: number }[];
type AiZone = { id?: string; polygon: { lat: number; lng: number }[]; severity?: string };
type AiAnalysis = { zones?: AiZone[] } | null;
type Task = {
  id: string;
  odm_uuid: string | null;
  status: string;
  created_at: string;
  image_count: number;
  ai_analysis: AiAnalysis;
};
type FlightLog = { id: string; scan_id: string | null; date_flown: string };

function polyAcres(poly: { lat: number; lng: number }[]) {
  if (!poly || poly.length < 3) return 0;
  try {
    const ring = poly.map(p => [p.lng, p.lat]) as [number, number][];
    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push(ring[0]);
    const m2 = turfArea(turfPolygon([ring]) as any);
    return m2 / 4047;
  } catch { return 0; }
}

function boundsFromRings(rings: Ring[] | null): L.LatLngBoundsExpression | null {
  if (!rings || !rings.length) return null;
  let minLat = 90, minLng = 180, maxLat = -90, maxLng = -180;
  for (const r of rings) for (const p of r) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  if (minLat > maxLat) return null;
  return [[minLat, minLng], [maxLat, maxLng]];
}

function MiniMap({ task, boundary }: { task: Task; boundary: Ring[] | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current || !task.odm_uuid) return;
    const map = L.map(ref.current, {
      zoomControl: false, attributionControl: false, dragging: false,
      scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false,
      touchZoom: false,
    });
    const tl = L.tileLayer(`${TILE_BASE}/${task.odm_uuid}/{z}/{x}/{y}.png`, { maxZoom: 22 });
    tl.addTo(map);
    const b = boundsFromRings(boundary);
    if (b) map.fitBounds(b, { padding: [4, 4] });
    else map.setView([0, 0], 2);
    // Overlay AI zones if present
    const zones = task.ai_analysis?.zones ?? [];
    for (const z of zones) {
      if (!z.polygon || z.polygon.length < 3) continue;
      const color = z.severity === "high" ? "#ef4444" : z.severity === "medium" ? "#f59e0b" : "#facc15";
      L.polygon(z.polygon.map(p => [p.lat, p.lng]) as any, {
        color, weight: 1.5, fillOpacity: 0.35, interactive: false,
      }).addTo(map);
    }
    return () => { map.remove(); };
  }, [task.id, task.odm_uuid, boundary]);
  if (!task.odm_uuid) {
    return <div className="h-40 rounded bg-[#0a0a0a] border border-[#1f1f1f] flex items-center justify-center text-xs text-neutral-600">No orthomosaic</div>;
  }
  return <div ref={ref} className="h-40 rounded bg-[#0a0a0a] border border-[#1f1f1f] overflow-hidden" />;
}

function CompareMap({ a, b, boundary }: { a: Task; b: Task; boundary: Ring[] | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [pct, setPct] = useState(50);
  const topPaneRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!ref.current || !a.odm_uuid || !b.odm_uuid) return;
    const map = L.map(ref.current, { zoomControl: true, attributionControl: false });
    // Bottom layer (older = a): ortho + ndvi
    const bottomPane = map.createPane("histBottom") as HTMLElement; bottomPane.style.zIndex = "300";
    const topPane = map.createPane("histTop") as HTMLElement; topPane.style.zIndex = "400";
    topPaneRef.current = topPane;
    L.tileLayer(`${TILE_BASE}/${a.odm_uuid}/{z}/{x}/{y}.png`, { pane: "histBottom", maxZoom: 22 }).addTo(map);
    L.tileLayer(`${NDVI_BASE}/${a.id}/{z}/{x}/{y}.png`, { pane: "histBottom", maxZoom: 22, opacity: 0.7 }).addTo(map);
    L.tileLayer(`${TILE_BASE}/${b.odm_uuid}/{z}/{x}/{y}.png`, { pane: "histTop", maxZoom: 22 }).addTo(map);
    L.tileLayer(`${NDVI_BASE}/${b.id}/{z}/{x}/{y}.png`, { pane: "histTop", maxZoom: 22, opacity: 0.7 }).addTo(map);
    const bb = boundsFromRings(boundary);
    if (bb) map.fitBounds(bb, { padding: [20, 20] });
    return () => { map.remove(); topPaneRef.current = null; };
  }, [a.id, b.id, a.odm_uuid, b.odm_uuid, boundary]);

  useEffect(() => {
    if (topPaneRef.current) topPaneRef.current.style.clipPath = `inset(0 0 0 ${pct}%)`;
  }, [pct]);

  const onDrag = (e: React.MouseEvent | React.TouchEvent) => {
    const wrap = wrapRef.current; if (!wrap) return;
    const move = (clientX: number) => {
      const r = wrap.getBoundingClientRect();
      const x = Math.max(0, Math.min(r.width, clientX - r.left));
      setPct((x / r.width) * 100);
    };
    const mm = (ev: MouseEvent) => move(ev.clientX);
    const tm = (ev: TouchEvent) => move(ev.touches[0].clientX);
    const up = () => {
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchmove", tm);
      window.removeEventListener("touchend", up);
    };
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchmove", tm);
    window.addEventListener("touchend", up);
    if ("touches" in e) move(e.touches[0].clientX); else move((e as React.MouseEvent).clientX);
  };

  return (
    <div ref={wrapRef} className="relative h-[420px] rounded border border-[#1f1f1f] overflow-hidden bg-[#0a0a0a]">
      <div ref={ref} className="absolute inset-0" />
      <div className="absolute top-2 left-2 text-[10px] uppercase tracking-wider bg-black/70 px-2 py-1 rounded text-neutral-300 pointer-events-none">
        Older · {new Date(a.created_at).toLocaleDateString()}
      </div>
      <div className="absolute top-2 right-2 text-[10px] uppercase tracking-wider bg-black/70 px-2 py-1 rounded text-neutral-300 pointer-events-none">
        Newer · {new Date(b.created_at).toLocaleDateString()}
      </div>
      <div
        onMouseDown={onDrag as any} onTouchStart={onDrag as any}
        className="absolute top-0 bottom-0 w-1 bg-white/90 cursor-ew-resize z-[500] -translate-x-1/2"
        style={{ left: `${pct}%` }}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-white shadow-lg flex items-center justify-center">
          <ChevronsLeftRight className="h-4 w-4 text-black" />
        </div>
      </div>
    </div>
  );
}

export default function HistoryTab({
  fieldId, fieldName, boundary, currentTaskId, openTask,
}: {
  fieldId: string | null;
  fieldName: string;
  boundary: Ring[] | null;
  currentTaskId: string;
  openTask: (id: string) => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<Record<string, FlightLog>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!fieldId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: ts } = await supabase
        .from("odm_tasks")
        .select("id, odm_uuid, status, created_at, image_count, ai_analysis")
        .eq("field_id", fieldId)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      const all = (ts as Task[] | null) ?? [];
      setTasks(all);
      const ids = all.map(t => t.id);
      if (ids.length) {
        const { data: ls } = await supabase
          .from("flight_logs")
          .select("id, scan_id, date_flown")
          .in("scan_id", ids);
        if (!cancelled) {
          const map: Record<string, FlightLog> = {};
          for (const l of (ls as FlightLog[] | null) ?? []) {
            if (l.scan_id && !map[l.scan_id]) map[l.scan_id] = l;
          }
          setLogs(map);
        }
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [fieldId]);

  const stats = useMemo(() => {
    const m = new Map<string, { zones: number; stressed: number }>();
    for (const t of tasks) {
      const zones = t.ai_analysis?.zones ?? [];
      let stressed = 0;
      for (const z of zones) stressed += polyAcres(z.polygon);
      m.set(t.id, { zones: zones.length, stressed });
    }
    return m;
  }, [tasks]);

  const toggle = (id: string) => {
    setSelected(s => {
      if (s.includes(id)) return s.filter(x => x !== id);
      const next = [...s, id];
      return next.length > 2 ? next.slice(-2) : next;
    });
  };

  const [aId, bId] = selected.length === 2
    ? [...selected].sort((x, y) => {
        const tx = tasks.find(t => t.id === x)!.created_at;
        const ty = tasks.find(t => t.id === y)!.created_at;
        return tx.localeCompare(ty);
      })
    : [null, null];
  const a = aId ? tasks.find(t => t.id === aId)! : null;
  const b = bId ? tasks.find(t => t.id === bId)! : null;
  const aStress = a ? stats.get(a.id)!.stressed : 0;
  const bStress = b ? stats.get(b.id)!.stressed : 0;
  const delta = a && b && aStress > 0 ? ((bStress - aStress) / aStress) * 100 : 0;

  return (
    <div className="flex-1 min-h-0 overflow-auto p-6 bg-[#0a0a0a]">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-neutral-500">Scan History</div>
          <h1 className="font-display text-2xl text-neutral-100">{fieldName}</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Every orthomosaic captured for this field. Select two scans to compare side-by-side and measure treatment impact.
          </p>
        </div>

        {loading && (
          <div className="text-sm text-neutral-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading scans…</div>
        )}

        {!loading && tasks.length === 0 && (
          <Card className="p-10 text-center text-sm text-neutral-500 bg-[#111] border-[#1f1f1f]">
            No scans yet for this field.
          </Card>
        )}

        {!loading && tasks.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {tasks.map((t, i) => {
              const s = stats.get(t.id)!;
              const flown = !!logs[t.id];
              const isCurrent = t.id === currentTaskId;
              const isSelected = selected.includes(t.id);
              return (
                <Card
                  key={t.id}
                  onClick={() => toggle(t.id)}
                  className={`p-4 cursor-pointer transition border bg-[#111] ${
                    isSelected ? "border-cyan-500 ring-1 ring-cyan-500/40" : "border-[#1f1f1f] hover:border-[#333]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-neutral-500">Scan {i + 1}{isCurrent && " · current"}</div>
                      <div className="text-sm font-medium text-neutral-100">
                        {new Date(t.created_at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
                      </div>
                    </div>
                    {isSelected && (
                      <div className="h-5 w-5 rounded-full bg-cyan-500 text-black text-[11px] font-semibold flex items-center justify-center">
                        {selected.indexOf(t.id) + 1}
                      </div>
                    )}
                  </div>

                  <div className="mt-3"><MiniMap task={t} boundary={boundary} /></div>

                  <div className="mt-3 space-y-1 text-xs text-neutral-400">
                    <div><span className="text-neutral-100">{s.zones}</span> zone{s.zones === 1 ? "" : "s"} found</div>
                    <div><span className="text-neutral-100">{s.stressed.toFixed(2)} ac</span> stressed</div>
                    <div className="flex items-center gap-1">
                      {flown
                        ? <Badge variant="outline" className="border-emerald-600 text-emerald-400 text-[10px] gap-1"><CheckCircle2 className="h-3 w-3" /> Mission flown</Badge>
                        : <Badge variant="outline" className="border-amber-600 text-amber-400 text-[10px] gap-1"><Clock className="h-3 w-3" /> Pending</Badge>}
                    </div>
                  </div>

                  <div className="mt-3 flex gap-2">
                    {flown ? (
                      <Button size="sm" variant="outline" className="h-7 text-[11px] flex-1"
                        onClick={(e) => { e.stopPropagation(); openTask(t.id); }}>
                        <FileBarChart className="h-3 w-3" /> View Report
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="h-7 text-[11px] flex-1"
                        onClick={(e) => { e.stopPropagation(); openTask(t.id); }}>
                        <Plane className="h-3 w-3" /> Plan Mission
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {a && b && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-wider text-neutral-500">Comparison</div>
              <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setSelected([])}>
                <X className="h-3 w-3" /> Clear
              </Button>
            </div>
            <CompareMap a={a} b={b} boundary={boundary} />
            <Card className="p-4 bg-[#111] border-[#1f1f1f]">
              {aStress > 0 ? (
                <div className="text-sm text-neutral-200">
                  Stressed area {delta < 0 ? "reduced" : "changed"} from{" "}
                  <span className="font-medium">{aStress.toFixed(2)} ac</span> →{" "}
                  <span className="font-medium">{bStress.toFixed(2)} ac</span>{" "}
                  <span className={delta < 0 ? "text-emerald-400 font-semibold" : "text-amber-400 font-semibold"}>
                    ({delta > 0 ? "+" : ""}{delta.toFixed(0)}%)
                  </span>
                  {delta < 0 && <span className="text-neutral-500"> after treatment</span>}
                </div>
              ) : (
                <div className="text-sm text-neutral-400">No stressed area detected in the older scan — nothing to compare against.</div>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}