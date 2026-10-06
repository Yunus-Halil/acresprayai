// Photo Scout: the planting pattern in a single drone photo, no orthomosaic.
//
// Developer mode only. Drop one or more photos; each is decoded, read for
// its EXIF, and run through lib/photoScout/pattern in this browser. The
// photo never leaves the machine: no upload, no ODM, no map, nothing saved.
// What it shows is the rows the fit found, the blobs on them, and the blobs
// at no expected place, so the engine can be judged on real photos before
// the same pass runs per source frame of a scan.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Camera, Loader2, Upload } from "lucide-react";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { fmtAreaCm2, fmtLengthCm } from "@/lib/units";
import { type DecodedPhoto, decodePhoto } from "@/lib/photoScout/decode";
import { EMPTY_EXIF, type GsdEstimate, type PhotoExif, estimateGsd, readPhotoExif } from "@/lib/photoScout/exif";
import { type BlobClass, DEFAULT_MIN_BLOB_AREA_CM2, type PhotoPattern, analysePhoto, rowSegmentsPx } from "@/lib/photoScout/pattern";
import { DEFAULT_ROW_WINDOW_M } from "@/lib/weedScout/rows";

type Status = "new" | "decoding" | "running" | "done" | "error";

type Photo = {
  id: string;
  name: string;
  file: File;
  exif: PhotoExif | null;
  decoded: DecodedPhoto | null;
  pattern: PhotoPattern | null;
  status: Status;
  progress: { done: number; total: number } | null;
  error: string | null;
  /** Pixel size the last run used, decoded pixels, and where it came from. */
  used: { gsdM: number; basis: string } | null;
};

const CLASS_COLOUR: Record<BlobClass, string> = {
  "on pattern": "#4CAF50",
  "double": "#26C6DA",
  "between plants": "#FFA726",
  "off-row": "#EF5350",
  "unplaced": "#9E9E9E",
};
const CLASS_ORDER: BlobClass[] = ["on pattern", "double", "between plants", "off-row", "unplaced"];

const ROW_SPACINGS: { label: string; cm: number }[] = [
  { label: "30 in (76 cm)", cm: 76.2 },
  { label: "36 in (91 cm)", cm: 91.44 },
  { label: "38 in (97 cm)", cm: 96.52 },
  { label: "40 in (102 cm)", cm: 101.6 },
  { label: "20 in (51 cm)", cm: 50.8 },
  { label: "15 in (38 cm)", cm: 38.1 },
];

const input = "bg-[#0f0f0f] border border-[#333] rounded-sm px-2 py-1 text-xs text-neutral-200 w-full";
const btn = "inline-flex items-center gap-1.5 text-xs border border-[#333] text-neutral-300 hover:bg-[#1f1f1f] disabled:opacity-40 rounded-sm px-3 py-1.5";

let nextId = 0;

