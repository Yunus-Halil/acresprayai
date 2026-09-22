// When the scout may put a name next to a candidate, and how the list is
// ordered when the operator goes looking for one.
//
// THE ONLY DEFENSIBLE BASIS TODAY IS THE OPERATOR'S OWN PAST VERDICTS. The
// detector measures size, colour, shape and position; it has never been
// shown labelled imagery of any species and cannot tell one from another.
// The one thing it does have is retrieval over the archive (feedback.ts):
// when the archived candidates most like this one were confirmed as weeds
// and the operator wrote a name on them, that name is offered back. If that
// text matches a catalog entry, the entry is offered as a suggestion, with
// the basis spelled out: "you called things like this X before", never "this
// looks like X". Without that, there is no suggestion, and the panel stays
// at the vegetation or weed-area level with the reference list open for the
// operator to identify manually.
//
// Importing the catalog changes none of the detector's numbers. It gives the
// operator a sourced name to pick instead of free text. That is all.
import type { Candidate } from "../weedScout/types";
import type { CatalogEntry, CropContext, FieldRegion } from "./types";
import { CROP_CONTEXT_LABEL } from "./types";

export type Suggestion = {
  entry: CatalogEntry;
  /** The species text the operator wrote on the archived neighbours. */
  matchedText: string;
  matchedOn: "common name" | "scientific name" | "reviewed name";
  /** Neighbours confirmed as weeds, and neighbours considered. */
  confirmed: number;
  considered: number;
  /** Plain words for why this name is here, shown next to it always. */
  basis: string;
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Entries whose common, scientific or reviewer-resolved name equals the text. */
export function entriesNamed(text: string, entries: readonly CatalogEntry[]): { entry: CatalogEntry; on: Suggestion["matchedOn"] }[] {
  const t = norm(text);
  if (!t) return [];
  const out: { entry: CatalogEntry; on: Suggestion["matchedOn"] }[] = [];
  for (const e of entries) {
    if (e.review_status === "excluded") continue;
    if (norm(e.common_name) === t) out.push({ entry: e, on: "common name" });
    else if (norm(e.scientific_name_as_source) === t) out.push({ entry: e, on: "scientific name" });
    else if (e.resolved_scientific_name && norm(e.resolved_scientific_name) === t) out.push({ entry: e, on: "reviewed name" });
  }
  return out;
}

/**
 * Suggestions for a candidate. Empty unless the archive's nearest confirmed
 * neighbours carried a name that is in the catalog. At most three.
 */
export function suggestionsFor(c: Candidate, entries: readonly CatalogEntry[]): Suggestion[] {
  const f = c.feedback;
  if (!f || !(f.factor > 1) || !f.species.length || f.confirmed <= 0) return [];
  const considered = f.confirmed + f.dismissed;
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const text of f.species) {
    for (const { entry, on } of entriesNamed(text, entries)) {
      if (seen.has(entry.catalog_id)) continue;
      seen.add(entry.catalog_id);
      out.push({
        entry, matchedText: text, matchedOn: on, confirmed: f.confirmed, considered,
        basis: `From your own past verdicts: ${f.confirmed} of the ${considered} archived candidates most like this one ` +
          `(by size, colour, shape and position) were confirmed as weeds, and you named them "${text}". ` +
          `This catalog entry is a ${on} match to that text. It is not a visual identification of these pixels.`,
      });
      if (out.length >= 3) return out;
    }
  }
  return out;
}

export type Narrowing = {
  region: FieldRegion;
  crop: CropContext | null;
};

export type RankedEntry = {
  entry: CatalogEntry;
  /** 0 = named for this crop, 1 = named for another crop, 2 = agricultural review cue, 3 = everything else. */
  rank: 0 | 1 | 2 | 3;
  /** One line saying why it ranks where it does. */
  why: string;
};

const AGRICULTURAL_CUES = new Set(["agronomic_crops", "pasture_forage", "horticultural_crops"]);

/**
 * Order the reference list for a field. Nothing is removed by state or crop:
 * the list is one state's catalog already, and a plant not named in a crop
 * guide can still be the one standing in this field. Excluded (reviewer-
 * rejected) entries are the only ones dropped.
 */
