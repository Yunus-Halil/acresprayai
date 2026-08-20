// A movable, resizable, hideable panel over the map.
//
// Drag the header to move it; it snaps to whichever of nine sections of the map
// you drop it nearest, with the candidate lit up while you drag so the landing
// is never a surprise. Drag the bottom-right corner to resize. Collapse to a
// single strip, or hide it entirely — and there is always a way back, because
// hiding everything must not be a one-way door.
//
// Pointer Events throughout rather than mouse events: the same code then works
// for a stylus and for the touchscreen on a field tablet, which is the device
// this is most likely to be used on.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, X } from "lucide-react";
import {
  type AnchorId, type PanelLimits, type PanelState, type Rect,
  ANCHORS, PANEL_MARGIN, anchorFraction, clampSize, nearestAnchor, positionFor,
} from "@/lib/panelLayout";

export function FloatingPanel({
  title, icon, state, limits, rect, badge, onChange, onHide, children,
}: {
  title: string;
  icon?: React.ReactNode;
  state: PanelState;
  limits: PanelLimits;
  /** The map's pixel size. Snapping and clamping are relative to it. */
  rect: Rect;
  /** Shown in the header when collapsed — a panel folded away still reports. */
  badge?: React.ReactNode;
  onChange: (next: PanelState) => void;
  onHide: () => void;
  children: React.ReactNode;
}) {
  const [drag, setDrag] = useState<{ dx: number; dy: number; x: number; y: number } | null>(null);
  const [resize, setResize] = useState<{ w: number; h: number; x: number; y: number } | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<AnchorId | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  const base = positionFor(state.anchor, state.size, rect);
  // While dragging, follow the pointer; the snap happens on release.
  const left = drag ? drag.x - drag.dx : base.left;
  const top = drag ? drag.y - drag.dy : base.top;
  const height = state.collapsed ? undefined : state.size.h;

  const onHeaderDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;   // let controls click
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ dx: e.clientX - box.left, dy: e.clientY - box.top, x: e.clientX, y: e.clientY });
  };

  // Drag and resize both live on window so a fast pointer that outruns the
  // panel does not drop the gesture halfway.
  useEffect(() => {
    if (!drag && !resize) return;
    const parent = ref.current?.parentElement?.getBoundingClientRect();

    const move = (e: PointerEvent) => {
      if (drag) {
        setDrag(d => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
        if (parent) {
          const cx = e.clientX - parent.left - drag.dx + state.size.w / 2;
          const cy = e.clientY - parent.top - drag.dy + (height ?? 40) / 2;
          setHoverAnchor(nearestAnchor({ x: cx, y: cy }, rect));
        }
      } else if (resize) {
        onChange({
          ...state,
          size: clampSize(
            { w: resize.w + (e.clientX - resize.x), h: resize.h + (e.clientY - resize.y) },
            limits, rect,
          ),
        });
      }
    };

    const up = () => {
      if (drag && hoverAnchor) onChange({ ...state, anchor: hoverAnchor });
      setDrag(null);
      setResize(null);
      setHoverAnchor(null);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [drag, resize, hoverAnchor, state, rect, limits, height, onChange]);

  const startResize = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    setResize({ w: state.size.w, h: state.size.h, x: e.clientX, y: e.clientY });
  }, [state.size.w, state.size.h]);

  return (
    <>
      {/* Snap targets, shown only while a drag is live. */}
      {drag && ANCHORS.map(id => {
        const f = anchorFraction(id);
        const active = hoverAnchor === id;
        return (
          <div key={id}
            className={`absolute z-[540] pointer-events-none rounded-sm border-2 border-dashed transition-colors ${
              active ? "border-[#4CAF50] bg-[#4CAF50]/10" : "border-white/15"}`}
            style={{
              width: 56, height: 34,
              left: PANEL_MARGIN + (rect.w - 56 - PANEL_MARGIN * 2) * f.fx,
              top: PANEL_MARGIN + (rect.h - 34 - PANEL_MARGIN * 2) * f.fy,
            }}
          />
        );
      })}

      <div
        ref={ref}
        className="absolute z-[550] rounded-md border border-[#222] overflow-hidden flex flex-col"
        style={{
          left, top, width: state.size.w, height,
          background: "rgba(10,10,10,0.86)",
          backdropFilter: "blur(4px)",
          boxShadow: drag ? "0 12px 32px rgba(0,0,0,0.55)" : "0 4px 14px rgba(0,0,0,0.35)",
          cursor: drag ? "grabbing" : undefined,
          transition: drag ? "none" : "left 140ms ease, top 140ms ease",
        }}
      >
        <div
          onPointerDown={onHeaderDown}
          className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] uppercase tracking-wider text-neutral-400 select-none shrink-0"
          style={{ cursor: drag ? "grabbing" : "grab" }}
        >
          <GripVertical className="h-3 w-3 text-neutral-600 shrink-0" />
          {icon}
          <span className="truncate">{title}</span>
          <span className="ml-auto flex items-center gap-0.5">
            {state.collapsed && badge}
            <button
              onClick={() => onChange({ ...state, collapsed: !state.collapsed })}
              aria-label={state.collapsed ? `Expand ${title}` : `Collapse ${title}`}
              className="p-0.5 hover:text-neutral-200 transition-colors">
              {state.collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            </button>
            <button onClick={onHide} aria-label={`Hide ${title}`}
              className="p-0.5 hover:text-red-300 transition-colors">
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>

        {!state.collapsed && (
          <div className="flex-1 min-h-0 overflow-auto px-2 pb-2">{children}</div>
        )}

        {!state.collapsed && (
          <div
            onPointerDown={startResize}
            aria-label={`Resize ${title}`}
            className="absolute bottom-0 right-0 h-3.5 w-3.5 cursor-nwse-resize"
            style={{
              background:
                "linear-gradient(135deg, transparent 0 50%, rgba(255,255,255,0.28) 50% 60%, transparent 60% 70%, rgba(255,255,255,0.28) 70% 80%, transparent 80%)",
            }}
          />
        )}
      </div>
    </>
  );
}

export default FloatingPanel;
