# Crop profile benchmark: WeedsGalore held-out test patches (corn)

Run 2026-10-23, code c28f705+uncommitted. WeedsGalore (Celikkan et al. 2025, CC BY 4.0): one maize field near Potsdam, Germany, 70 cm rows, four dates (sown 9 May 2023; 25 May, 30 May, 6 June, 15 June). 26 test patches of 1.5 x 1.5 m (the authors' spatial split; nothing here was set on them). RGB composites of the P4 Multispectral R, G and B bands with one gain from train and val (scripts/cropProfiles/prep_weedsgalore.py): not a consumer RGB camera. Scores at 1 and 2 cm come from box-averaging 0.25 cm pixels and are upper bounds for native imagery at those sizes (Velumani 2021).

Rows for the position rule are taken from the maize labels (oracle rows): these numbers measure the rule and the band width given correct rows, not the row reader. The row band is the engine's: half-width max(15 cm, 0.15 x pitch).

| Pixel | Mask | Patches | Vegetation IoU | Maize inside the band | Weed outside the band | Off-band vegetation that is weed | Off-row cover MAE | Off-row cover bias |
|---|---|---|---|---|---|---|---|---|
| 0.25cm | neutral | 26 | 0.25 | 0.968 | 0.626 | 0.978 | 0.368 | 0.357 |
| 0.25cm | corn | 26 | 0.41 | 0.968 | 0.626 | 0.978 | 0.014 | -0.009 |
| 0.25cm | exgr0 (reference) | 26 | 0.412 | 0.968 | 0.626 | 0.978 | 0.013 | -0.008 |
| 1cm | neutral | 26 | 0.405 | 0.968 | 0.624 | 0.982 | 0.148 | 0.128 |
| 1cm | corn | 26 | 0.458 | 0.968 | 0.624 | 0.982 | 0.02 | -0.02 |
| 1cm | exgr0 (reference) | 26 | 0.459 | 0.968 | 0.624 | 0.982 | 0.019 | -0.019 |
| 2cm | neutral | 26 | 0.451 | 0.946 | 0.661 | 0.972 | 0.013 | -0.01 |
| 2cm | corn | 26 | 0.394 | 0.946 | 0.661 | 0.972 | 0.031 | -0.031 |
| 2cm | exgr0 (reference) | 26 | 0.395 | 0.946 | 0.661 | 0.972 | 0.031 | -0.03 |

Automatic rows (pattern pass with the corn prior) on the 1.5 m patches at 1 cm: found on 69% of patches. A patch holds about two rows, under what a pitch measurement needs; field photos are 4 m and more.

By date, 1 cm, corn mask:

| Date | Patches | Vegetation IoU | Off-row cover MAE | Maize inside the band | Weed outside the band |
|---|---|---|---|---|---|
| 2023-05-25 | 8 | 0.377 | 0.004 | 1 | 0.545 |
| 2023-05-30 | 8 | 0.318 | 0.014 | 0.995 | 0.706 |
| 2023-06-06 | 8 | 0.623 | 0.026 | 0.96 | 0.612 |
| 2023-06-15 | 2 | 0.687 | 0.071 | 0.804 | 0.702 |
