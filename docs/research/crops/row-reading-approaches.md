# Reading rows in continuous-row crops: a survey and what to build first

Research of 2026-10-22. Our field row reader finds rows by chaining separate plants that stand at least a metre apart on
evenly spaced lines, which suits orchards and vineyards and fails on all four US row crops: corn in 30 in rows, soybean
in 15 or 30 in rows or drilled at 7.5 in, cotton in 38 to 40 in rows with skips, and wheat drilled at about 7.5 in. In
these crops the row is a continuous green stripe, not a chain of plants. This document surveys how published work finds
such rows from drone imagery and ends with a recommendation. It extends [row-crop-detection-methods.md](../row-crop-detection-methods.md),
which already covers the method families against our pipeline and concluded that classical methods are not beaten by
deep learning on clean early rows and that nothing recovers rows after canopy closure; this one adds the
continuous-row evidence and the numbers. Our own estimates are labelled.

## What each family needs, costs and survives

### Projection and profile methods

The idea: make a vegetation mask, rotate it (or sum along candidate directions), and the true row direction is the one
whose profile across the rows shows the sharpest periodic peaks; each peak is a row.

The strongest whole-field evidence is a US corn study that cut a 6.1 ha orthomosaic into 3000 x 2000 pixel sections,
thresholded excess green (2g minus r minus b) at a fixed 0.08, summed columns and took each local maximum as a row: 2,313
rows right, 12 false and 8 missed, F1 0.995, in 8 seconds ([Site-specific weed management in corn using UAS imagery, arXiv 2301.07519](https://arxiv.org/abs/2301.07519)).
Flown at 350 ft with a 42 MP camera and a 35 mm lens, about 1.4 cm a pixel by our arithmetic. It failed in two ways:
small plants under the 0.08 threshold lost their row, and a row that curved inside a 41 m section gave two peaks and two
lines; the authors suggest smaller sections.

Chen et al. 2021 refined this into a sweep plus fit: midpoints of vegetation edge pairs between 3 pixels and twice the
row spacing apart; the image rotated from 0 to 180 degrees in 0.1 degree steps, keeping the angle with the largest average
projection peak height; points assigned to a row within plus or minus 0.375 of the row spacing of each peak (better than
0.5 or 0.25 of spacing either side); each row fitted by least squares. Cotton at 76 cm rows and 2.8 cm a pixel scored
0.99 to 1.00 on their row-detection accuracy measure; wheat at 20 cm rows, 2.0 cm a pixel and jointing scored 0.66 to
0.82, getting worse where high nitrogen made neighbouring rows overlap. A Hough transform on the same points scored 0.93
to 0.98 and 0.31 to 0.53. The method assumes straight rows, an orthomosaic, and ignores weeds
([Chen et al. 2021, Remote Sensing 13:3526](https://doi.org/10.3390/rs13173526)).

Xue et al. 2024 tiled a 9 mm early-maize orthomosaic into 581 x 455 pixel tiles (about 5 x 4 m), used a known planter
spacing to count rows, and fitted each by least squares: mean angle error 0.57 degrees and about 2 cm lateral error on
regular rows, about 0.5 to 0.8 degrees where sowing passes crossed. Residual weeds pushed errors to 3.4 degrees and 13.6
pixels ([Xue et al. 2024, ISPRS IJGI 13:376](https://doi.org/10.3390/ijgi13110376)). Peña et al. grew rows as long
objects across an object-based segmentation of early maize at 2 cm and identified all 142 rows on training images,
with weeds touching rows distorting the row edges ([Peña et al. 2013, PLoS ONE](https://pmc.ncbi.nlm.nih.gov/articles/PMC3795646/)).

*Needs:* a vegetation mask and a spacing range. *Cost:* linear in pixels per angle tried, so cheap if the angle is found
once per tile (our estimate); runs on a CPU and in a browser when tiled. *Survives:* gaps and missing plants (a gap lowers
a peak, it does not remove it), wide rows, heavy but sparse weeds better than Hough. *Fails:* canopy overlap and closure,
curves within one window, dense weeds between rows, plants under the mask threshold, more than one direction per
window.

### Hough transform

Edge or skeleton pixels vote for lines in (angle, offset) space; peaks are rows. Bah et al. ran it on the skeleton of an
excess-green Otsu mask at 0.1 degree and 1 pixel resolution, normalised the accumulator so short rows at the border
count fully, rejected lines more than 20 degrees from the dominant direction, and subtracted each found row's votes to
avoid duplicates; earlier beet and corn work reported detection "close to 100%" at very fine pixels
([Bah et al. 2018, Remote Sensing](https://mdpi-res.com/d_attachment/remotesensing/remotesensing-10-01690/article_deploy/remotesensing-10-01690.pdf)).
Corn at 0.6 cm reached 95 to 100% precision (Su et al. 2018, cited by Chen 2021). Hough found cotton rows for emergence
counting at 0.97 m spacing ([Feng et al. 2020](https://doi.org/10.3390/rs12111764)). But head to head on the same data it
lost to profile fitting twice (Chen 2021, above; Xue 2024 found Hough lines biased to one side of expert lines), and
wheat seedling methods built on Hough scored 21 to 76% against 84 to 98% for a newer method
([Chen, Ma and Yang 2022, European Journal of Agronomy](https://www.sciencedirect.com/science/article/abs/pii/S1161030122001885), abstract).
A full accumulator at 0.1 degrees on a 7360 x 4912 image is about 32 million cells (our arithmetic), which is why
practitioners vote with skeletons or sample points. A pattern-Hough variant estimates angle, offset and spacing jointly
as a family of parallel lines (Winterhalter et al. 2018, ground robot).

*Needs:* edges or a skeleton, an angle window. *Cost:* high unless the votes are thinned. *Fails:* non-parallel false
lines, bias under weeds, closure. Its one advantage is tolerance of short rows when normalised.

### Frequency domain

A 2D Fourier transform of a field patch puts row spacing and direction in the strongest low-frequency peak, and the
phase gives the row position. Tenhunen et al. used block FFTs on cereal imagery from a drone at about 10 m to get row
direction and spacing, then grouped plants into rows: 94% accuracy, 0.11 s per 1452 x 969 image ([Tenhunen et al. 2019,
Computers and Electronics in Agriculture](https://research.utu.fi/converis/portal/detail/Publication/41308105), abstract).
Gai et al. 2025 refined spacing and direction by frequency interpolation and a Hanning window and took position from the
phase, on a ground camera ([Gai et al. 2025](https://doi.org/10.1016/j.compag.2024.109666)). Our own pitch estimate is
already an autocorrelation peak, which is the same information. No Gabor or wavelet row-detection study on drone row
crops with numbers was found.

*Needs:* nothing but pixels; gives spacing without a prior. *Cost:* one FFT per tile, cheap. *Survives:* gaps, noise,
moderate weeds (they add broadband energy, not a periodic peak). *Fails:* curved rows within a block, several plantings
in one block, and closure (the periodic peak fades; how fast it fades with cover has not been measured).

### Learned segmentation

A network trained on labelled rows finds them as segments or lines. Osco et al. trained a joint plant-and-row network on
corn at 1.55 cm with rows drawn as lines and plants as points: row precision 0.91, recall 0.94, F 0.96 at V3 and 0.89 to
0.90 on mature corn; it followed curved rows and rows with large gaps ([Osco et al. 2021, ISPRS Journal, arXiv 2012.15827](https://arxiv.org/abs/2012.15827)).
CRowNet reached 93.6% of rows at 70% overlap and transferred to other crops ([Bah et al. 2020, IEEE Access](https://doi.org/10.1109/ACCESS.2019.2960873)).
A row-level Mask R-CNN counted early maize emergence at 1 to 2.5 cm with up to 95.8% accuracy ([Pang et al. 2020,
Computers and Electronics in Agriculture](https://ui.adsabs.harvard.edu/abs/2020CEAgr.17805766P/abstract)). Against
that: the public row dataset CRDLD is from a ground robot, not a drone, and its U-Net lost accuracy in direct sun, dense
weeds, tramlines and row breaks ([arXiv 2109.08247](https://arxiv.org/abs/2109.08247)); Agriculture-Vision covers corn
and soybean at 10 to 20 cm a pixel with no row lines ([arXiv 2001.01306](https://arxiv.org/abs/2001.01306)); and no
public drone orthomosaic with row-line truth for corn, soybean, cotton or wheat was found here or in the earlier survey.

*Needs:* labelled rows from our own imagery, a GPU to train. *Cost:* inference about half a second per patch on a desktop
GPU (Osco). *Survives:* curves and gaps best of all families. *Fails:* transfer to unseen conditions, and nobody has
labels for our crops at our resolution.

### Height and planting priors

A DSM can mark rows by height, and UAV lidar finds rows from point density and elevation across stages and canopy cover
([Lin and Habib 2021, Remote Sensing of Environment](https://www.osti.gov/biblio/1848205), abstract). No photogrammetric
DSM study recovering corn, soybean or cotton rows after canopy closure with numbers was found. Planting priors (planter
GPS, as-planted maps) fused with drone row detection: none found; the one corn spacing study that had seeder sensors used
them to explain errors, not to place rows ([Kostić et al. 2024, Applied Sciences](https://doi.org/10.3390/app142210693)).

## Against the conditions that matter

| Condition | Profile / sweep | Hough | FFT | Learned |
|---|---|---|---|---|
| Canopy closure | fails (wheat degraded at overlap) | fails | peak fades, unmeasured | Osco 0.89 on mature corn, but rows a person could still draw |
| Heavy weeds between rows | degrades (3.4 deg, 13.6 px in Xue) | biased | moderate | CRDLD degraded |
| Curved or contour rows | needs small windows | needs small windows | needs small blocks | handles them |
| Gaps, missing plants | robust | robust | robust | robust |
| Drilled 19 cm rows | wheat at 2 cm: 0.66 to 0.82 | wheat 0.31 to 0.53 | cereals 94% at about 10 m | no drone evidence |
| Skip rows, point rows, headlands | no published evidence | normalised accumulator helps short rows | no evidence | no evidence |
| Runs headless on a CPU | yes | yes if thinned | yes | needs a trained model |

## What to build first

**A tiled profile reader with an FFT start, the family our photo pass already uses.** It has the most direct evidence on
whole-field drone orthos of the crops we need (corn F1 0.995 over 6.1 ha; cotton 0.99 to 1.00; wheat 0.66 to 0.82 at
2 cm), it beat Hough head to head twice, it needs no training data, and its pieces exist in our code for photographs: the
angle sweep over projection profiles and the autocorrelation pitch in `src/lib/weedScout/rows.ts`. The parameters the
literature supports:

- **Vegetation mask:** excess green on chromaticity with a fixed threshold (0.08 in the corn study) or excess green minus
  excess red at zero, which we already use; Otsu only where vegetation and soil are balanced.
- **Tiles:** about 5 to 20 m on a side (Xue used about 5 x 4 m; 41 m sections broke on gently curved rows). Our estimate:
  start at 10 to 15 m, which holds 13 to 20 corn rows or 50 to 80 wheat rows and keeps a contour row near straight.
- **Direction:** an FFT or coarse sweep per tile, then 0.1 degree steps within plus or minus 5 degrees of it (Chen), with
  neighbouring tiles required to agree within a few degrees, so a field with two plantings splits into blocks.
- **Spacing:** search 15 to 110 cm, taken from the FFT peak and snapped to the crop's known spacings (19, 38, 51, 56, 76,
  97, 102 cm); peaks suppressed within 0.75 of a spacing of a stronger one (Chen).
- **Rows:** assign mask points within plus or minus 0.375 of the spacing of each peak, fit each row by least squares, and
  join row segments across tiles by position and angle.
- **Validity:** report "no rows" when the periodic peak is weak against the background (our photo pass already has a
  phase-coherence gate), when cover is above about 90%, or when tiles disagree on direction. Never guess rows that are not
  there; a field with no readable rows is graded as not assessed.

**What it will not do, and should say so.** It will not read rows after the canopy closes, in any crop. It will not read
drilled wheat or soybean reliably at 5 cm a pixel (a 19 cm row is under 4 pixels), and only before closure at 1 to 3 cm.
It has no published evidence for skip rows, point rows or headlands; those need their own handling and test fields. Dense
weeds between rows will pull fitted lines towards them. And because the alley width is all our grade divides by, a wrong
spacing is a wrong grade, so the spacing it reads should be shown to the operator and confirmable, not trusted silently.

**Later, if needed.** A learned row segmenter is the only family that handles curves and gaps together, but it needs our
own labelled rows; it is the second step once the profile reader has produced enough fields to label from, not the first.
