// The Field Twin inspector: what a clicked tree or weed is, its measurements in the account's units, and the crops
// of the original photographs that show it.
import { useUnitSystem } from "@/hooks/useUnitSystem";
import { fmtDistance } from "@/lib/units";
import type { TwinBundle, TwinEvidence } from "@/lib/fieldTwin/types";
import { TREE_COLOUR, weedColour } from "@/lib/fieldTwin/style";
import { type InspectLine, treeLines, weedLines } from "@/lib/fieldTwin/view";
import EvidenceCrop from "./EvidenceCrop";
import type { TwinSelection } from "./TwinMap";

type Props = { twin: TwinBundle; selection: TwinSelection; atlasUrl: (index: number) => Promise<string> };

export default function TwinInspector({ twin, selection, atlasUrl }: Props) {
  const units = useUnitSystem();
  if (!selection) return <p className="text-xs text-neutral-500">Click a tree or a weed on the map.</p>;
  const weed = selection.kind === "weed" ? twin.weeds.find(w => w.id === selection.id) : undefined;
  const tree = selection.kind === "tree" ? twin.trees.find(t => t.id === selection.id) : undefined;
  if (!weed && !tree) return <p className="text-xs text-neutral-500">That object is not in this twin.</p>;
  const title = weed ? `Weed candidate ${weed.id}` : `Tree ${tree!.id}`;
  const colour = weed ? weedColour(weed) : TREE_COLOUR;
  const lines: InspectLine[] = weed ? weedLines(weed, units) : treeLines(tree!, units);
  const evidence: TwinEvidence[] = (weed ?? tree)!.evidence;
  return (
    <div>
      <p className="text-sm font-medium" style={{ color: colour }}>{title}</p>
      <dl className="mt-1 space-y-0.5">{lines.map(l => (
        <div key={l.label} className="flex justify-between gap-3 text-xs"><dt className="text-neutral-500">{l.label}</dt><dd className="text-right text-neutral-200">{l.value}</dd></div>
      ))}</dl>
      <p className="mt-3 mb-1 text-[11px] text-neutral-500">{evidence.length ? "In the original photographs" : "No photograph crops were kept for this object."}</p>
      <div className="flex flex-wrap gap-2">{evidence.map((e, i) => (
        <EvidenceCrop key={i} evidence={e} atlasUrl={atlasUrl} colour={colour} px={144}
          caption={`${e.photo}${e.metresAcross != null ? ` · ${fmtDistance(e.metresAcross, units).text} across` : ""}`} />
      ))}</div>
    </div>
  );
}
