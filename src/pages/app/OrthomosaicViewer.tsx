import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "@/integrations/supabase/client";
import { Unzip, UnzipInflate } from "fflate";
import {
  ArrowLeft, ChevronLeft, ChevronRight, Search, Eye, EyeOff,
  Layers, Folder, Image as ImageIcon, Mountain, Ruler, Settings,
  Camera, Maximize2, Plus, Minus, Loader2, MapPin,
} from "lucide-react";

const PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const FN_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;
const TITILER = "https://titiler.xyz";

// Streams the all.zip from a signed URL, pulls out odm_orthophoto.tif WITHOUT
// buffering the full archive in RAM, and PUTs the .tif to a Supabase signed
// upload URL. Designed for the WebODM Lightning case where the edge function
// can't extract the orthomosaic itself within its 256 MB memory cap.
async function extractAndUpload(
  zipUrl: string,
  upload: { path: string; token: string; bucket: string },
  onProgress: (stage: string, pct: number) => void,
): Promise<void> {
  onProgress("Downloading processing archive…", 1);
  const res = await fetch(zipUrl);
  if (!res.ok || !res.body) throw new Error(`zip download failed (${res.status})`);
  const totalHeader = res.headers.get("content-length");
  const total = totalHeader ? Number(totalHeader) : 0;

  const matcher = /odm_orthophoto[\\/]odm_orthophoto\.tif$/i;
  const fallbackMatcher = /(^|[\\/])orthophoto\.tif$/i;

  const tifBytes = await new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let matchedName: string | null = null;
    let done = false;

    const unz = new Unzip((file) => {
      if (done) return;
      const primary = matcher.test(file.name);
      const fallback = !matchedName && fallbackMatcher.test(file.name);
      if (!primary && !fallback) return;
      if (primary) { chunks.length = 0; size = 0; }
      matchedName = file.name;
      file.ondata = (err, chunk, final) => {
        if (done) return;
        if (err) { done = true; reject(err); return; }
        chunks.push(chunk);
        size += chunk.byteLength;
        if (final && file.name === matchedName) {
          done = true;
          const out = new Uint8Array(size);
          let off = 0;
          for (const c of chunks) { out.set(c, off); off += c.byteLength; }
          resolve(out);
        }
      };
      file.start();
    });
    unz.register(UnzipInflate);

    const reader = res.body!.getReader();
    let read = 0;
    (async () => {
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (done) { try { reader.cancel(); } catch { /* noop */ } return; }
          const { value, done: rdone } = await reader.read();
          if (rdone) { unz.push(new Uint8Array(0), true); break; }
          if (value && value.byteLength) {
            read += value.byteLength;
            unz.push(value, false);
            const pct = total ? Math.min(95, (read / total) * 95) : Math.min(95, (read / (50_000_000)) * 95);
            onProgress(matchedName ? "Extracting orthomosaic…" : "Downloading processing archive…", pct);
          }
        }
        if (!done) reject(new Error("orthomosaic file not found in archive"));
      } catch (e) {
        if (!done) { done = true; reject(e as Error); }
      }
    })();
  });

  onProgress("Uploading orthomosaic…", 96);
  const buf = tifBytes.buffer.slice(tifBytes.byteOffset, tifBytes.byteOffset + tifBytes.byteLength) as ArrayBuffer;
  const blob = new Blob([buf], { type: "image/tiff" });
  const { error } = await supabase.storage
    .from(upload.bucket)
    .uploadToSignedUrl(upload.path, upload.token, blob, { contentType: "image/tiff", upsert: true });
  if (error) throw error;
  onProgress("Finalizing…", 100);
}

type TaskRow = { odm_uuid: string | null; field_id: string; created_at: string };
type FieldRow = { name: string };

// --- helpers that run inside the MapContainer ---------------------------------
function FitBounds({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    try { map.fitBounds(bounds as any, { padding: [40, 40] }); } catch { /* noop */ }
  }, [bounds, map]);
  return null;
}

