# Visual inspection of `soil_only_v1` (2026-10-13)

What a person saw in the three contact sheets (36 candidates, 20 rejected or
ambiguous; train split only; chosen by the rule in `build_soil_subset.select_for_sheets`,
listed in `sheet_selection.json`). Sheets are under
`D:\swardus-research\weed-vision-lab-outputs\subset\soil_only_v1\sheets\`.

## Does semantic background mean bare soil?

Mostly, with three additions that matter for a detector:

1. **Soil varies by plot and date.** Four textures seen: pale tan crumbly soil with stones and tyre tread (05-15, plots P0030688, P0030852); pink-beige compacted soil (05-26, P0034018, P0034279); dark brown moist soil (06-05, P0037987, P0038055); and a mid-brown with white stones (05-26, P0034280). All are background.
2. **Cast shadows are background.** Crop rosettes throw hard shadows onto soil (05-15_00028 id 1241 sits half in one; 05-15_00134 id 1306 next to one). Shadowed soil is near-black and will trip any brightness-based rule.
3. **Dry plant residue and dead leaves are background.** 06-05_00040 id 1136 has brown dead leaves beside the weed. Residue is brown, not green, so colour indices should separate it; a texture-based method would not.

No lawn or grass sward appears anywhere in the candidates. Nothing in the A or B
cells contradicts "weed on exposed soil".

## Category A (isolated)

All 14 cells are a single weed on soil with nothing else within the 32 px ring.
Range seen: 100 px sliver of a single blade (05-15_00173 id 1241, the smallest A)
to 1,992 px rosettes (05-26_00219 id 1220). The "lowest solidity" A
(05-26_00060 id 1155, solidity 0.17) is a grass-like weed of long thin blades:
the reference mask follows each blade. Thin-structure preservation is a real
requirement, not a corner case.

Some reference outlines are loose at leaf tips (05-15_00151 id 1096). Boundary
F1 against these references has a floor set by the annotation, which Phase 4
must estimate before reading a boundary score as a failure.

## Category B (multiple distinguishable)

Weeds with another weed 8 to 32 px away and no crop within 64 px. The hardest B
(05-15_00050 id 1325, ring background 0.86) sits inside a loose mat of a dozen
weeds; the neighbours are separate instances in the reference, so a merge there
counts against the method. 06-05_00112 id 1264 has a grass-like weed 19 px away.

Only 293 observations (107 unique plants) are B. Weeds in PhenoBench either grow
alone or in contact; the 8 to 32 px gap is uncommon.

## Category C (crop-adjacent)

As intended: a weed with a crop leaf 8 to 64 px away and a clean soil gap between
(05-26_00215 id 1216, crop at 8 px). Three of the six C cells are the same plant
in three overlapping frames (05-26_00215, 00216, 00236, id 1216, area 1,102 in
all three). See "repeated observations" in `report.md`.

## Category D (dense or ambiguous)

- The two largest patches (26,752 px, 06-05_00182 and 00203, id 1164, again one plant in two frames) look like one large bushy weed touching a crop, not a mat of many. "large_patch" does not always mean many plants; it means the reference cannot say.
- Touching-crop cases are weeds under or between crop leaves (05-15_00041 id 987 inside a rosette; 06-05_00153 id 1480 under a leaf). Correctly out of the primary target.
- Fragmented: 05-15_00154 id 968 is two blobs 10 px apart labelled as one instance; a seedling whose stem was not annotated, or two plants. 06-05_00222 id 1346 is five pieces under crop leaves.

## Rejected

- Tiny (< 100 px): 26 and 64 px specks are barely visible; the 72 px (05-26_00176 id 1337) and 91 px (06-05_00223 id 1171) cells are real seedlings with two cotyledons each. **The 100 px floor removes some real, visible seedlings.** The sensitivity line shows 4,513 primary instances at a 50 px floor against 3,721 at 100 px. Kept at 100 for v1 so that boundary scores are meaningful, with the band reported separately; the detection benchmark should report recall on the tiny band regardless.
- Partial (class 4): cut by the image edge (05-15_00172 id 1089) or under a crop (06-05_00153 id 1416). As expected.
- Touches border: canopy cut by the frame edge; span unknown. As expected.

## Consequences recorded

- The ring-background criterion is redundant for A at these distances (sensitivity flat at 3,428): with no plant within 32 px the ring is background by construction. Kept in the config for clarity; it does no work.
- D is dominated by "touching" (1,969) and "near-touching under 8 px" (464). Weeds in this field grow in contact with crops far more than with each other (2,100 touch a crop, 279 weed-weed pairs).
- Nineteen plants change category between frames (a crop leaf moves in or out of range as the frame shifts). Per-plant metrics should take the category from the majority of its frames or evaluate per observation and say so.
