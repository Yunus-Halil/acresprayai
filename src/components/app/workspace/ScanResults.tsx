// What the scan found, in one screen, so the operator's job stops being spread
// across five tabs that do not know they are one job.
//
// THIS COMPONENT COMPUTES NOTHING. Every number and every sentence on it is
// produced by a module that already existed and is already the authority for
// it: the spots and their scores come from lib/weedScout, the plain-English
// description from describe.ts (attached to the candidate by the pipeline, not
// re-derived here), the acreage from lib/treatment/plannedArea.ts which is the
// same function the Flight Planner prices its chemical with, the names and
// every caveat around them from lib/weedCatalog/suggest.ts. If something here
// ever needs a figure none of those will state, that is the signal it is
// overreaching, not the signal to compute it.
//
// The one button hands over to the Flight Planner, which owns litres, tanks
// and the mission. It chooses no product and writes no rate: it applies the
// rates the operator already set, and the planner's own refusals still stand.
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, MapPin, Plane } from "lucide-react";
import type { Identification } from "@/lib/weedCatalog/identification";
import { isStatedFinding } from "@/lib/weedCatalog/identification";
import type { CropShortlist, RankedEntry, RecentLabel, Suggestion } from "@/lib/weedCatalog/suggest";
import type { CatalogEntry, FieldRegion } from "@/lib/weedCatalog/types";
import { describeCandidate } from "@/lib/weedScout/candidates";
import { type Verdict, VERDICTS, isDismissal } from "@/lib/weedScout/observations";
import type { Candidate } from "@/lib/weedScout/types";
import { type UnitSystem, fmtArea } from "@/lib/units";
import { IdentificationBlock } from "./IdentificationBlock";

const VERDICT_TONE: Record<string, string> = {
  weed: "bg-[#4CAF50] text-black border-[#4CAF50]",
  not_weed: "bg-[#525252] text-white border-[#525252]",
  unsure: "bg-amber-400 text-black border-amber-400",
};

export type ScanResultsProps = {
  candidates: Candidate[];
  units: UnitSystem;
  /** Ground the kept spots cover, from plannedAreas. The planner's own number. */
  treatAreaM2: number;
  /** The field's own area. Null when no boundary area is on file. */
  fieldAreaM2: number | null;
  /** Planned area for one spot, or null when the planner would drop it. */
  areaOf: (c: Candidate) => number | null;
  verdictOf: (c: Candidate) => Verdict;
  setVerdict: (c: Candidate, v: Verdict) => void;
  identificationOf: (c: Candidate) => Identification;
  notesOf: (c: Candidate) => string;
  setNotes: (c: Candidate, text: string) => void;
  suggestionOf: (c: Candidate) => Suggestion | null;
  isSaved: (c: Candidate) => boolean;
  isOnField: (c: Candidate) => boolean;
  /** The expanded row. Also the spot selected on the map. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;

  // ---- identification wiring, for the expanded row only ----
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

  // ---- the hand-off ----
  onShowMap: () => void;
  onBuildMission: () => void;
  /** Non-null while saving: what to say and how far along it is. */
  building: { done: number; total: number } | null;
  buildError: string | null;
  canBuild: boolean;
};