function MouseReadout({ onMove }: { onMove: (lat: number, lng: number, z: number) => void }) {
  const map = useMap();
  useMapEvents({
    mousemove: (e) => onMove(e.latlng.lat, e.latlng.lng, map.getZoom()),
    zoomend: () => onMove(NaN, NaN, map.getZoom()),
  });
  return null;
}

function MapControls({ fitTo }: { fitTo: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  const onFit = () => { if (fitTo) map.fitBounds(fitTo as any, { padding: [40, 40] }); };
  return (
    <div className="absolute bottom-12 right-4 z-[1000] flex flex-col gap-1.5">
      <button onClick={onFit} title="Zoom to fit"
        className="h-9 w-9 grid place-items-center rounded-md bg-neutral-900/90 hover:bg-neutral-800 text-neutral-200 border border-neutral-700">
        <Maximize2 className="h-4 w-4" />
      </button>
      <button onClick={() => map.zoomIn()} title="Zoom in"
        className="h-9 w-9 grid place-items-center rounded-md bg-neutral-900/90 hover:bg-neutral-800 text-neutral-200 border border-neutral-700">
        <Plus className="h-4 w-4" />
      </button>
      <button onClick={() => map.zoomOut()} title="Zoom out"
        className="h-9 w-9 grid place-items-center rounded-md bg-neutral-900/90 hover:bg-neutral-800 text-neutral-200 border border-neutral-700">
        <Minus className="h-4 w-4" />
      </button>
    </div>
  );
}

// --- layer tree ---------------------------------------------------------------
type LayerState = {
  annotations: boolean;
  design: boolean;
  orthomosaic: boolean;
  dsm: boolean;
};

function LayerRow({
  label, icon: Icon, checked, onToggle, indent = 0,
}: { label: string; icon: any; checked: boolean; onToggle: () => void; indent?: number }) {
  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-neutral-800/70 text-sm text-neutral-200 cursor-pointer"
      style={{ paddingLeft: 8 + indent * 14 }}
      onClick={onToggle}
    >
      <input type="checkbox" checked={checked} readOnly
        className="h-3.5 w-3.5 accent-sky-500" />
      <Icon className="h-3.5 w-3.5 text-neutral-400" />
      <span className="flex-1 truncate">{label}</span>
      {checked
        ? <Eye className="h-3.5 w-3.5 text-neutral-400" />
        : <EyeOff className="h-3.5 w-3.5 text-neutral-600" />}
    </div>
  );
}

