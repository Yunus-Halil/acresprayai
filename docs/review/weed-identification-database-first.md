# Species identification: database first (architecture review)

Status: proposal, 2026-10-01. Nothing here is implemented. weed-v1 (weed / crop / other)
stays as it is; this is the layer that would sit after it.

The principle, in the founder's words: do not make the model the knowledge base. Make
the weed database the knowledge base, and make the algorithms responsible for matching
new observations against it. A new species, or a new field example of an old one, is a
row, not a retrain.

## 0. The precondition nobody can design around

Species identification needs pixels that show a leaf. The live validation (same date,
`weed-detection-foundation.md`) found the only scans in the system at 4.3-14.8 cm/px.
A 10 cm seedling is one or two pixels there. No retrieval scheme, no embedding and no
descriptor identifies a species from two pixels. So the first row of the knowledge base
is a number per species and growth stage: **the coarsest GSD at which it was ever
identified correctly on a benchmark**, and the matcher refuses below it with `UNKNOWN
(resolution)`. That makes the GSD floor data, not a constant in code, and it means the
Weed Library can say "identifiable from the air at 1 cm/px or finer" per species and
mean it. The catalog's `aerial_identification_validated = false` constraint stays; the
validation lives in its own table (section 3) and never flips that column.

## 1. What exists today (reviewed)

| Piece | Where | What it already gives the species layer |
|---|---|---|
| State name catalog | `weed_catalog_entries`, `_sources`, `_review_queue`; `lib/weedCatalog` | 755 sourced Virginia names, crop-guide citations, legal tiers, USDA crosswalk, and the two-owner rule (source-owned vs review-owned columns, re-import parks changes on reviewed rows). This is the naming layer and should stay the naming layer. |
| Identification contract | `weed_observations.suggested_catalog_id / suggestion_basis` vs `identification_status / catalog_id / species / identification_source / identification_basis`, with check constraints | A suggestion is never the label; a confirmation must equal the suggestion; unidentified and rejected rows carry no id. The matcher plugs in as a new source of `suggested_catalog_id` and changes nothing downstream. |
| The archive | `weed_observations` + private `weed-chips` bucket | Chip, GSD, chip span, physical measurements (`features`: equivalent diameter, width, height, extent, chromaticity, ExG, brightness), row distance, crop, stage, season, place, weather, operator verdict, `verdict_source` (operator vs default), model prediction. This is where new prototypes come from. |
| Classical descriptor | `lib/weedScout/feedback.ts: featureVectorOf` | A 9-number GSD-normalised vector in physical units (log area m², extent, log aspect, r/g/b chromaticity, ExG, brightness, off-row fraction) with fixed comparison scales, already stored per row (`vector`). The seed of the descriptor channel. |
| Suggestion by retrieval | `lib/weedCatalog/suggest.ts: suggestionsFor` | Already retrieval, already honest: "you named things like this X before", at most three, basis spelled out, operator's own rows only. The species matcher is the same shape with a bigger library. |
| Ground-truth store | `offrow/learn/examples.py` (`Example`, `Manifest`, `split_for`, label basis), `datasets.py` diameter bins, `evaluate.py` scorecard by source and size | The prototype library's file format and the benchmark's split rule (by frame / scene / field, hashed) exist. `species` is already a field on `Example`. |
| The verifier | weed-v1 | Gate: species matching runs only on candidates the verifier calls weed, once the verifier is shown to work. |
| Weed Library page | `/app/weeds` | Search, filters, detail panel, review queue. Becomes the species page shell. |
| Stable spot ids | `lib/weedScout/spotId.ts` | A correction made next week attaches to the same spot. |
| Field region | `lib/weedCatalog/region.ts` (assumed Virginia), `fields.derived_location` | The regional filter's input, once the assumption is retired. |

What does not exist: any species-labelled aerial image in the repo or the database; any
embedding; the `vector` extension (no migration enables pgvector); a per-field state.

## 2. Two layers, kept apart

**Weed Knowledge Base**: what a species is expected to look like and where it occurs.
Curated, sourced, slow-changing, reviewer-owned. Text and numbers.

**Visual Prototype Library**: what it actually looked like from a drone, with the
conditions it was seen under. Grows with every confirmed observation. Pixels and vectors.

