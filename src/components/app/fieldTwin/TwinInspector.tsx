// The Field Twin inspector: identity and state first, then the measurements, the confidence behind them, the
// photographs that show the object, and the technical record folded away. Opaque, sectioned, beside the map.
import { useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { fmtArea, fmtAreaCm2, fmtDistance, fmtLengthCm } from "@/lib/units";
import type { UnitSystem } from "@/lib/units";
import type { Scene } from "@/lib/fieldTwin/scene";
import type { TwinBundle, TwinEvidence, TwinTree, TwinWeed } from "@/lib/fieldTwin/types";
import { TREE_COLOUR, TWIN_COLOURS, weedColour } from "@/lib/fieldTwin/style";
import { distanceToRowM } from "@/lib/fieldTwin/view";
import EvidenceCrop from "./EvidenceCrop";
import type { TwinPick } from "./TwinCanvasLayer";

type Props = { twin: TwinBundle; scene: Scene; selection: TwinPick; atlasUrl: (index: number) => Promise<string>; onClose: () => void; onZoomTo?: (lat: number, lng: number, metresAcross: number) => void };

type Line = { label: string; value: string };
const cm = (m: number, u: UnitSystem) => fmtLengthCm(m * 100, u).text;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[#2e322e] pt-3 mt-3">
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-500">{title}</h3>
      {children}
    </section>
  );
}
const Rows = ({ lines }: { lines: Line[] }) => (
  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">{lines.map(l => (
    <div key={l.label} className="contents"><dt className="text-neutral-400">{l.label}</dt><dd className="text-right text-neutral-100 tabular-nums">{l.value}</dd></div>
  ))}</dl>
);

function Header({ kind, title, colour, onClose }: { kind: string; title: string; colour: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-500">{kind}</p>
        <p className="mt-0.5 flex items-center gap-2 text-base font-semibold text-neutral-100"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colour }} />{title}</p>
      </div>
      <button type="button" onClick={onClose} className="rounded p-1 text-neutral-400 hover:bg-[#262a26] hover:text-neutral-100" aria-label="Close the inspector"><X className="h-4 w-4" /></button>
    </div>
  );
}

