# SwathWise Virginia weed catalog: sourced research build

**As of September 22, 2026. Version 0.1.0.** This is a substantial Virginia source inventory, **not** a certified list of every agricultural weed in Virginia and **not** a species classifier. It is designed to let SwathWise curate and update a state at a time without silently treating a plant name as a proven field detection.

## Exactly what is included

- `catalog.json`: individual source-index records with a stable source record ID, common and scientific names as published, direct profile link, USDA Virginia checklist crosswalk where an exact binomial match exists, crop-guide support where explicitly checked, and noxious-weed regulation when matched. `source_index_only` is a research candidate, not a validated agricultural-weed entry.
- `catalog_overview.csv`: the same records in a simple table for sorting and review. Each crop context and automated habitat flag is separated with a semicolon. Consult `catalog.json` for source locators and evidence detail.
- `sources.json`: primary-source URLs and what each can support.
- `review_queue.json`: source names that did not match cleanly or need a species-level decision.
- `coverage.json`: automatically calculated counts and explicit release limitations.
- `schema/catalog.schema.json` and `validate_catalog.py`: structure and relationship checks. Run `python validate_catalog.py` from this directory.
- `STATE_METHOD.md`: evidence and review steps to repeat this work in the next state.
- `WHAT_CHANGED.md`: a plain-language summary of the Virginia build.

## Evidence boundaries

**Virginia Tech Weed ID index**: The source says its list contains weeds commonly submitted to the Virginia Weed Identification Clinic. It also includes cultivated plants, aquatic plants, fungi, and entries that may not be relevant to an agricultural field. A profile in this index is **not** proof of occurrence on a given farm.

**USDA Virginia state plants checklist**: A matching name is evidence that the binomial is in the state's plants checklist. It is **not** evidence that it is a weed, currently widespread, or found in a particular county. Scientific names and taxonomy can differ between the two sources. An unmatched name means "requires review," not "absent from Virginia." We use the exact first two scientific-name tokens for a *candidate* join. A single USDA symbol is assigned only where that check yielded one accepted symbol, or one common symbol for all matched synonym rows. USDA symbols on unreviewed rows are provisional crosswalks.

**2026 field-crop guide**: Tables 5.12 (corn), 5.47 (soybean), 5.65 (small grains) and 5.81 (pasture, hay and CRP) support explicitly named weed columns or rows conservatively mapped to a specific Weed ID entry. Aggregate or alternative columns such as "pigweed," "Palmer amaranth / waterhemp," "foxtail spp.," and "smartweed" stay in the review queue; they cannot become species IDs automatically. The guide covers Mid-Atlantic crop management, so a crop tag does not claim prevalence in every Virginia county. No herbicide product, rate, or performance rating has been extracted.

**Virginia noxious weed law**: Regulatory tiers are kept distinct from crop weed relevance. Tier 1 means *not known present in Virginia*; a Tier 1 listing must never be used as a positive state-occurrence flag. Noxious-weed rules may change, so recheck the statute at release.

**Habitat notes**: Where profile habitat terms could be read, the catalog adds automated *review cues* such as `agronomic_crops` or `pasture_forage`. They are not verified crop associations; the original profile must be read before promoting one to an operator-facing claim. Source descriptions and photographs are not copied into this package.

## How to ship this responsibly

1. Use `catalog_status=crop_context_sourced` only as a preliminary reference search result. Do not turn it into species-level aerial identification.
2. Resolve the `review_queue.json` name and taxonomic conflicts. Review all automated habitat cues and crop-context candidates against their linked primary pages. Add state-presence evidence where needed.
3. Attach verified imagery with use-specific permission and field observations in the earlier `weeddb` format. Keep image and data licenses separate.
4. Have a weed scientist or relevant Extension specialist review the intended agricultural entries and inclusion rules. Version the approved subset independently of this research inventory.
5. Continue with another state using the same source ledger, reconciliation, and review gates. Never copy Virginia's presence or crop context to another state.

## What is missing

The catalog does not claim complete coverage across Virginia crops, forests, turf, water bodies or counties; it does not supply current field observations, drone training imagery, emergence models, local abundance, resistance claims or treatment advice. Coverage counts describe the sources captured, **not recall against an unknowable universal weed list**.
