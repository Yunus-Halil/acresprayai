// Treatment-grid zones on the Field View map, presented the way AI zones and
// hand-drawn anomalies already are: polygons with a popup naming what, where,
// how much — and, unlike the other two, a popup you can triage from.
//
// These shapes are projections of grid cells, not records of their own (see
// lib/gridAnomalies.ts). That is why the popup still has no delete button where
// AiZonesLayer and UserPolyLayer have one: deleting a projection is meaningless,
// and removing the cells from here would be a second, less careful editing
// surface for state the Treatment Grid tab guards with locks and confirmations.
//
// WHAT THE POPUP MAY EDIT. The classification and the note, and nothing else.
// Both are descriptions of the ground; neither changes what is treated or at
// what rate. Rate and treated-state stay where they are decided, cell by cell,
// in the Treatment Grid tab. A write from here goes to the same cells that tab
// writes, so the two views cannot disagree — there is no second record here to
// disagree with.
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { LatLng2 } from "@/lib/geo";
import type { GridZone } from "@/lib/gridZones";
import { UNCLASSIFIED_LABEL, classifyGridZone } from "@/lib/gridAnomalies";
import { MAX_NOTE_CHARS } from "@/lib/treatmentGrid";
import { escapeHtml, safeLabel, USER_POLY_ISSUES } from "./layers";
import { fmtArea, fmtRate } from "@/lib/units";
import { useUnitSystem } from "@/hooks/useUnitSystem";

/** Amber, matching the candidate/suggestion colour family — grid-flagged
    ground is operator-decided but distinct from AI severities. */
const COLOR = "#f59e0b";

/** Idle delay before a typed note is written. Same feel as the grid's own save. */
const NOTE_DEBOUNCE_MS = 600;

/** The zone's description as it currently stands on screen. */
type Draft = { issue: string; note: string };

