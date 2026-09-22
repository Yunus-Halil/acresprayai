// The one decision on the results screen: what is this, if anything.
//
// Lifted out of WeedScoutTab so the results rows and the map-side selected-spot
// panel are the same component rather than two copies that drift. It renders
// four states and nothing else decides between them:
//
//   suggested      the archive's nearest confirmed neighbours carried a name
//                  that is in the catalog. Shown with the basis spelled out,
//                  Confirm and Reject beside it. `suggestionsFor` decides this,
//                  and its gate is unchanged: no archive, no suggestion.
//   identified     the operator has said what it is. Their label, their
//                  authority, with the source it came from.
//   rejected       they were shown a name and said no. Still unidentified.
//   unidentified   nothing has been said, which is a valid outcome and stays
//                  one. Leaving is as easy as picking.
//
// WHAT THIS COMPONENT MAY NOT DO. It may not favour an entry. The crop
// shortlist it renders is Virginia's guide list for the field's crop, which is
// sixteen names for corn and the same sixteen for soybean, so `cropShortlist`
// reports `tooMany` and the list is shown as a list to read rather than a
// ranking to trust. The chips exist because clicking beats typing into a box
// over 755 names, not because the first one is more likely. Every caveat the
// catalog carries travels with them: evidence label, presence note, legal tier,
// the state assumption, and the reference list's own note.
import { ExternalLink } from "lucide-react";
import {
  type Identification, REJECTED, UNIDENTIFIED,
} from "@/lib/weedCatalog/identification";
import { ASSUMED_REGION_WARNING } from "@/lib/weedCatalog/region";
import {
  type CropShortlist, type RankedEntry, type RecentLabel, type Suggestion,
  evidenceLabel, presenceNote, regulatoryNote,
} from "@/lib/weedCatalog/suggest";
import type { CatalogEntry, FieldRegion } from "@/lib/weedCatalog/types";

const INPUT = "w-full bg-[#0f0f0f] border border-[#222] rounded-sm px-2 py-1 text-xs text-[#f0f0f0] focus:outline-none focus:border-[#4CAF50]";
const PILL = "ml-1 text-[9px] uppercase tracking-wider rounded-sm px-1";
const CHIP = "text-[11px] rounded-sm border border-[#333] px-2 py-1 text-neutral-200 hover:border-[#38bdf8] hover:text-[#7dd3fc] transition-colors";

export type IdentificationBlockProps = {
  identification: Identification;
  /** From the archive, or null. Never computed from the pixels. */
  suggestion: Suggestion | null;
  /** The state's crop-guide entries for this field's crop, and whether to favour any. */
  shortlist: CropShortlist;
  /** Names the operator has used before. A recently-used list, not a claim. */
  recent: RecentLabel[];
  /** Search results over the whole reference list, already sliced. */
  searchResults: RankedEntry[];
  searchQuery: string;
  onSearchQuery: (q: string) => void;
  freeText: string;
  onFreeText: (t: string) => void;
  /** The whole reference list's own note about what it is. */
  listNote: string;
  region: FieldRegion;
  catalogSize: number;
  catalogError: string | null;
  onConfirmSuggestion: () => void;
  onSetIdentification: (id: Identification) => void;
  /** Picking an entry from any of the three routes: chips, recents, search. */
  onPickEntry: (entry: CatalogEntry, why: string) => void;
  /** Picking a name the operator has used before, which may not be in the catalog. */
  onPickRecent: (name: string) => void;
};

