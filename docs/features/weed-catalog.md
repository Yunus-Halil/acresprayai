# Weed catalog, identification and treatment

The weed reference catalog is a state-at-a-time list of weed NAMES with the source each name
came from. It exists so an operator identifying a Weed Scout spot can pick a real, sourced
name instead of typing free text, and so that name travels into the archive, Field View,
the Flight Planner and the application record with its source and its confirmation status.
It is not a detector, not a presence claim, and it carries no herbicide information.

Everything here is developer-mode work (Settings, section 5) and shipped 2026-09-22.

## Testing assumption: every field is in Virginia

There is no per-field state yet. Until one exists, `lib/weedCatalog/region.ts` treats every
field as being in Virginia, the one state with a catalog. The Fields page carries an amber
banner saying so, the scout's identification panel names the assumption in its note, and the
Weed Library states it in its header. Remove it by giving `fieldRegion()` a real source and
deleting the banner; nothing else depends on the constant.

## The Virginia package

`weeddatabase/Virginia_weed_catalog_v0.1/` is the source package (README, WHAT_CHANGED,
STATE_METHOD, coverage report, JSON schema, data). Its own boundaries, which the import keeps:

- 755 source records: 739 Virginia Tech Weed ID index entries and 16 law-only listings.
  These are not 755 verified farm weeds. The index includes cultivated, aquatic and
  non-field plants.
- 54 entries have a named crop or pasture guide table connection, and those are preliminary.
- 98 scientific names did not match the USDA Virginia checklist exactly and need review.
- Habitat keyword flags are automated review cues, not verified crop associations.
- Every record has `aerial_identification_validated = false`.
- A Tier 1 regulatory listing means "not known present in Virginia" and must never become
  an occurrence claim.

## Import

`scripts/build-weed-catalog-seed.ts <package dir>` parses the package with
`lib/weedCatalog/import.ts`, runs the same checks the package's `validate_catalog.py` runs
(plus the ones the database also enforces: no aerial claim, no Tier 1 checklist match,
crop status only with crop evidence, unique ids, known sources, coverage counts that match
the records) and writes a seed migration that calls `public.import_weed_catalog(jsonb)`.
Applying it with `supabase db push` is the import. The function is idempotent: the same
payload twice changes nothing but the version stamp; a changed upstream record updates the
source-owned columns of an unreviewed entry and is parked in `pending_source_update` on a
reviewed one. It never writes a review-owned column (`review_status`, `review_notes`,
`reviewed_by`, `reviewed_at`, `resolved_scientific_name`, `pending_source_update`).

Tables (migration `20260922090000_weed_catalog.sql`): `weed_catalog_sources`,
`weed_catalog_entries`, `weed_catalog_review_queue`. Readable by every signed-in user,
written by the service role only. There is no reviewer role yet; review columns exist so the
import contract is real, and are set by SQL until a reviewer flow exists.

## Weed Library (`/app/weeds`, developer mode)

The internal review view: coverage counts computed from the rows, search by common or
scientific name, USDA symbol or catalog id, filters by evidence, crop context, legal tier and
plant type, "unresolved only" and "with habitat cues" toggles, a detail panel with sources,
crop-guide locators, the legal note, the name reconciliation state, the review state and the
entry's review-queue items, plus the review queue grouped by reason and the source ledger.
Crop-guide entries are listed first; that is an ordering, not evidence. Every entry is
labelled by how it got here (identification index only, named in a crop guide table, law
listing only). Nothing on the page is a confirmed farm weed.

## Identification in Weed Scout

A spot's identification is the operator's statement, in one of four states: unidentified,
suggested-then-rejected, confirmed (the suggestion that was shown), edited (their own pick
from the list or typed text). Only confirmed and edited are findings.