They meet on one key, `species_id`. A catalog entry (a state's name for a plant) points at
a species; a species has many catalog entries (one per state, synonyms), many trait
rows, many prototypes. The catalog stays per-state because its sources are per-state.

## 3. Schema

Conventions carried over from the catalog: every fact carries its basis and source;
source-owned and review-owned columns are separate; nothing is written by an import that
a person owns; owner-scoped RLS until a row is explicitly shared.

```sql
-- Knowledge base -----------------------------------------------------------
weed_species
  species_id        text PK            -- slug of the accepted scientific name
  scientific_name   text NOT NULL      -- accepted name (reviewer-resolved)
  common_names      text[]             -- all, first is preferred
  family            text               -- botanical family
  plant_type        text               -- broadleaf | grass | sedge | other
  life_cycle        text               -- annual | biennial | perennial
  growth_habit      text               -- erect | prostrate | climbing | bunch | rhizomatous ...
  usda_symbol       text
  review_status, review_notes, reviewed_by, reviewed_at   -- review-owned

weed_catalog_entries
  + species_id      text REFERENCES weed_species  -- review-owned: set by a person, never by import_weed_catalog()

weed_species_traits                    -- one row per (species, stage, trait): each fact has its own basis
  species_id, stage                    -- stage: seedling | juvenile | mature | flowering | any
  trait             text               -- leaf_shape, leaf_width_mm, leaf_length_mm, venation, colour,
                                       -- texture, tillering, branching, canopy_footprint_m, geometry,
                                       -- seedling_appearance, mature_appearance, distinguishing,
                                       -- emergence_period, min_identifiable_gsd_m, ...
  value             jsonb              -- {text} | {min, max, unit} | {tags[]}
  basis             text               -- source | expert | measured_from_prototypes | benchmark
  source_id         text REFERENCES weed_catalog_sources
  reviewed_by, reviewed_at
  UNIQUE (species_id, stage, trait, source_id)

weed_species_regions   (species_id, state, basis, source_id)        -- where it occurs, sourced
weed_species_crops     (species_id, crop, source_id, locator)       -- lifted from crop_evidence
weed_lookalikes        (species_a, species_b, stage, distinguishing_traits text[], source_id, basis)
                        CHECK (species_a < species_b)

-- Visual prototype library ---------------------------------------------------
weed_prototypes
  id                uuid PK
  label_kind        text NOT NULL      -- species | crop | ground   (negatives are prototypes too: UNKNOWN needs them)
  species_id        text REFERENCES weed_species        -- when label_kind = species
  label             text NOT NULL      -- species_id, or 'corn', 'soil', 'residue', 'shadow', ...
  stage             text               -- weed growth stage
  view              text NOT NULL      -- nadir | oblique | close_up | ground
  image_path        text NOT NULL      -- private bucket weed-prototypes/<owner>/<id>.png
  chip_span_m       numeric NOT NULL
  gsd_m             numeric NOT NULL   -- refuse a row without it (as examples.py does)
  altitude_m        numeric            -- null unless recorded; never derived
  camera_key        text
  captured_at       timestamptz
  crop, region_state, season           -- context for the filters
  lat, lng                             -- optional; rounded to ~1 km when shared
  conditions        text[]             -- lighting, soil, background, residue, wet, shadow ...
  diameter_m, width_m, height_m        -- measured on the ground or from the chip, with basis
  measurement_basis text
  verification      text NOT NULL      -- operator_confirmed | expert_verified | public_dataset | synthetic
  verification_source text             -- dataset name + licence, or reviewer
  verified_by, verified_at
  origin_observation_id uuid REFERENCES weed_observations   -- when promoted from a correction
  origin_example_id text               -- when imported from an offrow manifest
  owner_id          uuid               -- RLS: owner until shared
  shared            boolean NOT NULL DEFAULT false   -- consented into the common library
  group_key         text NOT NULL      -- field / frame / scene: the split unit, never a chip

weed_prototype_vectors                 -- vectors are a property of (prototype x method), so a new
  prototype_id, method, version        -- embedding model never rewrites the library
  embedding         vector(D)          -- pgvector; D fixed per method+version
  descriptor        jsonb              -- classical, GSD-normalised (featureVectorOf and successors)
  PRIMARY KEY (prototype_id, method, version)

weed_prototype_sets                    -- frozen, named collections
  set_id, name, purpose                -- reference | benchmark
  frozen_at, notes
weed_prototype_set_members (set_id, prototype_id)
  -- rule, enforced by the evaluator: a prototype's group_key may not appear in both a
  -- reference set and the benchmark set it is scored against.

-- Identification runs ----------------------------------------------------------
weed_identifications
  id, observation_id REFERENCES weed_observations
  matcher_version, embedding_method, embedding_version, reference_set_id
  context           jsonb              -- {state, crop, season, diameter_m, gsd_m} the filters used
  candidates        jsonb              -- [{species_id, similarity, support, prototype_ids[]}] ranked
  result            text NOT NULL      -- match | unknown
  unknown_reason    text               -- resolution | no_support | low_similarity | ambiguous
  top_species_id    text
  created_at
  -- The run writes weed_observations.suggested_catalog_id + suggestion_basis (the catalog
  -- entry for top_species_id in the field's state) and nothing else. Confirm / edit /
  -- reject stay exactly the operator's, under the existing constraints.

weed_species_validation                -- benchmark results, per species x stage x GSD bin x set
  species_id, stage, gsd_bin, benchmark_set_id, matcher_version
  n, top1, top3, unknown_rate, confused_with jsonb, evaluated_at
  -- This is the only place "identifiable from the air" is ever asserted, and it carries
  -- the benchmark it came from. weed_catalog_entries.aerial_identification_validated stays false.
```

Promotion (operator correction becomes a prototype) is a queue, not a trigger: a row in
`weed_observations` with `verdict_source = 'operator'`, `identification_status in
('confirmed','edited')`, a chip, and a GSD is **eligible**; a reviewer (or, later, a
rule with a confidence floor) inserts the prototype with `verification =
'operator_confirmed'`. Nothing enters the shared reference set without `shared = true`.

## 4. The matching flow, as functions

```
candidate (chip, gsd, diameter, crop, state, season, row distance)
  -> gate:        weed-v1 says weed, else stop
  -> precondition: gsd <= min_identifiable_gsd for any species in region, else UNKNOWN(resolution)
  -> normalise:   crop to objectSpanM(diameter), resample to a fixed physical scale (mm/px), not a fixed pixel count
  -> describe:    descriptor = featureVectorOf + shape/texture terms; embedding = method(version)(chip)
  -> retrieve:    k nearest in the reference set, within the context filters (state, crop or
                  'any', season window, diameter within the species' canopy range for that stage)
  -> rank:        per species, similarity = f(top-k agreement, mean distance, support count)
  -> decide:      match if top similarity >= t_sim AND margin to #2 >= t_margin AND support >= n_min
                  else UNKNOWN(low_similarity | ambiguous | no_support)
  -> suggest:     write the catalog entry for the top species as suggested_catalog_id, basis text
  -> operator confirms / edits / rejects  ->  eligible for promotion
```

Two channels on purpose: a learned embedding and a classical descriptor. The descriptor
is explainable ("30 cm across, prostrate, pale, off-row") and works at coarse GSD where
texture is gone; the embedding carries leaf shape and texture where the pixels exist.
Fuse late (rank-level), so either can be replaced without touching the other, and so
the PoC can report which channel the correct answers came from.

UNKNOWN is a first-class result with a reason, stored, and counted in the benchmark.
The closest species is never returned just because one exists.

## 5. Proof of concept (5 to 10 species)

Species from the Virginia corn/soybean guide list (the 16 names both tables share),
chosen to cover plant types and to include lookalike pairs on purpose:

| species | type | why |
|---|---|---|
| velvetleaf (*Abutilon theophrasti*) | broadleaf | large, distinctive, the easy case |
| common ragweed (*Ambrosia artemisiifolia*) | broadleaf | fine lobed leaf, texture-dependent |
| jimsonweed (*Datura stramonium*) | broadleaf | lookalike to velvetleaf at seedling stage |
| horseweed (*Erigeron canadensis*) | broadleaf | rosette then erect: strongest stage variation |
| barnyardgrass (*Echinochloa crus-galli*) | grass | the grass lookalike cluster |
| Johnsongrass (*Sorghum halepense*) | grass | lookalike to corn seedlings and to barnyardgrass |
| broadleaf signalgrass or Texas panicum (*Urochloa*) | grass | second grass lookalike |
| yellow nutsedge (*Cyperus esculentus*) | sedge | the one sedge; colour is the cue |

Negatives in the same library: corn, soybean, bare soil, residue, shadow, the stressed
crop patch. Without them UNKNOWN cannot be measured.

**Data.** No species-labelled aerial imagery exists in this repo today, and none should
be assumed. The PoC's first deliverable is a prototype set, from: (a) SwathWise flights
at 1 cm/px and 2 cm/px over staked, photographed plants (`offrow/FLIGHT.md`); (b)
DRONEWEED once downloaded, if its labels are per species (unknown until read); (c) any
licensed public set with per-species boxes, imported through the offrow `Example` format
with `species` set and licence recorded. Target: 30+ prototypes per species per stage
(seedling, juvenile) from at least three fields (groups), or the species is marked
`insufficient` and reported, not scored.

**What to build for the PoC, and only this:** the four knowledge-base tables seeded for
the eight species from sourced profiles (Virginia Tech weed ID profiles are already the
catalog's source), the prototype table and bucket, an offline matcher in `offrow` (Python,
where the evaluator already is) over a frozen reference set, and `evaluate.py` extended
with the metrics below. No UI. No in-app matching. The in-app path (section 4) is
designed so it can be added without changing the tables.

## 6. Measurement

All on a benchmark set frozen before any matching is tuned, split from the reference set
by `group_key` (field / frame / scene) with `split_for`, so no field is on both sides.

| metric | definition |
|---|---|
| top-1 | correct species is the single returned match (UNKNOWN counts as wrong when the species is in the library) |
| top-3 | correct species within the first three ranked candidates |
| unknown rejection | on chips whose true species is **not** in the reference set (hold out two of the eight entirely, rotate), and on the negatives: fraction returned as UNKNOWN. Report the false-match rate too: how often a held-out species is confidently called one that is present. |
| lookalike confusion | full confusion matrix; the named pairs (velvetleaf/jimsonweed, barnyardgrass/Johnsongrass/signalgrass, Johnsongrass/corn) reported as pair-wise error rates |
| by GSD | every metric per GSD bin: <=0.5, 0.5-1, 1-2, 2-4, >4 cm/px. Benchmark chips are degraded from the finest capture (as `train.py` does) so every bin is populated from the same plants; the bin where top-1 drops below the threshold becomes `min_identifiable_gsd_m` for that species and stage. |
| by growth stage | every metric per stage, with n |
| by channel | descriptor-only, embedding-only, fused: which channel the correct answers came from |
| calibration | similarity vs. observed correctness, binned; the `t_sim` threshold is chosen on validation groups, never on the benchmark |

Gate for anything to leave R&D: top-1 >= 0.80 and unknown rejection >= 0.80 at 1 cm/px on
the benchmark, with the confusion matrix published next to it. Below that the library is
still worth building (it is the data), and the matcher is reported as not ready.

## 7. What to reuse, what to add, what not to touch

Reuse unchanged: catalog tables and importer; the identification contract and its
constraints; `weed_observations` and the chips bucket as the correction source; `verdict_source`
as the ground-truth filter; `featureVectorOf`; `Example`/`Manifest`/`split_for`;
`evaluate.py`'s by-source, by-size reporting; the Weed Library page as the shell.

Add: `weed_species`, `weed_species_traits`, `weed_species_regions`, `weed_species_crops`,
`weed_lookalikes`, `weed_prototypes`, `weed_prototype_vectors` (needs `create extension
vector`), `weed_prototype_sets` + members, `weed_identifications`,
`weed_species_validation`; one review-owned `species_id` on `weed_catalog_entries`; a
private `weed-prototypes` bucket; the `offrow` matcher and evaluator extension.

Do not touch: weed-v1 and its contract; the verdict and identification columns; the
`aerial_identification_validated = false` constraint; the treatment layer.

## 8. Order of work, after this review is agreed

1. Fly to the spec and stake plants (the same step the detection foundation needs).
2. Seed the knowledge base for the eight species from sourced profiles, reviewed.
3. Build the prototype set from (1), import through `Example`, freeze reference and
   benchmark sets.
4. Offline matcher and the scorecard in section 6.
5. Read the scorecard. Only then decide whether the in-app path (section 4) is built.
