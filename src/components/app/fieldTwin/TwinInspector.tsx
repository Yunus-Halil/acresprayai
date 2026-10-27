// The Field Twin inspector: what a selected object is, its measurements in the account's units, how many
// photographs it rests on, and the crops of those photographs. Docked beside the map, never over it.
import { useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { fmtArea, fmtDistance } from "@/lib/units";
import type { Scene } from "@/lib/fieldTwin/scene";
import type { TwinBundle, TwinEvidence } from "@/lib/fieldTwin/types";
import { TREE_COLOUR, TWIN_COLOURS, weedColour } from "@/lib/fieldTwin/style";
import { type InspectLine, treeLines, weedLines } from "@/lib/fieldTwin/view";
import EvidenceCrop from "./EvidenceCrop";
import type { TwinPick } from "./TwinCanvasLayer";

type Props = { twin: TwinBundle; scene: Scene; selection: TwinPick; atlasUrl: (index: number) => Promise<string>; onClose: () => void; onZoomTo?: (lat: number, lng: number, metresAcross: number) => void };

const Lines = ({ lines }: { lines: InspectLine[] }) => (
  <dl className="mt-2 space-y-1">{lines.map(l => (
    <div key={l.label} className="flex justify-between gap-3 text-xs"><dt className="text-neutral-500">{l.label}</dt><dd className="text-right text-neutral-200">{l.value}</dd></div>
  ))}</dl>
);

function Evidence({ evidence, atlasUrl, colour, units }: { evidence: TwinEvidence[]; atlasUrl: Props["atlasUrl"]; colour: string; units: "metric" | "imperial" }) {
  const [big, setBig] = useState<number | null>(null);
  if (!evidence.length) return <p className="mt-3 text-[11px] text-neutral-500">No photograph crops were kept for this object.</p>;
  return (
    <div className="mt-3">
      <p className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">In the original photographs</p>
      <div className="flex flex-wrap gap-2">
        {evidence.map((e, i) => (
          <button key={i} type="button" className="text-left" onClick={() => setBig(big === i ? null : i)} aria-label={big === i ? `Shrink the crop of ${e.photo}` : `Enlarge the crop of ${e.photo}`}>
            <EvidenceCrop evidence={e} atlasUrl={atlasUrl} colour={colour} px={big === i ? 296 : 140} caption={`${e.photo}${e.metresAcross != null ? ` · ${fmtDistance(e.metresAcross, units).text} across` : ""}`} />
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-neutral-500">Click a crop to enlarge it here. The outline is the object's own measured geometry in that photograph.</p>
    </div>
  );
}

export default function TwinInspector({ twin, scene, selection, atlasUrl, onClose, onZoomTo }: Props) {
  const units = useUnitSystem();
  const [showObs, setShowObs] = useState(false);
  if (!selection) return null;
  const header = (title: string, colour: string, kind: string) => (
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-[11px] uppercase tracking-wide text-neutral-500">{kind}</p>
        <p className="text-sm font-medium" style={{ color: colour }}>{title}</p>
      </div>
      <button type="button" onClick={onClose} className="rounded p-1 text-neutral-400 hover:bg-[#1f1f1f] hover:text-neutral-200" aria-label="Close the inspector"><X className="h-4 w-4" /></button>
    </div>
  );

  if (selection.kind === "weed") {
    const w = twin.weeds.find(x => x.id === selection.id);
    if (!w) return <p className="text-xs text-neutral-500">That weed is not in this twin.</p>;
    const colour = weedColour(w);
    const kind = w.status === "on a tree" ? "Model detection on a tree crown" : w.status === "verified" ? "Weed candidate, seen in several photographs" : "Weed candidate, one sighting";
    return (
      <div>
        {header(`Weed ${w.id}`, colour, kind)}
        <Lines lines={weedLines(w, units, twin)} />
        <p className="mt-2 text-[11px] text-neutral-500">Agreement across photographs says the detector saw the same thing more than once; it does not identify the plant.</p>
        <Evidence evidence={w.evidence} atlasUrl={atlasUrl} colour={colour} units={units} />
        <button type="button" className="mt-3 flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-200" onClick={() => setShowObs(s => !s)} aria-expanded={showObs}>
          {showObs ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}Observations behind this object ({w.evidence.length} shown of {w.seenBy})
        </button>
        {showObs && (
          <ul className="mt-1 space-y-0.5 text-[11px] text-neutral-400">
            {w.evidence.map((e, i) => <li key={i}>{e.photo}: crop at ({e.x}, {e.y}) in atlas {e.atlas}, {e.poly.length} outline points</li>)}
            <li className="text-neutral-500">Reconciled position: the point closest to every sighting's ray; height from their parallax.</li>
          </ul>
        )}
      </div>
    );
  }
  if (selection.kind === "tree") {
    const t = twin.trees.find(x => x.id === selection.id);
    if (!t) return <p className="text-xs text-neutral-500">That tree is not in this twin.</p>;
    return (
      <div>
        {header(`Tree ${t.id}`, TREE_COLOUR, "Crop tree, reconciled from the planting layout")}
        <Lines lines={treeLines(t, units)} />
        <Evidence evidence={t.evidence} atlasUrl={atlasUrl} colour={TREE_COLOUR} units={units} />
      </div>
    );
  }
  if (selection.kind === "vegetation") {
    const v = twin.vegetation.find(x => x.id === selection.id);
    if (!v) return <p className="text-xs text-neutral-500">That patch is not in this twin.</p>;
    return (
      <div>
        {header(`Vegetation ${v.id}`, TWIN_COLOURS.vegetation, "Green patch, neither tree nor weed candidate")}
        <Lines lines={[{ label: "Seen in", value: `${v.seenBy} photographs` }, { label: "Ground cover", value: fmtArea(v.areaM2, units).text }, { label: "Position", value: `${v.lat.toFixed(7)}, ${v.lng.toFixed(7)}` }]} />
        <p className="mt-2 text-[11px] text-neutral-500">A connected patch of green in the photographs that no detector classed. Its outline is measured; what it is, is not.</p>
      </div>
    );
  }
  if (selection.kind === "zone") {
    const z = scene.intel.zones.find(x => x.id === selection.id);
    if (!z) return null;
    const [lat, lng] = scene.intel.frame.toLatLng(z.centre[0], z.centre[1]);
    return (
      <div>
        {header(`Scouting zone ${z.id}`, TWIN_COLOURS.zone, "Connected ground at moderate or high weed pressure")}
        <Lines lines={[
          { label: "Ground", value: fmtArea(z.areaM2, units).text },
          { label: "Verified weed cover", value: `${fmtArea(z.coverM2, units).text} (${z.meanCoverPct.toFixed(1)} % of the ground)` },
          { label: "Verified weed candidates", value: String(z.weeds) },
          { label: "Cells", value: `${z.cells.length} of ${scene.intel.grid.cellM} m` },
        ]} />
        <p className="mt-2 text-[11px] text-neutral-500">Pressure is the share of ground covered by verified weed candidates, per {scene.intel.grid.cellM} m cell along the rows. The candidates themselves are drawn when you zoom in.</p>
        {onZoomTo && <button type="button" className="mt-3 rounded-sm border border-[#333] px-3 py-1.5 text-xs text-neutral-300 hover:bg-[#1f1f1f]" onClick={() => onZoomTo(lat, lng, Math.sqrt(z.areaM2) * 1.6)}>Zoom to this zone</button>}
      </div>
    );
  }
  return null;
}
