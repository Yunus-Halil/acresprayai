import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Cloud, CloudRain, MapPin, Loader2, Trash2, Play, Pause } from "lucide-react";
import { toast } from "sonner";

type Farm = { id: string; name: string; address: string; lat: number; lng: number };

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
  const [frames, setFrames] = useState<{ time: number; path: string }[]>([]);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [host, setHost] = useState<string>("");

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
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(form.address)}`;
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      const j = await r.json();
      if (!Array.isArray(j) || !j.length) {
        toast.error("Address not found — try a more specific location");
        return;
      }
      const farm: Farm = {
        id: crypto.randomUUID(),
        name: form.name.trim(),
        address: j[0].display_name,
        lat: parseFloat(j[0].lat),
        lng: parseFloat(j[0].lon),
      };
      persist([...farms, farm]);
      mapRef.current?.flyTo([farm.lat, farm.lng], 10, { duration: 1.2 });
      setForm({ name: "", address: "" });
      toast.success(`${farm.name} pinned`);
    } catch (err: any) {
      toast.error("Geocoding failed");
    } finally {
      setSearching(false);
    }
  };

  const removeFarm = (id: string) => {
    persist(farms.filter(f => f.id !== id));
  };

  const goTo = (f: Farm) => {
    mapRef.current?.flyTo([f.lat, f.lng], 11, { duration: 1.2 });
    markersRef.current.get(f.id)?.openPopup();
  };

  const currentFrame = frames[frameIdx];
  const frameLabel = currentFrame
    ? new Date(currentFrame.time * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
  const isNowcast = currentFrame && frameIdx >= frames.findIndex(f => f.time === currentFrame.time && frames.indexOf(f) === frameIdx) && currentFrame.time * 1000 > Date.now();

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
              Address lookup via OpenStreetMap Nominatim. Pinned farms are saved on this device.
            </p>
          </Card>

          <Card className="p-5">
            <h3 className="font-display flex items-center gap-2 mb-3"><Cloud className="h-4 w-4" /> Your pinned farms</h3>
            {farms.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">No farms pinned yet — add one above.</div>
            ) : (
              <ul className="space-y-2">
                {farms.map(f => (
                  <li key={f.id} className="flex items-start gap-2 border rounded p-2 hover:bg-muted/40">
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
        </div>
      </div>
    </div>
  );
}