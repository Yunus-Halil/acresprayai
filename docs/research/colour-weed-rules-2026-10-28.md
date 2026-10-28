# Weeds by rules alone: how far the colour tier can go, measured (2026-10-28)

Yunus's question, after his first look at the fast tier on the apricot twin (strips along the rows, circles stacked
inside circles): can rules get the model's accuracy in the fast tier's time, without any AI model? This document
is the research, the measurements and what was built from them. Everything below is on the 71-photograph apricot
flight, with the 414 weeds and 104 crop crowns hand-labelled on DJI_0301 and projected to the ground
(`data/direct-georef/apricot/labels.geojson`), judged on DJI_0301 and on the four other photographs that hold at
least half of those labels (DJI_0296, 0300, 0302, 0309). The harness is `scripts/directGeoref/colourBench.ts`.

## What "an algorithm" can and cannot do here

RF-DETR is a neural network: 36 million numbers fitted to labelled sugar-beet photographs. The colour tier is
rules: every decision is written down. On a bare-soil orchard in sun the two look at the same thing, a green
blob on brown ground, and the rules have one advantage the model lacks: the twin already knows where every crown
and every row is, and the model does not.

The literature says what rules can be expected to do:

- **Index.** Meyer & Neto 2008 (ExGR, the index the twin uses) measured it at 0.88 against 0.53 for ExG with
  Otsu's split on soil with residue; the Elliptical Color Index (2020, 240 images across illumination) and the
  2014 illumination-invariant transform with shadow removal (Wageningen) are the shadow-robust refinements.
  A plain ExG with Otsu paints shadow as vegetation.
- **Threshold.** A fixed bar misses a small plant whose pixel is a blend of leaf and soil; a bar relative to the
  local soil finds it (the same idea as the "soil-adjusted" indices and the illumination-invariant work).
- **Context.** The unsupervised row-based methods (Bah 2018; RoWeeder 2024; Van Poucke 2025) separate inter-row
  from intra-row vegetation by the crop lines; Lottes 2017 uses the plant arrangement. The twin has the rows and
  the crowns reconciled already, which is more than any of them start with.
- **Separating touching plants.** The classical answer is the distance transform: the centre of each plant is the
  cell furthest from the patch's edge, and cells go to the nearest peak (watershed on the inverted distance
  transform; the Swedish leaf-level work notes the over-segmentation and merges by criteria, which here is the
  peak separation).

What rules cannot do: see a plant that is not greener than its surroundings (yellowing, dead, or under 4 cm at
this pixel size), or tell a weed from a green shoot at a crown's edge by shape. The model does the second a
little better; neither does the first.

## What was wrong with the fast tier Yunus saw

Three things, all in the code, none in the photographs:

1. **The cell pooling threw away half the weeds.** The green mask was pooled into 2-pixel cells (8 cm at the
   quarter decode) and a patch needed 3 cells. A weed under 20 cm rarely made it. Going to 1-pixel cells of 2 or
   more took DJI_0301 from 123 to 226 labelled weeds found, at the same cost.
2. **Nothing told the pass where the trees were.** Every green pixel of every crown became a patch; the long
   strips in the screenshots were crown edges and the green under the drip line running together.
3. **Fragments became separate candidates.** The same patch was cut differently in each photograph, and the
   reconciliation links sightings only when their rays meet within 10 cm plus a quarter of the size, one
   sighting per photograph: a patch seen whole in one view and as three pieces in the next became four objects
   stacked on one spot.

## The variants, measured

Sum over the five photographs. "Found" is a labelled weed with a candidate centre within 0.5 m on the ground, and
the candidate must not be a crown's: a candidate inside a reconciled crown's core (radius plus 10 cm) or within
0.5 m of a crop label counts as crown, whatever else is near it. (An earlier reading of the same runs let crown
pieces "find" the labels beside them and overstated every variant by a third; the numbers here are the corrected
ones.) "Near nothing" is a candidate with neither a weed nor a crop label nor a crown within 0.5 m: the labels
are not exhaustive, so some of these are real plants. Milliseconds are the rules alone, per photograph, in Node.
The model is RF-DETR Seg-Large's saved answers for the same photographs, its weed instances scored the same way.

