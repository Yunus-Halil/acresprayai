# Corn: the continuous-row reader (2026-10-29)

**What changed.** Photographs of corn (and of any crop whose profile says `rowReader.strategy: continuous-row`) are no
longer read by the planting-pattern pass. They go through `src/lib/rowCrop/readRowCrop.ts`, which treats the whole
row as the crop and reports only what stands between the rows.

**Why.** The pattern pass models plants on a lattice: trees and vines at a spacing along rows, where a green blob at no
lattice position is the finding. From about V4 a corn row is one ragged line of leaves, all crop, reaching a third of
the way into the alley. Read as a lattice it became hundreds of "off-row" circles on the corn; read by brightness
the lines landed on the straw stripe between the rows; and a straight line per block drifted off the rows at the frame
edges, where the lens bends them. Yunus's screenshots of 2026-10-29 showed all three.

## How it reads a photograph

1. **Work raster** at about 1 cm a pixel (the photo box-averaged by an integer factor).
2. **Green** by ExGR relative to the soil around each pixel (`directGeoref/green.ts`, `exgr-soil`), with a new cap:
   a tile's soil level may not rise more than 0.05 above the photo's own soil level, so a tile that is all lawn does
   not call its green "soil". The orchard tier, which does not set the cap, is unchanged.
3. **Solid green** (a lawn, a verge, a hedge, a closed canopy: more than 45 % green over a 1.5 m neighbourhood) is left
   out of the rows and reported as not judged.
4. **Row direction**: the projection axis whose detrended profile is most periodic (strongest autocorrelation between
   the shortest planted spacing and 2 m, weighted by the profile's spread).
5. **Pitch**: the autocorrelation's peaks; with a known pixel size the strongest peak near a planted spacing wins,
   otherwise the shortest of the peaks that are nearly as strong as the strongest (the fundamental under harmonics).
   Without a pixel size (no EXIF) the pitch in pixels gives the scale from the profile's default spacing, and the read
   says so: every metre in it then rests on that assumption.
6. **Strips** half a metre long along the rows: the green peaks across each strip, a peak standing at least three
   times over its alleys, settled on the strip's lattice or chained to a neighbour a pitch away (the lattice drifts
   at the frame edges), thinned to one per slot, and chained strip to strip into rows. Rows are trimmed to their
   supported span, bridged inside it, dropped under three strips or 30 % support; two traces of one row are joined.
7. **Crop band per row** from the row's own green: the density of green by distance from the centreline falls from
   the row's peak to the alley's floor; the band ends at the outermost offset still a tenth of the way up, so it
   reaches the leaves' tails (Yunus, 2026-10-29: the band must take in every leaf ending). The profile's
   `bandHalfWidthM` is the floor; a twin row's second line keeps the density up and stays inside. On the V5 to V7
   photographs the band is 20 to 21 cm either side of the row.
8. **Components** of the green: a patch that touches a band is the crop; so is a leaf tip cut off from its row by
   shadow or a pale midrib (at most 80 cm², within six tenths of a band beyond the band, elongated and pointing at
   the row); a patch clear of every band is a weed candidate with its outline, area and distance from the row; a
   patch beyond the outermost rows or a pitch from any row is not judged; a patch wider across than one and a half
   pitches is a border or cover.
9. **Along each row**: the green share inside the band, gaps longer than twice the seed spacing (at least 30 cm), and,
   at 1.5 cm a pixel and finer, a stand estimate from the green peaks along the row, marked unverified.

Everything is deterministic and runs in about half a second on a 21 MP photograph on a CPU.

## Where it shows

- **Photo Scout** (`src/pages/app/PhotoScout.tsx`): with the crop set to corn the read draws rows (cyan), each
  row's band (faint blue), weeds between rows (red outlines), gaps (orange), plants (green dots, under the
  "unplaced" toggle) and the not-judged patches (grey, under "windows"); the summary says what was measured, what was
  assumed and what is an estimate.
