// The dashboard weather screen.
//
// This used to be a weather VIEWER: a radar animation, some pins, and a 7-day
// forecast for whichever pin you clicked. Pretty, and it made the operator do
// all the work: open each field, read the numbers, decide, remember, repeat.
//
// It is now a spray board. It answers the question someone standing at the
// dashboard with eight fields and a week of booked work actually has, and which
// a per-field tab structurally cannot answer:
//
//   Across all my fields, where and when can I spray, and does that break
//   anything I have already scheduled?
//
// The decision logic is in @/lib/sprayBoard and @/lib/sprayWindow, shared with
// the per-scan Weather tab. Before that split there were THREE different spray
// rules in this codebase, and this file held the loosest one: it called a whole
// day sprayable on precipitation probability and wind alone, ignoring gusts,
// humidity and temperature entirely, and averaged over 24 hours so a calm
// evening could mask an unflyable afternoon.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, Cloud,
  CloudDrizzle, CloudLightning, CloudRain, CloudSnow, Droplets, Loader2, MapPin,
  Pause, Play, RefreshCw, Sun, Trash2, Wind, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { type WxDay, type WxHour, fetchWeather } from "@/lib/weather";
import { storageKey } from "@/lib/storage";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { fmtTemp, fmtWindSpeed } from "@/lib/units";
import {
  type BoardSite, type MissionCheck, type SiteOutlook,
  checkScheduled, conflictsOnly, outlookFor, sortOutlooks, suggestedMove, summarise,
} from "@/lib/sprayBoard";
import {
  type SprayWindow, type Verdict, DEFAULT_SPRAY_LIMITS, VERDICT_LABEL,
  formatReason, rainAhead, shortReason, sprayVerdict,
} from "@/lib/sprayWindow";
import { type ScheduledMission, listMissions } from "@/lib/schedule";

type Farm = BoardSite & { address: string };
type Suggestion = { id: number; name: string; admin1?: string; country?: string; latitude: number; longitude: number };

const WMO: Record<number, { label: string; Icon: LucideIcon }> = {
  0: { label: "Clear", Icon: Sun },
  1: { label: "Mainly clear", Icon: Sun },
  2: { label: "Partly cloudy", Icon: Cloud },
  3: { label: "Overcast", Icon: Cloud },
  45: { label: "Fog", Icon: Cloud },
  48: { label: "Rime fog", Icon: Cloud },
  51: { label: "Light drizzle", Icon: CloudDrizzle },
  53: { label: "Drizzle", Icon: CloudDrizzle },
  55: { label: "Heavy drizzle", Icon: CloudDrizzle },
  61: { label: "Light rain", Icon: CloudRain },
  63: { label: "Rain", Icon: CloudRain },
  65: { label: "Heavy rain", Icon: CloudRain },
  71: { label: "Light snow", Icon: CloudSnow },
  73: { label: "Snow", Icon: CloudSnow },
  75: { label: "Heavy snow", Icon: CloudSnow },
  80: { label: "Showers", Icon: CloudRain },
  81: { label: "Heavy showers", Icon: CloudRain },
  82: { label: "Violent showers", Icon: CloudRain },
  95: { label: "Thunderstorm", Icon: CloudLightning },
  96: { label: "Thunder + hail", Icon: CloudLightning },
  99: { label: "Severe thunder", Icon: CloudLightning },
};
const wmo = (c: number) => WMO[c] ?? { label: "Unknown", Icon: Cloud };

const STORAGE_KEY = storageKey("farms");

/** How far ahead the calendar is checked. The forecast runs 48 hours. */
const SCHEDULE_LOOKAHEAD_DAYS = 14;

/**
 * Forecasts fetched at once.
 *
 * Each site is a separate edge-function call. A farm with twenty pins firing
 * twenty simultaneous requests would rate-limit itself and, on the rural
 * connections this product is built for, time most of them out. Four at a time
 * finishes fast enough and degrades gracefully. Repeat visits mostly hit the
 * 20-minute localStorage cache in @/lib/weather and cost nothing.
 */
const FETCH_CONCURRENCY = 4;

// Fix default marker icons (Leaflet + bundlers)
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const VERDICT_HEX: Record<Verdict, string> = {
  green: "#16a34a", yellow: "#d97706", red: "#dc2626",
};

