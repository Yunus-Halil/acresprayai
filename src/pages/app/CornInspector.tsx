// Development only: the corn inspector. Load a flight's folder (or one photograph) and step through what the corn
// algorithm does, drawn on one photograph at a time. Everything shown is computed by the app's own code on the dev
// server (scripts/rowCrop/cornInspect.ts, run by scripts/rowCrop/cornInspectorPlugin.ts); this page only draws it,
// using the app's own projection (directGeoref/projection.ts) to bring field positions into the photograph. Mounted
// under import.meta.env.DEV only (App.tsx), not linked from the app, never in a production build.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type GeorefFrame, groundToPixel, pixelToGround } from "@/lib/directGeoref/projection";
import { framesFromAnalysis, type TwinAnalysis } from "@/lib/fieldTwin/analysis";
import { type PhotoShift, shiftOf } from "@/lib/fieldTwin/plantsFirst";
import { fromEnu, toEnu, type LatLngAlt } from "@/lib/sourceFrames/odm";

const API = "/__corn-inspector";
type Job = { state: "waiting" | "running" | "done" | "failed"; error?: string; done?: number; total?: number; started?: number; ended?: number };
type Session = { id: string; kind: "flight" | "photo"; path: string; photos: { name: string; file: string }[]; analysis: string | null; analysisSource: string | null; jobs: { build?: Job; reads?: Job; field?: Job; photos: Record<string, Job> } };
type Pt = [number, number];
type PhotoInfo = {
  name: string; width: number; height: number; flight: boolean; readMs: number; ms: number; gsdM: number | null; gsdBasis: string; readScale: { gsdM: number; basis: string };
  plans: { stage: string; share: number; pitchPx: number }[]; rowSpacingPx: number | null; greenShare: number; firstPass: Pt[]; typicalPx: number; coresAdded: Pt[];
  cores: { finePx: number; widePx: number; reference: string; factor: number; share: number; strongest: number; medianOnMarks: number | null; onMarks: number | null; threshold: number | null; peaks: number | null; kept: number; keptInCover: number; keptOnNoPiece: number; added: number; white: number } | null;
  coresOn: boolean; readMarks: number; readMarksAreTheExpectedPass: boolean | null; candidates: number | null;
  rows: { points: Pt[]; identity: string; evidence: string; plants: number | null }[];
  guard: { on: boolean; share: number | null; cut: number; withheld: boolean | null };
  summary: Record<string, unknown>; notes: string[];
  scout: { rows: { points: Pt[]; identity?: string; gaps: { x1: number; y1: number; x2: number; y2: number }[] }[]; weeds: { x: number; y: number; hull: Pt[]; areaM2: number }[]; excluded: number; summary: Record<string, unknown>; cornV1?: Record<string, unknown>; notes: string[] } | null;
};
type FieldMeta = {
  analysis: string; photographsRead: number; photographs: number; fieldOptionsOfTheRecordEqualFIELD: boolean; failed?: string;
  origin: LatLngAlt; directionDeg: number | null; pitchM: number | null; photos: string[]; shifts: PhotoShift[]; strict: number; repeatM: number; gateM: number; nDots: number; nSights: number; nCand: number;
  frames: TwinAnalysis["frames"]; ground: { e0: number; n0: number; cell: number; gw: number; gh: number; dcell: number; dw: number; dh: number; spacingM: number } | null;
  planting: { judged: boolean; why: string | null; plantedM2: number; scatteredM2: number; plantSpacingM: number | null };
  geometry: { spacingM: number; directionDeg: number; seedM: number | null; rowLengthMedianM: number; perMMedian: number; certainDots: number; certainRows: number };
  tooCloseM: number; certainGaps: number; spacingRules: boolean; gaps: { filled: number; gapM: number; bridged: number; notConfirmedStretches: number; cutOverMaxBridge: number; cutOverScattered: number }; alleyRefused: number; alone: number;
  rows: { id: number; kind: "certain" | "geometry"; plants: number; lengthM: number; perM: number; line: Pt[]; segments: { a0: number; a1: number; confirmed: boolean }[] }[];
  sequence: Record<string, unknown>; placing: Record<string, unknown>; settledNames: Record<string, string>; settledLine: Record<string, number>; source: string; lines: { certainEvidence: number; reconstruct: number; placeDots: number };
  report: { plants: Record<string, number> | null; plantsNote: string | null; plantPoints: Pt[]; plantShown: number[]; field: Record<string, unknown>; weeds: { e: number; n: number; verdict: string; areaM2: number; seenBy: number; coveredBy: number }[]; gaps: { aEN: Pt; bEN: Pt; verdict: string; lengthM: number }[]; fieldRows: number };
  arrays: { name: string; type: "f32" | "f64" | "i32" | "u8"; length: number; offset: number }[];
};
type Field = { meta: FieldMeta; a: Record<string, Float32Array | Float64Array | Int32Array | Uint8Array>; frames: Map<string, GeorefFrame>; sightDot: Int32Array; candDot: Int32Array };

