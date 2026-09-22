# Repeatable state catalog method

Virginia is the first research build. For every later state, keep the same evidence rules and publish a separate coverage report.

1. **Collect names with source links.** Use a state Extension or land-grant weed identification list and record the source spelling and direct entry link. A broad index is a discovery list, not an agricultural weed list.
2. **Reconcile names.** Compare scientific names with the USDA state plants checklist, retaining every conflicting, ambiguous or missing match for expert review. A state checklist is not an agricultural relevance or county occurrence claim.
3. **Establish farm context.** Use current state or regional Extension crop and pasture publications. Link each supported weed to its exact crop table or page. Keep family and genus labels as groups until a specific species is supported.
4. **Keep legal status separate.** Capture the state's current regulated noxious weed list, effective date and tiers. Restrictions, watchlists and plants not yet present must never be converted into confirmed occurrences.
5. **Promote only reviewed entries.** An Extension weed scientist reviews taxonomic matches, aliases, field relevance and local evidence. Species level image detection requires a separate evaluated imagery set. Publish the reviewed farm subset with a version and a dated source ledger.
6. **Update and audit.** Recheck yearly guide editions and laws, record changes to names, source links and status, and keep unresolved items in a public review queue. Do not copy Virginia occurrence or crop labels into another state.

## Release meanings

| Label | Meaning | Safe use |
| --- | --- | --- |
| `source_index_only` | Named in a broad source index | Research/search and human triage |
| `crop_context_sourced` | Named in a crop or pasture guide table | Preliminary reference with cited context |
| `regulatory_only` | Named in state law; possibly absent locally | Compliance research with tier shown |
| `aerial_identification_validated=false` | No field-image accuracy study in this build | Do not claim automated species identification |

A production SwathWise catalog should add a distinct `expert_reviewed` state and separate county occurrence and visual-detection evidence. No records in v0.1 have those claims.
