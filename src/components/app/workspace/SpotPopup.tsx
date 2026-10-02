// What one spot says when the operator clicks it on the map.
//
// WHY A POPUP AND NOT A LIST. The scout has already decided every spot before
// the operator arrives: plant candidates and vegetation regions start as
// weeds, bare and dark ground starts unsure, and anything resembling what they
// have dismissed before starts removed. A list of thirty rows presents that as
// thirty tasks. The map presents it as one picture with thirty decisions
// already made, and the operator only opens the ones that look wrong.
//
// So this is deliberately small. Three verdict buttons and a sentence are the
// whole of it until the operator asks for more: naming is behind a button,
// because most spots do not need a name and an unnamed spot is a valid
// outcome with its own treatment group. The measurements are behind another,
// because they are for the rare case where the operator wants to argue with
// the machine.
//
// Everything it renders comes from a module that already owns it. It composes;
// it does not decide.
import { type Prediction, describePrediction } from "@/lib/weedScout/classify";
import type { NativeCrop } from "@/lib/sourceFrames/crop";
import type { ScanSources } from "@/lib/sourceFrames/scan";
import type { SpotSources } from "@/lib/sourceFrames/spot";
import { useState } from "react";
import { CheckCircle2, MapPin } from "lucide-react";
import type { Identification } from "@/lib/weedCatalog/identification";
import { isStatedFinding } from "@/lib/weedCatalog/identification";
import type { CropShortlist, RankedEntry, RecentLabel, Suggestion } from "@/lib/weedCatalog/suggest";
import type { CatalogEntry, FieldRegion } from "@/lib/weedCatalog/types";
import { FINDING_CLASS_LABEL, describeCandidate, findingClassOf } from "@/lib/weedScout/candidates";
import { type StoredPrediction, type Verdict, VERDICTS, isDismissal } from "@/lib/weedScout/observations";
import type { Candidate } from "@/lib/weedScout/types";
import { type UnitSystem, fmtArea, fmtAreaCm2, fmtLengthCm } from "@/lib/units";
import { IdentificationBlock } from "./IdentificationBlock";

const VERDICT_TONE: Record<string, string> = {
  weed: "bg-[#4CAF50] text-black border-[#4CAF50]",
  not_weed: "bg-[#525252] text-white border-[#525252]",
  unsure: "bg-amber-400 text-black border-amber-400",
};

export type SpotPopupProps = {
  candidate: Candidate;
  index: number;
  total: number;
  units: UnitSystem;
  /** Planned area, or null when the planner would not carry this spot. */
  areaM2: number | null;
  verdict: Verdict;
  onVerdict: (v: Verdict) => void;
  identification: Identification;
  suggestion: Suggestion | null;
  notes: string;
  onNotes: (text: string) => void;
  saved: boolean;
  /** What the model said when this spot was last saved, for a reopened scan with no live score. */
  savedPrediction: StoredPrediction | null;
  onField: boolean;
  /** The photographs that saw this spot, from lib/sourceFrames. Null while loading. */
  sourceFrames: SpotSources | null;
  sourcesOrigin: ScanSources["reconstruction"];
  comparison: NativeComparison | null;
  onCompare: () => void;

  // Identification wiring, handed straight to the shared block.
  shortlist: CropShortlist;
  recent: RecentLabel[];
  searchResults: RankedEntry[];
  searchQuery: string;
  onSearchQuery: (q: string) => void;
  freeText: string;
  onFreeText: (t: string) => void;
  listNote: string;
  region: FieldRegion;
  catalogSize: number;
  catalogError: string | null;
  onConfirmSuggestion: () => void;
  onSetIdentification: (id: Identification) => void;
  onPickEntry: (entry: CatalogEntry, why: string) => void;
  onPickRecent: (name: string) => void;
};

