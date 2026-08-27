import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { Button } from "@/components/ui/button";
import { Play, Pause, RotateCcw } from "lucide-react";
import { advance, atEnd, crossfade, layerOpacities } from "@/lib/timelapse";

const PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const TILE_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1/tile`;

export type TimelapseScan = { id: string; odm_uuid: string | null; created_at: string };
type Ring = { lat: number; lng: number }[];

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

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

/**
 * Scrub or play across every completed scan of a field, crossfading the
 * pre-baked tile layers into each other.
 *
 * Read-only: it queries nothing and writes nothing. The scans arrive already
 * filtered and sorted, and the tiles are the same ones the Field view serves,
 * fetched through the same `?token=` path - so there is no new surface to
 * secure here.
 *
 * Every scan's layer is mounted once and left in place; scrubbing only changes
 * opacities. Fine at the scan counts this product actually has.
 */
export default function Timelapse({
  scans,
  boundary,
  token,
}: {
  scans: TimelapseScan[];
  boundary: Ring[] | null;
  token: string | null;
}) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const layersRef = useRef<L.TileLayer[]>([]);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2>(1);

  const count = scans.length;
  const pair = useMemo(() => crossfade(position, count), [position, count]);

  // Build the map and one tile layer per scan.
  useEffect(() => {
    if (!mapEl.current || !token || count < 2) return;
    const map = L.map(mapEl.current, { zoomControl: true, attributionControl: false });

    const layers = scans.map((scan, i) => {
      const layer = L.tileLayer(
        `${TILE_BASE}/${scan.odm_uuid}/{z}/{x}/{y}.png?token=${token}`,
        { maxZoom: 22, opacity: 0, zIndex: 200 + i },
      );
      layer.addTo(map);
      return layer;
    });
    layersRef.current = layers;

    // Framed on the field boundary, so every scan plays within one steady
    // view. Without a boundary there is nothing to frame — the old fallback
    // (world view over the Atlantic) rendered a permanent black box with
    // working-looking controls; that case now renders a message instead
    // (see the boundary check in the render below), so this branch only
    // runs when a frame exists.
    const b = boundsFromRings(boundary);
    if (b) map.fitBounds(b, { padding: [20, 20] });

    return () => {
      layersRef.current = [];
      map.remove();
    };
  }, [scans, boundary, token, count]);

  // Apply the crossfade whenever the playhead moves.
  useEffect(() => {
    const opacities = layerOpacities(position, count);
    layersRef.current.forEach((layer, i) => layer.setOpacity(opacities[i] ?? 0));
  }, [position, count]);

  // Playback. Driven off timestamps rather than a fixed per-frame step so the
  // pace is the same on a 60Hz and a 120Hz display.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const elapsed = now - last;
      last = now;
      setPosition((p) => {
        const next = advance(p, count, elapsed, speed);
        if (atEnd(next, count)) setPlaying(false);
        return next;
      });
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, count]);

  if (count < 2) return null;

  // No boundary = nothing to frame the map on. Say so instead of showing a
  // black box centred on the open ocean.
  if (!boundsFromRings(boundary)) {
    return (
      <div className="rounded-sm border border-[#1f1f1f] bg-[#141414] p-3 text-[11px] text-neutral-500">
        The timelapse needs a saved field boundary to frame the map. Draw one in
        Field View and it will appear here.
      </div>
    );
  }

  const finished = atEnd(position, count);

  const togglePlay = () => {
    // Pressing play at the end replays from the start rather than doing nothing.
    if (!playing && finished) setPosition(0);
    setPlaying((p) => !p);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-neutral-500">Timelapse</div>
          <p className="mt-1 text-xs text-neutral-500">
            Every completed scan of this field, oldest to newest.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={togglePlay}
            aria-label={playing ? "Pause timelapse" : finished ? "Replay timelapse" : "Play timelapse"}
          >
            {playing
              ? <><Pause className="h-3 w-3" /> Pause</>
              : finished
                ? <><RotateCcw className="h-3 w-3" /> Replay</>
                : <><Play className="h-3 w-3" /> Play</>}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-10 text-[11px]"
            onClick={() => setSpeed((s) => (s === 1 ? 2 : 1))}
            aria-label={`Playback speed ${speed}x`}
          >
            {speed}x
          </Button>
        </div>
      </div>

      <div className="relative h-[420px] overflow-hidden rounded border border-[#1f1f1f] bg-[#0a0a0a]">
        <div ref={mapEl} className="absolute inset-0" />
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[10px] uppercase tracking-wider text-neutral-300">
          {longDate(scans[pair.lower].created_at)}
          {pair.upper !== pair.lower && pair.upperOpacity > 0 && (
            <span className="text-neutral-500"> → {longDate(scans[pair.upper].created_at)}</span>
          )}
        </div>
        <div className="pointer-events-none absolute right-2 top-2 rounded bg-black/70 px-2 py-1 text-[10px] uppercase tracking-wider text-neutral-400">
          Scan {pair.lower + 1} of {count}
        </div>
      </div>

      <div>
        <input
          type="range"
          min={0}
          max={count - 1}
          step={0.01}
          value={position}
          onChange={(e) => { setPlaying(false); setPosition(parseFloat(e.target.value)); }}
          aria-label="Scan timeline"
          aria-valuetext={longDate(scans[pair.lower].created_at)}
          className="w-full accent-cyan-500"
        />
        <div className="mt-1 flex justify-between text-[10px] text-neutral-500">
          {scans.map((scan, i) => (
            <span key={scan.id} className={i === pair.lower ? "text-neutral-200" : undefined}>
              {shortDate(scan.created_at)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
