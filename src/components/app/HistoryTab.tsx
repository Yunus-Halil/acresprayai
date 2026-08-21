import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, Clock, FileBarChart, Plane, Columns2, X } from "lucide-react";
import { area as turfArea } from "@turf/area";
import { polygon as turfPolygon } from "@turf/helpers";
import Timelapse from "@/components/app/Timelapse";
import ScanCompare from "@/components/app/ScanCompare";
import { isPlayable } from "@/lib/timelapse";
import { compareSelectionError, isComparable, notComparableReason } from "@/lib/scanLayers";

const PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const FN_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;
const TILE_BASE = `${FN_BASE}/tile`;
const NDVI_BASE = `${FN_BASE}/ndvi-tile`;

type Ring = { lat: number; lng: number }[];
// Persisted AI zones store their outline as `ring` (see AiZone in
// OrthomosaicViewer). `polygon` is only the wire shape the model returns before
// analyze-ortho normalises it - it is never what lands in odm_tasks.ai_analysis.
type AiZone = { id?: string; ring?: Ring; severity?: string };
type AiAnalysis = { zones?: AiZone[] } | null;
type Task = {
  id: string;
  odm_uuid: string | null;
  status: string;
  created_at: string;
  image_count: number;
  ai_analysis: AiAnalysis;
  /** Only a fully baked scan has tiles to fade to. */
  tiles_baked: boolean | null;
};
type FlightLog = { id: string; scan_id: string | null; date_flown: string };

export function polyAcres(poly: { lat: number; lng: number }[] | undefined) {
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

function MiniMap({ task, boundary, token }: { task: Task; boundary: Ring[] | null; token: string | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current || !task.odm_uuid || !token) return;
    const map = L.map(ref.current, {
      zoomControl: false, attributionControl: false, dragging: false,
      scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false,
      touchZoom: false,
    });
    const tl = L.tileLayer(`${TILE_BASE}/${task.odm_uuid}/{z}/{x}/{y}.png?token=${token}`, { maxZoom: 22 });
    tl.addTo(map);
    const b = boundsFromRings(boundary);
    if (b) map.fitBounds(b, { padding: [4, 4] });
    else map.setView([0, 0], 2);
    // Overlay AI zones if present
    const zones = task.ai_analysis?.zones ?? [];
    for (const z of zones) {
      if (!z.ring || z.ring.length < 3) continue;
      const color = z.severity === "high" ? "#ef4444" : z.severity === "medium" ? "#f59e0b" : "#facc15";
      L.polygon(z.ring.map(p => [p.lat, p.lng]) as any, {
        color, weight: 1.5, fillOpacity: 0.35, interactive: false,
      }).addTo(map);
    }
    return () => { map.remove(); };
  }, [task.id, task.odm_uuid, boundary, token]);
  if (!task.odm_uuid) {
    return <div className="h-40 rounded bg-[#0a0a0a] border border-[#1f1f1f] flex items-center justify-center text-xs text-neutral-600">No orthomosaic</div>;
  }
  return <div ref={ref} className="h-40 rounded bg-[#0a0a0a] border border-[#1f1f1f] overflow-hidden" />;
}

// The swipe-over-one-map compare that used to live here is gone. It was a third
// hand-rolled L.map beside MiniMap and the Field View's own renderer, it stacked
// the index layer over both scans with no way to turn it off, and a single map
// cannot show two scans as two pictures — only as one picture cut in half. See
// components/app/ScanCompare.tsx, which runs the real renderer twice and keeps
// the swipe as one of its two layouts.

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
  // Tile endpoints authenticate via ?token= because Leaflet loads them as <img>.
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setToken(s?.access_token ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!fieldId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: ts } = await supabase
        .from("odm_tasks")
        .select("id, odm_uuid, status, created_at, image_count, ai_analysis, tiles_baked")
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
      for (const z of zones) stressed += polyAcres(z.ring);
      m.set(t.id, { zones: zones.length, stressed });
    }
    return m;
  }, [tasks]);

  // Scans with something to actually render. A scan still processing, or one
  // whose tiles never finished baking, would fade to a blank frame.
  const playable = useMemo(
    () => tasks.filter(isPlayable),
    [tasks],
  );

  const [comparing, setComparing] = useState(false);

  const toggle = (id: string) => {
    setSelected(s => {
      if (s.includes(id)) return s.filter(x => x !== id);
      const next = [...s, id];
      // Rolling window of two: a third click replaces the oldest rather than
      // being ignored, so picking the wrong scan is one click to fix.
      return next.length > 2 ? next.slice(-2) : next;
    });
  };

  const selectionError = compareSelectionError(selected);

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

  // Compare takes over the whole panel. Two orthomosaics at a useful size do not
  // fit under a scrolling list of cards, and the point of the view is to look
  // closely at both at once.
  if (comparing && a && b) {
    return (
      <ScanCompare
        left={a}
        right={b}
        boundary={boundary}
        token={token}
        onExit={() => setComparing(false)}
      />
    );
  }

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
              // A scan with no baked tiles has nothing to draw in a pane, so it
              // is not offered for comparison — with the reason, rather than a
              // card that just refuses to respond to clicks.
              const blocked = notComparableReason(t);
              return (
                <Card
                  key={t.id}
                  onClick={() => { if (!blocked) toggle(t.id); }}
                  title={blocked ?? undefined}
                  className={`p-4 transition border bg-[#111] ${
                    blocked
                      ? "cursor-not-allowed border-[#1f1f1f] opacity-60"
                      : isSelected
                        ? "cursor-pointer border-cyan-500 ring-1 ring-cyan-500/40"
                        : "cursor-pointer border-[#1f1f1f] hover:border-[#333]"
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

                  <div className="mt-3"><MiniMap task={t} boundary={boundary} token={token} /></div>

                  <div className="mt-3 space-y-1 text-xs text-neutral-400">
                    <div><span className="text-neutral-100">{s.zones}</span> zone{s.zones === 1 ? "" : "s"} found</div>
                    <div><span className="text-neutral-100">{s.stressed.toFixed(2)} ac</span> stressed</div>
                    {blocked && <div className="text-[11px] text-amber-500/80">{blocked}</div>}
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

        {playable.length >= 2 && (
          <Timelapse scans={playable} boundary={boundary} token={token} />
        )}

        {/* Compare action. Present whenever there is more than one scan to
            compare, so the feature is discoverable before anything is selected
            rather than appearing only once the selection happens to be right. */}
        {!loading && tasks.filter(isComparable).length >= 2 && (
          <Card className="p-3 bg-[#111] border-[#1f1f1f] flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wider text-neutral-500">Compare scans</div>
              <div className={`text-xs mt-0.5 ${selectionError ? "text-neutral-500" : "text-neutral-300"}`}>
                {selectionError ?? `${new Date(a!.created_at).toLocaleDateString()} and ${new Date(b!.created_at).toLocaleDateString()}, oldest on the left.`}
              </div>
            </div>
            {selected.length > 0 && (
              <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setSelected([])}>
                <X className="h-3 w-3" /> Clear
              </Button>
            )}
            <Button
              size="sm"
              className="h-7 text-[11px]"
              disabled={!!selectionError}
              title={selectionError ?? "Open the side-by-side view"}
              onClick={() => setComparing(true)}
            >
              <Columns2 className="h-3 w-3" /> Compare
            </Button>
          </Card>
        )}

        {a && b && (
          <div className="space-y-3">
            <div className="text-[11px] uppercase tracking-wider text-neutral-500">Change between them</div>
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
                <div className="text-sm text-neutral-400">No stressed area detected in the older scan. Nothing to compare against.</div>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}