function Evidence({ evidence, atlasUrl, colour, units }: { evidence: TwinEvidence[]; atlasUrl: Props["atlasUrl"]; colour: string; units: UnitSystem }) {
  const [big, setBig] = useState<number | null>(null);
  if (!evidence.length) return <p className="text-[11px] text-neutral-500">No photograph crops were kept for this object.</p>;
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {evidence.map((e, i) => (
          <button key={i} type="button" className="text-left" onClick={() => setBig(big === i ? null : i)} aria-label={big === i ? `Shrink the crop of ${e.photo}` : `Enlarge the crop of ${e.photo}`}>
            <EvidenceCrop evidence={e} atlasUrl={atlasUrl} colour={colour} px={big === i ? 300 : 146} caption={`${e.photo}${e.metresAcross != null ? ` · ${fmtDistance(e.metresAcross, units).text} across` : ""}`} />
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-neutral-500">Click a crop to enlarge it. The outline is the object's measured geometry in that photograph.</p>
    </div>
  );
}

function Diagnostics({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="border-t border-[#2e322e] pt-2 mt-3">
      <button type="button" className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-200" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}Technical diagnostics
      </button>
      {open && <div className="mt-2 space-y-1 text-[11px] text-neutral-400">{children}</div>}
    </section>
  );
}

function WeedPanel({ w, twin, atlasUrl, onClose, units }: { w: TwinWeed; twin: TwinBundle; atlasUrl: Props["atlasUrl"]; onClose: () => void; units: UnitSystem }) {
  const colour = weedColour(w);
  const state = w.status === "on a tree" ? "Model detection on a tree crown" : w.status === "verified" ? "Weed candidate" : "Weed candidate, unverified";
  const near = distanceToRowM(twin, w.lat, w.lng);
  const measurements: Line[] = [
    { label: "Size across", value: cm(w.diameterM, units) },
    { label: "Ground cover", value: fmtAreaCm2(w.areaM2 * 10_000, units).text },
    ...(w.spanM != null ? [{ label: "Longest span", value: cm(w.spanM, units) }] : []),
    ...(w.heightM != null ? [{ label: "Height above soil", value: cm(Math.max(0, w.heightM), units) }] : []),
    { label: "Where", value: w.rowStatus === "between rows" ? "Between the rows" : w.rowStatus === "on a row" ? "On a crop row" : "No rows read here" },
    ...(near ? [{ label: "Nearest crop row", value: `Row ${near.rowId}, ${fmtDistance(near.distanceM, units).text}` }] : []),
    ...(w.treeId != null ? [{ label: "On tree", value: `Tree ${w.treeId}` }] : []),
  ];
  const confidence: Line[] = [
    { label: "Seen in", value: `${w.seenBy} of ${w.coveredBy} photographs that covered it` },
    ...(w.seenBy >= 2 ? [{ label: "Position agreement", value: `within ${cm(w.viewSpreadM, units)}` }, { label: "Size agreement", value: `within ${Math.round(w.sizeCv * 100)} %` }] : [{ label: "Position agreement", value: "one sighting, none to compare" }]),
    ...(w.score != null ? [{ label: "Model confidence", value: `${Math.round(w.score * 100)} %` }] : []),
  ];
  return (
    <div>
      <Header kind={state} title={`Weed ${w.id}`} colour={colour} onClose={onClose} />
      <p className="mt-2 text-xs text-neutral-300">
        {w.status === "verified" ? "The detector found this plant in more than one photograph and the sightings agree on where it stands. That says the detection repeats; it does not identify the species." : w.status === "single view" ? "Only one photograph's detector saw this, though more covered the spot. Treat it as a lead, not a finding." : "The detector called part of a tree crown a weed. Kept apart from the weed candidates."}
      </p>
      <Section title="Measurements"><Rows lines={measurements} /></Section>
      <Section title="Confidence"><Rows lines={confidence} /></Section>
      <Section title="In the original photographs"><Evidence evidence={w.evidence} atlasUrl={atlasUrl} colour={colour} units={units} /></Section>
      <Diagnostics>
        <p>Object id {w.id}; position {w.lat.toFixed(7)}, {w.lng.toFixed(7)}.</p>
        <p>Reconciled position: the point closest to every sighting's ray; height from their parallax.</p>
        {w.evidence.map((e, i) => <p key={i}>{e.photo}: crop at ({e.x}, {e.y}) in atlas {e.atlas}, {e.poly.length} outline points.</p>)}
        <p>{w.evidence.length} of {w.seenBy} sightings kept as crops.</p>
      </Diagnostics>
    </div>
  );
}

function TreePanel({ t, atlasUrl, onClose, units }: { t: TwinTree; atlasUrl: Props["atlasUrl"]; onClose: () => void; units: UnitSystem }) {
  return (
    <div>
      <Header kind="Crop tree" title={`Tree ${t.id}`} colour={TREE_COLOUR} onClose={onClose} />
      <p className="mt-2 text-xs text-neutral-300">A tree of the planting layout, reconciled from the photographs that saw it.</p>
      <Section title="Measurements"><Rows lines={[
        { label: "Crown across", value: fmtDistance(2 * t.crownRadiusM, units).text },
        ...(t.heightM != null ? [{ label: "Crown centre above soil", value: fmtDistance(Math.max(0, t.heightM), units).text }] : []),
        { label: "Row", value: t.rowId != null ? `Row ${t.rowId}` : "Not on a kept row" },
      ]} /></Section>
      <Section title="Confidence"><Rows lines={[
        { label: "Seen in", value: `${t.seenBy} of ${t.coveredBy} photographs that covered it` },
        ...(t.seenBy >= 2 ? [{ label: "Position agreement", value: `within ${cm(t.viewSpreadM, units)}` }, { label: "Crown size agreement", value: `within ${Math.round(t.sizeCv * 100)} %` }] : []),
      ]} /></Section>
      <Section title="In the original photographs"><Evidence evidence={t.evidence} atlasUrl={atlasUrl} colour={TREE_COLOUR} units={units} /></Section>
      <Diagnostics><p>Object id {t.id}; position {t.lat.toFixed(7)}, {t.lng.toFixed(7)}. Crown radius from the planting layout's ring in each photograph; the drawn circle is that radius, not a measured outline.</p></Diagnostics>
    </div>
  );
}

export default function TwinInspector({ twin, scene, selection, atlasUrl, onClose, onZoomTo }: Props) {
  const units = useUnitSystem();
  if (!selection) return null;
  if (selection.kind === "weed") {
    const w = twin.weeds.find(x => x.id === selection.id);
    return w ? <WeedPanel w={w} twin={twin} atlasUrl={atlasUrl} onClose={onClose} units={units} /> : <p className="text-xs text-neutral-500">That weed is not in this twin.</p>;
  }
  if (selection.kind === "tree") {
    const t = twin.trees.find(x => x.id === selection.id);
    return t ? <TreePanel t={t} atlasUrl={atlasUrl} onClose={onClose} units={units} /> : <p className="text-xs text-neutral-500">That tree is not in this twin.</p>;
  }
  if (selection.kind === "vegetation") {
    const v = twin.vegetation.find(x => x.id === selection.id);
    if (!v) return <p className="text-xs text-neutral-500">That patch is not in this twin.</p>;
    return (
      <div>
        <Header kind="Other vegetation" title={`Patch ${v.id}`} colour={TWIN_COLOURS.vegetation} onClose={onClose} />
        <p className="mt-2 text-xs text-neutral-300">A connected patch of green that no detector classed. Its outline is measured; what it is, is not.</p>
        <Section title="Measurements"><Rows lines={[{ label: "Ground cover", value: fmtArea(v.areaM2, units).text }, { label: "Seen in", value: `${v.seenBy} photographs` }]} /></Section>
        <Diagnostics><p>Object id {v.id}; position {v.lat.toFixed(7)}, {v.lng.toFixed(7)}.</p></Diagnostics>
      </div>
    );
  }
  if (selection.kind === "zone") {
    const z = scene.intel.zones.find(x => x.id === selection.id);
    if (!z) return null;
    const [lat, lng] = scene.intel.frame.toLatLng(z.centre[0], z.centre[1]);
    return (
      <div>
        <Header kind={`Scouting zone, priority ${z.priority}`} title={`Zone ${z.id}`} colour={TWIN_COLOURS.zoneFill[z.priority]} onClose={onClose} />
        <p className="mt-2 text-xs text-neutral-300">Connected ground where verified weed candidates cover at least 1.5 % of the soil. Priority is its rank by total cover across the field.</p>
        <Section title="Measurements"><Rows lines={[
          { label: "Ground", value: fmtArea(z.areaM2, units).text },
          { label: "Weed cover", value: `${fmtArea(z.coverM2, units).text} (${z.meanCoverPct.toFixed(1)} %)` },
          { label: "Verified candidates", value: String(z.weeds) },
          { label: "Cells", value: `${z.cells.length} of ${scene.intel.grid.cellM} m` },
        ]} /></Section>
        {onZoomTo && <button type="button" className="mt-3 rounded-sm border border-[#3a3f3a] bg-[#242824] px-3 py-1.5 text-xs text-neutral-200 hover:bg-[#2c312c]" onClick={() => onZoomTo(lat, lng, Math.sqrt(z.areaM2) * 1.6)}>Zoom to this zone</button>}
        <Diagnostics><p>The region drawn is the zone's own cells with their corners rounded; no cells were added or merged for looks.</p></Diagnostics>
      </div>
    );
  }
  return null;
}
