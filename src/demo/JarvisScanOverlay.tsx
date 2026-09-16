// DEMO_JARVIS — the HUD that plays over the Treatment Grid map while Find
// Similar runs. See jarvisDemo.ts for what is real versus scripted and for
// removal instructions. Pure presentation: it never writes to the grid.
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { useMap } from "react-leaflet";
import type L from "leaflet";
import { X } from "lucide-react";
import type { CellId, TreatmentGrid } from "@/lib/treatmentGrid";
import type { LatLng2 } from "@/lib/geo";
import { candidateTotals } from "@/lib/findSimilar";
import { RGB_FEATURES } from "@/lib/cellFeatures";
import { type UnitSystem, fmtArea, fmtRate, fmtVolume } from "@/lib/units";
import {
  DEMO_TARGET_KEY, DEMO_TARGET_TEXT, DEMO_WEED_CAROUSEL, type DemoWeed,
} from "./jarvisDemo";

/** Rendered inside MapContainer only to hand the Leaflet map instance out. */
export function MapHandle({ onMap }: { onMap: (m: L.Map) => void }) {
  const map = useMap();
  useEffect(() => { onMap(map); }, [map, onMap]);
  return null;
}

const GREEN = "#4CAF50";
const AMBER = "#f5b42a";
/** Lines drawn to the strongest candidates; the rest are counted, not drawn. */
const MAX_LINES = 16;
const CAROUSEL_TICKS = 24;

type Phase = "scan" | "identified" | "branch" | "program";

function useTyped(text: string, active: boolean, cps = 95): string {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) { setN(0); return; }
    let i = 0;
    const id = window.setInterval(() => {
      i += 2;
      setN(Math.min(i, text.length));
      if (i >= text.length) window.clearInterval(id);
    }, 2000 / cps);
    return () => window.clearInterval(id);
  }, [text, active, cps]);
  return text.slice(0, n);
}