export function ScanResults(props: ScanResultsProps) {
  const {
    candidates, units, treatAreaM2, fieldAreaM2, areaOf, verdictOf, setVerdict, identificationOf,
    notesOf, setNotes, suggestionOf, isSaved, isOnField, selectedId, onSelect,
    onShowMap, onBuildMission, building, buildError, canBuild,
  } = props;

  const kept = candidates.filter(c => verdictOf(c) === "weed");
  const removed = candidates.filter(c => isDismissal(verdictOf(c)));
  const unsure = candidates.length - kept.length - removed.length;
  const area = (m2: number) => fmtArea(m2, units).text;
  // A percentage of a field whose area nobody recorded is not a number we have.
  const untreatedPct = fieldAreaM2 && fieldAreaM2 > 0
    ? Math.max(0, Math.min(100, 100 - (treatAreaM2 / fieldAreaM2) * 100))
    : null;

  return (
    <div className="absolute inset-0 overflow-y-auto" style={{ background: "#0f0f0f" }}>
      <div className="max-w-4xl mx-auto p-6 space-y-5">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Scan results</h1>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Worst first. Keep or remove each one, name it if you can, then hand it to the planner.
            </p>
          </div>
          <button type="button" onClick={onShowMap}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs border border-[#333] text-neutral-300 hover:bg-[#1f1f1f] rounded-sm px-3 py-1.5">
            <MapPin className="h-3.5 w-3.5" /> Show map
          </button>
        </header>

        {/* Three numbers, none of them computed here. */}
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Spots found" value={String(candidates.length)}
            note={`${kept.length} kept, ${removed.length} removed, ${unsure} unsure`} />
          <Stat label="To treat" value={area(treatAreaM2)}
            note={fieldAreaM2 ? `of ${area(fieldAreaM2)}` : "field area not on file"} />
          <Stat
            label="Needs nothing"
            value={untreatedPct != null ? `${untreatedPct.toFixed(0)}%` : "Not known"}
            note={untreatedPct != null ? "of the field" : "no boundary area on file"}
            muted={untreatedPct == null}
          />
        </div>

        {candidates.length === 0 && (
          <div className="rounded-sm border border-[#222] p-6 text-center text-sm text-neutral-400" style={{ background: "#161616" }}>
            Nothing stood out at these settings. That is a result, not an absence.
          </div>
        )}

        <ul className="space-y-2">
          {candidates.map((c, i) => {
            const v = verdictOf(c);
            const gone = isDismissal(v);
            const expanded = c.id === selectedId;
            const id = identificationOf(c);
            const named = isStatedFinding(id);
            const a = areaOf(c);
            return (
              <li key={c.id}
                className={`rounded-sm border ${expanded ? "border-[#38bdf8]/50" : "border-[#222]"} ${gone ? "opacity-60" : ""}`}
                style={{ background: "#161616" }}>
                <button type="button" onClick={() => onSelect(expanded ? null : c.id)}
                  className="w-full text-left p-3 flex items-start gap-3">
                  {c.chip ? (
                    <img src={c.chip} alt="" className="h-14 w-14 rounded-sm object-cover shrink-0 border border-[#222]"
                      style={{ imageRendering: "pixelated" }} />
                  ) : (
                    <div className="h-14 w-14 rounded-sm shrink-0 border border-[#222] grid place-items-center text-[9px] text-neutral-600">
                      no close-up
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs text-neutral-200">
                      <span className="font-mono text-neutral-500">{i + 1}</span>
                      <span className="truncate">{named ? id.label : (c.region ? c.region.klass : c.kind)}</span>
                      {named && <span className="text-[9px] uppercase tracking-wider text-[#7dd3fc] border border-[#38bdf8]/40 rounded-sm px-1">identified</span>}
                      {isSaved(c) && <CheckCircle2 className="h-3 w-3 text-[#4CAF50] shrink-0" />}
                      {isOnField(c) && <MapPin className="h-3 w-3 text-[#38bdf8] shrink-0" />}
                    </div>
                    <div className="text-[11px] text-neutral-500 mt-0.5">{describeCandidate(c, units)}</div>
                    {c.estimate && <div className="text-[11px] text-neutral-400 mt-0.5">{c.estimate.summary}</div>}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs font-mono text-neutral-300">
                      {a != null ? area(a) : <span className="text-neutral-500">outside boundary</span>}
                    </div>
                    <div className="text-[10px] text-neutral-600 mt-0.5 inline-flex items-center gap-1">
                      {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      {expanded ? "close" : "review"}
                    </div>
                  </div>
                </button>

                <div className="px-3 pb-3 flex flex-wrap items-center gap-1">
                  {VERDICTS.map(o => {
                    const on = v === o.value || (o.value === "not_weed" && gone);
                    return (
                      <button key={o.value} type="button" onClick={() => setVerdict(c, o.value)}
                        className={`text-[11px] rounded-sm px-2.5 py-1 border font-semibold ${on ? VERDICT_TONE[o.value] : "border-[#222] text-neutral-400 hover:bg-[#1f1f1f]"}`}>
                        {o.label}
                      </button>
                    );
                  })}
                  {a == null && (
                    <span className="text-[10px] text-amber-400/80 ml-1">
                      Centred outside the boundary, so the planner will not carry it.
                    </span>
                  )}
                </div>

                {expanded && !gone && (
                  <div className="px-3 pb-3 space-y-2">
                    <IdentificationBlock
                      identification={id}
                      suggestion={suggestionOf(c)}
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
                    <input
                      className="w-full bg-[#0f0f0f] border border-[#222] rounded-sm px-2 py-1 text-xs text-[#f0f0f0] focus:outline-none focus:border-[#4CAF50]"
                      placeholder="Notes" maxLength={300}
                      value={notesOf(c)} onChange={e => setNotes(c, e.target.value)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {candidates.length > 0 && (
          <div className="sticky bottom-0 pt-2 pb-4" style={{ background: "linear-gradient(to top, #0f0f0f 70%, transparent)" }}>
            <button type="button" onClick={onBuildMission} disabled={!canBuild || !!building}
              className="w-full inline-flex items-center justify-center gap-2 text-sm bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-40 text-black rounded-sm px-4 py-2.5 font-semibold">
              {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plane className="h-4 w-4" />}
              {building
                ? `Saving ${building.done}/${building.total}`
                : `Save ${candidates.length} spot${candidates.length === 1 ? "" : "s"} and open the Flight Planner`}
            </button>
            <p className="text-[10px] text-neutral-500 text-center mt-1.5">
              Puts the {kept.length} kept spot{kept.length === 1 ? "" : "s"} on the field and applies your own rates,
              drone and tank settings. No product or rate is chosen for you.
            </p>
            {buildError && <p className="text-[11px] text-red-400 text-center mt-1">{buildError}</p>}
            {!canBuild && <p className="text-[11px] text-neutral-500 text-center mt-1">Sign in to save.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, note, muted }: { label: string; value: string; note: string; muted?: boolean }) {
  return (
    <div className="rounded-sm border border-[#222] p-3" style={{ background: "#161616" }}>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className={`text-xl font-medium mt-0.5 ${muted ? "text-neutral-500" : "text-neutral-100"}`}>{value}</div>
      <div className="text-[11px] text-neutral-500">{note}</div>
    </div>
  );
}

export default ScanResults;