const STEPS = ["Views", "Marks in this photo", "Placed on the ground", "Obvious plants", "What it learned", "Judged", "Report"] as const;
const FLIGHT_ONLY = new Set([2, 3, 4, 5]);
// How each verdict is drawn (step 6), by the SETTLED name the code wrote.
const VERDICT: Record<string, { col: string; words: string; placed: boolean }> = {
  certainRow: { col: "#3cff5a", words: "a certain plant on a row the certain plants made", placed: true },
  placedAtSpacing: { col: "#40d8ff", words: "placed: on a row's line, a whole number of plant spacings from the nearest plant on it", placed: true },
  placedOffSpacing: { col: "#b4ff50", words: "placed by the spacing option: on a row's line, off the spacing", placed: true },
  freePlaced: { col: "#b4ff50", words: "placed by the loosened placement", placed: true },
  geometryRow: { col: "#ff60ff", words: "placed on a row found in a free slot of the planter's pattern", placed: true },
  scattered: { col: "#a0703c", words: "refused: on ground the field judged scattered", placed: false },
  noRow: { col: "#8c8c8c", words: "refused: no row's line reaches it", placed: false },
  noSpacing: { col: "#8c8c8c", words: "refused: the plant spacing is not measured on this flight, so the rule that would place it does not run", placed: false },
  alley: { col: "#b482ff", words: "refused: a second-look dot where its row's band does not beat the ground between the rows", placed: false },
  tooClose: { col: "#ff3c3c", words: "refused: closer to a plant on its row than the too-close limit (a second mark on a plant)", placed: false },
  tooFar: { col: "#ff9a00", words: "refused: more plant spacings from the nearest plant on its row than the reach allows", placed: false },
  offSpacing: { col: "#ffe628", words: "refused: not a whole number of plant spacings from the nearest plant on its row", placed: false },
  freeAlley: { col: "#b482ff", words: "refused by the loosened placement: band does not beat the alley", placed: false },
  freeTooClose: { col: "#ff3c3c", words: "refused by the loosened placement: too close to a plant on the row", placed: false },
  alone: { col: "#ff78c8", words: "taken off its row by the final sweep: a second-look mark with no located plant near it on that row", placed: false },
  cutFromRow: { col: "#ffffff", words: "placed on a row, then left on no row when the row was built (a piece of under three plants, a stretch with no plant over the bridge limit, or over ground judged scattered)", placed: false },
  none: { col: "#000000", words: "settled by no named test", placed: false },
};
const TIER = ["a mark of the stricter bar", "second look, 2+ photographs", "second look, 1 photograph near its frame's middle", "second look, 1 photograph anywhere"];
const SHOWN = [{ col: "#3cff5a", name: "certain" }, { col: "#40d8ff", name: "probable" }, { col: "#8c8c8c", name: "on no row" }, { col: "#ff9a00", name: "between rows" }, { col: "#ffe628", name: "along a row, 2+ photographs" }, { col: "#ff78c8", name: "along a row, 1 photograph" }];
const fmt = (x: number | null | undefined, d = 0) => (x == null || !Number.isFinite(x) ? "–" : x.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));
const cm = (m: number | null | undefined) => (m == null ? "not measured" : `${fmt(m * 100, 1)} cm`);

async function loadField(id: string): Promise<Field> {
  const meta = (await (await fetch(`${API}/cache/${id}/field.json`)).json()) as FieldMeta;
  const buf = await (await fetch(`${API}/cache/${id}/field.bin`)).arrayBuffer(), a: Field["a"] = {};
  for (const d of meta.arrays) a[d.name] = d.type === "f32" ? new Float32Array(buf, d.offset, d.length) : d.type === "f64" ? new Float64Array(buf, d.offset, d.length) : d.type === "i32" ? new Int32Array(buf, d.offset, d.length) : new Uint8Array(buf, d.offset, d.length);
  const frames = meta.frames ? framesFromAnalysis({ frames: meta.frames } as TwinAnalysis) : new Map<string, GeorefFrame>();
  const sightDot = new Int32Array(meta.nSights ?? 0).fill(-1), candDot = new Int32Array(meta.nCand ?? 0).fill(-1);
  if (a["dot.memberStart"]) { const st = a["dot.memberStart"], mem = a["dot.members"]; for (let i = 0; i < meta.nDots; i++) for (let k = st[i]; k < st[i + 1]; k++) (i < meta.strict ? sightDot : candDot)[mem[k]] = i; }
  return { meta, a, frames, sightDot, candDot };
}

/** Field positions into one photograph, and back: the app's projection with this photograph's registration shift
 * (plantsFirst.ts shiftOf), kept only where the pixel looks back at the place within 5 cm (the round-trip guard). */
function projector(F: Field, name: string) {
  const f = F.frames.get(name), pi = F.meta.photos.indexOf(name);
  if (!f || pi < 0) return null;
  const O = F.meta.origin, sh = F.meta.shifts[pi], altM = (f.ground as { altM?: number }).altM ?? 0, W = f.intrinsics.width, H = f.intrinsics.height;
  const pixelOf = (e: number, n: number, shifted = true): Pt | null => {
    let de = 0, dn = 0, u = 0, v = 0;
    for (let it = 0; it < (shifted ? 4 : 1); it++) { const p = fromEnu([e - de, n - dn, 0], O), h = groundToPixel(f, p.lat, p.lng, altM); if (!h) return null; u = h.u; v = h.v; if (shifted) [de, dn] = shiftOf(sh, u, v); }
    if (u < 0 || v < 0 || u >= W || v >= H) return null;
    const g = pixelToGround(f, u, v); if (!g) return null;
    const b = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, O), [se, sn] = shifted ? shiftOf(sh, u, v) : [0, 0];
    return Math.hypot(b[0] + se - e, b[1] + sn - n) <= 0.05 ? [u, v] : null;
  };
  const groundOf = (u: number, v: number): Pt | null => { const g = pixelToGround(f, u, v); if (!g) return null; const b = toEnu({ lat: g.lat, lng: g.lng, altM: 0 }, O), [se, sn] = shiftOf(sh, u, v); return [b[0] + se, b[1] + sn]; };
  return { f, pi, W, H, pixelOf, groundOf, shift: shiftOf(sh, W / 2, H / 2) };
}

