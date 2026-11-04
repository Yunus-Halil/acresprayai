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
import { type BlobClass, DEFAULT_MIN_BLOB_AREA_CM2, DEFAULT_PHOTO_WINDOW_M, type PhotoPattern, analysePhoto, rowSegmentsPx } from "@/lib/photoScout/pattern";
import { patternPriorFor } from "@/lib/cropProfiles/engine";
import { checkRowSpacing } from "@/lib/cropProfiles/checks";
import { cropProfileById, listCropProfiles } from "@/lib/cropProfiles/registry";
import { type RowCropRead, type RowCropStage, readRowCrop, rowCropOverlay } from "@/lib/rowCrop/readRowCrop";
import { adaptiveAsRead, readCornAdaptive } from "@/lib/rowCrop/adaptive";
import { cornV1AsRead, readCornV1 } from "@/lib/rowCrop/cornV1";
import { readsContinuousRows, rowCropParamsFor } from "@/lib/rowCrop/params";

type Status = "new" | "decoding" | "running" | "done" | "error";

type Photo = {
  id: string;
  name: string;
  file: File;
  exif: PhotoExif | null;
  decoded: DecodedPhoto | null;
  pattern: PhotoPattern | null;
  /** The continuous-row read (corn and any crop whose profile traces rows on the green) instead of the lattice pattern. */
  rowCrop: RowCropRead | null;
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

const AUTO = "auto";
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
  const [rowSpacingCm, setRowSpacingCm] = useState(AUTO);
  /** The crop profile the read uses ("" for crop-neutral): its spacings, green gate and brightness check (src/lib/cropProfiles). */
  const [cropId, setCropId] = useState("");
  /** "auto" (the default): the photo is assessed region by region and each region read by the stage reader its
   * structure calls for (src/lib/rowCrop/adaptive.ts); or one stage reader forced for the whole photo. */
  const [stage, setStage] = useState<RowCropStage | "auto">("auto");
  const [heightM, setHeightM] = useState("");
  const [gsdCm, setGsdCm] = useState("");
  const [minBlobCm2, setMinBlobCm2] = useState(String(DEFAULT_MIN_BLOB_AREA_CM2));
  const [windowM, setWindowM] = useState(String(DEFAULT_PHOTO_WINDOW_M));
  const [show, setShow] = useState({ rows: true, blobs: true, unplaced: false, windows: true });
  const selected = photos.find(p => p.id === selectedId) ?? null;

  const patch = useCallback((id: string, next: Partial<Photo>) => {
    setPhotos(ps => ps.map(p => (p.id === id ? { ...p, ...next } : p)));
  }, []);

  const add = async (files: FileList | File[]) => {
    const list = Array.from(files).filter(f => /\.(jpe?g)$/i.test(f.name) || f.type === "image/jpeg");
    if (!list.length) return;
    const fresh: Photo[] = list.map(file => ({
      id: `p${nextId++}`, name: file.name, file, exif: null, decoded: null, pattern: null, rowCrop: null, status: "new", progress: null, error: null, used: null,
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
    const spacing: number | "auto" = rowSpacingCm === AUTO ? "auto" : Number(rowSpacingCm) / 100;
    if (spacing !== "auto" && !(spacing > 0)) { patch(p.id, { status: "error", error: "Type a row spacing first, or choose auto." }); return; }
    try {
      let decoded = p.decoded;
      if (!decoded) {
        patch(p.id, { status: "decoding", error: null });
        decoded = await decodePhoto(p.file);
        patch(p.id, { decoded });
      }
      const g = gsdFor(p, decoded);
      if (readsContinuousRows(cropId)) {
        // Corn and its kind: rows traced on the green, the whole row is the crop. Without a pixel size the scale is
        // assumed from the measured pitch and the profile's default spacing, and the read says so.
        patch(p.id, { status: "running", progress: null, used: g.gsdM ? { gsdM: g.gsdM, basis: g.basis } : null });
        // Corn V1 (cornV1.ts) for corn on auto: the green read and the plant read fused, findings only from rows both
        // support. Other continuous-row crops on auto keep the adaptive read; a forced stage runs that reader alone.
        const onProgress = (done: number, total: number) => patch(p.id, { progress: { done, total } });
        const read = stage === "auto"
          ? cropId === "corn"
            ? cornV1AsRead(readCornV1(decoded.pixels, rowCropParamsFor(cropProfileById(cropId), g.gsdM), { onProgress, enteredCrop: cropId }))
            : adaptiveAsRead(readCornAdaptive(decoded.pixels, rowCropParamsFor(cropProfileById(cropId), g.gsdM), { onProgress }))
          : readRowCrop(decoded.pixels, rowCropParamsFor(cropProfileById(cropId), g.gsdM, stage), { onProgress: (done, total) => patch(p.id, { progress: { done, total } }) });
        patch(p.id, { rowCrop: read, pattern: null, status: "done", progress: null, used: { gsdM: read.gsdM, basis: read.scaleBasis === "given" ? g.basis : "assumed from the measured row pitch and the crop's default spacing" } });
        return;
      }
      if (!g.gsdM) { patch(p.id, { status: "error", error: `Cannot size the pixels: ${g.basis}.` }); return; }
      patch(p.id, { status: "running", progress: null, used: { gsdM: g.gsdM, basis: g.basis } });
      const minBlob = Number(minBlobCm2), win = Number(windowM);
      const pattern = await analysePhoto(decoded.pixels, {
        gsdM: g.gsdM, rowSpacingM: spacing,
        minBlobAreaCm2: Number.isFinite(minBlob) && minBlob > 0 ? minBlob : undefined,
        windowM: Number.isFinite(win) && win > 0 ? win : undefined,
        prior: patternPriorFor(cropProfileById(cropId)),
      }, { onProgress: (done, total) => patch(p.id, { progress: { done, total } }) });
      patch(p.id, { pattern, rowCrop: null, status: "done", progress: null });
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
            <Field label="Crop">
              <select className={input} value={cropId} onChange={e => setCropId(e.target.value)} data-testid="photo-scout-crop">
                <option value="">not set (crop-neutral)</option>
                {listCropProfiles().map(c => <option key={c.id} value={c.id}>{c.name} ({c.status} profile)</option>)}
              </select>
              <div className="text-[10px] text-neutral-500">{readsContinuousRows(cropId) ? "rows are traced on the green and the whole row is the crop; only green clear of every row is reported, as patches between the rows" : cropId ? "the crop's planted spacings are searched beside the usual ones, and only green that passes the crop's gate counts" : "no crop profile: the read uses the crop-neutral settings"}</div>
            </Field>
            {readsContinuousRows(cropId) && (
              <Field label="Growth stage">
                <select className={input} value={stage} onChange={e => setStage(e.target.value as RowCropStage | "auto")} data-testid="photo-scout-stage">
                  <option value="auto">{cropId === "corn" ? "auto: Corn V1 (each part by what it shows, rows checked by the plants)" : "auto (read from the photo: each part by what it shows)"}</option>
                  <option value="emergence">emergence (VE to V2: seedlings on bare soil, just planted)</option>
                  <option value="establishment">early (V2 to V7: plants in a line, soil between the rows)</option>
                  <option value="mid">mid (V8 to tasselling: the canopy nearly meets over narrow alleys)</option>
                  <option value="late">late (closed canopy, no soil to be seen between the rows)</option>
                </select>
                <div className="text-[10px] text-neutral-500">{stage === "auto" && cropId === "corn" ? "Corn V1: the photo is read twice, once for its green (region by region, each region by the stage reader it calls for) and once for its plants (each plant located on the soil; rows only where many line up at a repeated spacing). Where the plants line up the rows are theirs; where they cannot be told apart (a canopy) the green's rows stand. A row is corn only where the field is entered as corn and both reads support it; other rows are planted rows with the crop not confirmed (amber dashes). Weed candidates and gaps come only from corn rows; everything else is drawn grey, never as a finding" : stage === "auto" ? "the photo is judged region by region (seedlings, rows on soil, a canopy nearly meeting, a closed canopy, cover, or uncertain) with one row direction for the field and a spacing per planting; each region is read by the matching reader; uncertain ground and corn on a row the reader did not hold are drawn grey, never as weeds" : stage === "late" ? "rows are read from how green the canopy is, ridges against the shaded alleys; nothing between the rows can be seen, so no weeds or seedlings are judged" : stage === "mid" ? "rows are placed between the alley troughs; only green standing on the alley floor is reported; a weed among the corn leaves counts as corn" : stage === "emergence" ? "each seedling is a point and a row is the straight line they stand on (the lens bend straightened); plants counted along each row; green off every row larger than nearly all the crop's own seedlings is a weed candidate (red); smaller green is counted apart in grey, never called a weed" : "rows are traced on the green; weeds are green clear of every row's band"}</div>
              </Field>
            )}
            <Field label="Row spacing">
              <div className="flex gap-1">
                <select className={input} value={rowSpacingCm === AUTO || ROW_SPACINGS.some(r => String(r.cm) === rowSpacingCm) ? rowSpacingCm : "custom"} onChange={e => setRowSpacingCm(e.target.value === "custom" ? "76.2" : e.target.value)}>
                  <option value={AUTO}>auto (search 12 cm to 1.6 m)</option>
                  {ROW_SPACINGS.map(r => <option key={r.cm} value={String(r.cm)}>{r.label}</option>)}
                  <option value="custom">custom</option>
                </select>
                {rowSpacingCm !== AUTO && <input className={`${input} w-20`} value={rowSpacingCm} onChange={e => setRowSpacingCm(e.target.value)} aria-label="Row spacing, cm" />}
              </div>
              <div className="text-[10px] text-neutral-500">{rowSpacingCm === AUTO ? "each window is fitted at several spacings and keeps the best" : "centimetres; the fit searches 60 to 160 percent of this number"}</div>
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
                  {selected.status === "decoding" ? "Decoding" : selected.status === "running" ? `Fitting${selected.progress ? ` ${selected.progress.done}/${selected.progress.total}` : ""}` : selected.pattern || selected.rowCrop ? "Run again" : "Read this photo"}
                </button>
                {(["rows", "blobs", "unplaced", "windows"] as const).map(k => (
                  <label key={k} className="text-xs text-neutral-400 inline-flex items-center gap-1">
                    <input type="checkbox" checked={show[k]} onChange={e => setShow(s => ({ ...s, [k]: e.target.checked }))} /> {k}
                  </label>
                ))}
                <span className="text-[10px] text-neutral-500 ml-auto inline-flex gap-3">
                  {selected.rowCrop
                    ? ([["#00E6FF", selected.rowCrop.cornV1 ? "corn row" : "row (the crop)"], ...(selected.rowCrop.cornV1 ? [["#FFBE00", "planted row, crop not confirmed (dashed)"]] as const : []), ["#78C8FF", "crop band"], ["#EF5350", "between rows"], ...(selected.rowCrop.seedlings ? [["#FFBE00", "late seedling"], ["#FF00C8", "escape (15 cm+)"]] as const : []), ["#FFA000", "gap in the row"], ["#3CFF5A", "plant (estimate)"], ["#9E9E9E", selected.rowCrop.cornV1 ? "withheld or not judged" : "not judged"]] as const).map(([c, l]) => <span key={l} className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />{l}</span>)
                    : CLASS_ORDER.map(c => <span key={c} className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: CLASS_COLOUR[c] }} />{c}</span>)}
                </span>
              </div>
              {selected.error && <div className="text-xs text-red-400 flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {selected.error}</div>}
              <ExifCard photo={selected} units={units} />
              <PhotoCanvas photo={selected} show={show} />
              {selected.pattern && <Summary pattern={selected.pattern} units={units} />}
              {selected.rowCrop && <RowCropSummary read={selected.rowCrop} units={units} />}
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
  if (p.rowCrop) {
    const s = p.rowCrop.summary;
    return s.rows ? `${s.rows} rows, ${p.rowCrop.stage === "late" ? "nothing between rows judged" : `${s.weeds} between rows`}, ${fmtLengthCm(p.rowCrop.gsdM * 100, units).text}/px` : "no rows read";
  }
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

function PhotoCanvas({ photo, show }: { photo: Photo; show: { rows: boolean; blobs: boolean; unplaced: boolean; windows: boolean } }) {
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
  const decoded = photo.decoded, pattern = photo.pattern, rowCrop = photo.rowCrop;
  const segments = useMemo(() => (pattern ? pattern.windows.flatMap(w => rowSegmentsPx(w, pattern.gsdM).map(s => ({ ...s, w }))) : []), [pattern]);
  const overlay = useMemo(() => (rowCrop ? rowCropOverlay(rowCrop) : null), [rowCrop]);

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
    if (overlay) {
      const path = (pts: [number, number][], close: boolean) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s))); if (close) ctx.closePath(); ctx.stroke(); };
      if (show.rows) {
        ctx.strokeStyle = "rgba(120,200,255,0.35)"; ctx.lineWidth = 1;
        for (const b of overlay.bands) path(b, false);
        ctx.strokeStyle = "rgba(0,230,255,0.9)"; ctx.lineWidth = 2;
        for (const r of overlay.rows) path(r, false);
        // Corn V1: planted rows whose crop is not confirmed, amber dashes.
        ctx.strokeStyle = "rgba(255,190,0,0.95)"; ctx.setLineDash([8, 5]);
        for (const r of overlay.probableRows) path(r, false);
        ctx.setLineDash([]);
        // Gaps: orange where the photo supports a missing plant (or before V2 classed them), grey dashed where it cannot tell.
        for (const g of overlay.gaps) {
          ctx.strokeStyle = g.kind === "uncertain" ? "rgba(170,170,170,0.9)" : "rgba(255,160,0,0.95)"; ctx.lineWidth = 3; ctx.setLineDash(g.kind === "uncertain" ? [6, 4] : []);
          ctx.beginPath(); ctx.moveTo(g.x1 * s, g.y1 * s); ctx.lineTo(g.x2 * s, g.y2 * s); ctx.stroke();
        }
        ctx.setLineDash([]);
        // Corn V1: gaps not reported (the row not confirmed by both reads, a plant inside, or the photo cannot tell), thin grey dashes.
        ctx.strokeStyle = "rgba(170,170,170,0.8)"; ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]);
        for (const g of rowCrop?.cornV1?.withheldGaps ?? []) { ctx.beginPath(); ctx.moveTo(g.x1 * s, g.y1 * s); ctx.lineTo(g.x2 * s, g.y2 * s); ctx.stroke(); }
        ctx.setLineDash([]);
        // Emergence V2 at expected plant positions: possible seedlings blue, supported missing plants orange, uncertain grey.
        const mark = Math.max(3, (rowCrop ? 0.02 / rowCrop.gsdM : 8) * s);
        for (const [pts, col] of [[overlay.possible, "rgba(70,150,255,0.95)"], [overlay.missing, "rgba(255,150,0,0.95)"], [overlay.uncertain, "rgba(170,170,170,0.9)"]] as const) {
          ctx.strokeStyle = col; ctx.lineWidth = 1.5;
          for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(x * s, y * s, mark, 0, 2 * Math.PI); ctx.stroke(); }
        }
        // Where the field stops inside the photo (establishment): the rows end against grass or bare ground there.
        ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2; ctx.setLineDash([8, 5]);
        for (const e of overlay.fieldEdges) path(e, false);
        ctx.setLineDash([]);
      }
      if (show.windows) { ctx.strokeStyle = "rgba(158,158,158,0.7)"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); for (const e of overlay.excluded) path(e, true); ctx.setLineDash([]); }
      if (show.blobs) {
        // Seedlings: a ring about 5 cm across (at least 4 screen pixels), so the plant inside stays visible.
        const ringR = Math.max(4, (rowCrop ? 0.025 / rowCrop.gsdM : 10) * s);
        ctx.strokeStyle = "rgba(255,190,0,0.95)"; ctx.lineWidth = 1.5;
        for (const [x, y] of overlay.seedlings) { ctx.beginPath(); ctx.arc(x * s, y * s, ringR, 0, 2 * Math.PI); ctx.stroke(); }
        ctx.strokeStyle = "rgba(170,170,170,0.85)"; ctx.lineWidth = 1; for (const w of overlay.smallGreen) path(w, true);
        ctx.strokeStyle = "#EF5350"; ctx.lineWidth = 2; for (const w of overlay.weeds) path(w, true);
        ctx.strokeStyle = "#FF00C8"; ctx.lineWidth = 3; for (const w of overlay.escapes) path(w, true);
      }
      if (show.unplaced) { ctx.fillStyle = "#3CFF5A"; for (const [x, y] of overlay.plants) ctx.fillRect(x * s - 1.5, y * s - 1.5, 3, 3); }
      return;
    }
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
        ctx.fillText(`${w.fit.confidence.toFixed(2)}${w.signal === "brightness" ? " b" : ""}${w.seed?.usable ? " s" : ""}`, w.x0 * s + 4, w.y0 * s + 11);
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
        if (b.cls === "unplaced" && !show.unplaced) continue;
        const r = Math.max(2, ((b.equivDiameterM / pattern.gsdM) * s) / 2);
        ctx.beginPath();
        ctx.arc(b.x * s, b.y * s, r, 0, Math.PI * 2);
        ctx.strokeStyle = CLASS_COLOUR[b.cls];
        ctx.lineWidth = b.cls === "on pattern" || b.cls === "unplaced" ? 1 : 2;
        ctx.stroke();
      }
    }
  }, [decoded, pattern, overlay, rowCrop, segments, show, width]);

  return (
    <div ref={holder} className="w-full rounded-sm border border-[#222] overflow-hidden" style={{ background: "#0f0f0f" }}>
      {decoded ? <canvas ref={ref} className="block w-full" /> : <div className="p-6 text-xs text-neutral-500">Press "Read this photo" to decode it.</div>}
    </div>
  );
}