export function narrowCatalog(entries: readonly CatalogEntry[], n: Narrowing): { ranked: RankedEntry[]; note: string } {
  const ranked: RankedEntry[] = [];
  for (const e of entries) {
    if (e.state !== n.region.state) continue;
    if (e.review_status === "excluded") continue;
    let rank: RankedEntry["rank"] = 3;
    let why = "In the state identification index only.";
    if (n.crop && e.crop_contexts.includes(n.crop)) {
      rank = 0; why = `Named in the ${CROP_CONTEXT_LABEL[n.crop]} table of the state crop guide.`;
    } else if (e.crop_contexts.length) {
      rank = 1; why = `Named in the crop guide for ${e.crop_contexts.map(c => CROP_CONTEXT_LABEL[c as CropContext] ?? c).join(", ")}, not for this crop.`;
    } else if (e.habitat_flags.some(f => AGRICULTURAL_CUES.has(f))) {
      rank = 2; why = "Profile habitat text mentions farm ground (an automated review cue, not a verified association).";
    } else if (e.catalog_status === "regulatory_only") {
      why = "Listed in state law only; no identification-index profile.";
    }
    ranked.push({ entry: e, rank, why });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.entry.common_name.localeCompare(b.entry.common_name));
  const cropText = n.crop ? ` and ${CROP_CONTEXT_LABEL[n.crop]}` : "";
  const note = `Reference list ordered for ${n.region.stateName} (${n.region.basis})${cropText}. ` +
    "Being on this list is not evidence that a plant is in this field.";
  return { ranked, note };
}

/** Client-side search over the ranked list: every token must hit a name, symbol or id. */
export function searchRanked(ranked: readonly RankedEntry[], query: string): RankedEntry[] {
  const tokens = norm(query).split(" ").filter(Boolean);
  if (!tokens.length) return [...ranked];
  return ranked.filter(({ entry: e }) => {
    const hay = norm([e.common_name, e.scientific_name_as_source, e.resolved_scientific_name ?? "", e.usda_symbol ?? "", e.catalog_id].join(" "));
    return tokens.every(t => hay.includes(t));
  });
}

/** What being in the catalog does and does not say about presence. */
export function presenceNote(e: CatalogEntry): string {
  switch (e.catalog_status) {
    case "crop_context_sourced":
      return "Named in a Mid-Atlantic crop guide table. That is crop relevance, not proof it grows in this field or county.";
    case "regulatory_only":
      return "Named in state law only, with no identification-index profile. Possibly absent from the state; not an occurrence claim.";
    default:
      return "Named in a broad identification index (plants submitted to a clinic, including cultivated and non-field plants). Not proof of occurrence on any farm.";
  }
}

/**
 * The legal status, worded so it cannot be read as a detection or as
 * presence. Null when the entry is not regulated.
 */
export function regulatoryNote(e: CatalogEntry): string | null {
  if (!e.regulatory_tier) return null;
  const law = e.regulatory_scientific_name && e.regulatory_scientific_name !== e.scientific_name_as_source
    ? ` (listed in law as ${e.regulatory_scientific_name})` : "";
  if (e.regulatory_tier === "Tier 1") {
    return `Virginia Tier 1 noxious weed${law}: designated NOT known present in Virginia. A legal status only. ` +
      "It is not evidence that this plant is in the state, in this field, or in this candidate.";
  }
  return `Virginia ${e.regulatory_tier} noxious weed${law}: a legal status under 2VAC5-317-20, ` +
    "separate from whether this candidate is that plant and from any treatment decision.";
}

/** Short evidence label for lists and badges. */
export function evidenceLabel(e: CatalogEntry): string {
  switch (e.catalog_status) {
    case "crop_context_sourced": return `Crop guide: ${e.crop_contexts.map(c => CROP_CONTEXT_LABEL[c as CropContext] ?? c).join(", ")}`;
    case "regulatory_only": return "Law listing only";
    default: return "Identification index only";
  }
}