export function GridAnomaliesLayer({
  zones, fieldId, boundary, onZonesChanged,
}: {
  zones: GridZone[];
  /** Null when the scan has no field: classification has nowhere to be saved. */
  fieldId: string | null;
  boundary: LatLng2[][] | null;
  /**
   * Fired after a classification write lands, so the shell can refresh the
   * scan's assessment snapshot. NOT a request to reload `zones` — see the
   * drafts comment below for why the layer never redraws mid-edit.
   */
  onZonesChanged?: () => void;
}) {
  const map = useMap();
  const units = useUnitSystem();

  // Edits made this session, by zone id.
  //
  // The layer deliberately does NOT ask its parent to reload after a write.
  // Reloading would hand it a new `zones` array, the effect below would rebuild
  // every polygon, and the popup the operator is still typing in would vanish
  // mid-sentence. Storage is the source of truth and is written immediately;
  // this map is only what the popup shows until the next mount re-reads it.
  const draftsRef = useRef(new Map<string, Draft>());
  // One pending note write at a time, with its timer, so a tab switch can flush
  // it. Without the flush, a note typed and immediately abandoned is lost.
  const pendingNote = useRef<{ zoneId: string; note: string; timer: number } | null>(null);

  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    const drafts = draftsRef.current;
    const canEdit = !!fieldId && !!boundary && boundary.length > 0;

    /** Persist one field of one zone. Returns the message to show, or null. */
    const write = async (zoneId: string, patch: { issue?: string | null; note?: string | null }) => {
      if (!fieldId || !boundary) return "No field, nothing was saved.";
      try {
        const res = await classifyGridZone(fieldId, boundary, zoneId, patch);
        if (!res) {
          return "Could not save: the treatment grid has moved on. Reopen the tab.";
        }
        onZonesChanged?.();
        return null;
      } catch (e) {
        console.error("[fieldview] classify failed", e);
        return `Could not save: ${(e as Error)?.message ?? e}`;
      }
    };

    const flushNote = () => {
      const p = pendingNote.current;
      if (!p) return;
      window.clearTimeout(p.timer);
      pendingNote.current = null;
      void write(p.zoneId, { note: p.note });
    };

    for (const z of zones) {
      const poly = L.polygon(z.ring.map(p => [p.lat, p.lng] as [number, number]), {
        color: COLOR, weight: 2, dashArray: "6 4",
        fillColor: COLOR, fillOpacity: 0.14,
      });

      const draftOf = (): Draft =>
        drafts.get(z.id) ?? { issue: z.issue ?? "", note: z.note ?? "" };

      const retitle = () => {
        const label = draftOf().issue || UNCLASSIFIED_LABEL;
        poly.setTooltipContent(`${safeLabel(label)} · treatment grid`);
      };

      poly.bindTooltip(
        `${safeLabel(draftOf().issue || UNCLASSIFIED_LABEL)} · treatment grid`,
        { sticky: true, opacity: 1, direction: "top", className: "ai-zone-label" },
      );

      // Built on open rather than up front: a field with a hundred zones would
      // otherwise construct a hundred forms nobody has asked to see.
      poly.bindPopup(() => buildPopupEl({
        zone: z, draft: draftOf(), canEdit, units,
        onIssue: async (issue, status) => {
          const cur = draftOf();
          drafts.set(z.id, { ...cur, issue });
          retitle();
          status("Saving…");
          // Written immediately, not debounced: a dropdown is one decisive
          // gesture, and it is usually the last thing done before the popup is
          // closed. Debouncing it is how it goes missing.
          const err = await write(z.id, { issue: issue || null });
          status(err ?? "Saved");
        },
        onNote: (note, status) => {
          const cur = draftOf();
          drafts.set(z.id, { ...cur, note });
          if (pendingNote.current) window.clearTimeout(pendingNote.current.timer);
          status("Saving…");
          const timer = window.setTimeout(async () => {
            pendingNote.current = null;
            const err = await write(z.id, { note: note || null });
            status(err ?? "Saved");
          }, NOTE_DEBOUNCE_MS);
          pendingNote.current = { zoneId: z.id, note, timer };
        },
      }), { className: "ai-zone-popup", maxWidth: 320, autoClose: true, closeOnClick: true });

      // Closing the popup is one of the two ways a half-typed note gets
      // abandoned; the other is leaving the tab, handled in the cleanup below.
      poly.on("popupclose", flushNote);
      poly.on("click", (e) => { L.DomEvent.stopPropagation(e); poly.openPopup(e.latlng); });
      group.addLayer(poly);
    }

    return () => { flushNote(); group.remove(); };
  }, [map, zones, units, fieldId, boundary]);

  return null;
}