| Variant | Labelled weeds found | Candidates | near a weed | crown | near nothing (under 50 cm², to 300, over) | ms |
|---|---|---|---|---|---|---|
| **RF-DETR Seg-Large, every tile** | **525 of 1376 (38 %)** | 2,100 | 481 (23 %) | 472 | 1,147 (19 / 553 / 575) | 8,400 on the GPU |
| v0, today: ExGR > 0, 4 cm pixels, 2-px cells of 3 | 331 (24 %) | 1,985 | 297 (15 %) | 937 | 751 | 26 |
| v2: 1-px cells of 2, threshold relative to the soil around the plant | 902 (66 %) | 8,483 | 1,323 (16 %) | 2,632 | 4,528 (1,709 / 2,153 / 666) | 62 |
| v7: v2 + patches over 0.3 m² split at their plants | 953 (69 %) | 22,169 | 1,624 (7 %) | 12,981 | 7,564 (1,733 / 3,019 / 2,812) | 127 |
| v11: v7 + a patch under 4 cells must stand 0.25 above its soil | 863 (63 %) | 19,415 | 1,304 (7 %) | 12,133 | 5,978 (147 / 3,019 / 2,812) | 107 |
| v14: v11, whole patches touching a crown (1.3 r + 0.3 m) dropped | 509 (37 %) | 2,254 | 623 (28 %) | 11 | 1,620 | 168 |
| v15: v11, crown discs of 1.3 r + 0.3 m cut out of the mask | 667 (48 %) | 3,192 | 863 (27 %) | 30 | 2,299 (83 / 1,504 / 712) | 48 |
| v16: discs of 1.6 r + 0.3 m | 435 (32 %) | 1,877 | 519 (28 %) | 11 | 1,347 | 44 |
| **v17: discs of 1.0 r + 0.3 m (shipped)** | **794 (58 %)** | 5,534 | 1,166 (21 %) | 157 | 4,211 (142 / 2,456 / 1,613) | 52 |
| v18: v17 + patches wholly within 1.3 r + 0.3 m dropped (the fringe) | 704 (51 %) | 4,116 | 999 (24 %) | 84 | 3,033 | 87 |
| v19: fringe 1.5 r | 584 (42 %) | 3,134 | 820 (26 %) | 51 | 2,263 | 85 |
| v20: fringe 1.8 r | 379 (28 %) | 1,779 | 479 (27 %) | 14 | 1,286 | 70 |

On DJI_0301 alone: the model 151 of 396; v0 94; v2 266; v7 281; v11 253; **v17 235**; v15 200.

Readings:

- **The rules find more of the labelled weeds than the model**: v17 finds 1.5 times as many (794 against 525 over
  the five views, 235 against 151 on DJI_0301), in 50 ms per photograph against 8.4 s on the GPU. The gain comes
  from the threshold relative to the soil (small and faint plants) and from the finer cells; it is not a
  threshold tuned to the labels (the margin 0.12, 0.15 and 0.2 all beat the model).
- **The rules also raise 2.6 times the model's candidates** (5,534 against 2,100 in the labelled ground), and their
  share near a label is the same as the model's (21 % against 23 %). The labels are not exhaustive, so neither
  figure is a precision; by the drawn check pictures (`colour-v17-DJI_0301.png`, `colour-model-DJI_0301.png`)
  the rules' extra candidates sit along the rows near the crowns and in the crowns' shadows, and on bare ground
  between the rows they are sparse and mostly at the labels.
- **The crowns.** The reconciled crown radius is the crown's core as the row reader measures it, about three
  quarters of the foliage. Dropping whole patches that touch a crown, or cutting a disc wider than the core,
  throws away labelled weeds as fast as unlabelled candidates: the weed strips under the drip line touch the
  crowns, and the labelled weeds are as often at a crown's edge as the unlabelled candidates. The cut at the
  core plus 0.3 m is the one that keeps the weeds and removes the crowns themselves; the fringe rule
  (`CROWN_FRINGE_SCALE`) is built and off.
