import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Cloud, CloudRain, MapPin, Loader2, Trash2, Play, Pause, Sun, CloudSnow, CloudLightning, CloudDrizzle, Wind, Thermometer, Droplets } from "lucide-react";
import { toast } from "sonner";

type Farm = { id: string; name: string; address: string; lat: number; lng: number };
type Suggestion = { id: number; name: string; admin1?: string; country?: string; latitude: number; longitude: number };

type DailyForecast = {
  date: string;
  tMax: number; tMin: number;
  precip: number; precipProb: number;
  wind: number; code: number;
};
type CurrentForecast = {
  temp: number; apparent: number; wind: number; humidity: number; code: number;
};
type Forecast = { current: CurrentForecast; daily: DailyForecast[]; units: { temp: string; wind: string; precip: string } };

const WMO: Record<number, { label: string; Icon: any }> = {
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

const STORAGE_KEY = "acrespray.farms";

// Fix default marker icons (Leaflet + bundlers)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const farmIcon = L.divIcon({
  className: "",
  html: `<div style="background:#16a34a;width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;"><span style="transform:rotate(45deg);color:white;font-size:11px;">🌾</span></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 22],
});

export default function Weather() {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const radarLayerRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const [farms, setFarms] = useState<Farm[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); } catch { return []; }
  });
  const [form, setForm] = useState({ name: "", address: "" });
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [frames, setFrames] = useState<{ time: number; path: string }[]>([]);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [host, setHost] = useState<string>("");
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);

  // Init map
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
        const all = [...past, ...nowcast];
        setFrames(all);
        setFrameIdx(past.length - 1);
      })
      .catch(() => toast.error("Could not load weather radar feed"));
  }, []);

  // Render current radar frame
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !frames.length || !host) return;
    const frame = frames[frameIdx];
    if (!frame) return;
    const url = `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
    const layer = L.tileLayer(url, { opacity: 0.65, attribution: "Radar &copy; RainViewer" });
    layer.addTo(map);
    if (radarLayerRef.current) map.removeLayer(radarLayerRef.current);
    radarLayerRef.current = layer;
  }, [frames, frameIdx, host]);

  // Play animation
  useEffect(() => {
    if (!playing || !frames.length) return;
    const id = setInterval(() => setFrameIdx(i => (i + 1) % frames.length), 700);
    return () => clearInterval(id);
  }, [playing, frames.length]);

  // Sync farm markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const currentIds = new Set(farms.map(f => f.id));
    // remove gone
    markersRef.current.forEach((m, id) => {
      if (!currentIds.has(id)) { map.removeLayer(m); markersRef.current.delete(id); }
    });
    // add new
    farms.forEach(f => {
      if (markersRef.current.has(f.id)) return;
      const m = L.marker([f.lat, f.lng], { icon: farmIcon })
        .addTo(map)
        .bindPopup(`<strong>${f.name}</strong><br/><span style="font-size:11px;color:#666;">${f.address}</span>`);
      markersRef.current.set(f.id, m);
    });
  }, [farms]);

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
        const url = `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(form.address)}`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Geocoding ${r.status}`);
        const j = await r.json();
        hit = j?.results?.[0] ?? null;
      }
      if (!hit) {
        toast.error("Address not found — try a city, ZIP, or more specific location");
        return;
      }
      const parts = [hit.name, hit.admin1, hit.country].filter(Boolean).join(", ");
      const farm: Farm = {
        id: crypto.randomUUID(),
        name: form.name.trim(),
        address: parts,
        lat: Number(hit.latitude),
        lng: Number(hit.longitude),
      };
      persist([...farms, farm]);
      mapRef.current?.flyTo([farm.lat, farm.lng], 10, { duration: 1.2 });
      setForm({ name: "", address: "" });
      setPicked(null);
      setSuggestions([]);
      setShowSuggest(false);
      setSelectedFarmId(farm.id);
      toast.success(`${farm.name} pinned`);
    } catch (err: any) {
      toast.error(err?.message ?? "Geocoding failed");
    } finally {
      setSearching(false);
    }
  };

  const removeFarm = (id: string) => {
    persist(farms.filter(f => f.id !== id));
    if (selectedFarmId === id) { setSelectedFarmId(null); setForecast(null); }
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
          { signal: ctrl.signal }
        );
        if (!r.ok) return;
        const j = await r.json();
        setSuggestions(j?.results ?? []);
        setShowSuggest(true);
      } catch {}
    }, 250);
    return () => { clearTimeout(id); ctrl.abort(); };
  }, [form.address, picked]);

  const goTo = (f: Farm) => {
    mapRef.current?.flyTo([f.lat, f.lng], 11, { duration: 1.2 });
    markersRef.current.get(f.id)?.openPopup();
    setSelectedFarmId(f.id);
  };

  // Auto-select first farm
  useEffect(() => {
    if (!selectedFarmId && farms.length) setSelectedFarmId(farms[0].id);
  }, [farms, selectedFarmId]);

  // Fetch forecast when selected farm changes
  useEffect(() => {
    const f = farms.find(x => x.id === selectedFarmId);
    if (!f) { setForecast(null); return; }
    let aborted = false;
    setForecastLoading(true);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${f.lat}&longitude=${f.lng}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=7`;
    fetch(url)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`Forecast ${r.status}`)))
      .then(j => {
        if (aborted) return;
        const daily: DailyForecast[] = (j.daily?.time ?? []).map((t: string, i: number) => ({
          date: t,
          tMax: j.daily.temperature_2m_max[i],
          tMin: j.daily.temperature_2m_min[i],
          precip: j.daily.precipitation_sum[i],
          precipProb: j.daily.precipitation_probability_max?.[i] ?? 0,
          wind: j.daily.wind_speed_10m_max[i],
          code: j.daily.weather_code[i],
        }));
        setForecast({
          current: {
            temp: j.current.temperature_2m,
            apparent: j.current.apparent_temperature,
            wind: j.current.wind_speed_10m,
            humidity: j.current.relative_humidity_2m,
            code: j.current.weather_code,
          },
          daily,
          units: { temp: "°F", wind: "mph", precip: "in" },
        });
      })
      .catch(e => { if (!aborted) toast.error(e.message ?? "Forecast failed"); })
      .finally(() => { if (!aborted) setForecastLoading(false); });
    return () => { aborted = true; };
  }, [selectedFarmId, farms]);

  const currentFrame = frames[frameIdx];
  const frameLabel = currentFrame
    ? new Date(currentFrame.time * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
  const isNowcast = !!currentFrame && currentFrame.time * 1000 > Date.now();
  const selectedFarm = farms.find(f => f.id === selectedFarmId) ?? null;
  const dayLabel = (s: string) => new Date(s + "T00:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

  return (
    <div className="p-8 space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl flex items-center gap-2">
            <CloudRain className="h-7 w-7" /> Weather Radar
          </h1>
          <p className="text-muted-foreground">Live precipitation radar across the continental US. Pin your farms by address to track storms over your fields.</p>
        </div>
      </header>

      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6">
        <Card className="overflow-hidden">
          <div ref={containerRef} style={{ height: 520 }} className="w-full bg-muted" />
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
              className="flex-1 min-w-[160px]"
            />
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="font-display flex items-center gap-2 mb-3"><MapPin className="h-4 w-4" /> Pin a farm</h3>
            <form onSubmit={addFarm} className="space-y-3">
              <div>
                <Label>Farm name</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="North Quadrant" />
              </div>
              <div>
                <Label>Address or location</Label>
                <Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="e.g. 1200 N Main St, Lincoln, NE" />
              </div>
              <Button type="submit" className="w-full" disabled={searching}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                {searching ? "Locating…" : "Pin to radar"}
              </Button>
            </form>
            <p className="text-[11px] text-muted-foreground mt-3">
              Address lookup via Open-Meteo geocoding. Pinned farms are saved on this device.
            </p>
          </Card>

          <Card className="p-5">
            <h3 className="font-display flex items-center gap-2 mb-3"><Cloud className="h-4 w-4" /> Your pinned farms</h3>
            {farms.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">No farms pinned yet — add one above.</div>
            ) : (
              <ul className="space-y-2">
                {farms.map(f => (
                  <li key={f.id} className={`flex items-start gap-2 border rounded p-2 hover:bg-muted/40 ${selectedFarmId === f.id ? "border-primary bg-primary/5" : ""}`}>
                    <button className="flex-1 text-left min-w-0" onClick={() => goTo(f)}>
                      <div className="font-medium text-sm truncate">{f.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{f.address}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">{f.lat.toFixed(4)}°, {f.lng.toFixed(4)}°</div>
                    </button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 flex-shrink-0" onClick={() => removeFarm(f.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {selectedFarm && (
            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display flex items-center gap-2">
                  <CloudRain className="h-4 w-4" /> Upcoming conditions
                </h3>
                <Badge variant="outline" className="text-[10px]">{selectedFarm.name}</Badge>
              </div>
              {forecastLoading && !forecast && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading forecast…
                </div>
              )}
              {forecast && (
                <>
                  {(() => {
                    const c = forecast.current; const w = wmo(c.code);
                    return (
                      <div className="flex items-center gap-3 border rounded-lg p-3 bg-muted/30">
                        <w.Icon className="h-10 w-10 text-primary flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-display text-2xl leading-none">{Math.round(c.temp)}{forecast.units.temp}</div>
                          <div className="text-xs text-muted-foreground">{w.label} · feels {Math.round(c.apparent)}{forecast.units.temp}</div>
                        </div>
                        <div className="text-right text-[11px] text-muted-foreground space-y-0.5">
                          <div className="flex items-center gap-1 justify-end"><Wind className="h-3 w-3" /> {Math.round(c.wind)} {forecast.units.wind}</div>
                          <div className="flex items-center gap-1 justify-end"><Droplets className="h-3 w-3" /> {c.humidity}%</div>
                        </div>
                      </div>
                    );
                  })()}
                  <div className="space-y-1.5">
                    {forecast.daily.slice(0, 7).map((d) => {
                      const w = wmo(d.code);
                      const sprayOk = d.precipProb < 30 && d.wind < 12 && d.precip < 0.05;
                      return (
                        <div key={d.date} className="flex items-center gap-2 text-xs border rounded px-2 py-1.5">
                          <div className="w-20 text-muted-foreground">{dayLabel(d.date)}</div>
                          <w.Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <div className="flex-1 truncate">{w.label}</div>
                          <div className="flex items-center gap-0.5 w-14 justify-end text-sky-600"><Droplets className="h-3 w-3" /> {d.precipProb}%</div>
                          <div className="w-20 text-right font-mono">
                            <span className="font-semibold">{Math.round(d.tMax)}°</span>
                            <span className="text-muted-foreground"> / {Math.round(d.tMin)}°</span>
                          </div>
                          <Badge variant="outline" className={`text-[9px] ${sprayOk ? "border-emerald-500 text-emerald-600" : "border-amber-500 text-amber-600"}`}>
                            {sprayOk ? "Spray OK" : "Hold"}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Thermometer className="h-3 w-3" /> Forecast via Open-Meteo · spray window assumes &lt;30% precip, wind &lt;12 mph.
                  </p>
                </>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}