- **The bench** `npm run bench:row-crop -- --photos <folder> [--gsd-cm 0.5] [--tag name]` writes the same pictures
  into `<folder>/outputs/row-crop/<tag>/` with a table beside them.

## What was measured

| Set | Result |
|---|---|
| `directtestimagery`, 15 top-down photographs of one V5 to V7 field, 5280 × 3956, no EXIF | Every visible row traced on the crop in all 15, including the rows at the frame edges where straight lines failed; 1 to 11 patches between rows per photograph once the band reaches the leaf tails; the lawn and verge left out; about 0.6 s each. The scale is assumed from the pitch and 76.2 cm. |
| `CropTesting/Corn/earlystage`, three residue and close-up photographs | Rows on the corn in all three (the no-till photograph had put the lattice pass's lines on the straw); the weeds between the rows outlined. |
| Rendered development stands (24, `scripts/cropProfiles/scenes.ts`) | Rows found on 24, on the crop (within a quarter pitch) on 23; the pitch within 10 % on all; between-row weeds found in more than half the cases at 1 cm and finer; the crop never reported except on the V2 stand under weeds larger than its plants. |

The regression tests are `src/test/rowCrop.test.ts`. No photograph with hand-drawn row or weed truth exists yet, so
real-field precision and recall are not numbers; the pictures are the evidence.

## Known limits

- A row's end can run a metre or two into a mown verge beside the field.
- A weed touching the crop's leaves, or standing within the leaves' reach of the row, is the crop; weeds inside the
  row are never separable by position. The band reaching the leaf tails was Yunus's call: a leaf tip called a weed
  is worse than a weed under the leaves called corn.
- Twin rows share one band, so a weed between the pair is hidden.
- A V2 stand (6 cm plants) under weeds larger than its plants can have weed peaks pass for rows.
- The stand estimate has never been checked against counted plants.
- The field map (the orthomosaic) still goes through the pattern pass (`weedVision/patternRows.ts`); the reader
  works at any pixel size and is the obvious next step there, and for the Field Twin's corn rows.

## Stage variants (2026-10-29, afternoon)

Yunus: one algorithm cannot serve V3 corn and V10 corn; isolate the early-stage reader and add a mid-stage variant,
and later detect the stage automatically. `RowCropParams.stage` picks the variant; the establishment path is
unchanged and pinned by the tests.

**Mid stage** (`stage: "mid"`, Photo Scout stage selector, bench `--stage mid`): no density gate before the direction
and pitch (a dense stand is over the early variant's 45 % share, which was why the mid photographs read nothing);
rows are placed midway between consecutive alley troughs, the sharp feature when the canopy nearly meets; readable
ground is wherever 3 m windows are periodic at the pitch, whatever their green share, and the rest (verge, lawn,
closed canopy) is not judged; a read is refused when under 15 % of the green ground is periodic; between the rows a
patch under 20 cm² is a leaf flake and a leaf tip may be 150 cm². On the 40 mid-phase photographs (`directtestimagery/
midphase`, V8 to V10, no EXIF) the direction and pitch now agree on 36 (the other four show no rows: a road, a
verge); rows are traced through the dense stand with bands of 32 to 34 cm; between-row patches 15 to 336 a
photograph, cover 0.1 to 4.4 %. Not verified against truth: the eye test is Yunus's.

**What the rules cannot do at mid stage.** A weed under or among the corn leaves is the crop by position. USU-Corn-WeedDB
(Utah forage corn at 10 m, 0.48 cm a pixel, 10,539 weed boxes over 800 tiles, CC BY 4.0; stitched back into 64
sources by `scripts/rowCrop/usu_mosaic.py`, scored by `npm run bench:row-crop:usu`) makes that measurable: most of
its pigweed and lambsquarters stand inside the rows. Recall of its boxes: establishment variant 9 % (foxtail 17 %,
lambsquarters 9 %, pigweed 6 %), mid variant 3 %; of the reader's own patches 29 % and 47 % sit inside a box. That is
the honest ceiling of position rules on a weedy mid-season field, and the reason a segmentation step is wanted.

## The WeedsGalore model, tested (2026-10-29)

Yunus asked for the GFZ model (github.com/GFZ/weedsgalore) as the segmentation step. Run as published
(`scripts/rowCrop/weedsgalore_infer.py`, DeepLabv3+ ResNet-50, RGB six-class checkpoint `dlv3p_rgb_6.pth`, CPU):

| Input | Result |
|---|---|
| Its own test scenes (16-bit P4M bands / 65535, 0.25 cm) | Works: maize IoU 0.63 and 0.75, amaranth 0.80, pixel accuracy 0.87 and 0.97 on two scenes. The weights load with no missing keys. |
| Our mid-stage photographs, sRGB / 255, upsampled 2x to 0.25 cm | Calls corn leaves amaranth wholesale: 13 to 18 % of every crop pixel field "amaranth", in stripes along the rows (pictures in `directtestimagery/midphase/outputs/weedsgalore-model/`). |
| Same, linearised (gamma 2.2) and per-band means matched to the training data | Calls nearly everything maize, including the real weeds on the alley floor; weed classes 3 to 4 %. |
| Establishment and residue photographs | Same pattern: the corn is split between maize and amaranth, the between-row weeds the rules find are missed. |

So the checkpoint does not transfer from one German field's multispectral camera at 0.25 cm to a consumer RGB camera
at 0.5 cm, in either colour treatment. It is not usable as a weed finder here as published. What would make a
segmentation step work: the same architecture (Apache-2.0 code) trained or fine-tuned on RGB drone imagery at our
scale with weed labels, for which USU-Corn-WeedDB (boxes, 0.48 cm, CC BY) is the closest public material; the WeedsGalore
masks could join it after resampling to 0.5 cm. The checkpoints' own licence is still unstated and would need the
authors' word before anything ships. 27 s a 3200 x 2400 crop on this CPU.

## Pointed at by Yunus the same day

WeedsGalore (GFZ, github.com/GFZ/weedsgalore): code Apache-2.0, data CC BY 4.0, DeepLabv3+ checkpoints offered for
RGB and multispectral input (uni-weed and multi-weed, deterministic and probabilistic; 887 MB, now at
`C:\swardus-research\models\weedsgalore\ckpts.zip`), trained on one German maize field at 0.25 cm a pixel from a
Phantom 4 Multispectral. No licence is stated for the checkpoints themselves. Not run yet: it would be a second
opinion on the green inside the band (weeds in the row), which the rules cannot give; whether it transfers to 0.5 cm
consumer RGB is unproven.

## Our own corn segmenter (2026-10-29, evening)

Yunus: "do whatever you deem fit" after no published model transferred. Built on an Apache-2.0 base with licensed
data only, everything at 0.5 cm a pixel:

- **Data.** USU-Corn-WeedDB tiles with green-inside-box weed labels (every fifth source held out), WeedsGalore masks
  resampled to 0.5 cm (its test split held out), and weak labels from the mid-stage reader on 34 of the 40 mid
  photographs (`scripts/rowCrop/weakLabels.ts`: bands corn, alley patches weed, unjudged green ignored). Photos 9, 11,
  22 and 88 are held out and are the ones drawn.
- **Model.** Frozen DINOv2-small patch features (14 px patches) and a small convolutional head, trained on the CPU in
  minutes (`scripts/rowCrop/seg_train.py`). Checkpoints on D: (`checkpoints/corn-seg-dinov2-public`, `-mixed`).
- **Measured on held-out tiles (IoU).**

| Model | USU crop | USU weed | WeedsGalore weed | Mid photos crop | Mid photos weed (vs the reader) |
|---|---|---|---|---|---|
| Public data only | 0.59 | 0.35 | 0.44 | not trained | not trained |
| Public + weak mid labels | 0.63 | 0.37 | 0.44 | 0.67 | 0.02 |

- **What the pictures show.** Public-only at 2x finds alley seedlings but also paints corn whorls red (a habit from
  USU, whose pigweed stands in the row). The mixed model draws the best corn mask of anything tried, every row cleanly,
  but calls almost nothing weed: the weak labels taught it what corn is, not what a weed is.
- **Hybrid (`scripts/rowCrop/seg_hybrid.py`).** The model decides what is corn, soil-relative colour decides what is
  green, and green that is not within 3 px (about 3 cm) of the model's corn is a weed candidate. On the four held-out
  photos it marks 1,277 to 5,801 candidates a photograph, most on the alley floor where the photographs show small
  seedlings (mostly grass), some on corn leaf tips the model left just outside its mask. Verges light up as expected.
  Not verified against truth.
- **Limits.** 14 px patches are about 7 cm at native scale, so the model is run at 2x (3.5 cm); 80 s a photograph on
  this CPU. A weed among the corn leaves is still the model's corn, since the weak labels say so. The next real step
  is a few hundred hand-checked weed outlines on these photographs; the reader's patches are not truth.

## Mid stage: what the alley seedlings are, and what the read reports (2026-10-29, night)

Yunus could not tell whether the small green things on the alley floor of the mid-phase photographs were weeds or
expected. Looked at at full resolution they are weeds: a late flush of annual grass seedlings, two to four leaves,
spread over the soil between the rows. Whether they matter is settled by the critical period for weed control in
corn: weeds that emerge after about V8, under a closing canopy, rarely reduce this year's yield and matter for next
year's seed (our weed-ecology research: "After V8 new emergence matters for seed, not yield"; Steckel and Sprague 2004:
waterhemp emerging after V8 did not reduce yield; Iowa State: the later a weed emerges after the crop, the less it
affects yield; UNL: about 2 % yield per leaf stage of delay until canopy closure). The broadcast post window on most
labels closes at V8 or 30 in. What still matters at mid season is an escape: a plant that came through early control
and is now large.

So the mid-stage variant now reports three things, and draws them differently in Photo Scout and the bench pictures:

- **Late seedlings** (amber dots): green on the alley floor between 2 and 20 cm², clear of every band, standing above
  its soil. A layer with a count and a cover figure, never individual findings.
- **Between-row plants** (red outlines): 20 cm² and up, clear of every band.
- **Escapes** (magenta, thick): between-row plants 15 cm across or wider (the corn profile's small-weed ceiling).
- The read's notes carry the agronomic reading above, and that the post window is a label matter (no product, no
  rate: decision support only).

**Two false alarms found by eye and fixed (mid only).** The first escape sheets of photo 22 were all verge grass and
frame-cut corn leaves. Now a patch is judged only where a corn row stands beside a soil alley: in the 3 x 3 cells of
0.5 m around it the crop bands are at least 25 % green and at least three times as green as the alleys, and the alleys
are under 30 % green; a verge or lawn the rows were traced into fails that because band and alley look alike there.
A patch touching the photo's edge is not judged. Rows are drawn only over their longest run where a row stands
(band at least 25 % green and 1.5 times the alleys), at least 3 m and a quarter of the photo's longest row, so no
stubs in a lawn. On the 40 mid photographs: 0 to 1 escape a photograph (the ones left are worth a look by eye),
7 to 36 between-row plants, 0 to 261 late seedlings (under 0.3 % of the alley ground), every field row drawn on the
photographs looked at (11, 22, 88). Establishment reads are unchanged, number for number.

**Known limit.** One row direction per photograph: photo 16 holds two plantings at different directions and its lines
cross the rows. Nothing is judged there (0 plants), but the lines are wrong.