// -----------------------------------------------------------------------------
export default function OrthomosaicViewer() {
  const { taskId } = useParams<{ taskId: string }>();
  const [task, setTask] = useState<TaskRow | null>(null);
  const [field, setField] = useState<FieldRow | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [bounds, setBounds] = useState<L.LatLngBoundsExpression | null>(null);
  const [maxNative, setMaxNative] = useState<number>(20);
  const [cogUrl, setCogUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<{ status: string; progress: number } | null>(null);
  const [extracting, setExtracting] = useState<{ stage: string; pct: number } | null>(null);

  const [layers, setLayers] = useState<LayerState>({
    annotations: false, design: false, orthomosaic: true, dsm: false,
  });
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [cursor, setCursor] = useState<{ lat: number; lng: number; z: number }>({
    lat: NaN, lng: NaN, z: 2,
  });

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const run = async () => {
      console.log("[OrthoViewer] taskId from route:", taskId);
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) { setErr("Please sign in."); return; }
      setToken(s.session.access_token);

      const { data: t } = await supabase.from("odm_tasks")
        .select("odm_uuid, field_id, created_at").eq("id", taskId).maybeSingle();
      console.log("[OrthoViewer] task row:", t);
      if (!t?.odm_uuid) { setErr("Scan not found"); return; }
      setTask(t as TaskRow);

      const { data: f } = await supabase.from("fields")
        .select("name").eq("id", t.field_id).maybeSingle();
      if (f) setField(f as FieldRow);

      // 1) Mint a signed URL to the orthophoto.tif sitting in Supabase Storage.
      // 2) Hand that URL to TiTiler to get bounds + tiles.
      try {
        const r = await fetch(`${FN_BASE}/ortho-url?task_id=${taskId}`, {
          headers: { Authorization: `Bearer ${s.session.access_token}` },
        });
        const j = await r.json();
        if (cancelled) return;
        if (r.status === 409) {
          // Still processing - show progress and retry in 5s.
          setPending({ status: j?.status ?? "processing", progress: j?.progress ?? 0 });
          setErr(null);
          timer = window.setTimeout(run, 5000);
          return;
        }
        if (r.status === 202 && j?.needsExtract) {
          // Backend can't produce the .tif directly (WebODM Lightning only serves
          // all.zip and extracting that on the edge OOMs). Stream-extract in the
          // browser, push the .tif straight to storage, then retry.
          setPending(null);
          setErr(null);
          try {
            await extractAndUpload(j.zipUrl, j.upload, (stage, pct) => {
              if (!cancelled) setExtracting({ stage, pct });
            });
            if (cancelled) return;
            setExtracting(null);
            timer = window.setTimeout(run, 200);
            return;
          } catch (e: any) {
            console.error("[OrthoViewer] client extraction failed", e);
            setExtracting(null);
            setErr(`Could not extract orthomosaic in browser: ${e?.message ?? e}`);
            return;
          }
        }
        if (!r.ok || !j?.url) {
          setPending(null);
          setErr(j?.error ?? "Orthomosaic not available yet.");
          return;
        }
        setPending(null);
        setCogUrl(j.url);

        // Ask TiTiler for a WebMercator TileJSON. It returns:
        //  - bounds in WGS84 (what Leaflet wants)
        //  - the canonical tile URL template (path differs across TiTiler versions)
        //  - min/max native zoom
        const tjR = await fetch(
          `${TITILER}/cog/WebMercatorQuad/tilejson.json?url=${encodeURIComponent(j.url)}&tilesize=256`,
        );
        const tj = await tjR.json();
        const b: any = tj?.bounds;
        if (Array.isArray(b) && b.length === 4) {
          setBounds([[b[1], b[0]], [b[3], b[2]]] as L.LatLngBoundsExpression);
        }
        if (Array.isArray(tj?.tiles) && tj.tiles[0]) setTileTemplate(tj.tiles[0]);
        if (typeof tj?.maxzoom === "number") setMaxNative(Math.min(22, tj.maxzoom));
      } catch (e) {
        console.error("[OrthoViewer] info failed", e);
        setErr("Could not load orthomosaic metadata.");
      }
    };
    run();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [taskId]);

  const tileUrl = useMemo(() => {
    if (!cogUrl) return null;
    return `${TITILER}/cog/tiles/{z}/{x}/{y}.png?url=${encodeURIComponent(cogUrl)}`;
  }, [cogUrl]);

  if (err) {
    return (
      <div className="h-screen w-screen bg-neutral-950 flex flex-col items-center justify-center gap-3 text-sm text-neutral-200">
        <div className="text-red-400 max-w-md text-center px-6">{err}</div>
        <a href="/app/fields" className="text-sky-400 underline">Back to fields</a>
      </div>
    );
  }
  if (extracting) {
    return (
      <div className="h-screen w-screen bg-neutral-950 flex flex-col items-center justify-center gap-3 text-sm text-neutral-200">
        <Loader2 className="h-5 w-5 animate-spin text-sky-400" />
        <div className="text-neutral-300">{extracting.stage}</div>
        <div className="w-64 h-1.5 bg-neutral-800 rounded overflow-hidden">
          <div className="h-full bg-sky-500 transition-all" style={{ width: `${Math.max(2, Math.min(100, extracting.pct))}%` }} />
        </div>
        <div className="text-xs text-neutral-500">Extracting orthomosaic from the processing archive on this device.</div>
      </div>
    );
  }
  if (pending) {
    return (
      <div className="h-screen w-screen bg-neutral-950 flex flex-col items-center justify-center gap-3 text-sm text-neutral-200">
        <Loader2 className="h-5 w-5 animate-spin text-sky-400" />
        <div className="text-neutral-300">
          {pending.status === "queued" ? "Queued on processing node…" : `Processing… ${pending.progress}%`}
        </div>
        <div className="text-xs text-neutral-500">Checking every 5 seconds. This page will load the map automatically when ready.</div>
        <a href="/app/fields" className="text-sky-400 underline text-xs">Back to fields</a>
      </div>
    );
  }
  if (!task || !token || !tileUrl) {
    return (
      <div className="h-screen w-screen bg-neutral-950 flex items-center justify-center text-sm text-neutral-400 gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading orthomosaic…
      </div>
    );
  }

  const taskName = field?.name ?? "Scan";
  const ts = new Date(task.created_at).toLocaleString();

  return (
    <div className="h-screen w-screen flex flex-col bg-neutral-950 text-neutral-200 overflow-hidden">
      {/* Topbar */}
      <div className="h-10 shrink-0 flex items-center justify-between px-3 border-b border-neutral-800 bg-neutral-900">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => window.history.back()}
            className="inline-flex items-center gap-1 text-xs text-neutral-300 hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <div className="h-4 w-px bg-neutral-700" />
          <div className="text-sm font-medium truncate">{taskName}</div>
          <div className="text-xs text-neutral-500">{ts}</div>
        </div>
        <div className="h-7 w-12 rounded-sm bg-gradient-to-br from-emerald-700 to-emerald-900 border border-neutral-700"
             title="Field thumbnail" />
        <div className="text-xs text-neutral-500 font-mono">{task.odm_uuid?.slice(0, 8)}</div>
      </div>

      {/* Main row */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Left sidebar */}
        {sidebarOpen && (
          <aside className="w-[280px] shrink-0 border-r border-neutral-800 bg-neutral-900 flex flex-col">
            <div className="px-3 py-2.5 border-b border-neutral-800 flex items-center gap-2">
              <Layers className="h-4 w-4 text-neutral-400" />
              <div className="text-sm font-medium">Layers</div>
            </div>
            <div className="p-2 border-b border-neutral-800">
              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500" />
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search layers"
                  className="w-full bg-neutral-950 border border-neutral-800 text-xs rounded pl-7 pr-2 py-1.5 focus:outline-none focus:border-sky-600"
                />
              </div>
            </div>
            <div className="p-1.5 overflow-auto flex-1 text-sm">
              <LayerRow label="Annotations" icon={MapPin}
                checked={layers.annotations}
                onToggle={() => setLayers(s => ({ ...s, annotations: !s.annotations }))} />
              <LayerRow label="Design overlays" icon={Folder}
                checked={layers.design}
                onToggle={() => setLayers(s => ({ ...s, design: !s.design }))} />
              <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-neutral-500">Outputs</div>
              <LayerRow label="Orthomosaic" icon={ImageIcon} indent={1}
                checked={layers.orthomosaic}
                onToggle={() => setLayers(s => ({ ...s, orthomosaic: !s.orthomosaic }))} />
              <LayerRow label="DSM" icon={Mountain} indent={1}
                checked={layers.dsm}
                onToggle={() => setLayers(s => ({ ...s, dsm: !s.dsm }))} />
            </div>
          </aside>
        )}

        {/* Sidebar collapse arrow */}
        <button
          onClick={() => setSidebarOpen(o => !o)}
          className="absolute top-3 z-[1000] h-8 w-5 grid place-items-center bg-neutral-900 border border-neutral-700 rounded-r text-neutral-300 hover:bg-neutral-800"
          style={{ left: sidebarOpen ? 280 : 0 }}
          title={sidebarOpen ? "Hide layers" : "Show layers"}
        >
          {sidebarOpen ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>

        {/* Map */}
        <div className="flex-1 relative bg-neutral-950">
          <MapContainer
            center={[0, 0]}
            zoom={2}
            minZoom={2}
              maxZoom={22}
            preferCanvas
            zoomControl={false}
            attributionControl={false}
            style={{ height: "100%", width: "100%", background: "#0a0a0a" }}
          >
            {layers.orthomosaic && tileUrl && (
              <TileLayer
                url={tileUrl}
                opacity={1.0}
                maxNativeZoom={Math.min(20, maxNative)}
                maxZoom={22}
                tileSize={256}
                keepBuffer={1}
                updateWhenIdle
                updateWhenZooming={false}
              />
            )}
            {/* OSM basemap underneath */}
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={19}
              zIndex={0}
            />
            <FitBounds bounds={bounds} />
            <MouseReadout onMove={(lat, lng, z) => setCursor({ lat, lng, z })} />
            <MapControls fitTo={bounds} />
          </MapContainer>

          {/* Bottom toolbar (left side) */}
          <div className="absolute bottom-12 left-4 z-[1000] flex gap-1.5">
            <button title="Measure"
              onClick={() => setRightOpen(true)}
              className="h-9 w-9 grid place-items-center rounded-md bg-neutral-900/90 hover:bg-neutral-800 text-neutral-200 border border-neutral-700">
              <Ruler className="h-4 w-4" />
            </button>
            <button title="Screenshot"
              className="h-9 w-9 grid place-items-center rounded-md bg-neutral-900/90 hover:bg-neutral-800 text-neutral-200 border border-neutral-700">
              <Camera className="h-4 w-4" />
            </button>
            <button title="Settings"
              className="h-9 w-9 grid place-items-center rounded-md bg-neutral-900/90 hover:bg-neutral-800 text-neutral-200 border border-neutral-700">
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Right panel */}
        {rightOpen && (
          <aside className="w-[260px] shrink-0 border-l border-neutral-800 bg-neutral-900 flex flex-col">
            <div className="px-3 py-2.5 border-b border-neutral-800 flex items-center justify-between">
              <div className="text-sm font-medium">Polygon</div>
              <button onClick={() => setRightOpen(false)}
                className="text-neutral-500 hover:text-neutral-200 text-xs">✕</button>
            </div>
            <div className="p-3 space-y-3 text-xs overflow-auto">
              <Field label="Name"><input className="rp-input" defaultValue="Untitled zone" /></Field>
              <Field label="Description"><textarea rows={2} className="rp-input resize-none" /></Field>
              <Field label="Tags"><input className="rp-input" placeholder="add tags…" /></Field>
              <Field label="Color">
                <input type="color" defaultValue="#22c55e" className="h-7 w-12 bg-transparent border border-neutral-700 rounded" />
              </Field>
              <div className="pt-2 mt-2 border-t border-neutral-800">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Measurements</div>
                <Stat label="2D area" value="—" />
                <Stat label="Area" value="—" />
                <Stat label="2D perimeter" value="—" />
                <Stat label="Perimeter" value="—" />
                <Stat label="Min elevation" value="—" />
                <Stat label="Max elevation" value="—" />
                <Stat label="Elevation difference" value="—" />
              </div>
            </div>
          </aside>
        )}
        {!rightOpen && (
          <button
            onClick={() => setRightOpen(true)}
            className="absolute top-3 right-0 z-[1000] h-8 w-5 grid place-items-center bg-neutral-900 border border-neutral-700 rounded-l text-neutral-300 hover:bg-neutral-800"
            title="Show details"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Bottom status bar */}
      <div className="h-7 shrink-0 px-3 flex items-center justify-between text-[11px] text-neutral-400 border-t border-neutral-800 bg-neutral-900">
        <div className="font-mono">
          {Number.isFinite(cursor.lat)
            ? `${cursor.lat.toFixed(6)}, ${cursor.lng.toFixed(6)}`
            : "—, —"}
        </div>
        <div className="font-mono">Zoom {Math.round(cursor.z)}</div>
        <div className="truncate">Orthomosaic tiles via OpenDroneMap</div>
      </div>

      {/* tiny inline styles for the right panel inputs */}
      <style>{`
        .rp-input {
          width: 100%;
          background: #0a0a0a;
          border: 1px solid #262626;
          color: #e5e5e5;
          font-size: 12px;
          padding: 5px 7px;
          border-radius: 4px;
        }
        .rp-input:focus { outline: none; border-color: #0284c7; }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">{label}</div>
      {children}
    </label>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-neutral-800/60 last:border-0">
      <span className="text-neutral-400">{label}</span>
      <span className="text-neutral-200 font-mono">{value}</span>
    </div>
  );
}