# WeedsGalore (placeholder)

Maize, 70 cm rows, four dates, UAV, with crop and weed labels. Data CC BY 4.0, code Apache-2.0
([GitHub](https://github.com/GFZ/weedsgalore); licence as found in
`docs/research/weed-measurement-and-prioritisation-2026-10-21.md`). Nothing is downloaded here yet.

**This fixture is for the row-crop reader, not for this grade.** The weed-pressure grade refuses row crops on rows
it read itself (`fieldRows.ts`, `ROW_CROP_GRADING_UNSUPPORTED`): the row reader needs rows at least 1 m apart made of
separate crop plants, and 70 cm maize has neither. Pointing `npm run eval:pressure` at this directory as it stands
fails on purpose: there is no `fixture.json`.

When the row-crop reader exists, this directory becomes its fixture: the four dates as four sub-fixtures (rows close
in over the season, so the dates test the reader against canopy closure), the dataset's crop labels as row truth,
and its weed labels turned into quadrats (`truth.csv`, format in `../../README.md`) for the grade once row crops are
let through.

Before downloading: confirm the licence on the dataset's own record, record the source and date here, and keep the
imagery out of git (on `D:\swardus-research\`, as the other research data is).
