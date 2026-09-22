// What an identification IS, and which of them may be stated as a finding.
//
// Four states, and the boundary between them is the whole point:
//
//   unidentified  nothing has been said. The candidate is vegetation or a
//                 weed-area candidate and that is all the app may call it.
//   rejected      a suggestion was shown and the operator said no. Still
//                 nothing is said about what it is.
//   confirmed     the operator confirmed the suggestion that was shown. The
//                 database enforces that a confirmed id equals the suggested id.
//   edited        the operator picked a different catalog entry, or typed a
//                 name. Their label, on their authority.
//
// Only `confirmed` and `edited` are findings. A suggestion that was shown and
// never acted on is stored as a suggestion (its own columns) and is NEVER
// promoted: `summariseIdentifications` puts it in a count of unidentified
// candidates, the annotation written by Apply carries no label for it, and
// the report prints it as "not identified".
import type { CatalogEntry } from "./types";

export type IdentificationStatus = "unidentified" | "confirmed" | "edited" | "rejected";
export const IDENTIFICATION_STATUSES: readonly IdentificationStatus[] = ["unidentified", "confirmed", "edited", "rejected"];

export type Identification = {
  status: IdentificationStatus;
  /** Catalog entry, when the label came from the catalog. */
  catalogId: string | null;
  /** The label as a person reads it: the entry's common name, or the operator's own text. */
  label: string | null;
  /** Where the label came from: source ids and profile link, or "operator free text". */
  source: string | null;
  /** Why it was offered (a suggestion's basis) or how it was chosen. */
  basis: string | null;
};

export const UNIDENTIFIED: Identification = { status: "unidentified", catalogId: null, label: null, source: null, basis: null };
export const REJECTED: Identification = { status: "rejected", catalogId: null, label: null, source: null, basis: null };

/** True only for the two states that are the operator's own statement. */
export function isStatedFinding(id: Identification | null | undefined): boolean {
  return !!id && (id.status === "confirmed" || id.status === "edited") && !!id.label?.trim();
}

/** The source text stored with a label taken from the catalog. */
export function sourceTextFor(e: Pick<CatalogEntry, "source_ids" | "vt_profile_url" | "catalog_id" | "catalog_version" | "state">): string {
  const parts = [`${e.state} weed catalog ${e.catalog_version}, ${e.catalog_id}`, `sources: ${e.source_ids.join(", ")}`];
  if (e.vt_profile_url) parts.push(e.vt_profile_url);
  return parts.join("; ");
}

export function identificationFromEntry(e: CatalogEntry, status: "confirmed" | "edited", basis: string): Identification {
  return {
    status,
    catalogId: e.catalog_id,
    label: e.common_name,
    source: sourceTextFor(e),
    basis,
  };
}

export function identificationFromText(text: string): Identification {
  const t = text.trim();
  if (!t) return UNIDENTIFIED;
  return { status: "edited", catalogId: null, label: t, source: "operator free text", basis: "Typed by the operator." };
}

/** One sentence for a popup or a note. Never names a plant unless the operator did. */
export function identificationLine(id: Identification | null | undefined): string {
  if (!id || id.status === "unidentified") return "Not identified by the operator. A vegetation or weed-area candidate, not a finding.";
  if (id.status === "rejected") return "The operator rejected the suggested name. Not identified.";
  const how = id.status === "confirmed" ? "confirmed by the operator from a suggestion drawn from their own past verdicts" : "identified by the operator";
  return `${id.label}: ${how}. Source: ${id.source ?? "not recorded"}.`;
}

// ---------------------------------------------------------------------------
// The report's view
// ---------------------------------------------------------------------------

/** The columns the report reads off `weed_observations`. */
export type IdentificationRow = {
  candidate_id: string;
  kind: string;
  verdict: string | null;
  species: string | null;
  identification_status: IdentificationStatus | string | null;
  catalog_id: string | null;
  identification_source: string | null;
  suggested_catalog_id: string | null;
  area_m2: number | null;
  lat: number;
  lng: number;
};

export type StatedIdentification = {
  candidate_id: string;
  label: string;
  status: "confirmed" | "edited";
  catalog_id: string | null;
  source: string | null;
  verdict: string | null;
  area_m2: number | null;
  lat: number;
  lng: number;
};

export type IdentificationSummary = {
  /** The only rows that may be printed as findings. */
  stated: StatedIdentification[];
  /** Candidates saved with no identification (including any shown a suggestion and never acted on). */
  unidentified: number;
  /** Suggestions the operator rejected. */
  rejected: number;
  /** Of the unidentified, those that had a suggestion on screen. Never a finding. */
  suggestedOnly: number;
};

export function summariseIdentifications(rows: readonly IdentificationRow[]): IdentificationSummary {
  const stated: StatedIdentification[] = [];
  let unidentified = 0, rejected = 0, suggestedOnly = 0;
  for (const r of rows) {
    const status = r.identification_status;
    const label = r.species?.trim() ?? "";
    if ((status === "confirmed" || status === "edited") && label) {
      stated.push({
        candidate_id: r.candidate_id, label, status, catalog_id: r.catalog_id, source: r.identification_source,
        verdict: r.verdict, area_m2: r.area_m2, lat: r.lat, lng: r.lng,
      });
    } else if (status === "rejected") {
      rejected += 1;
    } else {
      unidentified += 1;
      if (r.suggested_catalog_id) suggestedOnly += 1;
    }
  }
  stated.sort((a, b) => a.label.localeCompare(b.label));
  return { stated, unidentified, rejected, suggestedOnly };
}

/** The sentence the report prints under the identifications block. */
export function identificationCaveat(s: IdentificationSummary): string {
  const parts: string[] = [];
  if (s.stated.length) parts.push("Each name above was stated by the operator; none was produced by image analysis.");
  if (s.unidentified) parts.push(`${s.unidentified} saved candidate${s.unidentified === 1 ? " was" : "s were"} not identified and ${s.unidentified === 1 ? "is" : "are"} not findings.`);
  if (s.rejected) parts.push(`${s.rejected} suggested name${s.rejected === 1 ? " was" : "s were"} rejected by the operator.`);
  if (!parts.length) parts.push("No weed identifications were recorded for this scan.");
  return parts.join(" ");
}
