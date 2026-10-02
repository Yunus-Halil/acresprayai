// The field walk: which flagged patch to go to next, and what a record of it
// must say. Pure, so the rules can be tested without a field or a phone.
//
// The map flags areas; a person walks to them and says what is there. That
// statement, with photos, is the label everything patch-level is built on, so
// the rules here are about honesty more than convenience: "what is here" is
// asked on its own before any species (a pale patch is as often a wet hollow
// as a weed), a weed record must name something (and "not sure which" is an
// allowed name), and nothing is filled in for the person.

export const WHAT_IS_HERE = [
  "weeds", "crop_stress", "bare_ground", "waterlogging", "crop_damage", "nothing_unusual", "other",
] as const;
export type WhatIsHere = typeof WHAT_IS_HERE[number];

export const WHAT_IS_HERE_LABEL: Record<WhatIsHere, string> = {
  weeds: "Weeds",
  crop_stress: "Crop stress (pale, stunted, diseased)",
  bare_ground: "Bare ground",
  waterlogging: "Wet or waterlogged",
  crop_damage: "Crop damage (wheel, lodging, animal)",
  nothing_unusual: "Nothing unusual",
  other: "Something else",
};

export const GROWTH_STAGES = ["seedling", "vegetative", "flowering", "seeding", "mixed", "unknown"] as const;
export type GrowthStage = typeof GROWTH_STAGES[number];

export type Confidence = "certain" | "likely" | "unsure";
export type IdentifiedBy = "operator" | "agronomist" | "other";

/** One plant named in a patch, in the visitor's words. */
export type SpeciesEntry = {
  name: string;
  /** Reference-list id when the name was picked from the list; null for typed names. */
  catalogId: string | null;
  /** Share of the patch this plant covers, 0..100, when estimated. */
  coverPct: number | null;
  dominant: boolean;
};

/** A name that says "a weed, species not known" without inventing one. */
export const UNKNOWN_WEED = "Weed, species not known";

/** A flagged patch as the walk list shows it, from the scan's saved spots. */
export type WalkPatch = {
  observationId: string;
  candidateId: string;
  scanId: string | null;
  fieldId: string | null;
  lat: number;
  lng: number;
  /** What the map called it: the finding class or the region class or the kind. */
  label: string;
  verdict: string | null;
  areaM2: number | null;
  crop: string | null;
};

export type Position = { lat: number; lng: number; accuracyM?: number | null };

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from north, 0..360. */
export function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8];

export type WalkItem = WalkPatch & {
  /** From the walker, when their position is known. */
  distanceM: number | null;
  bearingDeg: number | null;
  /** Visits already recorded for this patch. */
  visits: number;
};

/**
 * The patches in walking order: unvisited first, then nearest first when the
 * walker's position is known, else in the order the scan ranked them.
 */
export function walkList(patches: WalkPatch[], here: Position | null, visitsBySpot: Record<string, number>): WalkItem[] {
  const items: WalkItem[] = patches.map(p => ({
    ...p,
    distanceM: here ? distanceM(here, p) : null,
    bearingDeg: here ? bearingDeg(here, p) : null,
    visits: visitsBySpot[p.candidateId] ?? 0,
  }));
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) =>
      Number(a.it.visits > 0) - Number(b.it.visits > 0) ||
      (a.it.distanceM ?? 0) - (b.it.distanceM ?? 0) ||
      a.i - b.i)
    .map(x => x.it);
}

/** Directions to a patch in whatever maps app the phone has. */
export const directionsUrl = (p: { lat: number; lng: number }) =>
  `https://www.google.com/maps/dir/?api=1&destination=${p.lat.toFixed(7)},${p.lng.toFixed(7)}&travelmode=walking`;

export type GroundTruthInput = {
  patch: WalkPatch;
  visitor: Position | null;
  whatIsHere: WhatIsHere | null;
  species: SpeciesEntry[];
  growthStage: GrowthStage | null;
  patchCoverPct: number | null;
  confidence: Confidence;
  identifiedBy: IdentifiedBy;
  notes: string;
};

/** Everything wrong with a record, in words a person in a field can act on. Empty when it can be saved. */
export function validateGroundTruth(input: GroundTruthInput): string[] {
  const errors: string[] = [];
  if (!input.whatIsHere) errors.push("Say what is in the patch first.");
  const named = input.species.filter(s => s.name.trim());
  if (input.whatIsHere === "weeds" && !named.length) {
    errors.push(`Name at least one weed, or pick "${UNKNOWN_WEED}".`);
  }
  if (input.species.some(s => !s.name.trim() && s.coverPct != null)) errors.push("A cover estimate needs a plant name beside it.");
  for (const s of named) {
    if (s.coverPct != null && (s.coverPct < 0 || s.coverPct > 100)) errors.push(`Cover for ${s.name} must be between 0 and 100%.`);
  }
  if (input.patchCoverPct != null && (input.patchCoverPct < 0 || input.patchCoverPct > 100)) errors.push("Patch cover must be between 0 and 100%.");
  const total = named.reduce((t, s) => t + (s.coverPct ?? 0), 0);
  if (total > 100) errors.push(`The plant covers add up to ${total}%, more than the whole patch.`);
  if (named.filter(s => s.dominant).length > 1) errors.push("Only one plant can be the dominant one.");
  return errors;
}

/** The database row for a valid record (photos are added after upload). */
export function groundTruthRow(input: GroundTruthInput, userId: string) {
  const species = input.whatIsHere === "weeds"
    ? input.species.filter(s => s.name.trim()).map(s => ({ name: s.name.trim(), catalogId: s.catalogId, coverPct: s.coverPct, dominant: s.dominant }))
    : [];
  return {
    user_id: userId,
    field_id: input.patch.fieldId,
    scan_id: input.patch.scanId,
    candidate_id: input.patch.candidateId,
    observation_id: input.patch.observationId,
    patch_lat: input.patch.lat,
    patch_lng: input.patch.lng,
    visitor_lat: input.visitor?.lat ?? null,
    visitor_lng: input.visitor?.lng ?? null,
    visitor_accuracy_m: input.visitor?.accuracyM ?? null,
    what_is_here: input.whatIsHere!,
    species,
    growth_stage: input.whatIsHere === "weeds" ? input.growthStage : null,
    patch_cover_pct: input.patchCoverPct,
    confidence: input.confidence,
    identified_by: input.identifiedBy,
    crop: input.patch.crop,
    notes: input.notes.trim() || null,
  };
}