export default function CornInspector() {
  const [path, setPath] = useState(() => { try { return localStorage.getItem("cornInspector.path") ?? ""; } catch { return ""; } });
  const [analysisPath, setAnalysisPath] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [known, setKnown] = useState<{ path: string; photographs: number }[]>([]);
  const [photo, setPhoto] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [view, setView] = useState<"photo" | "green" | "cores">("photo");
  const [field, setField] = useState<Field | null>(null);
  const [info, setInfo] = useState<PhotoInfo | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [images, setImages] = useState<{ photo?: HTMLImageElement; green?: HTMLImageElement; cores?: HTMLImageElement }>({});
  const canvas = useRef<HTMLCanvasElement | null>(null), xf = useRef({ s: 0.2, x: 0, y: 0 }), [tick, setTick] = useState(0);

  useEffect(() => { fetch(`${API}/known`).then(r => r.json()).then(setKnown).catch(() => setKnown([])); }, []);
  const open = async () => {
    setError(null); setField(null); setInfo(null); setPhoto(null); setPicked(null);
    try { localStorage.setItem("cornInspector.path", path); } catch { /* not kept */ }
    const r = await fetch(`${API}/open`, { method: "POST", body: JSON.stringify({ path, analysis: analysisPath || undefined }) }), j = await r.json();
    if (!r.ok) { setError(j.error); return; }
    setSession(j); setPhoto(j.photos[0]?.name ?? null);
  };
  // The session's jobs, polled while any runs.
  useEffect(() => {
    if (!session) return;
    const busy = [session.jobs.build, session.jobs.reads, session.jobs.field, ...Object.values(session.jobs.photos)].some(j => j && (j.state === "running" || j.state === "waiting"));
    if (!busy) return;
    const t = setTimeout(async () => { const r = await fetch(`${API}/session/${session.id}`); if (r.ok) setSession(await r.json()); }, 1500);
    return () => clearTimeout(t);
  }, [session]);
  useEffect(() => { if (session?.kind === "flight" && session.jobs.field?.state === "done" && !field) loadField(session.id).then(setField).catch(e => setError(String(e))); }, [session, field]);
  // The photograph's own views and marks: asked once, then read from the cache.
  const photoJob = photo && session ? session.jobs.photos[photo] : undefined;
  useEffect(() => { if (!session || !photo) return; setInfo(null); setPicked(null); fetch(`${API}/photo/${session.id}/${encodeURIComponent(photo)}`, { method: "POST" }).then(r => r.json()).then(j => setSession(s => (s ? { ...s, jobs: { ...s.jobs, photos: { ...s.jobs.photos, [photo]: j } } } : s))); }, [session?.id, photo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (session && photo && photoJob?.state === "done" && (!info || info.name !== photo)) fetch(`${API}/cache/${session.id}/photo/${encodeURIComponent(photo)}/info.json`).then(r => r.json()).then(setInfo); }, [session, photo, photoJob?.state, info]);
  useEffect(() => {
    if (!session || !photo) return;
    const load = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });
    setImages({});
    load(`${API}/photo-file/${session.id}/${encodeURIComponent(photo)}`).then(im => { setImages(s => ({ ...s, photo: im })); const c = canvas.current; if (c) { const s = Math.min(c.clientWidth / im.width, c.clientHeight / im.height); xf.current = { s, x: (c.clientWidth - im.width * s) / 2, y: (c.clientHeight - im.height * s) / 2 }; setTick(t => t + 1); } });
    if (photoJob?.state === "done") { load(`${API}/cache/${session.id}/photo/${encodeURIComponent(photo)}/green.png`).then(im => setImages(s => ({ ...s, green: im }))).catch(() => undefined); load(`${API}/cache/${session.id}/photo/${encodeURIComponent(photo)}/cores.jpg`).then(im => setImages(s => ({ ...s, cores: im }))).catch(() => undefined); }
  }, [session?.id, photo, photoJob?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Everything of the flight that falls in this photograph, projected once.
  const P = useMemo(() => (field && photo ? projector(field, photo) : null), [field, photo]);
  const inPhoto = useMemo(() => {
    if (!field || !P) return null;
    const a = field.a, n = field.meta.nDots;
    // The photograph's ground, a little wider: the dots to try.
    const corners = [[0, 0], [P.W, 0], [0, P.H], [P.W, P.H], [P.W / 2, 0], [P.W / 2, P.H], [0, P.H / 2], [P.W, P.H / 2]].map(([u, v]) => P.groundOf(u, v)).filter((x): x is Pt => !!x);
    const e0 = Math.min(...corners.map(c => c[0])) - 1, e1 = Math.max(...corners.map(c => c[0])) + 1, n0 = Math.min(...corners.map(c => c[1])) - 1, n1 = Math.max(...corners.map(c => c[1])) + 1;
    const dots: { i: number; u: number; v: number }[] = [];
    for (let i = 0; i < n; i++) { const e = a["dot.e"][i], nn = a["dot.n"][i]; if (e < e0 || e > e1 || nn < n0 || nn > n1) continue; const q = P.pixelOf(e, nn); if (q) dots.push({ i, u: q[0], v: q[1] }); }
    const at = new Map(dots.map(d => [d.i, d]));
    const sights: { k: number; u: number; v: number; dot: number }[] = []; for (let k = 0; k < field.meta.nSights; k++) if (a["sight.p"][k] === P.pi) sights.push({ k, u: a["sight.u"][k], v: a["sight.v"][k], dot: field.sightDot[k] });
    const cands: { k: number; u: number; v: number; dot: number; lone: boolean }[] = []; for (let k = 0; k < field.meta.nCand; k++) if (a["cand.p"][k] === P.pi) cands.push({ k, u: a["cand.u"][k], v: a["cand.v"][k], dot: field.candDot[k], lone: a["cand.sight"][k] >= 0 });
    const rows = field.meta.rows.map(r => ({ ...r, px: r.line.map(([e, nn]) => P.pixelOf(e, nn)) }));
    // The ground's judgement under the photograph, every 24 pixels.
    let shade: HTMLCanvasElement | null = null; const G = field.meta.ground;
    if (G) {
      const S = 24, w = Math.ceil(P.W / S), h = Math.ceil(P.H / S); shade = document.createElement("canvas"); shade.width = w; shade.height = h;
      const ctx = shade.getContext("2d")!, im = ctx.createImageData(w, h), st = a["ground.state"];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const g = P.groundOf((x + 0.5) * S, (y + 0.5) * S); if (!g) continue;
        const i = Math.floor((g[0] - G.e0) / G.cell), j = Math.floor((g[1] - G.n0) / G.cell); const s = i >= 0 && j >= 0 && i < G.gw && j < G.gh ? st[j * G.gw + i] : 0;
        const o = (y * w + x) * 4, c = s === 1 ? [60, 255, 90] : s === 2 ? [255, 60, 60] : [150, 150, 150]; im.data[o] = c[0]; im.data[o + 1] = c[1]; im.data[o + 2] = c[2]; im.data[o + 3] = 255;
      }
      ctx.putImageData(im, 0, 0);
    }
    const plants = field.meta.report.plantPoints.map(([lat, lng], k) => { const b = toEnu({ lat, lng, altM: 0 }, field.meta.origin), q = P.pixelOf(b[0], b[1]); return q ? { u: q[0], v: q[1], shown: field.meta.report.plantShown[k] } : null; }).filter((x): x is { u: number; v: number; shown: number } => !!x);
    const weeds = field.meta.report.weeds.map(w => ({ ...w, px: P.pixelOf(w.e, w.n, false) })).filter(w => w.px);
    const gaps = field.meta.report.gaps.map(g => ({ ...g, a: P.pixelOf(g.aEN[0], g.aEN[1], false), b: P.pixelOf(g.bEN[0], g.bEN[1], false) })).filter(g => g.a && g.b);
    return { dots, at, sights, cands, rows, shade, plants, weeds, gaps };
  }, [field, P]);

  // ---- Drawing.
  const draw = useCallback(() => {
    const c = canvas.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1; if (c.width !== c.clientWidth * dpr) { c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; }
    const ctx = c.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = "#141414"; ctx.fillRect(0, 0, c.clientWidth, c.clientHeight);
    const { s, x, y } = xf.current, T = (u: number, v: number): Pt => [x + u * s, y + v * s];
    const base = images.photo; if (!base) return;
    ctx.imageSmoothingEnabled = s < 1;
    if (step === 0 && view === "cores" && images.cores) ctx.drawImage(images.cores, x, y, base.width * s, base.height * s);
    else { ctx.drawImage(base, x, y, base.width * s, base.height * s); if (step === 0 && view === "green" && images.green) { ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(x, y, base.width * s, base.height * s); ctx.drawImage(images.green, x, y, base.width * s, base.height * s); } }
    const dot = (u: number, v: number, r: number, col: string, fill = true) => { const [X, Y] = T(u, v); ctx.beginPath(); ctx.arc(X, Y, r, 0, 2 * Math.PI); if (fill) { ctx.fillStyle = col; ctx.fill(); } else { ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); } };
    const line = (pts: (Pt | null)[], col: string, w = 2, dash: number[] = []) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash); ctx.beginPath(); let pen = false; for (const p of pts) { if (!p) { pen = false; continue; } const [X, Y] = T(p[0], p[1]); if (pen) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); pen = true; } ctx.stroke(); ctx.setLineDash([]); };
    const r = Math.max(2, Math.min(6, 2 + s * 4));
    const D = inPhoto, a = field?.a;
    if (step === 1 && info) { for (const [u, v] of info.firstPass) dot(u, v, r, "#40d8ff"); for (const [u, v] of info.coresAdded) dot(u, v, r + 1, "#ff9a00"); }
    if (step === 2 && D && a) {
      for (const d of D.dots) dot(d.u, d.v, r + 2, d.i < field!.meta.strict ? "rgba(255,255,255,0.9)" : "rgba(255,230,40,0.45)", false);
      ctx.lineWidth = 1;
      for (const sg of D.sights) { const t = sg.dot >= 0 ? D.at.get(sg.dot) : null; if (t) line([[sg.u, sg.v], [t.u, t.v]], "rgba(64,216,255,0.9)", 1); dot(sg.u, sg.v, r * 0.7, sg.dot >= 0 ? "#40d8ff" : "#ff3c3c"); }
      for (const cd of D.cands) { const t = cd.dot >= 0 ? D.at.get(cd.dot) : null; if (t) line([[cd.u, cd.v], [t.u, t.v]], "rgba(255,154,0,0.8)", 1); dot(cd.u, cd.v, r * 0.6, cd.dot >= 0 ? "#ff9a00" : "rgba(255,154,0,0.35)"); }
    }
    if (step === 3 && D && a) for (const d of D.dots) { if (a["dot.certainty"][d.i] === 0) dot(d.u, d.v, r, "#3cff5a"); else dot(d.u, d.v, r * 0.6, "rgba(200,200,200,0.45)"); }
    if (step === 4 && D) {
      if (D.shade) { ctx.globalAlpha = 0.28; ctx.imageSmoothingEnabled = false; ctx.drawImage(D.shade, x, y, base.width * s, base.height * s); ctx.globalAlpha = 1; }
      for (const row of D.rows) line(row.px, row.kind === "certain" ? "#40d8ff" : "#ff60ff", 2);
    }
    if (step === 5 && D && a && field) for (const d of D.dots) { const name = field.meta.settledNames[a["dot.settled"][d.i]] ?? "none"; dot(d.u, d.v, r, VERDICT[name]?.col ?? "#000"); }
    if (step === 6) {
      if (field && D) { for (const g of D.gaps) if (g.verdict === "stand gap") line([g.a, g.b], "#ff9a00", 3); for (const p of D.plants) dot(p.u, p.v, r, SHOWN[p.shown]?.col ?? "#fff"); for (const w of D.weeds) if (w.verdict === "weed candidate") dot(w.px![0], w.px![1], r + 5, "#ff3c3c", false); }
      else if (info?.scout) { for (const row of info.scout.rows) { line(row.points, row.identity === "corn" ? "#40d8ff" : "#ffe628", 2, row.identity === "corn" ? [] : [8, 6]); for (const g of row.gaps) line([[g.x1, g.y1], [g.x2, g.y2]], "#ff9a00", 3); } for (const w of info.scout.weeds) line([...w.hull, w.hull[0]], "#ff3c3c", 2); }
    }
    if (picked != null && D) { const d = D.at.get(picked); if (d) { dot(d.u, d.v, r + 7, "#ffffff", false); dot(d.u, d.v, r + 9, "#000000", false); } }
  }, [images, step, view, info, inPhoto, field, picked]);
  useEffect(() => { draw(); }, [draw, tick]);
  useEffect(() => { const f = () => setTick(t => t + 1); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);

  // ---- Zoom, pan and a click on a dot.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const onWheel = (e: React.WheelEvent) => { const c = canvas.current!, b = c.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top, k = Math.exp(-e.deltaY * 0.0015), t = xf.current; xf.current = { s: t.s * k, x: mx - (mx - t.x) * k, y: my - (my - t.y) * k }; setTick(v => v + 1); };
  const onDown = (e: React.MouseEvent) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; };
  const onMove = (e: React.MouseEvent) => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true; xf.current = { ...xf.current, x: xf.current.x + dx, y: xf.current.y + dy }; d.x = e.clientX; d.y = e.clientY; setTick(v => v + 1); };
  const onUp = (e: React.MouseEvent) => {
    const d = drag.current; drag.current = null; if (!d || d.moved || !inPhoto || step < 2 || step > 5) return;
    const b = canvas.current!.getBoundingClientRect(), { s, x, y } = xf.current, u = (e.clientX - b.left - x) / s, v = (e.clientY - b.top - y) / s;
    let best: number | null = null, bd = 12 / s; for (const q of inPhoto.dots) { const dd = Math.hypot(q.u - u, q.v - v); if (dd < bd) { bd = dd; best = q.i; } }
    setPicked(best);
  };

  // ---- What went in and what came out, per step.
  const flight = session?.kind === "flight", M = field?.meta, A = field?.a;
  const counts = (pick: (i: number) => string, list: number[]) => { const c: Record<string, number> = {}; for (const i of list) { const k = pick(i); c[k] = (c[k] ?? 0) + 1; } return c; };
  const numbers = (): { title: string; rows: [string, string][] }[] => {
    if (!info && step < 2) return [{ title: "Waiting", rows: [["This photograph", photoJob?.state === "failed" ? `failed: ${photoJob.error ?? "see the log"}` : photoJob?.error ?? "being read on the dev server"]] }];
    if (FLIGHT_ONLY.has(step) && !flight) return [{ title: "Cannot run on a single photograph", rows: [["Why", "This step combines a flight's photographs through their cameras: it needs a folder of one flight's photographs."]] }];
    if (FLIGHT_ONLY.has(step) || (step === 6 && flight)) { if (!M || !A) return [{ title: "Waiting", rows: [["The flight", session?.jobs.build?.state === "running" ? "building its cameras (the app's build pipeline)" : session?.jobs.reads?.state === "running" ? `reading its photographs: ${session.jobs.reads.done ?? 0} of ${session.jobs.reads.total ?? "?"}` : session?.jobs.field?.state === "running" ? "combining the photographs over the field" : session?.jobs.field?.state === "failed" || session?.jobs.reads?.state === "failed" || session?.jobs.build?.state === "failed" ? "failed: see the logs in the session's folder" : "waiting"]] }]; if (M.failed) return [{ title: "The field", rows: [["Result", M.failed]] }]; if (!P) return [{ title: "This photograph", rows: [["In the flight", "no: it has no camera in the flight's record"]] }]; }
    const I = info;
    if (step === 0 && I) return [
      { title: "In", rows: [["Photograph", `${I.width} × ${I.height} px`], ["Pixel size", `${fmt((I.gsdM ?? NaN) * 1000, 2)} mm (${I.gsdBasis})`], ["Pixel size the read used", `${fmt(I.readScale.gsdM * 1000, 2)} mm (${I.readScale.basis})`]] },
      { title: "Out", rows: [["Green (the plant read's mask)", `${fmt(I.greenShare * 100, 2)} % of the photograph`], ["The green read's plans", I.plans.map(p => `${p.stage} ${fmt(p.share * 100, 0)} %`).join(", ") || "none"], ["Row spacing it holds", I.rowSpacingPx ? `${fmt(I.rowSpacingPx, 1)} px` : "none: no cores are made"],
        ...(I.cores ? [["Cores view: the two blurs", `${fmt(I.cores.finePx, 1)} and ${fmt(I.cores.widePx, 1)} px`], ["A core is kept at or over", I.cores.reference === "marks" ? `${I.cores.factor} × the median core on the read's own marks (${fmt(I.cores.medianOnMarks, 4)}) = ${fmt(I.cores.threshold, 4)}` : `${I.cores.share} × the strongest core (${fmt(I.cores.strongest, 4)}) = ${fmt(I.cores.threshold, 4)}`], ["Strongest core in the photograph", fmt(I.cores.strongest, 4)], ["Cores kept", `${fmt(I.cores.kept)} (${fmt(I.cores.keptInCover)} in cover, ${fmt(I.cores.keptOnNoPiece)} on no piece)`], ["Cores view brightness", `white at ${fmt(I.cores.white, 4)}, three times the bar`]] as [string, string][] : []),
        ["Count guard", `${I.guard.on ? "on" : "off (default)"}; green on ${I.guard.share == null ? "–" : fmt(I.guard.share * 100, 1) + " %"} of the rows' length, cut ${fmt(I.guard.cut * 100, 1)} %`], ["Time", `read ${fmt(I.readMs / 1000, 1)} s, all views ${fmt(I.ms / 1000, 1)} s`]] },
    ];
    if (step === 1 && I) return [
      { title: "In", rows: [["The green view", `${fmt(I.greenShare * 100, 2)} % green`], ["A typical plant", `${fmt(I.typicalPx, 0)} px across`]] },
      { title: "Out", rows: [["First-pass marks (blue)", fmt(I.firstPass.length)], ["Marks the cores add (orange)", `${fmt(I.coresAdded.length)} (the cores option is ${I.coresOn ? "ON" : "off by default"}: ${I.coresOn ? "the later steps use them" : "the later steps do not use them"})`], ["Marks the read carries", `${fmt(I.readMarks)} (equal to the pass expected: ${I.readMarksAreTheExpectedPass == null ? "count withheld" : I.readMarksAreTheExpectedPass ? "yes" : "NO"})`], ["Second-look candidates (lower bar)", I.candidates == null ? "not made on this photograph (the dark-leaf rule does not apply)" : fmt(I.candidates)], ["Rows in this photograph", `${I.rows.length} (${I.rows.filter(r => r.identity === "corn").length} corn)`]] },
    ];
    if (!M || !A || !P || !inPhoto) return [];
    const D = inPhoto, mine = D.sights.length, merged = D.sights.filter(s => s.dot >= 0).length;
    if (step === 2) return [
      { title: "In", rows: [["This photograph's marks", fmt(mine)], ["Its second-look sightings", `${fmt(D.cands.length)} (${fmt(D.cands.filter(c => c.lone).length)} of them its own lone marks)`], ["The flight", `${M.photos.length} photographs, ${fmt(M.nSights)} marks, ${fmt(M.nCand)} second-look sightings`]] },
      { title: "Out", rows: [["This photograph's marks in a dot (blue, a line to it)", `${fmt(merged)}`], ["… in no dot (red: no other photograph made it)", fmt(mine - merged)], ["Its second-look sightings in a candidate dot (orange)", fmt(D.cands.filter(c => c.dot >= 0).length)], ["Dots in this photograph", `${fmt(D.dots.filter(d => d.i < M.strict).length)} of the stricter marks (white rings), ${fmt(D.dots.filter(d => d.i >= M.strict).length)} candidates (yellow rings)`], ["Dots over the flight", `${fmt(M.strict)} + ${fmt(M.nDots - M.strict)} candidates`], ["Merging gate", cm(M.gateM)], ["Repeat distance (registration)", cm(M.repeatM)], ["This photograph's shift at its centre", `${fmt(Math.hypot(P.shift[0], P.shift[1]) * 100, 1)} cm`], ["Rule", `placeDots, src/lib/fieldTwin/cornPlants.ts:${M.lines.placeDots}`]] },
    ];
    if (step === 3) { const c = D.dots.filter(d => A["dot.certainty"][d.i] === 0).length; return [
      { title: "In", rows: [["Dots in this photograph", fmt(D.dots.length)], ["Rule", `certain when at least ${M.sequence.certainViews} photographs made it and at least ${fmt(Number(M.sequence.certainShare) * 100, 0)} % of those that looked: ${M.source}:${M.lines.certainEvidence}`]] },
      { title: "Out", rows: [["Certain dots here (green)", fmt(c)], ["Certain dots over the flight", fmt(M.geometry.certainDots)]] },
    ]; }
    if (step === 4) return [
      { title: "In", rows: [["Certain dots over the flight", fmt(M.geometry.certainDots)]] },
      { title: "Out", rows: [["Rows (certain: blue, found in a free slot: magenta)", `${M.rows.length}: ${M.rows.filter(r => r.kind === "certain").length} + ${M.rows.filter(r => r.kind === "geometry").length}; ${M.geometry.certainRows} row lines from the certain plants`], ["Row spacing", cm(M.geometry.spacingM)], ["Plant spacing", cm(M.geometry.seedM)], ["Too-close limit", `${cm(M.tooCloseM)} (${M.sequence.tooCloseFromField ? `learned from ${fmt(M.certainGaps)} gaps between certain plants` : "half the plant spacing"})`], ["Rows' direction", `${fmt(M.geometry.directionDeg, 1)}°`], ["Spacing rules run", M.spacingRules ? "yes" : "no: the plant spacing is not measured"], ["A gap is long from", M.spacingRules ? cm(M.gaps.gapM) : "–"],
        ["Ground (shaded)", M.planting.judged ? `judged: ${fmt(M.planting.plantedM2)} m² planted (green), ${fmt(M.planting.scatteredM2)} m² scattered (red), the rest not judged (grey)` : `not judged on this flight${M.planting.why ? `: ${M.planting.why}` : ""}`]] },
    ];
    if (step === 5) { const name = (i: number) => M.settledNames[A["dot.settled"][i]] ?? "none", here = counts(name, D.dots.map(d => d.i)), all = counts(name, Array.from({ length: M.nDots }, (_, i) => i)); return [
      { title: "Verdicts (here / over the flight); click a dot", rows: Object.keys(VERDICT).filter(k => all[k]).map(k => [`${VERDICT[k].placed ? "✓" : "✗"} ${k}`, `${fmt(here[k] ?? 0)} / ${fmt(all[k])}  (${M.source}:${M.settledLine[k] ?? "?"})`] as [string, string]) },
    ]; }
    if (step === 6) { const R = M.report, p = R.plants; return [
      { title: "Plants (as the Field Twin keeps them)", rows: p ? [["Plants", fmt(p.plants)], ["certain / probable", `${fmt(p.certain)} / ${fmt(p.probable)}`], ["on no row / between rows", `${fmt(p.onNoRow)} / ${fmt(p.betweenRows)}`], ...(p.alongRowsTwo != null ? [["along the rows, 2+ / 1 photograph", `${fmt(p.alongRowsTwo)} / ${fmt(p.alongRowsOne)}`]] as [string, string][] : []), ["Rows", fmt(p.rows)], ["Row length with plants seen / not confirmed", `${fmt(p.confirmedM)} / ${fmt(p.notConfirmedM)} m`], ["In this photograph", fmt(D.plants.length)]] : [["Plants", R.plantsNote ?? "–"]] },
      { title: "The field", rows: [["Corn rows / planted rows", `${R.field.cornRows} / ${R.field.probableRows}`], ["Weed candidates (red rings)", `${R.field.weeds} (withheld ${R.field.weedsWithheld}); here ${D.weeds.filter(w => w.verdict === "weed candidate").length}`], ["Stand gaps (orange)", `${R.field.gaps}; here ${D.gaps.filter(g => g.verdict === "stand gap").length}`]] },
    ]; }
    return [];
  };
  const scoutNumbers = (): { title: string; rows: [string, string][] }[] => {
    const S = info?.scout; if (!S) return [];
    const s = S.summary as Record<string, number | null>, v = S.cornV1 as Record<string, unknown> | undefined;
    return [{ title: "Photo Scout's read (as the page shows it)", rows: [["Rows", `${s.rows} (${v?.cornRows ?? "?"} corn: blue; ${v?.probableRows ?? "?"} crop not confirmed: dashed yellow)`], ["Plants located", v?.plants == null ? `withheld: ${String(v?.countWithheld ?? "–")}` : fmt(v.plants as number)], ["Weed candidates (red outlines)", fmt(s.weeds)], ["Stand gaps (orange)", `${fmt(s.gaps)}, ${fmt(s.gapLengthM, 1)} m`], ["Not judged", `${fmt(S.excluded)} borders, cover or withheld findings`], ["Pixel size", `${fmt(info!.readScale.gsdM * 1000, 2)} mm (${info!.readScale.basis})`]] }];
  };

  // ---- The picked dot.
  const dotPanel = () => {
    if (picked == null || !M || !A) return null;
    const i = picked, name = M.settledNames[A["dot.settled"][i]] ?? "none", V = VERDICT[name], st = A["dot.memberStart"], mem = A["dot.members"];
    const members: string[] = []; for (let k = st[i]; k < st[i + 1]; k++) { const m = mem[k]; if (i < M.strict) members.push(`${M.photos[A["sight.p"][m]]} (${Math.round(A["sight.u"][m])}, ${Math.round(A["sight.v"][m])})`); else members.push(`${M.photos[A["cand.p"][m]]} (${Math.round(A["cand.u"][m])}, ${Math.round(A["cand.v"][m])})${A["cand.sight"][m] >= 0 ? ", a lone stricter mark" : ", a lower-bar mark"}`); }
    const row = A["dot.rowOf"][i];
    return (
      <div className="mt-3 rounded border border-white/20 p-2 text-xs">
        <div className="mb-1 font-semibold">Dot {i}</div>
        <div>Tier: {i < M.strict ? TIER[0] : TIER[A["dot.tier"][i]] ?? "?"}</div>
        <div>Photographs that made it: {A["dot.photos"][i]} of {A["dot.covered"][i]} that looked{A["dot.certainEvidence"][i] ? " (certain on its own evidence)" : ""}</div>
        <div>Certainty: {["certain", "probable", "uncertain"][A["dot.certainty"][i]]}; {row >= 0 ? `on row ${M.rows[row]?.id} (${M.rows[row]?.kind})` : "on no row"}{A["dot.between"][i] ? "; between two rows" : ""}{A["dot.offSpacing"][i] ? "; placed by the spacing option" : ""}</div>
        <div className="mt-1" style={{ color: V?.col }}>{V?.words ?? name}</div>
        <div className="text-white/70">Rule: {M.source}:{M.settledLine[name] ?? "?"} ({name})</div>
        <div className="mt-1 text-white/70">Its sightings ({members.length}): {members.slice(0, 12).join("; ")}{members.length > 12 ? "; …" : ""}</div>
        <div className="text-white/50">Spread of its sightings: {fmt(A["dot.spread"][i] * 100, 1)} cm</div>
      </div>
    );
  };

  const jobLine = (label: string, j?: Job) => j ? <div>{label}: {j.state}{j.done != null && j.total ? ` (${j.done}/${j.total})` : ""}{j.error ? `: ${j.error}` : ""}{j.started ? ` (${fmt(((j.ended ?? Date.now()) - j.started) / 1000)} s)` : ""}</div> : null;
  const blocks = step === 6 && !flight ? scoutNumbers() : numbers();
  const legend: Record<number, [string, string][]> = {
    1: [["#40d8ff", "first-pass mark"], ["#ff9a00", "a mark the cores add"]],
    2: [["#40d8ff", "this photo's mark, a line to its dot"], ["#ff3c3c", "this photo's mark in no dot"], ["#ff9a00", "this photo's second-look sighting"], ["#ffffff", "dot of the stricter marks (ring)"], ["#ffe628", "candidate dot (ring)"]],
    3: [["#3cff5a", "certain dot"], ["#c8c8c8", "other dots"]],
    4: [["#40d8ff", "row from the certain plants"], ["#ff60ff", "row found in a free slot"], ["#3cff5a", "ground planted"], ["#ff3c3c", "ground scattered"], ["#969696", "ground not judged"]],
    5: Object.entries(VERDICT).filter(([k]) => k !== "none").map(([k, v]) => [v.col, k]),
    6: flight ? [...SHOWN.map(s => [s.col, s.name] as [string, string]), ["#ff3c3c", "weed candidate (ring)"], ["#ff9a00", "stand gap"]] : [["#40d8ff", "corn row"], ["#ffe628", "row, crop not confirmed"], ["#ff3c3c", "weed candidate"], ["#ff9a00", "stand gap"]],
  };

  return (
    <div className="flex h-screen bg-[#141414] text-white">
      <aside className="w-[380px] shrink-0 overflow-y-auto border-r border-white/10 p-3 text-sm">
        <div className="mb-2 text-base font-semibold">Corn inspector <span className="text-xs font-normal text-white/50">(dev only)</span></div>
        <label className="block text-xs text-white/60">A flight's folder, or one photograph</label>
        <input className="mb-1 w-full rounded bg-white/10 px-2 py-1" value={path} onChange={e => setPath(e.target.value)} placeholder="C:\\…\\photos or C:\\…\\photo.JPG" />
        <label className="block text-xs text-white/60">Analysis record (optional: found or built when empty)</label>
        <input className="mb-2 w-full rounded bg-white/10 px-2 py-1" value={analysisPath} onChange={e => setAnalysisPath(e.target.value)} list="corn-inspector-known" placeholder="…\\analysis.json" />
        <datalist id="corn-inspector-known">{known.map(k => <option key={k.path} value={k.path}>{k.photographs} photographs</option>)}</datalist>
        <button className="rounded bg-sky-600 px-3 py-1 font-medium hover:bg-sky-500" onClick={open}>Open</button>
        {error && <div className="mt-2 text-red-400">{error}</div>}
        {session && (
          <div className="mt-3 space-y-1 text-xs text-white/70">
            <div>{session.kind === "flight" ? `Flight: ${session.photos.length} photographs` : "One photograph, no flight"}</div>
            {session.kind === "flight" && <div>Cameras: {session.analysis ? `${session.analysis} (${session.analysisSource})` : "none yet"}</div>}
            {jobLine("Build", session.jobs.build)}{jobLine("Reads", session.jobs.reads)}{jobLine("Field", session.jobs.field)}{photo && jobLine("This photograph", photoJob)}
            {M && <div>Field: {M.photographsRead} of {M.photographs} photographs read; the record's field settings {M.fieldOptionsOfTheRecordEqualFIELD ? "equal" : "differ from"} the build's (FIELD); the build's are used.</div>}
          </div>
        )}
        {session && (
          <>
            <div className="mt-3 text-xs text-white/60">Photograph</div>
            <select className="w-full rounded bg-white/10 px-2 py-1" value={photo ?? ""} onChange={e => setPhoto(e.target.value)}>{session.photos.map(p => <option key={p.name} value={p.name} className="bg-neutral-800">{p.name}</option>)}</select>
            <ol className="mt-3 space-y-1">
              {STEPS.map((sname, k) => {
                const off = FLIGHT_ONLY.has(k) && !flight;
                return <li key={sname}><button className={`w-full rounded px-2 py-1 text-left ${step === k ? "bg-sky-700" : "bg-white/5 hover:bg-white/10"} ${off ? "text-white/35" : ""}`} onClick={() => { setStep(k); setPicked(null); }}>{k + 1}. {sname}{off ? " (needs a flight)" : ""}</button></li>;
              })}
            </ol>
            {step === 0 && <div className="mt-2 flex gap-2 text-xs">{(["photo", "green", "cores"] as const).map(v => <button key={v} className={`rounded px-2 py-1 ${view === v ? "bg-sky-700" : "bg-white/10"}`} onClick={() => setView(v)}>{v === "photo" ? "Photo" : v === "green" ? "Green view" : "Cores view"}</button>)}</div>}
            {dotPanel()}
            <div className="mt-3 space-y-3">
              {blocks.map(b => (
                <div key={b.title}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-white/60">{b.title}</div>
                  <table className="w-full text-xs"><tbody>{b.rows.map(([k, v]) => <tr key={k} className="align-top"><td className="py-0.5 pr-2 text-white/60">{k}</td><td className="py-0.5">{v}</td></tr>)}</tbody></table>
                </div>
              ))}
            </div>
            {legend[step] && <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">{legend[step].map(([c, t]) => <span key={t} className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />{t}</span>)}</div>}
            {info?.notes?.length ? <details className="mt-3 text-xs text-white/60"><summary>The read's notes</summary>{info.notes.map(n => <p key={n} className="mt-1">{n}</p>)}</details> : null}
          </>
        )}
      </aside>
      <main className="relative flex-1">
        <canvas ref={canvas} className="h-full w-full cursor-crosshair" onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => (drag.current = null)} />
        {!images.photo && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white/40">{session ? "Loading the photograph…" : "Open a flight's folder or a photograph."}</div>}
        <div className="pointer-events-none absolute bottom-2 right-3 text-xs text-white/40">wheel: zoom · drag: pan{step >= 2 && step <= 5 ? " · click: a dot" : ""}</div>
      </main>
    </div>
  );
}
