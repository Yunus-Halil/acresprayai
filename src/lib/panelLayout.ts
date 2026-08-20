// Floating map panels — where they sit, how big they are, and what happens
// when you let go of one.
//
// WHY SNAP AT ALL, rather than leaving panels wherever they land. Free-floating
// windows drift: a panel dropped two pixels off the edge looks like a mistake,
// and after a week of nudging, nothing lines up with anything. Snapping to a
// 3×3 grid of anchors means every arrangement an operator can reach is one that
// looks deliberate, and it makes "put it back" a real, cheap operation instead
// of a fiddle.
//
// Everything here is pure. Dragging is a browser concern; deciding where a drag
// ENDS is arithmetic, and arithmetic can be tested without a mouse.

/** Nine positions a panel can occupy — corners, edge midpoints, and centre. */
export type AnchorId =
  | "top-left" | "top-center" | "top-right"
  | "mid-left" | "center" | "mid-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

export const ANCHORS: AnchorId[] = [
  "top-left", "top-center", "top-right",
  "mid-left", "center", "mid-right",
  "bottom-left", "bottom-center", "bottom-right",
];

/** Fractional position of each anchor within the map rectangle. */
export const anchorFraction = (id: AnchorId): { fx: number; fy: number } => {
  const [row, col] = id.split("-");
  const fy = row === "top" ? 0 : row === "bottom" ? 1 : 0.5;
  const fx = col === "left" ? 0 : col === "right" ? 1 : 0.5;
  return { fx, fy };
};

export type Size = { w: number; h: number };
export type Rect = { w: number; h: number };

export type PanelState = {
  anchor: AnchorId;
  size: Size;
  visible: boolean;
  collapsed: boolean;
};

export type PanelLayout = Record<string, PanelState>;

/** Gap between a panel and the map edge, px. */
export const PANEL_MARGIN = 12;

export type PanelLimits = { min: Size; max: Size };

/**
 * Top-left pixel position for a panel at an anchor.
 *
 * Clamped so a panel can never be placed where its header is off-screen — a
 * panel you cannot grab is a panel you cannot move back.
 */
export function positionFor(anchor: AnchorId, size: Size, rect: Rect) {
  const { fx, fy } = anchorFraction(anchor);
  const usableW = Math.max(0, rect.w - size.w - PANEL_MARGIN * 2);
  const usableH = Math.max(0, rect.h - size.h - PANEL_MARGIN * 2);
  return {
    left: Math.round(PANEL_MARGIN + usableW * fx),
    top: Math.round(PANEL_MARGIN + usableH * fy),
  };
}

/**
 * The anchor a panel should snap to, given where its centre was dropped.
 *
 * Nearest by squared distance in FRACTIONAL space, so the decision does not
 * change when the map is resized — dropping a panel a third of the way across
 * means the same thing on a laptop and a wall display.
 */
export function nearestAnchor(centre: { x: number; y: number }, rect: Rect): AnchorId {
  const fx = rect.w > 0 ? centre.x / rect.w : 0.5;
  const fy = rect.h > 0 ? centre.y / rect.h : 0.5;
  let best: AnchorId = "center";
  let bestD = Infinity;
  for (const id of ANCHORS) {
    const a = anchorFraction(id);
    const d = (a.fx - fx) ** 2 + (a.fy - fy) ** 2;
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

/** Keep a resize inside the panel's own limits and inside the map. */
export function clampSize(size: Size, limits: PanelLimits, rect: Rect): Size {
  const maxW = Math.min(limits.max.w, Math.max(limits.min.w, rect.w - PANEL_MARGIN * 2));
  const maxH = Math.min(limits.max.h, Math.max(limits.min.h, rect.h - PANEL_MARGIN * 2));
  return {
    w: Math.round(Math.max(limits.min.w, Math.min(maxW, size.w))),
    h: Math.round(Math.max(limits.min.h, Math.min(maxH, size.h))),
  };
}

/**
 * Panels that would overlap, given where they sit.
 *
 * Two panels on the same anchor is the one arrangement snapping can produce
 * that is worse than free dragging — the lower one is simply invisible. The UI
 * uses this to offer a nudge rather than silently stacking them.
 */
export function collisions(layout: PanelLayout): [string, string][] {
  const out: [string, string][] = [];
  const ids = Object.keys(layout).filter(id => layout[id].visible);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (layout[ids[i]].anchor === layout[ids[j]].anchor) out.push([ids[i], ids[j]]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const KEY = "swathwise.panels";

/**
 * Merge a stored layout over the defaults.
 *
 * Defaults win for any panel the stored blob has never heard of, so adding a
 * new panel later does not require a migration and does not leave it invisible
 * for everyone who has already arranged their screen.
 */
export function mergeLayout(defaults: PanelLayout, stored: unknown): PanelLayout {
  const out: PanelLayout = {};
  for (const [id, def] of Object.entries(defaults)) {
    const raw = (stored && typeof stored === "object")
      ? (stored as Record<string, unknown>)[id]
      : null;
    if (!raw || typeof raw !== "object") { out[id] = { ...def }; continue; }
    const p = raw as Partial<PanelState>;
    out[id] = {
      anchor: ANCHORS.includes(p.anchor as AnchorId) ? (p.anchor as AnchorId) : def.anchor,
      size: (p.size && typeof p.size.w === "number" && typeof p.size.h === "number")
        ? { w: p.size.w, h: p.size.h }
        : { ...def.size },
      visible: typeof p.visible === "boolean" ? p.visible : def.visible,
      collapsed: typeof p.collapsed === "boolean" ? p.collapsed : def.collapsed,
    };
  }
  return out;
}

export function loadLayout(defaults: PanelLayout): PanelLayout {
  try {
    const raw = localStorage.getItem(KEY);
    return mergeLayout(defaults, raw ? JSON.parse(raw) : null);
  } catch {
    return mergeLayout(defaults, null);   // private mode, or corrupt JSON
  }
}

export function saveLayout(layout: PanelLayout): void {
  try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch { /* private mode */ }
}

export function clearLayout(): void {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}