function RowCropSummary({ read, units }: { read: RowCropRead; units: "metric" | "imperial" }) {
  const s = read.summary;
  const cm = (m: number | null) => (m == null ? "–" : fmtLengthCm(m * 100, units).text);
  const v = read.cornV1;
  const rows: [string, string][] = [
    ...(v ? [
      ["Corn V1", `${v.cornRows} corn row${v.cornRows === 1 ? "" : "s"} (cyan), ${v.probableRows} planted row${v.probableRows === 1 ? "" : "s"} with the crop not confirmed (amber dashes)${v.entered !== "corn" ? "; the field is not entered as corn, so no row is called corn" : ""}${v.spacingImpossible ? "; the measured spacing is one corn is never planted at" : v.spacingFits === false ? "; the measured spacing is not one of corn's usual ones (check the flight height)" : ""}`],
      ["Behind the rows", `${v.agreedRows} where the plants and the green agree, ${v.plantOnlyRows} from the plants alone, ${v.greenOnlyRows} from the green alone; ${v.greenRowsDropped} green row${v.greenRowsDropped === 1 ? "" : "s"} dropped where the plants stand beside it; ${v.plants.toLocaleString()} plants located (${v.plantSource === "green" ? "on the soil, no model" : "by a detector"})`],
      ["Withheld", `${v.cropOnRow} green patch${v.cropOnRow === 1 ? "" : "es"} on a planted row (the crop, not weeds); ${v.unknownVegetation} unknown vegetation (no corn row beside it); ${v.gapsWithheld} gap${v.gapsWithheld === 1 ? "" : "s"} not reported (the row not confirmed by both reads, a plant inside it, or the photo cannot tell); all drawn grey`],
    ] as [string, string][] : []),
    ["Crop profile", read.crop ? `${read.crop.id} ${read.crop.version}, ${read.stage === "late" ? "late variant: rows read from the canopy's green, nothing between them judged" : read.stage === "mid" ? "mid-stage variant: rows between the alley troughs, the whole canopy is the crop" : read.stage === "emergence" ? "emergence variant: seedlings as points, rows the lines they stand on" : "early-stage variant: rows traced on the green, the whole row is the crop"}` : "none"],
    ["Scale", read.scaleBasis === "given" ? `${cm(read.gsdM)}/px` : `${cm(read.gsdM)}/px, ASSUMED from the measured pitch and the crop's default spacing`],
    ["Row direction", read.directionDeg == null ? "–" : `${read.directionDeg.toFixed(1)}° from the photo's x axis`],
    ["Row spacing measured", read.pitchM == null ? "–" : `${cm(read.pitchM)}${read.matchedSpacingM ? ` (a planted spacing: ${cm(read.matchedSpacingM)})` : " (matches no planted spacing; the measurement stands)"}`],
    ["Rows", `${s.rows} traced, ${s.totalRowLengthM.toFixed(0)} m in all${s.rowsDropped ? `, ${s.rowsDropped} short traces dropped` : ""}`],
    ["Crop band", s.medianBandHalfWidthM == null ? "–" : `${cm(s.medianBandHalfWidthM)} either side of the row (from the rows' own green)`],
    ["Green on the rows", s.medianRowGreenShare == null ? "–" : `${Math.round(s.medianRowGreenShare * 100)}% of the band`],
    ["Row coherence", s.coherence == null ? "–" : s.coherence.toFixed(2)],
    ["Between the rows", read.stage === "late" ? "not judged under a closed canopy" : `${s.weeds} ${read.emergence?.seedlingAreaCm2 ? "weed candidate" : "patch"}${s.weeds === 1 ? "" : read.emergence?.seedlingAreaCm2 ? "s" : "es"}${read.emergence?.seedlingAreaCm2 ? ` larger than the crop's seedlings (over ${read.emergence.seedlingAreaCm2.p90.toFixed(0)} cm², red), ${read.emergence.smallGreen} smaller green patches counted apart (grey, not weeds)` : ""}, ${s.weedAreaM2.toFixed(2)} m²${s.betweenRowCover == null ? "" : `, ${(s.betweenRowCover * 100).toFixed(1)}% of the ground between the bands`}${s.escapes != null ? `; ${s.escapes} escape${s.escapes === 1 ? "" : "s"} 15 cm or more across` : ""}`],
    ...(read.seedlings ? [["Late seedlings", `${read.seedlings.count.toLocaleString()} small plants on the soil, ${read.seedlings.cover == null ? "–" : (read.seedlings.cover * 100).toFixed(2) + "%"} of the field ground read; a layer, not findings`] as [string, string]] : []),
    ["On the rows", `${s.cropComponents.toLocaleString()} green patches counted as the crop${s.leafTips ? `, ${s.leafTips} of them leaf tips just beyond a band` : ""}`],
    ["Gaps along the rows", s.gaps ? `${s.gaps}, ${s.gapLengthM.toFixed(1)} m in all${read.emergence ? ` (before the second look: ${read.emergence.gapsBefore}, ${read.emergence.gapLengthBeforeM.toFixed(1)} m)` : ""}` : "none over the minimum length"],
    ...(read.emergence ? [["Second look along the rows", `${read.emergence.searched.toLocaleString()} expected positions: ${read.emergence.strictFound.toLocaleString()} plants the first pass had not counted, ${read.emergence.possible.toLocaleString()} possible seedlings (blue), ${read.emergence.missing.toLocaleString()} missing plants the photo supports (orange), ${read.emergence.uncertain.toLocaleString()} uncertain (grey)${read.emergence.laterPlanting ? `; a later planting set apart (${read.emergence.laterPlanting.greenPatches} green patches there, not weeds)` : ""}`] as [string, string]] : []),
    ...(read.fieldEdge ? [["Field edge", read.fieldEdge.ends.length ? `${read.fieldEdge.ends.length} row end${read.fieldEdge.ends.length === 1 ? "" : "s"} inside the photo: ${read.fieldEdge.ends.filter(e => e.beyond === "grass or cover").length} against grass or cover, ${read.fieldEdge.ends.filter(e => e.beyond === "bare ground").length} against bare ground (dashed white line); nothing beyond is judged` : "the rows run on to the photo's edges"] as [string, string]] : []),
    ["Plants (estimate)", s.plants == null ? "not estimated at this pixel size" : `${s.plants.toLocaleString()} green peaks along the rows; unverified`],
    ["Not judged", `${s.noRowsPatches} patches where no rows were read; ${read.excluded.length} borders or cover`],
    ["Vegetation", `${(s.vegetationFraction * 100).toFixed(1)}% of pixels; ${s.specks.toLocaleString()} specks dropped`],
    ["Time", `${s.ms} ms`],
  ];
  return (
    <section className="rounded-sm border border-[#222] p-3 text-[11px] space-y-2" style={{ background: "#161616" }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
        {rows.map(([k, v]) => <div key={k} className="flex gap-2"><span className="text-neutral-500 w-44 shrink-0">{k}</span><span className="text-neutral-300">{v}</span></div>)}
      </div>
      {read.notes.map((n, i) => (
        <div key={i} className="text-neutral-500 flex items-start gap-1.5 pt-1"><AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-amber-500/80" /> {n}</div>
      ))}
    </section>
  );
}

function Summary({ pattern, units }: { pattern: PhotoPattern; units: "metric" | "imperial" }) {
  const s = pattern.summary;
  const cm = (m: number | null) => (m == null ? "–" : fmtLengthCm(m * 100, units).text);
  const profile = cropProfileById(s.priorCropId ?? "");
  const spacingCheck = profile && s.medianPitchM ? checkRowSpacing(profile, s.medianPitchM) : null;
  const rows: [string, string][] = [
    ["Crop profile", profile
      ? `${profile.name} (${profile.status})${spacingCheck ? spacingCheck.finding ? `: the measured spacing is not one ${profile.name} is planted at (nearest ${spacingCheck.nearest?.label ?? "none"}); the measurement stands` : `: spacing consistent with ${spacingCheck.nearest?.label}` : ""}${(s.exgrGatedShare ?? 0) > 0.01 ? `; ${((s.exgrGatedShare ?? 0) * 100).toFixed(0)}% of the photo left out as straw, residue or soil by the green gate` : ""}${s.brightnessReplaced ? `; ${s.brightnessReplaced} brightness block(s) placed on the green` : ""}`
      : "none (crop-neutral read)"],
    ["Windows with rows", `${s.usableWindows} of ${s.windows} at ${pattern.windowM} m${s.brightnessWindows ? `, ${s.brightnessWindows} from brightness (b)` : ""}`],
    ["Row direction", s.medianAngleDeg == null ? "–" : `${s.medianAngleDeg.toFixed(1)}° from the photo's x axis`],
    ["Row spacing measured", pattern.rowSpacingM == null
      ? `${cm(s.medianPitchM)} (searched automatically)`
      : s.pitchKeptFromGiven > 0
        ? `${cm(s.medianPitchM)}: you gave ${cm(pattern.rowSpacingM)} and the fit kept it in ${s.pitchKeptFromGiven} of ${s.usableWindows} windows instead of what it measured`
        : `${cm(s.medianPitchM)} (you gave ${cm(pattern.rowSpacingM)})`],
    ["Typical plant", s.plantDiameterM == null ? "–" : `${cm(s.plantDiameterM)} across`],
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
