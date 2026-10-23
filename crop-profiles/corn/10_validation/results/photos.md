# Crop profile benchmark: early-corn photos (corn)

Run 2026-10-23, code 6d64eee. Three photos, no EXIF and no labels: the pixel size comes from the measured pitch and an assumed 30 in (76.2 cm) row spacing. The on-green ratio is the share of green (ExGR above zero, an index the pattern pass does not use) within an eighth of a pitch of the row lines, over the same share in the middle of the alleys: above 1 the lines sit on the green, under 1 they sit between the rows. Photo 0359 was used to diagnose the residue failure, so these are development results.

| Image | Resolution | Mode | Rows found | Pitch (cm) | On-green ratio | Brightness windows | Re-placed on green | ExGR-gated share | Otsu split | Row coherence |
|---|---|---|---|---|---|---|---|---|---|---|
| 0359_jpg.rf.d7 | photo | neutral | true | 74.968 | 0.387 | 6 | 0 | 0 | -0.164 | - |
| 0359_jpg.rf.d7 | photo | corn | true | 76.44 | 12.135 | 0 | 0 | 0.687 | -0.164 | 0.579 |
| 0359_jpg.rf.d7 | 2cm | neutral | true | 74.773 | 0.335 | 6 | 0 | 0 | 0.031 | 0.265 |
| 0359_jpg.rf.d7 | 2cm | corn | true | 76.439 | 15.045 | 0 | 0 | 0.195 | 0.031 | 0.626 |
| 0359_jpg.rf.d7 | 4cm | neutral | true | 76.474 | 16.144 | 0 | 0 | 0 | 0.023 | 0.299 |
| 0359_jpg.rf.d7 | 4cm | corn | true | 76.457 | 17.796 | 0 | 0 | 0.144 | 0.023 | 0.642 |
| ba2a945c-2f8f- | photo | neutral | true | 76.799 | 134.774 | 0 | 0 | 0 | 0.344 | 0.829 |
| ba2a945c-2f8f- | photo | corn | true | 76.799 | 134.774 | 0 | 0 | 0 | 0.344 | 0.842 |
| ba2a945c-2f8f- | 2cm | neutral | true | 76.659 | 207.65 | 0 | 0 | 0 | 0.305 | 0.841 |
| ba2a945c-2f8f- | 2cm | corn | true | 76.659 | 207.65 | 0 | 0 | 0 | 0.305 | 0.841 |
| ba2a945c-2f8f- | 4cm | neutral | true | 76.48 | 344.527 | 0 | 0 | 0 | 0.273 | 0.858 |
| ba2a945c-2f8f- | 4cm | corn | true | 76.48 | 344.527 | 0 | 0 | 0 | 0.273 | 0.858 |
| pic1.jpg | photo | neutral | false | - | - | 0 | 0 | 0 | 0.266 | - |
| pic1.jpg | photo | corn | true | 76.737 | 91.391 | 0 | 0 | 0 | 0.266 | 0.79 |
| pic1.jpg | 2cm | neutral | false | - | - | 0 | 0 | 0 | 0.195 | - |
| pic1.jpg | 2cm | corn | true | 76.415 | 127.009 | 0 | 0 | 0 | 0.195 | 0.816 |
| pic1.jpg | 4cm | neutral | false | - | - | 0 | 0 | 0 | 0.148 | - |
| pic1.jpg | 4cm | corn | true | 76.22 | 286.771 | 0 | 0 | 0.007 | 0.148 | 0.828 |