- **Finer pixels (2 cm) gain nothing** over the soil-relative threshold at 4 cm and cost the decode. The quarter
  decode stays.
- **The split** cuts the 450 big patches to 42 and lifts recall (the pieces of a strip land on the labels); its
  crown pieces are what the crown cut removes.
- **The contrast rule for tiny patches** removes 92 % of the sub-50 cm² "near nothing" specks (soil noise and
  shadow edges in the check pictures) for a tenth of the finds.

## What was built

- `src/lib/directGeoref/green.ts`: `greenPatches` with the index choice (`exgr`, `exgr-soil`, `exg-otsu`), the
  soil level per 64-pixel tile (25th percentile, smoothed over the neighbours, interpolated), the small-patch
  contrast rule, and `splitAtPeaks` (chamfer distance transform, non-maximum suppression at the peak separation,
  multi-source growth). Deterministic; the same cell set in, the same pieces out.
- `src/lib/fieldTwin/build/weeds.ts`: the colour pass runs `greenPatches` with `COLOUR_GREEN` (v11) over a mask
  with every reconciled crown's disc (its core radius plus 0.3 m, `crownMask`) cut out first, so a strip running
  into a crown ends at the crown's edge, and reconciles by outline overlap.
- `src/lib/directGeoref/reconcile.ts`: `linkBy: "overlap"` (two sightings are one plant when one's centre lies
  inside the other's ground outline, or within the mean radius) and `absorb` (after grouping, an object whose
  centre lies inside a larger object's outline, at most half its area, joins it, from the same photograph or not).
  Sizes are then summed per photograph before the median, so the pieces of a plant add up instead of each
  counting as a plant. The model tier keeps the ray rule and is unchanged.
- Tests: `src/test/greenPatches.test.ts` (the faint plant against its soil, lit and in shadow; the speck against
  the small plant; the strip split into its plants with every cell kept; a patch seen whole in one photograph and
  as three pieces in another becoming one plant seen twice).

## Twin level

The whole flight through the Node build (`buildTwinApp.ts --weeds colour`), the twin's weeds against the labels
(`labelcheck.py`: a labelled weed is found when a verified candidate lies within 0.6 m of it; the labelled ground
is DJI_0301's frame plus 2 m) and drawn on DJI_0301 (`colourTwinDiag.ts`,
[twin-weeds-apricot-colour5-DJI_0301.jpg](colour-weed-rules/twin-weeds-apricot-colour5-DJI_0301.jpg): green
within 0.6 m of a weed label, orange at a crown's edge, red elsewhere; white rings the labels, blue the crowns' cores).

| Twin | Labelled weeds found by a verified candidate | Verified in the labelled ground | of which within 0.6 m of a label | Weed objects in the twin | twin.json | Build |
|---|---|---|---|---|---|---|
| Colour rules as Yunus saw them this afternoon | 149 of 414 (36 %) | 532 | 125 (23 %) | 6,809 (3,596 verified) | 7 MB | 2 min |
| RF-DETR Seg-Large, every tile | 230 (56 %) | 934 | 201 (22 %) | 7,487 (4,410 verified) | 9 MB | 2 min + 10 min GPU |
| New rules, first run (crown core + 0.1 m, centre only) | 351 (85 %) | 5,238 | 569 (11 %) | 97,995 (39,464) | 67 MB | 5.5 min |
| + crown disc cut at the core + 0.3 m | 322 (78 %) | 3,873 | 469 (12 %) | 81,474 (32,106) | 55 MB | 5.3 min |
| + sightings within 15 cm merged, one crop per verified weed | 330 (80 %) | 3,926 | 472 (12 %) | 73,810 (33,861) | 40 MB | 5.7 min |
| **+ the crown disc swept through the tree's height, single sightings dropped where three or more photographs looked (shipped)** | **312 (75 %)** | 2,867 | 405 (14 %) | 45,246 (28,626) | 26 MB | 3.8 min |

What the drawn twin shows and the numbers cannot:

- The first runs put verified "weeds" on the crowns themselves, though every photograph's own pass was clean of
  them: a crown 2.5 m tall seen from a camera 20 m to the side lands on the ground plane more than a metre from
  where it stands, outside the cut disc, and two neighbouring photographs displace it the same way, so the two
  sightings agree. Sweeping the disc from the ground to the crown's top (every half metre) covers that; the
  unlabelled candidates at crown edges in the labelled ground fell from 1,000 to 307.
- The rules find a third more of the labelled weeds than the model at twin level (312 against 230) and three times
  the model's verified candidates in the same ground. Which of those 2,462 unlabelled candidates are weeds is
  what the labels cannot say (they are not exhaustive) and the drawn twin can: on bare ground between the rows
  the red marks are sparse and sit where the eye sees a plant; along the rows they are dense, which is where the
  drip line's weeds are and where the crown shoots are.
- The twin is three times the model twin's size and the build 1.5 times as long, both from the number of
  candidates; the atlases are 96 files against 49.

## Speed

The rules themselves cost 30 to 50 ms per photograph in Node (the soil level 20 ms, the split and the contrast rule
the rest; the crown sweep a few more); the quarter decode they share is unchanged. What grew is downstream of the
rules: the overlap reconciliation over 175,000 patches (about 60 s in Node, the outlines projected once at 16
points each) and the evidence crops (one per verified weed, 28,000). In Node the weed stage went from 78 s to
92 s and the bundle from 75 s to 98 s. The browser build runs the same stages on the helper pool; expect the twin
in under a minute on this machine against 21 s before, and the atlases a minute after. Still no model, still CPU.

## Not done, and what it would take

- **A verge, a sward, a grassed orchard.** The soil level assumes the tile's 25th percentile is soil. Where the
  ground is mostly green the level is a leaf and nothing is a weed. The boundary engine's cover class knows where
  that ground is; the colour pass should take the soil level from the cells classed soil only. Not built.
- **Yellowing and dead plants.** No colour rule finds them; the cover index (`COVER_EXGR`) finds cover of any
  colour but cannot tell it from straw. Out of scope for a weed map in spring.
- **Shape.** A green shoot at a crown's edge and a weed next to it look alike to colour. A rule on elongation and
  distance to the crown would catch some. Measured later if the eye test asks for it.

## Sources

- Meyer, G. E. & Neto, J. C. (2008). Verification of color vegetation indices for automated crop imaging
  applications. Computers and Electronics in Agriculture 63(2).
- Shadow-resistant segmentation based on illumination-invariant image transformation (Wageningen, 2014):
  https://research.wur.nl/en/publications/shadow-resistant-segmentation-based-on-illumination-invariant-ima/
- Elliptical Color Index for vegetation segmentation under varying illumination (2020):
  https://link.springer.com/doi/10.1007/s11119-020-09735-1
- Ground shadow detection and removal for vegetation segmentation (2017):
  https://link.springer.com/article/10.1007/s11119-017-9511-z
- Bah, Hafiane & Canals (2018), weed detection from crop lines on UAV images: https://arxiv.org/pdf/1805.12395
- RoWeeder, unsupervised weed mapping through crop-row detection (2024): https://arxiv.org/pdf/2410.04983
- Lottes et al. (2017), crop and weed classification using the plant arrangement:
  https://www.ipb.uni-bonn.de/wp-content/papercite-data/pdf/lottes17icra.pdf
- Van Poucke et al. (EGU 2025), unsupervised intra- and inter-row vegetation from ExG masks and row detection:
  https://meetingorganizer.copernicus.org/EGU25/EGU25-15760.html
- Watershed on the inverted distance transform for touching plants (Jordbruksverket):
  https://fou.jordbruksverket.se/fou/dl/Fil-001173
- Classical weed-index comparisons on UAV RGB (alfalfa, 2020; pitaya with Otsu, 2020):
  https://pmc.ncbi.nlm.nih.gov/articles/PMC6960911 , https://m.researching.cn/articles/OJ5f35eade1b33f9f4