export function SpotPopup(props: SpotPopupProps) {
  const {
    candidate: c, index, total, units, areaM2, verdict, onVerdict, identification, suggestion,
    notes, onNotes, saved, savedPrediction, onField, sourceFrames, sourcesOrigin, comparison, onCompare,
  } = props;
  const named = isStatedFinding(identification);
  // A suggestion is worth showing unasked; an empty picker is not.
  const [naming, setNaming] = useState(false);
  const gone = isDismissal(verdict);
  const showIdentification = !gone && (naming || named || !!suggestion || identification.status === "rejected");

  return (
    // Leaflet drives the map from events on its own container. Without this,
    // typing a space into the search box pans the field and a scroll inside
    // the picker zooms it.
    <div className="scout-popup text-[#f0f0f0]" style={{ minWidth: 300, maxWidth: 380 }}
      onWheelCapture={e => e.stopPropagation()}
      onMouseDownCapture={e => e.stopPropagation()}
      onDoubleClickCapture={e => e.stopPropagation()}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold truncate">
            {named ? identification.label : (c.region ? c.region.klass : c.kind)}
          </div>
          <div className="text-[10px] text-neutral-500">
            Spot {index + 1} of {total}
            {areaM2 != null
              ? ` · ${fmtArea(areaM2, units).text}`
              : " · centred outside the boundary, the planner will not carry it"}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 pt-0.5">
          {saved && <CheckCircle2 className="h-3 w-3 text-[#4CAF50]" aria-label="saved" />}
          {onField && <MapPin className="h-3 w-3 text-[#38bdf8]" aria-label="on the field" />}
        </div>
      </div>

      {c.chip && (
        <img src={c.chip} alt="" className="mt-2 w-full rounded-sm border border-[#222]"
          style={{ imageRendering: "pixelated", maxHeight: 130, objectFit: "cover" }} />
      )}

      <p className="mt-2 text-[11px] text-neutral-300 leading-relaxed">
        {c.estimate ? c.estimate.summary : describeCandidate(c, units)}
      </p>
      {c.prediction ? (
        <p className="mt-1 text-[10px] text-neutral-500 leading-relaxed" title="Trained on public corn imagery and synthetic scenes; the number is calibrated on held-out data, not on this field.">
          {describePrediction(c.prediction)}
        </p>
      ) : savedPrediction ? (
        <p className="mt-1 text-[10px] text-neutral-500 leading-relaxed" title="No model scored this spot on this run; this is the score stored with your saved verdict.">
          When saved: {describePrediction(savedPrediction)}
        </p>
      ) : c.inference?.status === "unknown_resolution" && (
        <p className="mt-1 text-[10px] text-neutral-500 leading-relaxed" data-testid="unknown-resolution">
          Model: not run. This chip is {fmtLengthCm((c.inference.effectiveGsdM ?? 0) * 100, units).text} per pixel;
          {" "}{c.inference.modelVersion} was trained on nothing coarser than {fmtLengthCm((c.inference.requiredGsdM ?? 0) * 100, units).text} per pixel (UNKNOWN_RESOLUTION).
        </p>
      )}

      <div className="mt-2 grid grid-cols-3 gap-1">
        {VERDICTS.map(o => {
          const on = verdict === o.value || (o.value === "not_weed" && gone);
          return (
            <button key={o.value} type="button" onClick={() => onVerdict(o.value)}
              className={`text-[11px] rounded-sm px-2 py-1.5 border font-semibold ${on ? VERDICT_TONE[o.value] : "border-[#333] text-neutral-300 hover:bg-[#1f1f1f]"}`}>
              {o.label}
            </button>
          );
        })}
      </div>

      {!gone && !showIdentification && (
        <button type="button" onClick={() => setNaming(true)}
          className="mt-2 w-full text-[11px] rounded-sm border border-[#333] px-2 py-1.5 text-neutral-300 hover:bg-[#1f1f1f]">
          Name it
          <span className="text-neutral-600"> (optional, it stays a weed spot without one)</span>
        </button>
      )}

      {showIdentification && (
        <div className="mt-2 overflow-y-auto" style={{ maxHeight: 260 }}>
          <IdentificationBlock
            identification={identification}
            suggestion={suggestion}
            shortlist={props.shortlist}
            recent={props.recent}
            searchResults={props.searchResults}
            searchQuery={props.searchQuery}
            onSearchQuery={props.onSearchQuery}
            freeText={props.freeText}
            onFreeText={props.onFreeText}
            listNote={props.listNote}
            region={props.region}
            catalogSize={props.catalogSize}
            catalogError={props.catalogError}
            onConfirmSuggestion={props.onConfirmSuggestion}
            onSetIdentification={props.onSetIdentification}
            onPickEntry={props.onPickEntry}
            onPickRecent={props.onPickRecent}
          />
        </div>
      )}

      <input
        className="mt-2 w-full bg-[#0f0f0f] border border-[#222] rounded-sm px-2 py-1 text-[11px] text-[#f0f0f0] focus:outline-none focus:border-[#4CAF50]"
        placeholder="Notes" maxLength={300} value={notes} onChange={e => onNotes(e.target.value)} />

      <details className="mt-2">
        <summary className="cursor-pointer text-[10px] text-neutral-500 hover:text-neutral-300">Measurements</summary>
        <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 pt-1.5 text-[10px]">
          <Dt k="Class" v={FINDING_CLASS_LABEL[findingClassOf(c)]} />
          <Dt k="Score" v={c.score.toFixed(2)} />
          {c.region ? (
            <>
              <Dt k="Tiles" v={`${c.region.tileCount} (${c.region.coreTiles} core)`} />
              <Dt k="Deviation" v={`mean ${c.region.meanStrength.toFixed(1)}, max ${c.region.maxStrength.toFixed(1)}`} />
              <Dt k="Drivers" v={c.region.drivers.map(d => `${d.feature} ${d.z > 0 ? "+" : "-"}${Math.abs(d.z).toFixed(1)}`).join("; ")} />
            </>
          ) : (
            <>
              <Dt k="Off row" v={c.distanceToRowM != null ? fmtLengthCm(Math.abs(c.distanceToRowM) * 100, units).text : "no row model"} />
              <Dt k="Unlike plants" v={c.blobZ != null ? `${c.blobZ.toFixed(1)} z on ${c.blobZFeature}` : "within the field's plants"} />
              <Dt k="Size" v={c.blob ? `${fmtLengthCm(c.blob.equivDiameterM * 100, units).text}, ${fmtAreaCm2(c.blob.areaM2 * 1e4, units).text}` : "no vegetation"} />
            </>
          )}
        </dl>
        {c.estimate && (
          <div className="pt-1 space-y-0.5 text-[10px] text-neutral-500">
            <p>{c.estimate.positionNote}</p>
            {c.estimate.whatWouldConfirm.length > 0 && <p>To confirm on the ground: {c.estimate.whatWouldConfirm.join(" ")}</p>}
            <p className="font-mono text-neutral-600">{c.id}</p>
          </div>
        )}
        <SourceFramesBlock c={c} units={units} sources={sourceFrames} origin={sourcesOrigin} comparison={comparison} onCompare={onCompare} />
      </details>
    </div>
  );
}