export function IdentificationBlock({
  identification, suggestion, shortlist, recent, searchResults, searchQuery, onSearchQuery,
  freeText, onFreeText, listNote, region, catalogSize, catalogError,
  onConfirmSuggestion, onSetIdentification, onPickEntry, onPickRecent,
}: IdentificationBlockProps) {
  const unnamed = identification.status === "unidentified" || identification.status === "rejected";
  const showSuggestion = suggestion
    && identification.status !== "confirmed"
    && identification.status !== "rejected";

  return (
    <div className="border border-[#222] rounded-sm p-3 space-y-2" style={{ background: "#161616" }}>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">What weed is it? (your call)</div>

      {showSuggestion && (
        <div className="border border-[#38bdf8]/40 rounded-sm p-2 space-y-1.5" style={{ background: "#0f171c" }}>
          <div className="text-[11px] text-neutral-200">
            Suggested: <span className="font-semibold">{suggestion!.entry.common_name}</span>{" "}
            <span className="italic text-neutral-400">{suggestion!.entry.scientific_name_as_source}</span>
            <span className={`${PILL} text-[#7dd3fc] border border-[#38bdf8]/40`}>suggested</span>
          </div>
          <div className="text-[10px] text-neutral-400">{suggestion!.basis}</div>
          <div className="text-[10px] text-neutral-500">{evidenceLabel(suggestion!.entry)}. {presenceNote(suggestion!.entry)}</div>
          {regulatoryNote(suggestion!.entry) && (
            <div className="text-[10px] text-amber-400/90">{regulatoryNote(suggestion!.entry)}</div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={onConfirmSuggestion}
              className="text-[11px] bg-[#38bdf8] hover:bg-[#0ea5e9] text-black rounded-sm px-2.5 py-1 font-semibold">Confirm</button>
            <button type="button" onClick={() => onSetIdentification(REJECTED)}
              className="text-[11px] border border-[#333] text-neutral-300 hover:bg-[#1f1f1f] rounded-sm px-2.5 py-1">Reject</button>
            <a href={`/app/weeds?id=${encodeURIComponent(suggestion!.entry.catalog_id)}`} target="_blank" rel="noreferrer"
              className="text-[10px] underline text-neutral-400 inline-flex items-center gap-1">Weed Library <ExternalLink className="h-3 w-3" /></a>
          </div>
        </div>
      )}

      {identification.status !== "unidentified" ? (
        <div className="text-[11px] flex items-start justify-between gap-2">
          <div className="min-w-0">
            {identification.status === "rejected" ? (
              <span className="text-neutral-400">Suggestion rejected. Not identified.</span>
            ) : (
              <>
                <span className="text-[#7dd3fc] font-semibold">{identification.label}</span>
                <span className={`${PILL} text-[#7dd3fc] border border-[#38bdf8]/40`}>
                  {identification.status === "confirmed" ? "user confirmed" : "user identified"}
                </span>
                <div className="text-[10px] text-neutral-600 break-all">Source: {identification.source}</div>
                {identification.catalogId && (
                  <a href={`/app/weeds?id=${encodeURIComponent(identification.catalogId)}`} target="_blank" rel="noreferrer"
                    className="text-[10px] underline text-neutral-400 inline-flex items-center gap-1">Open in Weed Library <ExternalLink className="h-3 w-3" /></a>
                )}
              </>
            )}
          </div>
          <button type="button" onClick={() => { onSetIdentification(UNIDENTIFIED); onFreeText(""); }}
            className="text-[10px] underline text-neutral-500 hover:text-neutral-200 shrink-0">Change</button>
        </div>
      ) : (
        <div className="text-[11px] text-neutral-500">
          Not identified. <span className={`${PILL} border border-[#333]`}>unidentified</span>{" "}
          It stays a weed spot without a name unless you pick one.
        </div>
      )}

      {unnamed && (
        <>
          {/* Names the operator has used before. Not a claim about this spot:
              their own vocabulary, handed back so they need not retype it. */}
          {recent.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] text-neutral-500">Names you have used before</div>
              <div className="flex flex-wrap gap-1">
                {recent.map(r => (
                  <button key={r.name} type="button" onClick={() => onPickRecent(r.name)} className={CHIP}>
                    {r.name}
                    {r.thisField && <span className="ml-1 text-[9px] text-neutral-500">this field</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* The state's crop-guide list. Never a favourite: see cropShortlist. */}
          {shortlist.entries.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] text-neutral-500">{shortlist.note}</div>
              <div className="flex flex-wrap gap-1">
                {shortlist.entries.map(({ entry: e, why }) => (
                  <button key={e.catalog_id} type="button" onClick={() => onPickEntry(e, why)} className={CHIP}
                    title={`${e.scientific_name_as_source}. ${evidenceLabel(e)}. ${presenceNote(e)}`}>
                    {e.common_name}
                    {e.regulatory_tier && (
                      <span className="ml-1 text-[9px] uppercase tracking-wider text-amber-400/90">{e.regulatory_tier}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="relative">
            <input className={INPUT}
              placeholder={catalogSize
                ? `Search all ${catalogSize} ${region.stateName} names`
                : catalogError ? "Reference list unavailable" : "Reference list loading"}
              value={searchQuery} onChange={e => onSearchQuery(e.target.value)} disabled={!catalogSize} />
            {searchResults.length > 0 && (
              <ul className="mt-1 border border-[#222] rounded-sm divide-y divide-[#1f1f1f] max-h-56 overflow-y-auto" style={{ background: "#0f0f0f" }}>
                {searchResults.map(({ entry: e, why }) => (
                  <li key={e.catalog_id}>
                    <button type="button" onClick={() => onPickEntry(e, why)} className="w-full text-left px-2 py-1.5 hover:bg-[#1a1a1a]">
                      <div className="text-[11px] text-neutral-200">
                        {e.common_name} <span className="italic text-neutral-500">{e.scientific_name_as_source}</span>
                        {e.regulatory_tier && (
                          <span className={`${PILL} text-amber-400/90 border border-amber-400/40`}>{e.regulatory_tier} noxious (legal status)</span>
                        )}
                        {e.usda_status === "unmatched_requires_review" && (
                          <span className={`${PILL} text-neutral-500 border border-[#333]`}>name unresolved</span>
                        )}
                      </div>
                      <div className="text-[10px] text-neutral-500">{evidenceLabel(e)}. {why}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {searchQuery.trim() && catalogSize > 0 && searchResults.length === 0 && (
              <div className="text-[10px] text-neutral-500 mt-1">
                No name in the {region.stateName} list matches. Type it below if you know it.
              </div>
            )}
          </div>

          <input className={INPUT} placeholder="Or type a name or group yourself"
            value={freeText} onChange={e => onFreeText(e.target.value)} maxLength={120} />

          {/* Leaving it unidentified must cost no more than picking. */}
          {identification.status === "unidentified" && (
            <button type="button" onClick={() => { onSetIdentification(UNIDENTIFIED); onFreeText(""); onSearchQuery(""); }}
              className="text-[10px] underline text-neutral-500 hover:text-neutral-300">
              Leave it unidentified
            </button>
          )}

          <div className="text-[10px] text-neutral-600">{listNote}</div>
          <div className="text-[10px] text-neutral-600">{ASSUMED_REGION_WARNING}</div>
        </>
      )}
    </div>
  );
}

export default IdentificationBlock;