/**
 * A pin coloured by whether you can spray there.
 *
 * The map is the fastest way to see that the storm is sitting on the two fields
 * in the north and not the four in the south. A uniformly green pin cannot
 * carry that, so the marker takes the verdict's colour and the radar underneath
 * explains why.
 */
const pinFor = (verdict: Verdict | null) => {
  const c = verdict ? VERDICT_HEX[verdict] : "#64748b";
  return L.divIcon({
    className: "",
    html:
      `<div style="background:${c};width:22px;height:22px;border-radius:50% 50% 50% 0;` +
      `transform:rotate(-45deg);border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4);"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 22],
  });
};

// Compute centroid (simple average of vertices) of a GeoJSON Polygon /
// MultiPolygon or Feature wrapping one. Returns null if no usable coordinates.
type GeomLike = { type?: string; coordinates?: unknown; geometry?: GeomLike };

function boundaryCentroid(b: unknown): [number, number] | null {
  if (!b || typeof b !== "object") return null;
  const o = b as GeomLike;
  const geom = o.type === "Feature" ? o.geometry : o;
  if (!geom?.type) return null;
  const coords = geom.coordinates as number[][][] | number[][][][] | undefined;
  const rings: number[][][] =
    geom.type === "Polygon" ? (coords as number[][][]) ?? [] :
    geom.type === "MultiPolygon" ? ((coords as number[][][][]) ?? []).flat() : [];
  let sx = 0, sy = 0, n = 0;
  for (const ring of rings) {
    for (const pt of ring) {
      if (Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
        sx += pt[0]; sy += pt[1]; n++;
      }
    }
  }
  if (!n) return null;
  return [sy / n, sx / n]; // [lat, lng]  (GeoJSON is [lng, lat])
}

/** A thrown value's message, or a stated fallback. */
const msgOf = (e: unknown, fallback: string): string =>
  e instanceof Error && e.message ? e.message : fallback;

/** Leaflet renders a popup string as HTML, so anything user-named is escaped. */
const esc = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const fmtHour = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric" });
const fmtDayHour = (ts: number) =>
  new Date(ts * 1000).toLocaleString([], { weekday: "short", hour: "numeric" });
const fmtDay = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

/** "in 3 hours" / "tomorrow 7 AM", whichever a person would actually say. */
function whenPhrase(w: SprayWindow, hoursUntil: number | null): string {
  if (w.active) return `open now until ${fmtHour(w.endTs)}`;
  if (hoursUntil != null && hoursUntil <= 12) {
    return `opens in ${hoursUntil} hour${hoursUntil === 1 ? "" : "s"}, ${fmtHour(w.startTs)} to ${fmtHour(w.endTs)}`;
  }
  return `${fmtDayHour(w.startTs)} to ${fmtHour(w.endTs)}`;
}

function VerdictDot({ verdict, className = "" }: { verdict: Verdict; className?: string }) {
  const Icon = verdict === "green" ? CheckCircle2 : verdict === "yellow" ? AlertTriangle : XCircle;
  return <Icon className={className} style={{ color: VERDICT_HEX[verdict] }} />;
}

export default function Weather() {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const radarLayerRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const units = useUnitSystem();

  const [farms, setFarms] = useState<Farm[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); } catch { return []; }
  });
  const [form, setForm] = useState({ name: "", address: "" });
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [frames, setFrames] = useState<{ time: number; path: string }[]>([]);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [host, setHost] = useState<string>("");
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null);
  const [autoLoading, setAutoLoading] = useState(false);

  // One forecast per site, plus whichever ones failed. Keyed by site id so the
  // board, the map pins and the calendar check all read the same numbers.
  const [hourlyBySite, setHourlyBySite] = useState<Map<string, WxHour[]>>(new Map());
  const [dailyBySite, setDailyBySite] = useState<Map<string, WxDay[]>>(new Map());
  const [errBySite, setErrBySite] = useState<Map<string, string>>(new Map());
  const [loadingForecasts, setLoadingForecasts] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  const [missions, setMissions] = useState<ScheduledMission[]>([]);

  // ---------------------------------------------------------------- map setup
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [39.5, -98.35], // continental US
      zoom: 4,
      worldCopyJump: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 18,
    }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Load RainViewer radar frames (free, no key)
  useEffect(() => {
    fetch("https://api.rainviewer.com/public/weather-maps.json")
      .then(r => r.json())
      .then((j) => {
        setHost(j.host);
        const past = (j.radar?.past ?? []) as { time: number; path: string }[];
        const nowcast = (j.radar?.nowcast ?? []) as { time: number; path: string }[];
        setFrames([...past, ...nowcast]);
        setFrameIdx(Math.max(0, past.length - 1));
      })
      .catch(() => toast.error("Could not load weather radar feed"));
  }, []);

  // Render current radar frame
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !frames.length || !host) return;
    const frame = frames[frameIdx];
    if (!frame) return;
    const layer = L.tileLayer(`${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, {
      opacity: 0.65, attribution: "Radar &copy; RainViewer",
    });
    layer.addTo(map);
    if (radarLayerRef.current) map.removeLayer(radarLayerRef.current);
    radarLayerRef.current = layer;
  }, [frames, frameIdx, host]);

  useEffect(() => {
    if (!playing || !frames.length) return;
    const id = setInterval(() => setFrameIdx(i => (i + 1) % frames.length), 700);
    return () => clearInterval(id);
  }, [playing, frames.length]);

  // ------------------------------------------------------- pins from fields
  // A field becomes a pin when either (a) it has a boundary (polygon centroid)
  // or (b) it has a free-text `location` we can geocode. Manual pins are left
  // alone; field-sourced pins are keyed `field:<id>` so re-runs dedupe, and so
  // a scheduled mission can be matched back to its weather by field id.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setAutoLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: rows, error } = await supabase
          .from("fields")
          .select("id,name,location,boundary")
          .eq("user_id", user.id);
        if (error) throw error;
        if (!rows?.length) return;

        const existing = new Map(farms.map(f => [f.id, f]));
        const additions: Farm[] = [];

        for (const row of rows) {
          const key = `field:${row.id}`;
          if (existing.has(key)) continue;
          const c = boundaryCentroid(row.boundary);
          if (c) {
            additions.push({
              id: key, name: row.name,
              address: row.location ?? "Defined boundary",
              lat: c[0], lng: c[1], source: "field",
            });
            continue;
          }
          if (row.location && row.location.trim()) {
            try {
              const r = await fetch(
                `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(row.location)}`
              );
              const j = await r.json();
              const hit = j?.results?.[0];
              if (hit) {
                additions.push({
                  id: key, name: row.name,
                  address: [hit.name, hit.admin1, hit.country].filter(Boolean).join(", "),
                  lat: Number(hit.latitude), lng: Number(hit.longitude), source: "field",
                });
              }
            } catch { /* a field we cannot place simply gets no pin */ }
          }
        }

        if (cancelled || !additions.length) return;
        const next = [...farms, ...additions];
        setFarms(next);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (e: unknown) {
        if (!cancelled) toast.error(msgOf(e, "Couldn't auto-pin fields"));
      } finally {
        if (!cancelled) setAutoLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Intentionally only run once on mount; manual changes shouldn't retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------- forecasts for every site
  const sitesKey = farms.map(f => `${f.id}@${f.lat.toFixed(3)},${f.lng.toFixed(3)}`).join("|");

  const loadForecasts = useCallback(async (force = false) => {
    if (!farms.length) { setLoadingForecasts(false); return; }
    setLoadingForecasts(true);
    const hourly = new Map<string, WxHour[]>();
    const daily = new Map<string, WxDay[]>();
    const errs = new Map<string, string>();

    const queue = [...farms];
    const worker = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        try {
          const { data } = await fetchWeather(f.lat, f.lng, { force });
          hourly.set(f.id, data.hourly ?? []);
          daily.set(f.id, data.daily ?? []);
        } catch (e: unknown) {
          // One field's forecast failing must not blank the whole board. The
          // row stays, marked unavailable, which is different from "no window".
          errs.set(f.id, msgOf(e, "Forecast unavailable"));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, farms.length) }, worker));

    setHourlyBySite(hourly);
    setDailyBySite(daily);
    setErrBySite(errs);
    setRefreshedAt(Date.now());
    setLoadingForecasts(false);
    if (errs.size && errs.size === farms.length) toast.error("Could not load any forecasts");
  }, [farms]);

  useEffect(() => {
    loadForecasts(false);
    // Refetch when the set of sites changes, not on every farms array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitesKey]);

  // -------------------------------------------------------- scheduled work
  useEffect(() => {
    let cancelled = false;
    const from = new Date();
    const to = new Date(Date.now() + SCHEDULE_LOOKAHEAD_DAYS * 86400_000);
    listMissions(from.toISOString(), to.toISOString())
      .then(ms => { if (!cancelled) setMissions(ms); })
      // A missing calendar is not worth a red toast on a weather screen; the
      // conflicts panel simply does not appear.
      .catch(() => { if (!cancelled) setMissions([]); });
    return () => { cancelled = true; };
  }, []);

  // ------------------------------------------------------------- derived board
  const outlooks = useMemo(() => {
    const rows = farms.map(f =>
      outlookFor(f, hourlyBySite.get(f.id) ?? null, { error: errBySite.get(f.id) ?? null }));
    return sortOutlooks(rows);
  }, [farms, hourlyBySite, errBySite]);

  const outlookById = useMemo(
    () => new Map(outlooks.map(o => [o.site.id, o])), [outlooks]);

  const summary = useMemo(() => summarise(outlooks), [outlooks]);

  const conflicts = useMemo(
    () => conflictsOnly(checkScheduled(missions, farms, hourlyBySite)),
    [missions, farms, hourlyBySite]);

  // ------------------------------------------------------------ map markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const live = new Set(farms.map(f => f.id));
    markersRef.current.forEach((m, id) => {
      if (!live.has(id)) { map.removeLayer(m); markersRef.current.delete(id); }
    });
    farms.forEach(f => {
      const o = outlookById.get(f.id);
      const verdict = o?.now?.verdict ?? null;
      const window = o?.nextWindow
        ? whenPhrase(o.nextWindow, o.hoursUntil)
        : o?.error ? "forecast unavailable" : "no window in the next 3 days";
      const popup =
        `<strong>${esc(f.name)}</strong><br/>` +
        `<span style="font-size:11px;color:${verdict ? VERDICT_HEX[verdict] : "#666"};">` +
        `${verdict ? esc(VERDICT_LABEL[verdict]) : "Unknown"}</span>` +
        `<span style="font-size:11px;color:#666;"> &middot; ${esc(window)}</span>`;

      const existing = markersRef.current.get(f.id);
      if (existing) {
        existing.setIcon(pinFor(verdict));
        existing.setPopupContent(popup);
        return;
      }
      const m = L.marker([f.lat, f.lng], { icon: pinFor(verdict) })
        .addTo(map)
        .bindPopup(popup)
        .on("click", () => setSelectedFarmId(f.id));
      markersRef.current.set(f.id, m);
    });
  }, [farms, outlookById]);

  // ------------------------------------------------------------------ pinning
  const persist = (next: Farm[]) => {
    setFarms(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const addFarm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.address.trim()) return;
    setSearching(true);
    try {
      let hit: Suggestion | null = picked;
      if (!hit) {
        const r = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(form.address)}`);
        if (!r.ok) throw new Error(`Geocoding ${r.status}`);
        hit = (await r.json())?.results?.[0] ?? null;
      }
      if (!hit) {
        toast.error("Address not found, try a city, ZIP, or a more specific location");
        return;
      }
      const farm: Farm = {
        id: crypto.randomUUID(),
        name: form.name.trim(),
        address: [hit.name, hit.admin1, hit.country].filter(Boolean).join(", "),
        lat: Number(hit.latitude), lng: Number(hit.longitude),
        source: "manual",
      };
      persist([...farms, farm]);
      mapRef.current?.flyTo([farm.lat, farm.lng], 10, { duration: 1.2 });
      setForm({ name: "", address: "" });
      setPicked(null); setSuggestions([]); setShowSuggest(false); setShowAddForm(false);
      setSelectedFarmId(farm.id);
      toast.success(`${farm.name} pinned`);
    } catch (err: unknown) {
      toast.error(msgOf(err, "Geocoding failed"));
    } finally {
      setSearching(false);
    }
  };

  const removeFarm = (id: string) => {
    persist(farms.filter(f => f.id !== id));
    if (selectedFarmId === id) setSelectedFarmId(null);
  };

  // Autocomplete (debounced)
  useEffect(() => {
    const q = form.address.trim();
    if (q.length < 2 || picked) { setSuggestions([]); return; }
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      try {
        const r = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=${encodeURIComponent(q)}`,
          { signal: ctrl.signal });
        if (!r.ok) return;
        setSuggestions((await r.json())?.results ?? []);
        setShowSuggest(true);
      } catch { /* aborted or offline; the field just gets no suggestions */ }
    }, 250);
    return () => { clearTimeout(id); ctrl.abort(); };
  }, [form.address, picked]);

  const goTo = (f: BoardSite) => {
    mapRef.current?.flyTo([f.lat, f.lng], 11, { duration: 1.2 });
    markersRef.current.get(f.id)?.openPopup();
    setSelectedFarmId(f.id);
  };

  useEffect(() => {
    if (!selectedFarmId && outlooks.length) setSelectedFarmId(outlooks[0].site.id);
  }, [outlooks, selectedFarmId]);

  // ---------------------------------------------------------------- rendering
  const currentFrame = frames[frameIdx];
  const frameLabel = currentFrame
    ? new Date(currentFrame.time * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "-";
  const isNowcast = !!currentFrame && currentFrame.time * 1000 > Date.now();

  const selected = selectedFarmId ? outlookById.get(selectedFarmId) ?? null : null;
  const selectedFarm = farms.find(f => f.id === selectedFarmId) ?? null;
  const selectedHourly = selectedFarmId ? hourlyBySite.get(selectedFarmId) ?? [] : [];
  const selectedDaily = selectedFarmId ? dailyBySite.get(selectedFarmId) ?? [] : [];

  const L_ = DEFAULT_SPRAY_LIMITS;
  const windTxt = (kmh: number) => fmtWindSpeed(kmh / 3.6, units).text;
  const limitsLine =
    `Wind ≤ ${windTxt(L_.windMaxKmh)}, gusts ≤ ${windTxt(L_.gustMaxKmh)}, ` +
    `no rain within 6 hours, ${L_.humidityMin}-${L_.humidityMax}% humidity, ` +
    `at least ${fmtTemp(L_.tempMinC, units).text}`;

  const headline =
    !farms.length ? "Add a field or pin a location to see spray conditions."
    : loadingForecasts && !refreshedAt ? "Checking conditions across your fields…"
    : summary.sprayableNow > 0
      ? `${summary.sprayableNow} of ${summary.total} ${summary.total === 1 ? "field is" : "fields are"} sprayable right now.`
      : summary.openingSoon > 0
        ? `Nothing sprayable right now. ${summary.openingSoon} ${summary.openingSoon === 1 ? "field opens" : "fields open"} within 24 hours.`
        : "No spray windows across your fields in the next 3 days.";

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl flex items-center gap-2">
            <CloudRain className="h-7 w-7" /> Spray Conditions
          </h1>
          <p className="text-muted-foreground">
            {headline}
            {autoLoading && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs">
                <Loader2 className="h-3 w-3 animate-spin" /> syncing fields…
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {refreshedAt && (
            <span className="text-[11px] text-muted-foreground">
              Updated {new Date(refreshedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => loadForecasts(true)} disabled={loadingForecasts || !farms.length}>
            {loadingForecasts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>
      </header>

      {/* Scheduled work the weather has a problem with. Hidden when there is
          nothing to say, so its presence always means something. */}
      {conflicts.length > 0 && (
        <Card className="border-amber-500/50 p-5">
          <h3 className="font-display flex items-center gap-2 mb-1">
            <CalendarClock className="h-4 w-4 text-amber-600" />
            {conflicts.length} scheduled {conflicts.length === 1 ? "mission runs" : "missions run"} into bad conditions
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            Checked against the forecast at each mission's own field and hour.
          </p>
          <ul className="space-y-2">
            {conflicts.map(c => (
              <ConflictRow
                key={c.mission.id}
                check={c}
                move={suggestedMove(c, c.site ? outlookById.get(c.site.id) : undefined)}
                units={units}
                onOpen={() => c.site && goTo(c.site)}
              />
            ))}
          </ul>
        </Card>
      )}

      {/* The board. This is the answer to "where can I spray", so it comes
          before the radar, which is the answer to "why". */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="font-display flex items-center gap-2">
            <MapPin className="h-4 w-4" /> Your fields
          </h3>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><VerdictDot verdict="green" className="h-3.5 w-3.5" /> {summary.sprayableNow} now</span>
            <span className="flex items-center gap-1"><VerdictDot verdict="yellow" className="h-3.5 w-3.5" /> {summary.openingSoon} within 24h</span>
            <span className="flex items-center gap-1"><VerdictDot verdict="red" className="h-3.5 w-3.5" /> {summary.noWindow} no window</span>
            {summary.unavailable > 0 && <span>{summary.unavailable} unavailable</span>}
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setShowAddForm(s => !s)}>
              {showAddForm ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Pin a location
            </Button>
          </div>
        </div>

        {showAddForm && (
          <form onSubmit={addFarm} className="grid sm:grid-cols-[1fr_1.5fr_auto] gap-3 items-end border rounded-lg p-3 mb-4 bg-muted/30">
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="North Quadrant" />
            </div>
            <div>
              <Label className="text-xs">Address or location</Label>
              <div className="relative">
                <Input
                  value={form.address}
                  onChange={e => { setForm({ ...form, address: e.target.value }); setPicked(null); }}
                  onFocus={() => suggestions.length && setShowSuggest(true)}
                  onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                  placeholder="Start typing a city, ZIP, or place…"
                  autoComplete="off"
                />
                {showSuggest && suggestions.length > 0 && (
                  <ul className="absolute z-[1000] left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-64 overflow-auto">
                    {suggestions.map(s => (
                      <li key={s.id}>
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-start gap-2"
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => {
                            setPicked(s);
                            setForm(f => ({ ...f, address: [s.name, s.admin1, s.country].filter(Boolean).join(", ") }));
                            setShowSuggest(false);
                          }}
                        >
                          <MapPin className="h-3.5 w-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
                          <span className="truncate">
                            <span className="font-medium">{s.name}</span>
                            <span className="text-muted-foreground">
                              {[s.admin1, s.country].filter(Boolean).length ? `, ${[s.admin1, s.country].filter(Boolean).join(", ")}` : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <Button type="submit" disabled={searching}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
              {searching ? "Locating…" : "Pin"}
            </Button>
          </form>
        )}

        {!farms.length ? (
          <div className="text-sm text-muted-foreground text-center py-10">
            No fields yet. Fields with a drawn boundary appear here automatically, or pin a location above.
          </div>
        ) : (
          <ul className="space-y-2">
            {outlooks.map(o => (
              <FieldRow
                key={o.site.id}
                outlook={o}
                hourly={hourlyBySite.get(o.site.id) ?? []}
                selected={o.site.id === selectedFarmId}
                loading={loadingForecasts && !hourlyBySite.has(o.site.id) && !errBySite.has(o.site.id)}
                units={units}
                onSelect={() => goTo(o.site)}
                onRemove={() => removeFarm(o.site.id)}
              />
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground mt-3">
          Sprayable means: {limitsLine}. These are conventional drift thresholds, not label law. Your product label may be stricter.
        </p>
      </Card>

      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6">
        <Card className="overflow-hidden">
          <div ref={containerRef} style={{ height: 480 }} className="w-full bg-muted" />
          <div className="p-3 border-t flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setPlaying(p => !p)}>
                {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {playing ? "Pause" : "Play"}
              </Button>
              <span className="text-xs font-mono text-muted-foreground">
                Frame {frameIdx + 1}/{frames.length || 0} · {frameLabel}
              </span>
              {isNowcast && <Badge variant="outline" className="border-amber-500 text-amber-600 text-[10px]">Forecast</Badge>}
            </div>
            <input
              type="range" min={0} max={Math.max(0, frames.length - 1)} value={frameIdx}
              onChange={e => setFrameIdx(Number(e.target.value))}
              aria-label="Radar frame"
              className="flex-1 min-w-[160px]"
            />
          </div>
          <div className="px-3 pb-3 text-[11px] text-muted-foreground">
            Pins are coloured by whether that field is sprayable right now. Radar from RainViewer.
          </div>
        </Card>

        {selected && selectedFarm && (
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display flex items-center gap-2 min-w-0">
                <CloudRain className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{selectedFarm.name}</span>
              </h3>
              {selected.now && (
                <Badge variant="outline" className="text-[10px] flex-shrink-0"
                       style={{ borderColor: VERDICT_HEX[selected.now.verdict], color: VERDICT_HEX[selected.now.verdict] }}>
                  {VERDICT_LABEL[selected.now.verdict]}
                </Badge>
              )}
            </div>

            {selected.error ? (
              <div className="text-sm text-muted-foreground py-4">{selected.error}</div>
            ) : !selectedHourly.length ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading forecast…
              </div>
            ) : (
              <>
                {selected.now && selected.now.reasons.length > 0 && (
                  <ul className="text-xs text-muted-foreground space-y-1 border rounded-lg p-3 bg-muted/30">
                    {selected.now.reasons.map((r, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span style={{ color: VERDICT_HEX[r.severity === "hard" ? "red" : "yellow"] }}>•</span>
                        {formatReason(r, units)}
                      </li>
                    ))}
                  </ul>
                )}

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                    Next 24 hours
                  </div>
                  <div className="flex gap-1 overflow-x-auto pb-1">
                    {selectedHourly.slice(0, 24).map((h, i) => {
                      const v = sprayVerdict(h, rainAhead(selectedHourly, i)).verdict;
                      return (
                        <div key={h.time} className="min-w-[52px] rounded border p-1.5 text-center"
                             title={`${fmtHour(h.time)}: ${VERDICT_LABEL[v]}`}>
                          <div className="text-[10px] text-muted-foreground">{fmtHour(h.time)}</div>
                          <div className="text-xs font-mono">{Math.round(fmtTemp(h.temp_c, units).value)}°</div>
                          <div className="text-[9px] text-muted-foreground font-mono">{windTxt(h.wind_kmh)}</div>
                          <div className="mt-1 h-1 rounded-full" style={{ background: VERDICT_HEX[v] }} />
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                    Spray windows, next 3 days
                  </div>
                  {selected.windows.length === 0 ? (
                    <div className="text-xs text-muted-foreground">
                      None. Every hour in the next 72 breaks at least one limit.
                    </div>
                  ) : (
                    <ul className="space-y-1.5">
                      {selected.windows.slice(0, 5).map(w => (
                        <li key={w.startTs}
                            className="flex items-center gap-2 text-xs border rounded px-2 py-1.5"
                            style={w.active ? { borderColor: VERDICT_HEX.green } : undefined}>
                          <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" style={{ color: VERDICT_HEX.green }} />
                          <span className="flex-1">{whenPhrase(w, w.active ? 0 : null)}</span>
                          <span className="text-muted-foreground font-mono">{w.hours}h</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {selectedDaily.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">7-day outlook</div>
                    <div className="space-y-1">
                      {selectedDaily.slice(0, 7).map(d => {
                        const w = wmo(d.code);
                        return (
                          <div key={d.time} className="flex items-center gap-2 text-xs border rounded px-2 py-1">
                            <div className="w-20 text-muted-foreground">{fmtDay(d.time)}</div>
                            <w.Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                            <div className="flex-1 truncate">{w.label}</div>
                            <div className="flex items-center gap-0.5 text-sky-600"><Droplets className="h-3 w-3" /> {d.precip_prob}%</div>
                            <div className="flex items-center gap-0.5 text-muted-foreground"><Wind className="h-3 w-3" /> {windTxt(d.wind_kmh)}</div>
                            <div className="w-16 text-right font-mono">
                              <span className="font-semibold">{Math.round(fmtTemp(d.tmax_c, units).value)}°</span>
                              <span className="text-muted-foreground"> / {Math.round(fmtTemp(d.tmin_c, units).value)}°</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2">
                      Daily rows are a summary. Spray windows above are computed hour by hour, because a calm evening can hide an unflyable afternoon.
                    </p>
                  </div>
                )}
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- sub-views

function FieldRow({
  outlook, hourly, selected, loading, units, onSelect, onRemove,
}: {
  outlook: SiteOutlook;
  hourly: WxHour[];
  selected: boolean;
  loading: boolean;
  units: "metric" | "imperial";
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { site, now, nextWindow, hoursUntil, error } = outlook;

  const status = error ? (
    <span className="text-muted-foreground">Forecast unavailable</span>
  ) : loading || !now ? (
    <span className="text-muted-foreground inline-flex items-center gap-1">
      <Loader2 className="h-3 w-3 animate-spin" /> Checking…
    </span>
  ) : nextWindow ? (
    <span style={{ color: nextWindow.active ? VERDICT_HEX.green : undefined }}>
      {whenPhrase(nextWindow, hoursUntil)}
    </span>
  ) : (
    <span className="text-muted-foreground">No window in the next 3 days</span>
  );

  return (
    <li className={`border rounded-lg p-3 hover:bg-muted/40 transition-colors ${selected ? "border-primary bg-primary/5" : ""}`}>
      <div className="flex items-start gap-3">
        <button className="flex-1 text-left min-w-0" onClick={onSelect}>
          <div className="flex items-center gap-2 min-w-0">
            {now ? <VerdictDot verdict={now.verdict} className="h-4 w-4 flex-shrink-0" />
                 : <Cloud className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
            <span className="font-medium text-sm truncate">{site.name}</span>
            {site.source === "field" && <Badge variant="outline" className="text-[9px] flex-shrink-0">Field</Badge>}
          </div>
          <div className="text-xs mt-1 ml-6">{status}</div>
          {now && now.headline && (
            <div className="text-[11px] text-muted-foreground mt-0.5 ml-6">{formatReason(now.headline, units)}</div>
          )}
        </button>

        {/* Three days at a glance. Each tick is one hour, coloured by verdict,
            so a whole week's shape reads without opening anything. */}
        {hourly.length > 0 && (
          <button className="hidden md:flex items-end gap-px h-8 flex-shrink-0" onClick={onSelect}
                  aria-label={`72 hour outlook for ${site.name}`}>
            {hourly.slice(0, 72).map((h, i) => {
              const v = sprayVerdict(h, rainAhead(hourly, i)).verdict;
              return (
                <span key={h.time} className="w-[3px] rounded-sm"
                      style={{ height: v === "green" ? 28 : v === "yellow" ? 18 : 9, background: VERDICT_HEX[v] }} />
              );
            })}
          </button>
        )}

        <Button size="icon" variant="ghost" className="h-7 w-7 flex-shrink-0" onClick={onRemove}
                aria-label={`Remove ${site.name}`}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}

function ConflictRow({
  check, move, units, onOpen,
}: {
  check: MissionCheck;
  move: SprayWindow | null;
  units: "metric" | "imperial";
  onOpen: () => void;
}) {
  const when = new Date(check.scheduledMs).toLocaleString([], {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  const v = check.verdict!;
  return (
    <li className="border rounded-lg p-3 text-sm" style={{ borderColor: `${VERDICT_HEX[v.verdict]}66` }}>
      <div className="flex items-start gap-2">
        <VerdictDot verdict={v.verdict} className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <button className="text-left" onClick={onOpen}>
            <span className="font-medium">{check.site?.name ?? "Unplaced mission"}</span>
            <span className="text-muted-foreground"> · {when}</span>
          </button>
          <div className="text-xs text-muted-foreground mt-0.5">
            {v.headline ? formatReason(v.headline, units) : VERDICT_LABEL[v.verdict]}
          </div>
          {move && (
            <div className="text-xs mt-1" style={{ color: VERDICT_HEX.green }}>
              Next clear window: {fmtDayHour(move.startTs)} to {fmtHour(move.endTs)} ({move.hours}h)
            </div>
          )}
        </div>
        <Badge variant="outline" className="text-[9px] flex-shrink-0"
               style={{ borderColor: VERDICT_HEX[v.verdict], color: VERDICT_HEX[v.verdict] }}>
          {v.headline ? shortReason(v.headline, units) : VERDICT_LABEL[v.verdict]}
        </Badge>
      </div>
    </li>
  );
}