export type NativeComparison =
  | { status: "loading" }
  | { status: "done"; crop: NativeCrop; prediction: Prediction | null; belowTrained: boolean; requiredGsdM: number | null }
  | { status: "error"; error: string };

/**
 * The developer's view of where better pixels would come from: which frames
 * saw the spot, the best one, and how many pixels the spot would get in it.
 * With the original kept, the same spot can be cut from it and scored, and
 * the two sit side by side. Reads only; decides nothing.
 */
function SourceFramesBlock({ c, units, sources, origin, comparison, onCompare }: {
  c: Candidate; units: UnitSystem; sources: SpotSources | null; origin: ScanSources["reconstruction"];
  comparison: NativeComparison | null; onCompare: () => void;
}) {
  const gsd = (m: number | null | undefined) => (m ? `${fmtLengthCm(m * 100, units).text}/px` : "unknown");
  const px = (n: number | null) => (n == null ? "unknown" : `${n.toFixed(1)} px`);
  if (!sources) return <p className="pt-1.5 text-[10px] text-neutral-600" data-testid="source-frames">Source frames: loading.</p>;
  if (sources.unavailable) {
    const why = sources.unavailable === "no reconstruction"
      ? (origin === "none" ? "no camera poses for this scan (imported orthomosaic, or the archive is missing)" : "poses could not be read")
      : sources.unavailable;
    return <p className="pt-1.5 text-[10px] text-neutral-600" data-testid="source-frames">Source frames: {why}.</p>;
  }
  const b = sources.best!;
  return (
    <div className="pt-1.5 text-[10px] text-neutral-500 space-y-0.5" data-testid="source-frames">
      <p className="text-neutral-400">Source frames: seen by {sources.views}. Best <span className="font-mono">{b.filename}</span> at pixel ({b.centre.u.toFixed(0)}, {b.centre.v.toFixed(0)}), {b.centre.viewAngleDeg.toFixed(0)} deg off nadir, {b.centre.edgeDistancePx.toFixed(0)} px from the edge{b.fullyInside ? "" : ", not fully inside"}{b.blurPx != null ? `, ~${b.blurPx.toFixed(1)} px motion blur` : ""}.</p>
      <p>Spot width: ortho chip {px(sources.targetPx.ortho)} at {gsd(c.chipGsdM)}; uploaded frame {px(sources.targetPx.uploaded)} at {gsd(b.gsdM)}; camera frame {px(sources.targetPx.native)} at {gsd(b.nativeGsdM)}.</p>
      {!sources.frameKept && <p className="text-neutral-600">The original photograph was not kept for this scan, so there is nothing to cut from it.</p>}
      {sources.frameKept && !comparison && (
        <button type="button" onClick={onCompare} className="underline text-neutral-300 hover:text-white" data-testid="compare-native">Compare the native crop</button>
      )}
      {comparison?.status === "loading" && <p>Reading the original and scoring it.</p>}
      {comparison?.status === "error" && <p className="text-red-400">Could not compare: {comparison.error}</p>}
      {comparison?.status === "done" && (
        <div className="grid grid-cols-2 gap-2 pt-1" data-testid="native-comparison">
          <div>
            {c.chip && <img src={c.chip} alt="" className="w-full rounded-sm border border-[#222]" style={{ imageRendering: "pixelated" }} />}
            <p className="pt-0.5">Ortho: {gsd(c.chipGsdM)}, spot {px(sources.targetPx.ortho)}{c.prediction ? `, model ${Math.round(c.prediction.pWeed * 100)}% weed` : ""}</p>
          </div>
          <div>
            <img src={comparison.crop.dataUrl} alt="" className="w-full rounded-sm border border-[#222]" style={{ imageRendering: "pixelated" }} />
            <p className="pt-0.5">Native: {gsd(comparison.crop.gsdM)}, spot {px(sources.targetPx.native)}{comparison.prediction ? `, model ${Math.round(comparison.prediction.pWeed * 100)}% weed` : ", no model"}</p>
          </div>
          {comparison.belowTrained && (
            <p className="col-span-2 text-amber-500/80">Both are coarser than the {gsd(comparison.requiredGsdM)} the model was trained on; the numbers are the experiment, not a finding.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Dt({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-neutral-500">{k}</dt>
      <dd className="text-neutral-300 font-mono text-right break-words">{v}</dd>
    </>
  );
}

export default SpotPopup;