function Glyph({ w, size, color, dim }: { w: DemoWeed; size: number; color: string; dim?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden
      style={{ opacity: dim ? 0.35 : 1, filter: dim ? "none" : `drop-shadow(0 0 4px ${color})` }}>
      <path d={w.glyph} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The real photograph, cropped square; falls back to the glyph if it fails to load. */
function Photo({ w, size, active, settled }: { w: DemoWeed; size: number; active: boolean; settled?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Glyph w={w} size={size * 0.7} color={active ? GREEN : "#8a8a8a"} dim={!active} />;
  return (
    <img src={w.image} alt={w.common} width={size} height={size} onError={() => setFailed(true)}
      style={{
        width: size, height: size, objectFit: "cover", display: "block", borderRadius: 2,
        filter: active ? "none" : "grayscale(0.7) brightness(0.55)",
        boxShadow: settled ? `0 0 14px ${GREEN}aa` : "none",
        transition: "filter 80ms",
      }} />
  );
}

/** Corner brackets — the HUD frame. */
function Frame({ color }: { color: string }) {
  const c: CSSProperties = { position: "absolute", width: 10, height: 10, borderColor: color, borderStyle: "solid" };
  return (
    <>
      <span style={{ ...c, top: -1, left: -1, borderWidth: "2px 0 0 2px" }} />
      <span style={{ ...c, top: -1, right: -1, borderWidth: "2px 2px 0 0" }} />
      <span style={{ ...c, bottom: -1, left: -1, borderWidth: "0 0 2px 2px" }} />
      <span style={{ ...c, bottom: -1, right: -1, borderWidth: "0 2px 2px 0" }} />
    </>
  );
}

const cardBase: CSSProperties = {
  position: "absolute",
  background: "rgba(6, 10, 7, 0.86)",
  border: `1px solid ${GREEN}66`,
  backdropFilter: "blur(6px)",
  color: "#e6f4e6",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  boxShadow: `0 0 24px ${GREEN}22`,
  animation: "jv-in 320ms ease-out both",
};

export function JarvisScanOverlay({
  map, grid, exampleIds, candidates, running, rateLha, units, cellPx, onReveal, onClose,
}: {
  map: L.Map;
  grid: TreatmentGrid;
  /** The operator's own treated marks — the reference the scan is reading. */
  exampleIds: ReadonlySet<CellId>;
  /** Live result of the real Find Similar run; null while it is still running. */
  candidates: ReadonlyMap<CellId, number> | null;
  running: boolean;
  rateLha: number;
  units: UnitSystem;
  cellPx: number | null;
  /** Fired when the lines start drawing — the grid layer may show candidates now. */
  onReveal: () => void;
  onClose: () => void;
}) {
  // Re-project on every pan/zoom so the HUD stays glued to the ground.
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force(n => n + 1);
    map.on("move zoom viewreset resize", f);
    return () => { map.off("move zoom viewreset resize", f); };
  }, [map]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ---- Carousel: fast, then decelerating, always landing on the target ----
  //
  // `pos` is an absolute index into a filmstrip of repeated entries, so the
  // strip only ever slides one way; the entry under the frame is pos % len.
  // The strip starts so that CAROUSEL_TICKS steps later it lands on the target.
  const targetIdx = Math.max(0, DEMO_WEED_CAROUSEL.findIndex(w => w.key === DEMO_TARGET_KEY));
  const len = DEMO_WEED_CAROUSEL.length;
  const startPos = ((targetIdx - CAROUSEL_TICKS) % len + len) % len;
  const [pos, setPos] = useState(startPos);
  const [stepMs, setStepMs] = useState(60);
  const [spun, setSpun] = useState(false);
  useEffect(() => {
    let i = 0;
    let t = 0;
    const delayAt = (k: number) => { const p = k / CAROUSEL_TICKS; return 60 + 520 * p * p * p; };
    const step = () => {
      i++;
      setPos(startPos + i);
      if (i >= CAROUSEL_TICKS) { setSpun(true); return; }
      const d = delayAt(i);
      setStepMs(d);
      t = window.setTimeout(step, d);
    };
    t = window.setTimeout(step, 60);
    return () => window.clearTimeout(t);
  }, [startPos]);
  const current = DEMO_WEED_CAROUSEL[pos % len];

  // ---- Phase machine: gated on BOTH the animation and the real result ------
  const ready = spun && !running && candidates !== null;
  const [phase, setPhase] = useState<Phase>("scan");
  const lineCount = Math.min(MAX_LINES, candidates?.size ?? 0);
  useEffect(() => {
    if (!ready || phase !== "scan") return;
    const t = window.setTimeout(() => setPhase("identified"), 250);
    return () => window.clearTimeout(t);
  }, [ready, phase]);
  useEffect(() => {
    if (phase !== "identified") return;
    const t = window.setTimeout(() => { setPhase("branch"); onReveal(); }, 1800);
    return () => window.clearTimeout(t);
  }, [phase, onReveal]);
  useEffect(() => {
    if (phase !== "branch") return;
    const t = window.setTimeout(() => setPhase("program"), 700 + lineCount * 70 + 500);
    return () => window.clearTimeout(t);
  }, [phase, lineCount]);

  // ---- Geometry ------------------------------------------------------------
  const size = map.getSize();
  const px = (p: LatLng2) => map.latLngToContainerPoint([p.lat, p.lng]);

  const examples = useMemo(
    () => grid.cells.filter(c => exampleIds.has(c.id)),
    [grid, exampleIds],
  );
  const topCandidates = useMemo(() => {
    if (!candidates) return [];
    const byId = new Map(grid.cells.map(c => [c.id, c]));
    return [...candidates.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_LINES)
      .flatMap(([id, score]) => {
        const cell = byId.get(id);
        return cell ? [{ cell, score }] : [];
      });
  }, [candidates, grid]);

  // Reticle: centred on the marked examples, sized to cover them.
  let cx = size.x / 2, cy = size.y / 2, r = 40;
  if (examples.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of examples) {
      const q = px(c.centroid);
      minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
    }
    cx = (minX + maxX) / 2; cy = (minY + maxY) / 2;
    const half = Math.hypot(maxX - minX, maxY - minY) / 2 + (cellPx ?? 20) * 0.8;
    r = Math.max(34, Math.min(170, half));
  }
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  // Recognition viewer above the reticle: one large frame plus a sliding
  // filmstrip. `stripW/H` are its outer size (the status card hangs off it).
  const tile = 44, gap = 4, stepPx = tile + gap;
  const frameW = 236, frameH = 132;
  const stripW = frameW + 16, stripH = 8 + frameH + 6 + 30 + 6 + tile + 8;
  const stripX = clamp(cx - stripW / 2, 8, size.x - stripW - 8);
  const stripY = clamp(cy - r - 18 - stripH, 8, size.y - stripH - 8);

  // Identity card: left of the reticle when there is room, else right.
  const cardW = 316, cardH = 196;
  const roomLeft = cx - r - 24 - cardW >= 8;
  const cardX = roomLeft ? cx - r - 24 - cardW : clamp(cx + r + 24, 8, size.x - cardW - 8);
  const cardY = clamp(cy - cardH / 2, stripY + stripH + 8, size.y - cardH - 8);
  // Where the branch lines leave the card.
  const anchor = { x: roomLeft ? cardX + cardW : cardX, y: cardY + cardH / 2 };

  // Treatment card: bottom-right, just above the basemap toggle.
  const progW = 330;
  const progX = size.x - progW - 16, progBottom = 56;

  const target = DEMO_WEED_CAROUSEL[targetIdx];
  const showCard = phase !== "scan";
  const finding = useTyped(DEMO_TARGET_TEXT.finding, showCard);
  const totals = candidates
    ? candidateTotals(grid, new Set(candidates.keys()), rateLha)
    : null;
  // Cells along the boundary are clipped, so N cells rarely equal N × cell².
  // Say so whenever the difference is one an operator could notice.
  const nominalM2 = totals ? totals.count * grid.cellSizeM * grid.cellSizeM : 0;
  const clippedNotably = !!totals && totals.count > 0 && totals.areaM2 < nominalM2 * 0.98;

  const statusLines = [
    `Sampling ${grid.cells.length.toLocaleString()} cells${cellPx ? ` · ${Math.round(cellPx)} px per cell` : ""}`,
    `${RGB_FEATURES.length} colour and variation features per cell`,
    `${examples.length} marked example${examples.length === 1 ? "" : "s"} as reference`,
    ...(spun && !ready ? ["Matching…"] : []),
  ];

  return (
    <div className="absolute inset-0 z-[600]" style={{ pointerEvents: "none" }} aria-live="polite">
      <style>{`
        @keyframes jv-in { from { opacity: 0; transform: translateY(6px) scale(.97); } to { opacity: 1; transform: none; } }
        @keyframes jv-spin { to { transform: rotate(360deg); } }
        @keyframes jv-spin-r { to { transform: rotate(-360deg); } }
        @keyframes jv-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
        @keyframes jv-pulse { 0% { r: 3; opacity: 1; } 100% { r: 16; opacity: 0; } }
        @keyframes jv-lock { 0% { transform: scale(1.12); opacity: .4; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes jv-blink { 50% { opacity: 0; } }
      `}</style>

      {/* Reticle + branch lines */}
      <svg width={size.x} height={size.y} className="absolute inset-0" style={{ overflow: "visible" }}>
        <g style={{ transformOrigin: `${cx}px ${cy}px`, animation: phase === "scan" ? "jv-spin 4s linear infinite" : "none" }}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={GREEN} strokeWidth={1.4}
            strokeDasharray={phase === "scan" ? "14 8" : undefined} opacity={0.9} />
        </g>
        <g style={{ transformOrigin: `${cx}px ${cy}px`, animation: phase === "scan" ? "jv-spin-r 2.6s linear infinite" : "none" }}>
          <circle cx={cx} cy={cy} r={Math.max(6, r - 8)} fill="none" stroke={GREEN} strokeWidth={1}
            strokeDasharray="2 6" opacity={0.6} />
        </g>
        {[0, 90, 180, 270].map(a => {
          const rad = (a * Math.PI) / 180;
          return (
            <line key={a}
              x1={cx + Math.cos(rad) * (r + 4)} y1={cy + Math.sin(rad) * (r + 4)}
              x2={cx + Math.cos(rad) * (r + 14)} y2={cy + Math.sin(rad) * (r + 14)}
              stroke={GREEN} strokeWidth={1.5} />
          );
        })}
        {/* Reticle → identity card tether */}
        {showCard && (
          <line x1={roomLeft ? cx - r : cx + r} y1={cy} x2={anchor.x} y2={anchor.y}
            stroke={GREEN} strokeWidth={1} strokeDasharray="3 4" opacity={0.7} />
        )}
        {/* Branches to the real candidates */}
        {(phase === "branch" || phase === "program") && topCandidates.map(({ cell }, i) => {
          const q = px(cell.centroid);
          const dx = (q.x - anchor.x) * 0.5;
          const d = `M${anchor.x},${anchor.y} C${anchor.x + dx},${anchor.y} ${q.x - dx},${q.y} ${q.x},${q.y}`;
          return (
            <g key={cell.id}>
              <path d={d} fill="none" stroke={AMBER} strokeWidth={1.2} opacity={0.85}
                pathLength={1} strokeDasharray="1" strokeDashoffset={1}
                style={{ animation: `jv-draw 600ms ease-out ${i * 70}ms forwards` }} />
              <circle cx={q.x} cy={q.y} r={3} fill="none" stroke={AMBER} strokeWidth={1.5}
                style={{ animation: `jv-pulse 1.2s ease-out ${600 + i * 70}ms infinite` }} />
              <circle cx={q.x} cy={q.y} r={2.2} fill={AMBER}
                style={{ opacity: 0, animation: `jv-in 200ms ease-out ${600 + i * 70}ms forwards` }} />
            </g>
          );
        })}
      </svg>

      {/* Recognition viewer: the frame shows the candidate under comparison,
          the filmstrip slides beneath it and the frame locks when it settles. */}
      <div style={{ ...cardBase, left: stripX, top: stripY, width: stripW, height: stripH, padding: 8 }}>
        <Frame color={GREEN} />
        <div style={{ position: "relative", width: frameW, height: frameH, overflow: "hidden", borderRadius: 2, background: "#050705" }}>
          <img key={current.key} src={current.image} alt={current.common}
            style={{
              width: "100%", height: "100%", objectFit: "cover", display: "block",
              filter: spun ? "none" : "saturate(0.85) contrast(1.05)",
            }} />
          {/* frame brackets; they snap in on the lock */}
          <div style={{
            position: "absolute", inset: spun ? 6 : 12, pointerEvents: "none",
            animation: spun ? "jv-lock 320ms ease-out both" : "none",
            transition: "inset 120ms",
          }}>
            <Frame color={spun ? GREEN : `${GREEN}99`} />
          </div>
          {/* scan-line texture while comparing */}
          {!spun && (
            <div style={{
              position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.35,
              background: "repeating-linear-gradient(0deg, transparent 0 3px, rgba(0,0,0,.35) 3px 4px)",
            }} />
          )}
          <div style={{
            position: "absolute", left: 8, bottom: 6, right: 8, display: "flex",
            justifyContent: "space-between", alignItems: "baseline", fontSize: 9,
            letterSpacing: "0.14em", color: spun ? GREEN : "#b9dcb9",
            textShadow: "0 1px 2px rgba(0,0,0,.9)",
          }}>
            <span>{spun ? "MATCH" : "COMPARING"}</span>
            <span style={{ letterSpacing: 0, fontSize: 8.5, color: "#9fc99f" }}>
              {String((pos % len) + 1).padStart(2, "0")} / {String(len).padStart(2, "0")}
            </span>
          </div>
        </div>
        <div style={{ height: 30, marginTop: 6, lineHeight: 1.2 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: spun ? "#f4fff4" : "#d8ecd8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {current.common}
          </div>
          <div style={{ fontSize: 9.5, fontStyle: "italic", color: "#9fc99f" }}>{current.latin}</div>
        </div>
        {/* filmstrip: absolute positions, slides one way, wraps by repetition */}
        <div style={{ position: "relative", width: frameW, height: tile, marginTop: 6, overflow: "hidden" }}>
          <div style={{
            position: "absolute", top: 0, left: 0, display: "flex", gap,
            transform: `translateX(${frameW / 2 - tile / 2 - pos * stepPx}px)`,
            transition: `transform ${Math.round(stepMs * 0.85)}ms cubic-bezier(.2,.7,.3,1)`,
          }}>
            {Array.from({ length: startPos + CAROUSEL_TICKS + len + 2 }, (_, k) => {
              const w = DEMO_WEED_CAROUSEL[k % len];
              const active = k === pos;
              return (
                <div key={k} title={w.common}
                  style={{
                    width: tile, height: tile, flexShrink: 0, borderRadius: 2, padding: 1,
                    border: `1px solid ${active ? GREEN : "#232823"}`,
                    transition: "border-color 80ms",
                  }}>
                  <Photo w={w} size={tile - 4} active={active} settled={spun && active} />
                </div>
              );
            })}
          </div>
          {/* centre marker under the frame */}
          <div style={{
            position: "absolute", left: frameW / 2 - 1, top: 0, width: 2, height: 4, background: GREEN,
          }} />
        </div>
      </div>

      {/* Scan status under the strip while sampling */}
      {phase === "scan" && (
        <div style={{
          ...cardBase, left: stripX, top: stripY + stripH + 6, width: stripW, padding: "6px 10px",
          fontSize: 10, lineHeight: 1.5, color: "#b9dcb9",
        }}>
          <Frame color={GREEN} />
          {statusLines.map((s, i) => (
            <div key={s} style={{ animation: `jv-in 260ms ease-out ${i * 450}ms both` }}>
              <span style={{ color: GREEN }}>›</span> {s}
              {i === statusLines.length - 1 && (
                <span style={{ animation: "jv-blink 900ms step-end infinite" }}>_</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Identity card */}
      {showCard && (
        <div style={{ ...cardBase, left: cardX, top: cardY, width: cardW, minHeight: cardH, padding: 12 }}>
          <Frame color={GREEN} />
          <div className="flex items-start gap-3">
            <div style={{ border: `1px solid ${GREEN}`, padding: 2, borderRadius: 2, flexShrink: 0 }}>
              <Photo w={target} size={64} active settled />
            </div>
            <div className="min-w-0">
              <div style={{ fontSize: 9, letterSpacing: "0.18em", color: GREEN }}>MATCH</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#f4fff4", lineHeight: 1.15 }}>{target.common}</div>
              <div style={{ fontSize: 10, fontStyle: "italic", color: "#9fc99f" }}>{target.latin}</div>
              <div style={{ fontSize: 8.5, color: "#6f8f6f", marginTop: 3 }}>Photo: {target.credit}</div>
            </div>
          </div>
          <div style={{ fontSize: 9.5, color: "#a9cfa9", marginTop: 8, borderTop: `1px solid ${GREEN}33`, paddingTop: 6 }}>
            {DEMO_TARGET_TEXT.identity}
          </div>
          <div style={{ fontSize: 10.5, lineHeight: 1.45, color: "#e0f0e0", marginTop: 6 }}>
            {finding}
            {finding.length < DEMO_TARGET_TEXT.finding.length && (
              <span style={{ color: GREEN, animation: "jv-blink 700ms step-end infinite" }}>▌</span>
            )}
          </div>
        </div>
      )}

      {/* Treatment card */}
      {phase === "program" && (
        <div style={{ ...cardBase, left: progX, bottom: progBottom, width: progW, padding: 12, pointerEvents: "auto" }}>
          <Frame color={AMBER} />
          <div className="flex items-baseline justify-between mb-1">
            <div style={{ fontSize: 9, letterSpacing: "0.18em", color: AMBER }}>TREATMENT ZONES</div>
            {totals && totals.count > 0 && (
              <div style={{ fontSize: 10, color: "#f7d98a" }}>
                {totals.count} cell{totals.count === 1 ? "" : "s"} matched
              </div>
            )}
          </div>
          {totals && totals.count > 0 && (
            <div style={{ fontSize: 10.5, color: "#efe9d8", lineHeight: 1.45, marginBottom: 8 }}>
              Treated area <span style={{ color: "#f7d98a" }}>{fmtArea(totals.areaM2, units).text}</span>
              {clippedNotably && (
                <span style={{ color: "#c9b57a" }}>
                  {" "}(edge cells clipped to the field boundary, so less than {totals.count} full cells)
                </span>
              )}
            </div>
          )}
          {totals && totals.count === 0 && (
            <div style={{ fontSize: 10.5, color: "#e6dcc2", lineHeight: 1.45, marginBottom: 8 }}>
              No further cells matched beyond your marked examples. The notes below
              apply to the cells you marked.
            </div>
          )}
          {candidates && candidates.size > MAX_LINES && (
            <div style={{ fontSize: 9.5, color: "#c9b57a", marginBottom: 6 }}>
              Lines show the {MAX_LINES} strongest matches; all {candidates.size} are outlined on the map.
            </div>
          )}
          <div className="grid gap-1.5" style={{ gridTemplateColumns: "72px 1fr", fontSize: 10.5, lineHeight: 1.4 }}>
            {DEMO_TARGET_TEXT.program.map((row, i) => (
              <div key={row.label} className="contents">
                <div style={{ color: AMBER, animation: `jv-in 260ms ease-out ${i * 220}ms both` }}>{row.label}</div>
                <div style={{ color: "#efe9d8", animation: `jv-in 260ms ease-out ${i * 220}ms both` }}>{row.text}</div>
              </div>
            ))}
            <div style={{ color: AMBER, animation: "jv-in 260ms ease-out 880ms both" }}>Volume</div>
            <div style={{ color: "#efe9d8", animation: "jv-in 260ms ease-out 880ms both" }}>
              Application volume {fmtRate(rateLha, units).text} from your settings
              {totals && totals.count > 0 && <>, {fmtVolume(totals.volumeL, units).text} of spray mix for the treated area</>}.
              {" "}Drone carrier volume, not a product rate; ground-rig labels often specify far more.
            </div>
          </div>
          <div style={{ fontSize: 9, color: "#8f8a78", marginTop: 8, lineHeight: 1.4 }}>{DEMO_TARGET_TEXT.caveat}</div>
          <button onClick={onClose}
            className="mt-2.5 w-full text-[11px] rounded-sm px-2 py-1.5 font-semibold"
            style={{ background: AMBER, color: "#111" }}>
            Review zones →
          </button>
        </div>
      )}

      {/* Always-available exit */}
      <button onClick={onClose} aria-label="Close scan overlay"
        className="absolute top-3 right-3 inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-sm"
        style={{ pointerEvents: "auto", background: "rgba(0,0,0,.7)", border: "1px solid #333", color: "#bbb" }}>
        <X className="h-3 w-3" /> Esc
      </button>
    </div>
  );
}
