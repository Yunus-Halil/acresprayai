// A whole original photograph in a viewport: the wheel zooms about the
// cursor, a drag pans, and whatever is drawn over it is drawn in the photo's
// own pixels and rides along. Nothing is cut and nothing jumps: the point
// under the cursor stays under the cursor through a zoom, and the picture
// opens on the spot at a scale that shows its surroundings.
//
// The overlay is SVG children in native pixel coordinates; strokes use
// non-scaling-stroke so a hairline stays a hairline at every zoom.
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type ViewerInitial = {
  /** The native pixel to open on. */
  cx: number;
  cy: number;
  /** The native width to fit into the viewport when opening, or null to fit the whole photo. */
  fitWidthPx: number | null;
};

export const VIEWER_MAX_SCALE = 8;
export const VIEWER_WHEEL_STEP = 1.1;

export type ViewerState = { tx: number; ty: number; s: number };

/** The scale that fits `w` by `h` native pixels into the viewport, and the translation that centres (cx, cy). Pure. */
export function fitView(viewport: { width: number; height: number }, photo: { width: number; height: number }, initial: ViewerInitial): ViewerState {
  const minS = Math.min(viewport.width / photo.width, viewport.height / photo.height);
  const want = initial.fitWidthPx ? Math.min(viewport.width, viewport.height) / initial.fitWidthPx : minS;
  const s = Math.max(minS, Math.min(VIEWER_MAX_SCALE, want));
  return { s, tx: viewport.width / 2 - initial.cx * s, ty: viewport.height / 2 - initial.cy * s };
}

/** A zoom by `k` about the viewport point (px, py): what was under the cursor stays under it. Pure. */
export function zoomAbout(v: ViewerState, k: number, px: number, py: number, minS: number): ViewerState {
  const s = Math.max(minS, Math.min(VIEWER_MAX_SCALE, v.s * k));
  const ratio = s / v.s;
  return { s, tx: px - (px - v.tx) * ratio, ty: py - (py - v.ty) * ratio };
}

export function PhotoViewer({ src, width, height, initial, overlay, alt, heightCss = "70vh", onScale }: {
  src: string;
  width: number;
  height: number;
  initial: ViewerInitial;
  /** SVG elements in native pixels. */
  overlay?: ReactNode;
  alt: string;
  heightCss?: string;
  onScale?: (s: number) => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const [v, setV] = useState<ViewerState>({ tx: 0, ty: 0, s: 1 });
  const [minS, setMinS] = useState(0.01);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; id: number } | null>(null);

  const fit = useCallback((to: ViewerInitial) => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const viewport = { width: Math.max(1, r.width), height: Math.max(1, r.height) };
    setMinS(Math.min(viewport.width / width, viewport.height / height) * 0.5);
    setV(fitView(viewport, { width, height }, to));
  }, [width, height]);

  // Open on the spot; re-fit when the photo changes.
  useLayoutEffect(() => { fit(initial); }, [fit, src, initial.cx, initial.cy, initial.fitWidthPx]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onScale?.(v.s); }, [v.s, onScale]);

  // The wheel must be a non-passive listener to stop the page scrolling under it.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const k = Math.pow(VIEWER_WHEEL_STEP, -e.deltaY / 100);
      setV(cur => zoomAbout(cur, k, e.clientX - r.left, e.clientY - r.top, minS));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [minS]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, tx: v.tx, ty: v.ty, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setV(cur => ({ ...cur, tx: d.tx + (e.clientX - d.x), ty: d.ty + (e.clientY - d.y) }));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) { drag.current = null; e.currentTarget.releasePointerCapture(e.pointerId); }
  };
  const zoomCentre = (k: number) => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setV(cur => zoomAbout(cur, k, r.width / 2, r.height / 2, minS));
  };

  return (
    <div className="relative">
      <div ref={box} data-testid="photo-viewer"
        className="relative overflow-hidden bg-black select-none touch-none"
        style={{ height: heightCss, cursor: drag.current ? "grabbing" : "grab" }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <div style={{ transform: `translate(${v.tx}px, ${v.ty}px) scale(${v.s})`, transformOrigin: "0 0", width, height, position: "absolute", left: 0, top: 0, willChange: "transform" }}>
          <img src={src} alt={alt} width={width} height={height} draggable={false} data-testid="closer-look-image"
            style={{ width, height, maxWidth: "none", display: "block", imageRendering: v.s > 2 ? "pixelated" : "auto" }} />
          {overlay && (
            <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 pointer-events-none" data-testid="closer-look-pattern-overlay">
              {overlay}
            </svg>
          )}
        </div>
      </div>
      <div className="absolute top-2 right-2 flex flex-col gap-1 text-[11px]">
        <button type="button" onClick={() => zoomCentre(1.5)} className="rounded-sm border border-[#333] bg-black/70 px-2 py-1 text-neutral-200 hover:bg-[#1f1f1f]" title="Zoom in (or scroll)">+</button>
        <button type="button" onClick={() => zoomCentre(1 / 1.5)} className="rounded-sm border border-[#333] bg-black/70 px-2 py-1 text-neutral-200 hover:bg-[#1f1f1f]" title="Zoom out (or scroll)">−</button>
        <button type="button" onClick={() => fit(initial)} className="rounded-sm border border-[#333] bg-black/70 px-2 py-1 text-neutral-200 hover:bg-[#1f1f1f]" title="Back to the spot" data-testid="closer-look-fit-spot">spot</button>
        <button type="button" onClick={() => fit({ cx: width / 2, cy: height / 2, fitWidthPx: null })} className="rounded-sm border border-[#333] bg-black/70 px-2 py-1 text-neutral-200 hover:bg-[#1f1f1f]" title="The whole photo" data-testid="closer-look-fit-photo">all</button>
        <button type="button" onClick={() => { const el = box.current; if (!el) return; const r = el.getBoundingClientRect(); setV(cur => zoomAbout(cur, 1 / cur.s, r.width / 2, r.height / 2, minS)); }} className="rounded-sm border border-[#333] bg-black/70 px-2 py-1 text-neutral-200 hover:bg-[#1f1f1f]" title="One photo pixel per screen pixel" data-testid="closer-look-zoom">1:1</button>
      </div>
      <div className="absolute bottom-2 left-2 text-[10px] text-neutral-300 bg-black/60 px-1.5 py-0.5 rounded-sm pointer-events-none">
        {v.s >= 1 ? `${v.s.toFixed(1)}x` : `1/${(1 / v.s).toFixed(1)}`} · scroll to zoom, drag to move
      </div>
    </div>
  );
}
