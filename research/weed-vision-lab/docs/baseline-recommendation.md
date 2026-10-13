# Recommended first classical detection baseline

Written after the Phase 2 profile and inspection, before any detector was run.
Nothing below is a result.

## What the data says the detector must cope with

| Observed | Source |
|---|---|
| Median weed 358 px (about 19 x 19), p25 145 px, p05 46 px; median max span 39 px | `report.md` quantiles |
| 16.6% of instances under 100 px; 61% between 100 and 1,000 px | size bands |
| Grass-like weeds with solidity down to 0.17 and OBB width under 5 px | A hardest cells |
| Four soil colours from pale tan to dark brown; hard cast shadows; brown residue; white stones | inspection |
| Crops are the dominant green object in every image (every image has a crop; crop pixels outnumber weed pixels) | profile |
| Weeds touch crops in 2,100 observations; weed-weed gaps of 8 to 32 px in 293 | categories |
| 1,448 reference instances are already fragmented | profile |

## Recommendation

**Vegetation first, by chromaticity, with no per-image tuning and no opening.**

1. Index: ExG minus ExR on chromaticity coordinates (r, g, b normalised by their sum), ExG = 2g - r - b, ExR = 1.4r - g, decision ExG - ExR > 0. Chromaticity removes the brightness swing between sunlit and shadowed soil; the ExR term pushes brown residue and reddish soil below zero. The zero threshold is parameter-free, which keeps the baseline honest across plots. Comparators in the same run: ExG with Otsu, and an HSV hue band (H in a fixed green range with a saturation floor), so the choice is measured rather than assumed.
2. Candidate extraction: 8-connected components of the vegetation mask. No morphological opening at all: opening by even one pixel would delete the 5 px wide blades and the under-100 px seedlings that the profile shows are common. At most a 3 x 3 closing, evaluated as a switch, to rejoin blades split by JPEG-like noise; its effect on merges in B must be reported.
3. Minimum component size: none in the detector. Components are scored by size band; a floor is a scoring decision, not a detection one.
4. Weed versus crop: the classical detector cannot tell them apart on 05-15 (same size, same colour). Score raw and crop-aware (reference crop masks as "don't care" at scoring time). Crop-aware scores say what a later crop-removal step would buy; raw scores are the honest autonomous number.
5. Instance separation: start with none. Measure the merge rate on B and C. If merges dominate, the next step is a distance-transform watershed seeded at distance peaks, applied only to components whose solidity is low and whose distance map has more than one peak, so isolated rosettes are not cut.
6. Matching rule for scoring: a detection matches a reference instance by mask IoU at 0.5, 0.3 and 0.1, one to one, greedy by IoU, the same rule for every method. Unmatched references are misses in their band; unmatched detections are false positives, with the share that lie on crop pixels reported separately.

## Why not something heavier first

The question Phase 3 has to answer is where a parameter-free colour rule fails
on soil: under shadows, on residue, on tiny seedlings, or on thin blades. Those
failure classes decide what a learned model would have to add. A pretrained
model run first would hide that answer.

## Runtime to record

Per image at native resolution on the Ryzen 5 9600X: index computation,
thresholding, labelling, per-component measurement, separately, cold and
steady-state. Expected well under 100 ms per image for the index and labelling;
the number will be measured, not assumed.
