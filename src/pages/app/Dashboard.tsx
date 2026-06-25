import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Cloud, CloudRain, Sun, CloudSnow, CloudFog, MapPin, ArrowUpRight } from "lucide-react";

type Field = { id: string; name: string; area_hectares: number | null };
type Scan = { id: string; field_id: string; created_at: string; health_score: number | null };

const HA_TO_AC = 2.4710538147;

function healthTone(score: number | null) {
  if (score == null) return { dot: "bg-muted-foreground/40", text: "text-muted-foreground", label: "—" };
  if (score >= 70) return { dot: "bg-emerald-500", text: "text-emerald-500", label: `${score}` };
  if (score >= 40) return { dot: "bg-amber-500", text: "text-amber-500", label: `${score}` };
  return { dot: "bg-red-500", text: "text-red-500", label: `${score}` };
}

function formatWhen(iso: string | null) {
  if (!iso) return "Never";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 86400000;
  if (diff < 1) return "Today";
  if (diff < 2) return "Yesterday";
  if (diff < 7) return `${Math.floor(diff)}d ago`;
  return d.toLocaleDateString();
}

// --- Weather widget (Open-Meteo, no API key required) -----------------------
type Weather = {
  temp: number;
  feels: number;
  code: number;
  wind: number;
  city: string;
};

const WMO_LABEL: Record<number, string> = {
  0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow",
  80: "Showers", 81: "Showers", 82: "Heavy showers",
  95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm",
};

function WeatherIcon({ code, className }: { code: number; className?: string }) {
  if (code === 0 || code === 1) return <Sun className={className} />;
  if (code >= 71 && code <= 77) return <CloudSnow className={className} />;
  if (code === 45 || code === 48) return <CloudFog className={className} />;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return <CloudRain className={className} />;
  return <Cloud className={className} />;
}

