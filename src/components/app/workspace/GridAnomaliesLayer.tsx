// Treatment-grid zones on the Field View map, presented the way AI zones and
// hand-drawn anomalies already are: polygons with a popup naming what, where,
// how much, and — the part the other two don't have — where the record LIVES.
//
// These shapes are projections of grid cells, not records of their own (see
// lib/gridAnomalies.ts). That is why the popup has no delete button where
// AiZonesLayer and UserPolyLayer have one: deleting the projection is
// meaningless, and deleting the cells from here would be a second, less
// careful editing surface for state the Treatment Grid tab already guards
// with locks and confirmations. The popup says where to edit instead.
import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { GridZone } from "@/lib/gridZones";
import { UNCLASSIFIED_LABEL } from "@/lib/gridAnomalies";
import { escapeHtml } from "./layers";
import { fmtArea, fmtRate } from "@/lib/units";
import { useUnitSystem } from "@/hooks/useUnitSystem";

/** Amber, matching the candidate/suggestion colour family — grid-flagged
    ground is operator-decided but distinct from AI severities. */
const COLOR = "#f59e0b";

export function GridAnomaliesLayer({ zones }: { zones: GridZone[] }) {
  const map = useMap();
  const units = useUnitSystem();

  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    for (const z of zones) {
      const poly = L.polygon(z.ring.map(p => [p.lat, p.lng] as [number, number]), {
        color: COLOR, weight: 2, dashArray: "6 4",
        fillColor: COLOR, fillOpacity: 0.14,
      });
      const issue = z.issue ?? UNCLASSIFIED_LABEL;
      poly.bindTooltip(`${issue} · treatment grid`, {
        sticky: true, opacity: 1, direction: "top", className: "ai-zone-label",
      });
      const html = `
        <div style="font-family:inherit;color:#f0f0f0;background:#161616;padding:10px 12px;min-width:220px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <div style="height:10px;width:10px;border-radius:2px;background:${COLOR}"></div>
            <div style="font-weight:600;font-size:13px">${escapeHtml(issue)}</div>
            <span style="margin-left:auto;font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:${COLOR};border:1px solid ${COLOR}55;border-radius:3px;padding:1px 5px">treatment grid</span>
          </div>
          <div style="font-size:11px;color:#9ca3af;display:grid;grid-template-columns:1fr auto;gap:3px 12px;margin-bottom:8px">
            <div>Area</div><div style="color:#f0f0f0;font-family:ui-monospace,monospace">${escapeHtml(fmtArea(z.areaM2, units).text)}</div>
            <div>Rate</div><div style="color:#f0f0f0;font-family:ui-monospace,monospace">${escapeHtml(fmtRate(z.rateLha, units).text)}</div>
            <div>Cells</div><div style="color:#f0f0f0;font-family:ui-monospace,monospace">${z.cellCount}</div>
            ${z.matchScore !== null
              ? `<div>Match score</div><div style="color:#f0f0f0;font-family:ui-monospace,monospace">${z.matchScore.toFixed(2)}</div>
                 <div style="grid-column:1/-1;color:#6b7280;font-size:10px">Similarity to the operator's marked examples when last scored — not a detection confidence.</div>`
              : `<div style="grid-column:1/-1;color:#6b7280;font-size:10px">Hand-painted — no model score attached.</div>`}
          </div>
          <div style="font-size:10px;color:#6b7280;border-top:1px solid #222;padding-top:6px">
            Edit the cells in the <span style="color:#f59e0b">Treatment Grid</span> tab — this shape follows them.
          </div>
        </div>`;
      poly.bindPopup(html, { className: "ai-zone-popup", maxWidth: 300, autoClose: true, closeOnClick: true });
      poly.on("click", (e) => { L.DomEvent.stopPropagation(e); poly.openPopup(e.latlng); });
      group.addLayer(poly);
    }
    return () => { group.remove(); };
  }, [map, zones, units]);

  return null;
}

export default GridAnomaliesLayer;