/** The popup body: the read-only facts, then the two things you may change. */
function buildPopupEl({
  zone: z, draft, canEdit, units, onIssue, onNote,
}: {
  zone: GridZone;
  draft: Draft;
  canEdit: boolean;
  units: ReturnType<typeof useUnitSystem>;
  onIssue: (issue: string, status: (msg: string) => void) => void;
  onNote: (note: string, status: (msg: string) => void) => void;
}): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = "font-family:inherit;color:#f0f0f0;background:#161616;padding:10px 12px;min-width:240px";

  const label = draft.issue || UNCLASSIFIED_LABEL;
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
      <div style="height:10px;width:10px;border-radius:2px;background:${COLOR}"></div>
      <div data-role="title" style="font-weight:600;font-size:13px">${escapeHtml(label)}</div>
      <span style="margin-left:auto;font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:${COLOR};border:1px solid ${COLOR}55;border-radius:3px;padding:1px 5px">treatment grid</span>
    </div>
    <div style="font-size:11px;color:#9ca3af;display:grid;grid-template-columns:1fr auto;gap:3px 12px;margin-bottom:8px">
      <div>Area</div><div style="color:#f0f0f0;font-family:ui-monospace,monospace">${escapeHtml(fmtArea(z.areaM2, units).text)}</div>
      <div>Rate</div><div style="color:#f0f0f0;font-family:ui-monospace,monospace">${escapeHtml(fmtRate(z.rateLha, units).text)}</div>
      <div>Cells</div><div style="color:#f0f0f0;font-family:ui-monospace,monospace">${z.cellCount}</div>
      ${z.matchScore !== null
        ? `<div>Match score</div><div style="color:#f0f0f0;font-family:ui-monospace,monospace">${z.matchScore.toFixed(2)}</div>
           <div style="grid-column:1/-1;color:#6b7280;font-size:10px">Similarity to the operator's marked examples when last scored, not a detection confidence.</div>`
        : `<div style="grid-column:1/-1;color:#6b7280;font-size:10px">Hand-painted, no model score attached.</div>`}
    </div>`;

  const title = el.querySelector<HTMLElement>('[data-role="title"]')!;

  const form = document.createElement("div");
  form.style.cssText = "border-top:1px solid #222;padding-top:8px;display:flex;flex-direction:column;gap:6px";

  const fieldLabel = (text: string) => {
    const d = document.createElement("div");
    d.style.cssText = "font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280";
    d.textContent = text;
    return d;
  };

  const inputStyle =
    "width:100%;box-sizing:border-box;background:#0a0a0a;color:#f0f0f0;border:1px solid #222;" +
    "border-radius:3px;padding:5px 6px;font-size:12px;font-family:inherit;outline:none";

  // ---- Issue ---------------------------------------------------------------
  form.appendChild(fieldLabel("Issue type"));
  const select = document.createElement("select");
  select.style.cssText = inputStyle;
  select.disabled = !canEdit;
  // Unclassified is a real option, not a placeholder: the app never guesses a
  // category, and clearing one back to unknown has to be possible. A stored tag
  // that is not in today's vocabulary (an older build, a hand-edited record) is
  // listed as well rather than silently displayed as Unclassified — showing the
  // wrong classification is worse than showing an unfamiliar one.
  const known: string[] = [...USER_POLY_ISSUES];
  const options = draft.issue && !known.includes(draft.issue)
    ? ["", ...known, draft.issue]
    : ["", ...known];
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt || UNCLASSIFIED_LABEL;
    select.appendChild(o);
  }
  select.value = draft.issue;
  form.appendChild(select);

  // ---- Note ----------------------------------------------------------------
  form.appendChild(fieldLabel("Note (optional)"));
  const note = document.createElement("textarea");
  note.style.cssText = inputStyle + ";resize:vertical;min-height:44px;line-height:1.4";
  note.rows = 2;
  note.maxLength = MAX_NOTE_CHARS;
  note.placeholder = "e.g. third year running, check drainage";
  note.value = draft.note;
  note.disabled = !canEdit;
  form.appendChild(note);

  const status = document.createElement("div");
  status.style.cssText = "font-size:10px;color:#6b7280;min-height:13px";
  status.textContent = canEdit
    ? "Saved to the cells under this shape. The Treatment Grid tab shows the same."
    : "This scan has no field, so there is nowhere to save a classification.";
  form.appendChild(status);

  const setStatus = (msg: string) => {
    status.textContent = msg;
    status.style.color = msg.startsWith("Could not") ? "#f87171" : "#6b7280";
  };

  select.addEventListener("change", () => {
    title.textContent = select.value || UNCLASSIFIED_LABEL;
    onIssue(select.value, setStatus);
  });
  note.addEventListener("input", () => onNote(note.value, setStatus));

  el.appendChild(form);

  // Leaflet treats the map as one big drag/zoom/keyboard surface. Without
  // these, selecting text drags the map and typing "+" zooms it in.
  L.DomEvent.disableClickPropagation(el);
  L.DomEvent.disableScrollPropagation(el);
  L.DomEvent.on(el, "keydown keypress keyup", L.DomEvent.stopPropagation);
  return el;
}

export default GridAnomaliesLayer;