export default function PhotoScout() {
  const units = useUnitSystem();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rowSpacingCm, setRowSpacingCm] = useState("76.2");
  const [heightM, setHeightM] = useState("");
  const [gsdCm, setGsdCm] = useState("");
  const [minBlobCm2, setMinBlobCm2] = useState(String(DEFAULT_MIN_BLOB_AREA_CM2));
  const [windowM, setWindowM] = useState(String(DEFAULT_ROW_WINDOW_M));
  const [show, setShow] = useState({ rows: true, blobs: true, windows: true });
  const selected = photos.find(p => p.id === selectedId) ?? null;

  const patch = useCallback((id: string, next: Partial<Photo>) => {
    setPhotos(ps => ps.map(p => (p.id === id ? { ...p, ...next } : p)));
  }, []);

  const add = async (files: FileList | File[]) => {
    const list = Array.from(files).filter(f => /\.(jpe?g)$/i.test(f.name) || f.type === "image/jpeg");
    if (!list.length) return;
    const fresh: Photo[] = list.map(file => ({
      id: `p${nextId++}`, name: file.name, file, exif: null, decoded: null, pattern: null, status: "new", progress: null, error: null, used: null,
    }));
    setPhotos(ps => [...ps, ...fresh]);
    setSelectedId(s => s ?? fresh[0].id);
    for (const p of fresh) {
      const exif = await readPhotoExif(p.file);
      patch(p.id, { exif });
    }
  };

  /** Pixel size for THIS photo's decoded pixels, from the typed size, the typed height, or the file. */
  const gsdFor = useCallback((p: Photo, decoded: DecodedPhoto): { gsdM: number | null; basis: string } => {
    const typedGsd = Number(gsdCm);
    if (gsdCm.trim() && Number.isFinite(typedGsd) && typedGsd > 0) {
      return { gsdM: (typedGsd / 100) / decoded.scale, basis: decoded.scale < 1 ? `the pixel size you typed, scaled for a photo drawn at ${(decoded.scale * 100).toFixed(0)}%` : "the pixel size you typed" };
    }
    const h = Number(heightM);
    const est: GsdEstimate = estimateGsd(p.exif ?? EMPTY_EXIF, { heightM: heightM.trim() && Number.isFinite(h) ? h : null, imageWidth: decoded.pixels.width });
    return { gsdM: est.gsdM, basis: est.basis };
  }, [gsdCm, heightM]);

  const run = async (p: Photo) => {
    const spacing = Number(rowSpacingCm) / 100;
    if (!(spacing > 0)) { patch(p.id, { status: "error", error: "Type a row spacing first." }); return; }
    try {
      let decoded = p.decoded;
      if (!decoded) {
        patch(p.id, { status: "decoding", error: null });
        decoded = await decodePhoto(p.file);
        patch(p.id, { decoded });
      }
      const g = gsdFor(p, decoded);
      if (!g.gsdM) { patch(p.id, { status: "error", error: `Cannot size the pixels: ${g.basis}.` }); return; }
      patch(p.id, { status: "running", progress: null, used: { gsdM: g.gsdM, basis: g.basis } });
      const minBlob = Number(minBlobCm2), win = Number(windowM);
      const pattern = await analysePhoto(decoded.pixels, {
        gsdM: g.gsdM, rowSpacingM: spacing,
        minBlobAreaCm2: Number.isFinite(minBlob) && minBlob > 0 ? minBlob : undefined,
        windowM: Number.isFinite(win) && win > 0 ? win : undefined,
      }, { onProgress: (done, total) => patch(p.id, { progress: { done, total } }) });
      patch(p.id, { pattern, status: "done", progress: null });
    } catch (e) {
      patch(p.id, { status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  };

  const onDrop = (e: React.DragEvent) => { e.preventDefault(); void add(e.dataTransfer.files); };

  return (
    <div className="p-8 space-y-6 text-neutral-200">
      <header className="space-y-2">
        <h1 className="font-display text-3xl inline-flex items-center gap-2"><Camera className="h-7 w-7 text-primary" /> Photo Scout</h1>
        <p className="text-muted-foreground max-w-3xl">
          The planting pattern in one drone photo, with no orthomosaic. The photo is read in this browser and
          never uploaded. It finds the crop rows, then the spacing of plants along each row, and shows the green
          blobs that sit at no expected place. Blobs, never verdicts; nothing is saved.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-6">
        <aside className="space-y-4">
          <label
            onDragOver={e => e.preventDefault()}
            onDrop={onDrop}
            className="flex flex-col items-center justify-center gap-2 border border-dashed border-[#444] rounded-sm p-6 text-xs text-neutral-400 cursor-pointer hover:bg-[#161616]"
          >
            <Upload className="h-5 w-5" />
            Drop JPEG photos here, or click to choose
            <input type="file" accept=".jpg,.jpeg,image/jpeg" multiple className="hidden" onChange={e => { if (e.target.files) void add(e.target.files); e.target.value = ""; }} />
          </label>

          <section className="rounded-sm border border-[#222] p-3 space-y-2" style={{ background: "#161616" }}>
            <div className="text-xs font-semibold">Settings</div>
            <Field label="Row spacing">
              <div className="flex gap-1">
                <select className={input} value={ROW_SPACINGS.some(r => String(r.cm) === rowSpacingCm) ? rowSpacingCm : "custom"} onChange={e => { if (e.target.value !== "custom") setRowSpacingCm(e.target.value); }}>
                  {ROW_SPACINGS.map(r => <option key={r.cm} value={String(r.cm)}>{r.label}</option>)}
                  <option value="custom">custom</option>
                </select>
                <input className={`${input} w-20`} value={rowSpacingCm} onChange={e => setRowSpacingCm(e.target.value)} aria-label="Row spacing, cm" />
              </div>
              <div className="text-[10px] text-neutral-500">centimetres; the fit searches around this number</div>
            </Field>
            <Field label="Flight height above ground, m (optional)">
              <input className={input} value={heightM} onChange={e => setHeightM(e.target.value)} placeholder="from the file when DJI" />
            </Field>
            <Field label="Pixel size, cm per pixel (optional, overrides)">
              <input className={input} value={gsdCm} onChange={e => setGsdCm(e.target.value)} placeholder="estimated when blank" />
            </Field>
            <Field label="Minimum blob area, cm²">
              <input className={input} value={minBlobCm2} onChange={e => setMinBlobCm2(e.target.value)} />
            </Field>
            <Field label="Row-fit window, m">
              <input className={input} value={windowM} onChange={e => setWindowM(e.target.value)} />
            </Field>
          </section>

          <section className="rounded-sm border border-[#222] divide-y divide-[#222]" style={{ background: "#161616" }}>
            {photos.length === 0 && <div className="p-3 text-xs text-neutral-500">No photos yet.</div>}
            {photos.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                className={`w-full text-left p-3 text-xs hover:bg-[#1f1f1f] ${p.id === selectedId ? "bg-[#1b1b1b]" : ""}`}
              >
                <div className="truncate text-neutral-200">{p.name}</div>
                <div className="text-[10px] text-neutral-500">{statusLine(p, units)}</div>
              </button>
            ))}
          </section>
        </aside>

        <main className="space-y-4 min-w-0">
          {!selected && <div className="text-sm text-neutral-500">Choose a photo to read it.</div>}
          {selected && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={btn} disabled={selected.status === "decoding" || selected.status === "running"} onClick={() => void run(selected)}>
                  {(selected.status === "decoding" || selected.status === "running") && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {selected.status === "decoding" ? "Decoding" : selected.status === "running" ? `Fitting${selected.progress ? ` ${selected.progress.done}/${selected.progress.total}` : ""}` : selected.pattern ? "Run again" : "Read this photo"}
                </button>
                {(["rows", "blobs", "windows"] as const).map(k => (
                  <label key={k} className="text-xs text-neutral-400 inline-flex items-center gap-1">
                    <input type="checkbox" checked={show[k]} onChange={e => setShow(s => ({ ...s, [k]: e.target.checked }))} /> {k}
                  </label>
                ))}
                <span className="text-[10px] text-neutral-500 ml-auto inline-flex gap-3">
                  {CLASS_ORDER.map(c => <span key={c} className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: CLASS_COLOUR[c] }} />{c}</span>)}
                </span>
              </div>
              {selected.error && <div className="text-xs text-red-400 flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {selected.error}</div>}
              <ExifCard photo={selected} units={units} />
              <PhotoCanvas photo={selected} show={show} />
              {selected.pattern && <Summary pattern={selected.pattern} units={units} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function statusLine(p: Photo, units: "metric" | "imperial"): string {
  if (p.status === "error") return "error";
  if (p.status === "decoding") return "decoding";
  if (p.status === "running") return "fitting rows";
  if (p.pattern) {
    const s = p.pattern.summary;
    return `${s.usableWindows}/${s.windows} windows, ${s.offRow} off-row, ${fmtLengthCm(p.pattern.gsdM * 100, units).text}/px`;
  }
  if (p.exif?.relativeAltitudeM != null) return `${p.exif.relativeAltitudeM.toFixed(0)} m above take-off`;
  return p.exif ? "no height in file" : "reading";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1"><span className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</span>{children}</label>;
}

function ExifCard({ photo, units }: { photo: Photo; units: "metric" | "imperial" }) {
  const e = photo.exif;
  if (!e) return null;
  const rows: [string, string][] = [];
  if (e.make || e.model) rows.push(["Camera", [e.make, e.model].filter(Boolean).join(" ")]);
  if (e.width && e.height) rows.push(["Native size", `${e.width} × ${e.height} px`]);
  if (photo.decoded && photo.decoded.scale < 1) rows.push(["Read at", `${photo.decoded.pixels.width} × ${photo.decoded.pixels.height} px (${(photo.decoded.scale * 100).toFixed(0)}%)`]);
  if (e.focalMm) rows.push(["Focal length", `${e.focalMm.toFixed(2)} mm${e.focal35Mm ? ` (${e.focal35Mm} mm equivalent)` : ""}`]);
  if (e.sensorWidthMm) rows.push(["Sensor width", `${e.sensorWidthMm.toFixed(2)} mm (from the file)`]);
  if (e.relativeAltitudeM != null) rows.push(["Height above take-off", `${e.relativeAltitudeM.toFixed(1)} m`]);
  else if (e.gpsAltitudeM != null) rows.push(["GPS altitude", `${e.gpsAltitudeM.toFixed(1)} m above sea level, not above ground`]);
  if (e.gimbalPitchDeg != null) rows.push(["Gimbal pitch", `${e.gimbalPitchDeg.toFixed(0)}°${Math.abs(e.gimbalPitchDeg + 90) > 10 ? " (not straight down: rows nearer the camera look wider)" : ""}`]);
  if (e.lat != null && e.lng != null) rows.push(["Position", `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}`]);
  if (e.capturedAt) rows.push(["Captured", e.capturedAt]);
  if (photo.used) rows.push(["Pixel size used", `${fmtLengthCm(photo.used.gsdM * 100, units).text}/px, ${photo.used.basis}`]);
  if (!rows.length) rows.push(["EXIF", "none readable in this file; type the pixel size"]);
  return (
    <section className="rounded-sm border border-[#222] p-3 text-[11px] grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1" style={{ background: "#161616" }}>
      {rows.map(([k, v]) => <div key={k} className="flex gap-2"><span className="text-neutral-500 w-36 shrink-0">{k}</span><span className="text-neutral-300">{v}</span></div>)}
    </section>
  );
}

function PhotoCanvas({ photo, show }: { photo: Photo; show: { rows: boolean; blobs: boolean; windows: boolean } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const decoded = photo.decoded, pattern = photo.pattern;
  const segments = useMemo(() => (pattern ? pattern.windows.flatMap(w => rowSegmentsPx(w, pattern.gsdM).map(s => ({ ...s, w }))) : []), [pattern]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !decoded || width <= 0) return;
    const { pixels } = decoded;
    const s = width / pixels.width;
    canvas.width = width;
    canvas.height = Math.round(pixels.height * s);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(decoded.bitmap, 0, 0, canvas.width, canvas.height);
    if (!pattern) return;
    if (show.windows) {
      for (const w of pattern.windows) {
        ctx.strokeStyle = w.usable ? "rgba(76,175,80,0.6)" : "rgba(158,158,158,0.5)";
        ctx.setLineDash(w.usable ? [] : [4, 4]);
        ctx.lineWidth = 1;
        ctx.strokeRect(w.x0 * s, w.y0 * s, (w.x1 - w.x0 + 1) * s, (w.y1 - w.y0 + 1) * s);
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(w.x0 * s + 2, w.y0 * s + 2, 44, 12);
        ctx.fillStyle = w.usable ? "#4CAF50" : "#9E9E9E";
        ctx.font = "10px system-ui";
        ctx.fillText(`${w.fit.confidence.toFixed(2)}${w.seed?.usable ? " s" : ""}`, w.x0 * s + 4, w.y0 * s + 11);
      }
    }
    if (show.rows) {
      ctx.strokeStyle = "rgba(255,235,59,0.55)";
      ctx.lineWidth = 1;
      for (const seg of segments) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(seg.w.x0 * s, seg.w.y0 * s, (seg.w.x1 - seg.w.x0 + 1) * s, (seg.w.y1 - seg.w.y0 + 1) * s);
        ctx.clip();
        ctx.beginPath();
        ctx.moveTo(seg.x1 * s, seg.y1 * s);
        ctx.lineTo(seg.x2 * s, seg.y2 * s);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (show.blobs) {
      for (const b of pattern.blobs) {
        const r = Math.max(2, ((b.equivDiameterM / pattern.gsdM) * s) / 2);
        ctx.beginPath();
        ctx.arc(b.x * s, b.y * s, r, 0, Math.PI * 2);
        ctx.strokeStyle = CLASS_COLOUR[b.cls];
        ctx.lineWidth = b.cls === "on pattern" || b.cls === "unplaced" ? 1 : 2;
        ctx.stroke();
      }
    }
  }, [decoded, pattern, segments, show, width]);

  return (
    <div ref={holder} className="w-full rounded-sm border border-[#222] overflow-hidden" style={{ background: "#0f0f0f" }}>
      {decoded ? <canvas ref={ref} className="block w-full" /> : <div className="p-6 text-xs text-neutral-500">Press "Read this photo" to decode it.</div>}
    </div>
  );
}

function Summary({ pattern, units }: { pattern: PhotoPattern; units: "metric" | "imperial" }) {
  const s = pattern.summary;
  const cm = (m: number | null) => (m == null ? "–" : fmtLengthCm(m * 100, units).text);
  const rows: [string, string][] = [
    ["Windows with rows", `${s.usableWindows} of ${s.windows} at ${pattern.windowM} m`],
    ["Row direction", s.medianAngleDeg == null ? "–" : `${s.medianAngleDeg.toFixed(1)}° from the photo's x axis`],
    ["Row spacing measured", `${cm(s.medianPitchM)} (you gave ${cm(pattern.rowSpacingM)})`],
    ["Plant spacing along the row", s.seedSpacingM == null ? "not consistent enough to report" : `${cm(s.seedSpacingM)}, ${Math.round((s.seedAgreement ?? 0) * 100)}% of gaps agree`],
    ["Vegetation", `${(pattern.vegetationFraction * 100).toFixed(1)}% of pixels${pattern.canopyClosed ? " (closed canopy)" : ""}`],
    ["Blobs", `${s.blobs.toLocaleString()} kept, ${s.specks.toLocaleString()} specks dropped under ${fmtAreaCm2(pattern.minBlobAreaCm2, units).text}`],
    ["On pattern", s.onPattern.toLocaleString()],
    ["Doubles", s.doubles.toLocaleString()],
    ["Between plants", s.betweenPlants.toLocaleString()],
    ["Off-row", s.offRow.toLocaleString()],
    ["Unplaced", `${s.unplaced.toLocaleString()} (no trusted rows there, or touching the edge)`],
    ["Skips", s.skips.toLocaleString()],
  ];
  return (
    <section className="rounded-sm border border-[#222] p-3 text-[11px] space-y-2" style={{ background: "#161616" }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
        {rows.map(([k, v]) => <div key={k} className="flex gap-2"><span className="text-neutral-500 w-44 shrink-0">{k}</span><span className="text-neutral-300">{v}</span></div>)}
      </div>
      {pattern.notes.map((n, i) => (
        <div key={i} className="text-neutral-500 flex items-start gap-1.5 pt-1"><AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-amber-500/80" /> {n}</div>
      ))}
    </section>
  );
}