function useWeather() {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) { setError("Location unavailable"); return; }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const { latitude, longitude } = pos.coords;
        const r = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
          `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m`
        );
        const j = await r.json();
        // Reverse-geocode for city label
        let city = "Your area";
        try {
          const g = await fetch(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${latitude}&longitude=${longitude}&count=1`);
          const gj = await g.json();
          city = gj?.results?.[0]?.name ?? city;
        } catch { /* ignore */ }
        setWeather({
          temp: j.current.temperature_2m,
          feels: j.current.apparent_temperature,
          code: j.current.weather_code,
          wind: j.current.wind_speed_10m,
          city,
        });
      } catch (e: any) {
        setError(e?.message ?? "Weather unavailable");
      }
    }, () => setError("Location denied"));
  }, []);

  return { weather, error };
}

// ----------------------------------------------------------------------------
export default function Dashboard() {
  const [fields, setFields] = useState<Field[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [f, s] = await Promise.all([
        supabase.from("fields").select("id, name, area_hectares"),
        supabase.from("scans").select("id, field_id, created_at, health_score").order("created_at", { ascending: false }),
      ]);
      setFields((f.data as Field[]) ?? []);
      setScans((s.data as Scan[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const { weather, error: weatherError } = useWeather();

  const perField = useMemo(() => {
    const map = new Map<string, { latest: Scan | null; latestHealth: Scan | null }>();
    for (const f of fields) map.set(f.id, { latest: null, latestHealth: null });
    for (const sc of scans) {
      const entry = map.get(sc.field_id);
      if (!entry) continue;
      if (!entry.latest) entry.latest = sc;
      if (!entry.latestHealth && typeof sc.health_score === "number") entry.latestHealth = sc;
    }
    return map;
  }, [fields, scans]);

  const scannedFieldIds = useMemo(() => new Set(scans.map(s => s.field_id)), [scans]);
  const totalAreaHa = useMemo(
    () => fields.filter(f => scannedFieldIds.has(f.id)).reduce((a, f) => a + Number(f.area_hectares || 0), 0),
    [fields, scannedFieldIds],
  );

  const avgHealth = useMemo(() => {
    const scores: number[] = [];
    for (const [, v] of perField) if (v.latestHealth?.health_score != null) scores.push(v.latestHealth.health_score);
    if (scores.length === 0) return null;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }, [perField]);

  const lastScanDate = scans[0]?.created_at ?? null;
  const avgTone = healthTone(avgHealth);

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Operations Dashboard</h1>
          <p className="text-muted-foreground text-sm">A snapshot of your fields, scans, and field weather.</p>
        </div>
      </header>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Total fields</div>
          <div className="font-display text-4xl mt-1 tabular-nums">{fields.length}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {scannedFieldIds.size} scanned · {fields.length - scannedFieldIds.size} pending
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Area scanned</div>
          <div className="font-display text-4xl mt-1 tabular-nums">{totalAreaHa.toFixed(1)}<span className="text-base text-muted-foreground ml-1">ha</span></div>
          <div className="text-xs text-muted-foreground mt-1 tabular-nums">{(totalAreaHa * HA_TO_AC).toFixed(1)} acres</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Avg health score</div>
          <div className="flex items-end gap-2 mt-1">
            <div className={`font-display text-4xl tabular-nums ${avgTone.text}`}>{avgHealth ?? "—"}</div>
            {avgHealth != null && <div className="text-base text-muted-foreground mb-1.5">/ 100</div>}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Across {Math.max(0, [...perField.values()].filter(v => v.latestHealth).length)} scored fields</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Last scan</div>
          <div className="font-display text-4xl mt-1">{formatWhen(lastScanDate)}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {lastScanDate ? new Date(lastScanDate).toLocaleString() : "No scans yet"}
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Field list */}
        <Card className="p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg">Fields</h2>
            <Link to="/app/fields" className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:text-foreground">
              Manage <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">No fields yet. <Link to="/app/fields" className="underline">Create your first field</Link>.</p>
          ) : (
            <ul className="divide-y divide-border">
              {fields.map(f => {
                const info = perField.get(f.id);
                const score = info?.latestHealth?.health_score ?? null;
                const tone = healthTone(score);
                return (
                  <li key={f.id}>
                    <Link to={`/app/fields/${f.id}`} className="flex items-center gap-3 py-3 hover:bg-muted/30 rounded-md px-2 -mx-2 transition-colors">
                      <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-sm">{f.name}</div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {f.area_hectares ? `${Number(f.area_hectares).toFixed(1)} ha` : "—"}
                        </div>
                      </div>
                      <Badge variant="outline" className={`tabular-nums ${tone.text}`}>
                        {score != null ? `${score}/100` : "No scan"}
                      </Badge>
                      <div className="text-xs text-muted-foreground w-20 text-right">
                        {formatWhen(info?.latest?.created_at ?? null)}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Weather widget */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg">Weather</h2>
            {weather && (
              <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {weather.city}
              </div>
            )}
          </div>
          {weatherError && <p className="text-sm text-muted-foreground">{weatherError}</p>}
          {!weather && !weatherError && <p className="text-sm text-muted-foreground">Detecting your location…</p>}
          {weather && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <WeatherIcon code={weather.code} className="h-12 w-12 text-primary" />
                <div>
                  <div className="font-display text-5xl tabular-nums">{Math.round(weather.temp)}°</div>
                  <div className="text-xs text-muted-foreground">{WMO_LABEL[weather.code] ?? "—"}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md border border-border/60 px-3 py-2">
                  <div className="text-muted-foreground">Feels like</div>
                  <div className="font-mono tabular-nums">{Math.round(weather.feels)}°C</div>
                </div>
                <div className="rounded-md border border-border/60 px-3 py-2">
                  <div className="text-muted-foreground">Wind</div>
                  <div className="font-mono tabular-nums">{Math.round(weather.wind)} km/h</div>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}