The scout offers a name only when it has a defensible basis, and the only one it has today is
the operator's own past verdicts: when the archived candidates most like this one were
confirmed as weeds and carried a name that is in the catalog (`lib/weedCatalog/suggest.ts`),
that entry is shown as "suggested" with the basis spelled out. Nothing recognises a species
from the pixels, and importing the catalog changes none of the detector's numbers. Without a
suggestion the panel stays at the vegetation level, with the Virginia list open to search
(ordered for the field's crop) and a free-text field.

Storage: `weed_observations` holds the suggestion apart from the identification
(`suggested_catalog_id`, `suggestion_basis` versus `identification_status`, `catalog_id`,
`species`, `identification_source`, `identification_basis`). Check constraints make the rule
structural: a confirmed row's `catalog_id` must equal its `suggested_catalog_id`; an
unidentified or rejected row carries no `catalog_id`.

Legal status stays apart from identification: a regulated entry shows its tier as a legal
note, with Tier 1 worded as "not known present in Virginia", never as a detection.

## Spots keep their id

`lib/weedScout/spotId.ts` derives a candidate's id from its family (region, tile, plant) and
its centroid rounded to about a metre, so a re-run under the same settings finds the same
spot: the archive row under `weed_observations.candidate_id`, the Field View annotation under
`user_annotations.spot_id`.

## Review flow

Scan, click a spot on the map or in the list, keep it as a weed or remove it (or leave it
unsure), identify it if you can, then "Save all". Removing is one click on the X of a row.
Every spot starts with a default (plant candidates and vegetation regions as weeds, bare or
dark or thin ground as unsure), shown on its row and flipped with one click. "Save all" writes
every spot with its current verdict and identification and, when the box is ticked, puts the
kept weed spots on Field View and the Flight Planner as ordinary annotations. Corrections
made later are saved to the same row (upsert on scan and spot id).

Field View's popup on an applied spot says "Identified as X (confirmed by the operator)" with
the source, or "Not identified by the operator. A candidate, not a finding."

## Treatment (separate from identification)

There is no single correct product or amount for a weed species, labels change, and the
catalog carries no herbicide data by design, so nothing is prefilled. In the Flight Planner,
zones are grouped by what the operator said they are (`lib/treatment/groups.ts`: each
identified weed, unidentified weed spots, hand-drawn zones, Treatment Grid zones) and the
operator picks or enters a treatment per group: product name, EPA registration number, label
source, date checked, crop on the label, application method, restrictions, rate and units,
carrier volume if the label states one, and a statement that they read the current label for
this crop, place and method. Saved to `treatment_choices` (owner-scoped) and assigned per
group in `fields.settings.treatment_assignments`.

`lib/treatment/quantities.ts` computes product amount (litres or kilograms), spray volume,
tank loads and the assumptions, recomputed whenever zones, rate or tank change. It refuses,
per group and for the total, with "Quantity not calculated" and the reasons, when a product,
rate, unit, verified label, carrier volume or tank is missing, or when the label's crop
conflicts with the field's crop. A suggestion is never a spray setting: an unidentified spot
sits in its own group and needs an explicit choice.

The report prints stated identifications with source and status, counts the unidentified and
rejected, and lists the assigned treatment choices with their label provenance under the
sentence "SwathWise recommends no product or rate."

## Tests

`weedCatalogImport.test.ts` (real package: counts match the coverage report, no forbidden
claim, no review column, repeatable ids and hashes, refusals), `weedCatalogSuggest.test.ts`
(suggestions only from confirmed verdicts, narrowing is an ordering, legal and presence notes),
`weedIdentification.test.ts` (suggestion never becomes the label, confirmation equals the
suggestion, report summary excludes suggested and unidentified, Apply carries only stated
labels, popup text), `treatmentQuantities.test.ts` (scales with area and rate, refuses on
missing or conflicting inputs, exact unit conversions, tank loads, stable spot ids),
`treatmentGroups.test.ts`, `reportsTabWeeds.test.tsx`.

## Still needs

- A real click-through in a signed-in session: scan, keep and remove, save all, the spots on
  Field View and in the planner, a treatment entered and the quantities moving with a zone.
- Verified product-label data: every treatment is operator-entered; no label database exists.
- Expert review of the catalog's review queue (259 items) and an approved farm subset before
  anything leaves developer mode.
- Labelled aerial imagery before any species suggestion can rest on the detector itself.
- A real per-field location, to retire the Virginia assumption.
