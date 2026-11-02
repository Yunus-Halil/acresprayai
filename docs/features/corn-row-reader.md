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

## Mid stage: seedlings found at the photo's own pixel (2026-10-29, late)

Yunus, pointing at pale grass seedlings on the soil that carried no mark: "obviously the corn ones are thicker and the
weeds are smaller". Two causes, both measured on the mid photographs:

- **The bands had eaten the alley.** To keep leaf tips out of the weeds, each band reaches the leaves' tails: 32 cm
  half-width at a 76 cm pitch, which leaves about 12 cm of judged alley. Every seedling between the plants of a row, or
  under the reach of a leaf, was inside a band and never looked at.
- **The work raster cannot see them.** A grass seedling's blades are 2 to 5 mm wide, a pixel or two at 0.5 cm. The
  reader works at about 1.5 cm here. And the camera stores colour at about a quarter of the resolution of brightness
  (chroma subsampling and in-camera smoothing): on the photographs a 1 cm blade keeps its brightness but most of its
  green is smeared into the soil around it, so a green index alone misses it.

So a second pass, `src/lib/rowCrop/fineSeedlings.ts`, runs at the photo's own pixel at mid stage only, following his
rule literally:

1. **Corn is thick.** A plant pixel whose 4 cm square is all plant is a corn leaf (a V8 leaf is 5 to 10 cm wide), and
   everything joined to it is corn, including pale sunlit leaf and whitish midribs (bright over the soil and greener
   than the soil's own tint; pale soil crust does not join, or the corn would run across the ground).
2. **A seedling is small and stands alone.** A plant piece of 2 to 20 cm² that joins no corn, stands 1.5 cm clear of
   it, sits on soil (at most 15 % plant in the ring 1 to 2 cm around it) and has a part brighter than its soil.
3. **Two soil levels.** Corn is told from a local level over every pixel; a pale seedling is told from the tint of the
   soil pixels alone (in a closing canopy the local level is corn's, and a pale seedling's green vanishes against it).
4. **Judged only where the reader judges:** rows read there, the ground not a verge, no larger weed already holding the
   spot, and within three quarters of a pitch of a drawn row (rows traced into a lawn are not drawn there).

Seedlings are counted wherever the rows stand, between the plants of a row as well as in the alley, and drawn as amber
rings about 5 cm across. On the 40 mid photographs: 1,500 to 4,300 per field photograph (they were 0 to 261), under
1 % of the field ground, the lawns clean. Checked by eye on photographs 11 and 22: most rings sit on sprouts; some sit
on a corn leaf's base or a pale leaf piece; seedlings within 1.5 cm of a leaf and clumps over 20 cm² are not counted.
Accuracy is not measured (no labels). The read takes about 5 s a photograph instead of 1 s. Establishment reads are
unchanged on all 15 photographs. `scripts/rowCrop/fineProbe.ts` draws the pass alone with its reasons for rejecting
each piece (corn mask blue, near-corn zone purple).

## Emergence stage: seedlings as points (2026-10-30)

Yunus's very early photographs (`directtestimagery/veryearlystage`, 23 photographs, VE to V1, one field beside a
grass verge, EXIF stripped): bare soil, a seedling every 15 cm or so on the planter's line, tyre tracks parallel to
the rows. His brief: the lines are near perfect because the field was just planted; find the line and the plants on
it and the rest is easy. The early variant read no rows on 11 of them and took the verge's texture for rows on the
others (it shrinks the photograph to 1.5 cm pixels, where a 1 cm leaf is lost, and reads a green density, which a
verge dominates).

`RowCropStage` "emergence", `src/lib/rowCrop/emergence.ts` (constants in `EMERGENCE`, never read by the other
variants):

1. Soil-relative green at about 1 cm (the seedlings come out cleanly, the soil and the tyre tracks do not).
2. Solid green (a cell over 15 % green: verge, lawn, hedge) left out with a cell's margin, drawn as rectangles.
3. Every small green component standing on soil (its cell at most 8 % green) is a point.
4. The lens: barrel distortion bends straight rows toward the frame's edges, the same way for every row. One radial
   coefficient is chosen together with the direction where the points' projection is most concentrated (0.06 on
   these photographs); rows are read in the straightened plane and drawn back through the lens. Without it a row at
   the frame's edge drifted onto its neighbour and its seedlings were called weeds.
5. Pitch from the projection's autocorrelation; phase from the points' circular mean; each line of the comb
   collects its points and is refitted (a quadratic once long and well held), membership narrowed to the row's own
   spread; two fits on one row keep the stronger.
6. Seedling pieces within 3.5 cm along a row are one plant; a row is split at empty stretches over 1.5 m and short
   runs dropped (specks on a road in a dark corner); gaps are stretches with no plant over twice the row's own plant
   spacing (at least 30 cm).
7. Green off every row (beyond the 6 cm band) is a weed candidate.

On the 23 photographs: rows on all of them (19 to 38 a frame, coherence 0.87 to 0.92), 1,100 to 3,500 plants a
frame, 23 to 124 green patches off the rows, about 0.3 s each; the verge and road left out; checked by eye at full
resolution on 40 (right edge) and on 4 and 54 (`directtestimagery/veryearlystage/outputs/row-crop/emergence/`).
Not measured against counted plants. Known limit: pale seedlings in the vignetted corners are missed, so gaps there
run long; a gap is "no seedling seen", not a confirmed skip. Photo Scout offers the variant ("emergence"); bench:
`npm run bench:row-crop -- --photos directtestimagery/veryearlystage --stage emergence`. Test:
`src/test/rowCropEmergence.test.ts` (a rendered field through a barrel lens with a verge and weeds: every drawn row
within 3 cm of a planted line, the stand within 10 %, every weed found; bare soil refused).

### Emergence: pale seedlings (2026-10-30, later)

Yunus, pointing at a seedling whose sunlit half carried no mark: the fixed index at 1 cm caught the darker half of a
leaf and lost the pale half, and in the vignetted corners lost whole seedlings. `src/lib/rowCrop/seedlingGreen.ts`
judges each pixel of the photograph itself against the soil beside it (block means of the least green pixels, a
median over the blocks around), in tint (G - (R + B) / 2) and brightness, with hysteresis: tint over the soil's by
16 is a leaf; by 10, or 28 lighter with a tint of 3, joins only where it touches a leaf pixel (the pale half); a
wholly pale seedling is kept when part of it is 30 lighter with a tint of 8. The emergence reader's points come from
this mask (shrunk by "any pixel in the block"); the fixed index still judges solid green and the soil around a point.
Thresholds chosen by eye on crops of photographs 40, 54, 60, 4 and 3 (`npx vite-node
scripts/rowCrop/seedlingMaskProbe.ts`, old beside new in `outputs/seedling-mask/`): at 14 / 6 / 22 the camera's colour
smear joined neighbouring seedlings; at 16 / 10 / 28 they stay apart and the corner seedlings are still caught.

On the 23 photographs: plants per frame up by a fifth to a third (54: 3,496 to 4,119), gaps about halved (54: 285 to
175), rows unchanged or one more; about 1.2 to 1.5 s a photograph in Node. Photograph 100's right third is a later
planting just emerging: its few seedlings per furrow form no rows and are listed as green off the rows (98 to 249
there); not tuned for. Photo Scout's growth stage still starts at "early": the emergence variant must be chosen.

## Benchmark of all four stages and the plan per stage (2026-11-02)

Every variant re-run at 32b32d2 on the four photo sets, compared with the recorded runs and looked at by eye; the
late stage (no variant) is the weakest, and the probe shows its rows still carry a periodic green signal. One
concrete plan per stage, weakest first, in
[docs/research/corn-stage-benchmark-2026-11-02.md](../research/corn-stage-benchmark-2026-11-02.md).

## Establishment: where the field ends (2026-11-02)

Yunus, on photograph 34: "very very very good detection, but it just doesn't know where the field ends", with the
proposal to look at the surroundings: grass all around, or a clear edge, is where the field stops. The rows had run on
across the headland, the verge and the road, carrying orange gaps and red "weeds" on the grass; and the grey outline of
a left-out verge was its convex hull, a diagonal line straight across the crop.

**The rule (`EDGE`, `fieldExtent` in readRowCrop.ts, establishment only).** Every traced row is judged strip by strip
(half a metre) from the ground around it, over its trace and 4 m past both ends:

- **It stands** where its band (a fifth of the pitch either side) holds green, at least a tenth of the field's typical
  row green, and is clearly greener than the softer of its two alleys: twice as green where the ground is green all
  over (a verge, a lawn), one and a half times elsewhere (a dry-grass or weedy headland). The bar is low on purpose:
  in a frame's dim, vignetted corner the same corn is a fraction as green (photograph 89 cut its rows mid-crop at a
  third of the typical green), and the contrast with soil alleys does the real work.
- **A strip where it does not stand is still the field** when its ground is not green and two of the rows one or two
  pitches either side stand there: a gap in one row. A headland, a road or a verge stops every row together.
- **A row standing on its own**, where no neighbour looked at stands within a metre along, is past the field (a trace
  across a verge by itself).
- Each row keeps its field runs; stretches up to 3 m between two runs are bridged; a first or last run under 2 m, cut
  off by ground that is not the field, is dropped (a one-strip "stand" at a verge's edge).
- **An end is the field's edge** when ground that is not the field follows within 4 m before the frame cuts the row
  off. The read says what lies beyond: grass or cover, or bare ground (a headland, a track, a road). Past an edge the
  row is not carried on, and green on the line of a cut row beyond its end is not judged (never a weed of the rows
  beside it).
- The edge is drawn where the field stops (the first strip that is not the field), not at each row's last plant; one
  side's ends of neighbouring rows are joined, each point at the median of itself and its two neighbours.
- Left-out patches are drawn as their own outline on quarter-metre cells, over the solid-green ground only.

**Where it shows.** Photo Scout draws the edge as a dashed white line with the rows and adds a "Field edge" line to the
summary; the read carries `fieldEdge: { ends, lines }`; the bench draws it white.

**Measured on the 15 establishment photographs** (`outputs/row-crop/field-edge/`, against `b1102-establishment`):

| Photo | Edge in the photo | Row ends found (grass / bare) | Row length m | Gaps | Gap m | Weeds |
|---|---|---|---|---|---|---|
| 34 | verge and road, bottom | 31 (25 / 6) | 517 to 503 | 29 to 24 | 19.3 to 13.4 | 15 to 7 |
| 63 | verge and road, diagonal | 34 (32 / 2) | 375 to 362 | 28 to 23 | 15.7 to 11.5 | 9 to 4 |
| 64 | verge and road, bottom | 36 (35 / 1) | 494 to 486 | 22 to 14 | 10.4 to 6.5 | 7 to 3 |
| 73, 104 | lawn, top | 33 and 33 | 625 to 618, 560 to 553 | 0 to 0, 4 to 3 | | unchanged |
| 42 | grass, top corner | 17 (17 / 0) | unchanged | unchanged | | unchanged |
| 89 | headland, top | 11 (6 / 5) | unchanged | unchanged | | unchanged |
| 102, 99 | none | 0 | unchanged | unchanged | | unchanged |
| 67, 70, 71, 72 | an unplanted tyre-tracked strip | 1 to 4, bare ground | within 1 % | | | up to 3 fewer |

Rows stop at the headland on every edge photograph looked at (34, 63, 64, 73, 104); the gaps and weeds that went are
the ones on the verge and the road. Every rendered development stand reads the same rows, length and on-crop share with
the step on and off, except development-5 (the registered weak case: V2 under weeds larger than its plants), which
loses a 2.5 m stub at the frame's edge (on-crop 0.78 to 0.76). The mid variant reads all 40 mid photographs number for
number as before. Tests: `src/test/rowCropFieldEdge.test.ts` (a rendered stand with a verge and a road, ends said and
drawn, bare-ground ends, a stand running off the frame without ends, the L-shaped outline); the end tests fail with the
step switched off. `scripts/rowCrop/edgeProbe.ts` prints a photograph's per-strip band and alley green, and
`edgeScenesProbe.ts` compares the rendered stands with the step on and off.

**Known limits.** The field's edge is where every row stops, so a sprayer track or a drowned strip more than 3 m wide
across the rows also reads as an edge (labelled bare ground). A headland planted across the rows reads as an edge too
(no row of this direction stands there). The edge line still steps where neighbouring rows end a metre or more apart.

## Establishment under other field conditions: a review (2026-11-02)

Yunus asked for the reader to be checked for field conditions beyond these photographs. What the code does with each,
where it is fragile, and the change each would need, most likely to matter first:

| Condition | What the reader does now | Fragile where | Change it would need |
|---|---|---|---|
| Dim corners, vignetting | Soil-relative green per 64 px tile copes with slow brightness change; the edge bar is relative and low | Gaps along rows in the corners are often missed plants (share under 15 % of the row's median) | Flatten the frame's radial brightness fall on soil pixels before the mask (shared with the emergence work) |
| Hard shadows (trees, poles, the drone) | Shadow is not green, so a shaded row reads as a gap | A shadow across several rows reads as gaps, or as a bare edge if over 3 m | A shadow mask (dark and unsaturated against the local soil) marked not judged, never a gap |
| Row spacing without a pixel size | Scale assumed from the measured pitch and 76.2 cm | 38 or 51 cm rows read at the wrong scale: every metre off by the ratio | The header's altitude when present; otherwise the operator's spacing in Photo Scout |
| Twin rows | One band covers both lines | A weed between the pair is hidden | A twin-aware band (two peaks inside one pitch) |
| Curved or contour rows | One direction per photo; strips chain slow bends | Strong curvature: strip profiles blur, traces break | Direction per region (the same work as the mid stage's photo 16) |
| Two plantings, a headland planted across | The second direction is not read | Its ground is now cut as an edge | Per-region direction, each region read as its own frame |
| Sprayer or wheel tracks across the rows | Up to 3 m bridged as gaps | Wider tracks become edges | Tell a track (bare, straight, across, rows resume beyond) from a headland (rows do not resume) |
| Weeds outgrowing V2 corn | Rows kept where the ground is under 30 % green | Above that, rows and verge look alike | Nothing by colour; the segmenter line of work |
| Residue, straw, red or wet soil | Soil-relative green; rendered straw and red-soil stands pass | Heavy no-till residue on real photographs untested | A real residue flight |
| Oblique photographs | Local pitch may vary 10 % per strip | Strong tilt: pitch varies across the frame beyond that | Refuse or rectify when the header's gimbal pitch is over 10 degrees off nadir |
| Coarse pixels (2 to 3 cm) | Reads rows; no stand estimate | V2 rows of 1 cm leaves vanish | Say so: the stage needs 1 cm or finer at V2 |

None of these is built; each is a separate piece of work with its own pictures to check.

## Emergence V2: rows first, then a second look along them (2026-11-02)

Yunus's brief: reconstruct the planter rows from the existing seedling detections, then use them to recover pale
seedlings, classify every apparent gap (confirmed, possible, uncertain, supported missing) and benchmark V1 against
V2A (rows) and V2B (row-aware recovery) without breaking what works. Built in `emergence.ts`, `seedlingGreen.ts` and
`readRowCrop.ts` (types), measured with `scripts/rowCrop/emergenceV2Bench.ts`.

**Phase 1, the rows: already the reconstruction the brief asks for; kept as it is.** The reader did not connect
neighbouring plants: it fits one lens coefficient with the direction where the points concentrate, takes the pitch
from the projection's autocorrelation and the phase from a circular mean, then refits each line of the comb to its own
points with a narrowing tolerance (a robust fit, RANSAC in effect), a quadratic once long, splits rows at empty
stretches over 1.5 m and drops short runs. Its consistency on the 23 photographs: row spacing 75.8 to 76.6 cm at the
assumed scale, coefficient of variation 1.5 to 2.3 % across neighbouring rows, direction 86.3 to 87.8 degrees, lens
coefficient 0.068 to 0.084. Rows continue through stretches with no seedling (the line is fitted, not drawn plant to
plant). So V2A changes one thing: the second planting.

**The second planting (photograph 100).** The right third is a later planting in the same direction, barely emerged;
V1 listed its specks as 249 weeds and ran one stray row into it. V2 looks at ground the main rows do not reach (at
least three pitches wide, mostly soil) with a relaxed seedling test (`SEEDLING_RELAXED`, thresholds scaled down with
the soil's brightness where it is dim). There its specks line up at 75 to 77 cm with coherence 0.48 to 0.61, so a
planting is there. Its rows were then grown as a comb of their own, and **looked at by eye they were wrong**: one line
sat on plain soil beside a furrow, others caught every second furrow. A line through ground that is not the crop is
worse than none, so the rows are not drawn. The ground is set apart instead (an excluded outline: "a later planting
just emerging, its rows are too faint to place"), its green counted on its own (172 patches), never as weeds,
and the main comb's stray row inside it dropped. Weeds on 100: 249 to 90.

**Phase 2, the second look.** In every stretch of a row longer than 1.6 times its own plant spacing, the expected
positions (the row's spacing, evenly between the plants either side) are examined:

1. **The strict test first, at the photo's own pixel.** Its mask is already computed for V1; a strict green pixel on
   the line there is a plant V1 never made a point, because it was larger than the seedling-point cap or stood in a
   crowded cell. This was the largest finding of the work: V1 drew gaps through 3,189 such plants on the 23
   photographs. They are confirmed, not "recovered".
2. **The relaxed test**, light-scaled, inside a corridor along the fitted line (3 cm, or 2.5 times the row's own
   spread): a speck of 8 photo pixels or more near the expected position is a **possible seedling**.
3. **A control**: the same search in the middle of both alleys beside the stretch. Where it fires a third of the time
   or more the soil itself fools the test, and nothing there is called either way. Across the 23 photographs the
   control fires 0.5 to 3 % of the time.
4. **Supported missing plant**: nothing found, the soil at least 70 % as bright as the frame's, inside 92 % of the
   frame's half-diagonal, not at the frame's edge, a quiet control. **Uncertain**: anything else with nothing found.
5. Gaps are recomputed over everything the row now holds and named by what their positions were: orange (a missing
   plant the photo supports) or grey dashed (uncertain). Positions outside the photo are not counted.

The strict mask is not widened anywhere: the relaxed test runs only inside the corridors and the set-apart ground, and
the possible seedlings are reported apart from the plants, never added to the stand. `seedlingGreen.ts` was split
into `soilLevels` (once per frame) and `seedlingWindow`; the whole-frame mask is bit-identical to before (checked on
three photographs) and costs the same.

**Phase 4, measured on the 23 photographs** (`outputs/emergence-v2/`, pictures V1, V2A, V2B side by side per photo,
`results.md`, sample sheets in `sheets/`). V1 mode reproduces the morning's reader on all 23 number for number; V2A
reproduces V1's rows and plants on every photograph but 100.

| | V1 | V2 |
|---|---|---|
| Plants counted on the rows | 64,553 | about 67,700 (+3,189 the strict test sees, previously drawn as gaps; 100 loses its stray row) |
| Possible seedlings (reported apart) | none | 1,665 |
| Supported missing plants | none | 2,729 |
| Uncertain positions | none | 339 |
| Gaps | 2,555, 1,311 m | 870, 395 m |
| Green called weeds on 100 | 249 | 90 |
| Time per photograph, median (max) | 1.33 s (1.52) | 1.36 s (1.60) |

**Checked by eye, not against counted plants** (no reference counts exist; these are my readings of the 36-crop
sample sheets at 5x, a 4 cm ring on the position):

- **Possible seedlings:** about 23 of 36 show a pale leaf inside the ring, 3 are plainly soil, about 10 cannot be told.
- **Supported missing plants:** none of 36 shows a plant in the ring (after the strict-first rule; before it, 6 of 36
  did, which is how the 3,189 were found).
- **Rows:** cyan lines lie on the planter lines on every photograph looked at (3, 40, 54, 100), through the gaps.

So there is no recall or precision figure: what exists is the control rate (the relaxed test's false finds on alley
soil, 0.5 to 3 %), the eye readings above, and the regression checks.

**Remaining failure modes.**
- The later planting on 100 is detected but not read; its rows are too faint for this camera at this stage. A second
  flight a week later would read it as its own field.
- A possible seedling is weaker evidence than a plant: roughly a third of the sampled ones could not be confirmed by
  eye. They are drawn in their own colour and kept out of the stand on purpose.
- Every metre rests on the assumed 76.2 cm row spacing (the photographs carry no EXIF).
- The seedling-point size cap is a share of the frame's long side, so a small or cropped frame under-reads (found while
  writing the tests: a 1,400 px frame has a 3 px cap).

**Where it shows.** Photo Scout (emergence selected) draws possible seedlings blue, supported missing plants orange,
uncertain positions grey, gaps orange or grey dashed, and the set-apart ground with the other left-out ground; the
summary gains a "Second look along the rows" line and the gaps line says what they were before. Tests:
`src/test/rowCropEmergenceV2.test.ts` (a rendered field with pale seedlings, skips and a later planting: V1's rows kept,
pale ones possible or plants, skips missing and never plants, the control quiet, the later planting set apart); two
of its four tests fail with V2 switched off. `EMERGENCE.recover` and `EMERGENCE.extraPlantings` switch V2 off.

## Emergence V2: the audit, and rows that run to the field's edge (2026-11-02, later)

V2 was frozen (tag `emergence-v2-frozen`, 4a58281) and audited on all 23 photographs without changing it
(`scripts/rowCrop/emergenceAudit.ts`, output in `outputs/emergence-audit/`), on three questions from a review.

**Do the lines follow the seedlings or the soil furrows? The seedlings.** At 115 clear seedlings sampled across the 23
photographs (centre, middle and rim of the frame), the seedling sits a median 1.1 cm from its drawn line (90th
percentile 2.6 cm), the same at the rim as in the centre. Around each, across a window 1 m along the line, the green
peaks 0.5 cm from the line and the darkest band (the soil furrow) 9.9 cm away; in 108 of the 115 the two part by 2 cm
or more and the line is on the plants. The 108 crops cut for the eye (`seedlings-1.jpg`, `seedlings-2.jpg`, the line
dotted, ticks every 2 cm) show the line through the plants in all but two or three; in several a dark soil streak runs
beside the plants and the line stays on the plants. These seedlings come from the mask the rows were fitted to, so the
distance measures the fit; the furrow offset and the crops are the part independent of it.

**The red off-row patches.** 1,846 on the frozen version, a median 19 cm from a line. In a sample of 48 cut for the eye
most rings sit on a green leaf; a few on dry residue, a pebble or bare soil. Whether a green one is a weed or a corn leaf
reaching past the 6 cm band cannot be told from the crop alone; `off-row.jpg` now draws the nearest line.

**The row ends: the failure.** Yunus's screenshot showed rows stopping a metre before the verge with seedlings
continuing to the grass ("we should be able to tell it's corn because it is, and stop when the field and the non-corn
stuff come"). Of 121 row ends in the bottom fifth of the frames, 61 had clear seedlings within 3 cm of the line's
extension in the next metre, 176 seedlings in all, counted nowhere (not plants, not weeds). Two causes, found by
instrumenting a scratch copy of the reader:

1. **The verge's margin.** Solid green was left out in cells of about 55 cm grown by a whole cell: up to a metre of
   seedlings before every verge was never looked at. Now the coarse zone's edge is refined at cells a quarter the size
   (about 14 cm): a fine cell is grass when it is over 30 % green itself and its 3 x 3 neighbourhood over 15 %, grown
   only into neighbouring cells over 12 % green (the grass's ragged fringe), so a cell with a seedling on soil stays in
   the field. A seedling's "on soil" test falls back to the fine neighbourhood (42 cm under 8 % green) wherever the
   coarse cell is crowded (grass or a clover patch beside the seedlings); it can only add points.
2. **A row split by plants too big to be points.** A stretch over 1.5 m with no seedling point split a row and the short
   tail beyond was dropped (photograph 35: two rows lost two metres). The stretch held seedlings over the point size
   cap. Now a row is split only where the strict seedling mask has no green on the fitted line for 1.5 m, and green
   inside solid-green ground does not count (the first version of this let four rows of photograph 3 run across the
   verge to the road; caught by eye and fixed before commit).

Near a verge, green that is part of the grass's fringe, or past the rows' ends on the headland's stubble strip, is not
judged; only a patch on soil within the rows' length is a weed candidate there.

| | Frozen | Now |
|---|---|---|
| Bottom row ends with seedlings past them | 61 of 121 | 27 of 135 |
| Seedlings past those ends | 176 | 31 |
| Rows | 639 | 659 |
| Plants on the rows | 67,732 | 70,362 |
| Line to seedling, median (90th pct) | 1.1 cm (2.6) | 1.1 cm (2.8) |
| Line to the darkest soil band, median | 9.4 cm | 11.8 cm |
| Off-row patches | 1,846 | 2,298 |
| Gaps | 870, 395 m | 972, 455 m |
| Time per photograph, median (max) | 1.36 s (1.60) | 1.58 s (1.88) |

The extra off-row patches are on the strips beside verges that were never looked at before (3, 4, 35 and 36 carry
most); the ones seen by eye on 3 and 35 are green on soil at the field's edge, clover-like, as in Yunus's screenshot.
The extra gaps come with the longer rows. Rows on 3, 4, 21 and 35 now run to the field's edge without crossing the verge.

**Still open.** 27 bottom ends still have a seedling or two past them (photograph 21 has 10: seedlings over the size cap
with gaps between them, rows half a metre short of the grass). The size cap on seedling points is a share of the frame's
long side, a fixed number a different camera or height would need re-set. Off-row patches are not yet sorted into weeds
and corn leaves past the band. Everything here is one field: transfer to another field is untested.

## Validation and the fixes it led to (2026-11-02, night)

A visual validation of all four readers (573 sampled observations judged by eye from the unannotated originals;
`directtestimagery/validation-2026-11-02/VALIDATION-REPORT.md`, gitignored) found the readers right on the crop and
wrong at the frame's dim rim, at the verge and off the rows. The fixes, each re-checked on a fresh sample (seed 777;
`directtestimagery/validation-2026-11-02-after/AFTER-FIXES.md`):

- **Squeezed rows** (establishment, mid; `readRowCrop.ts`): two strip peaks with bare soil between them are two rows
  however close (a frame corner squeezes rows to two thirds of their spacing; photograph 72 lost its outer row and its
  corn became weed candidates); traces are compared where they overlap, not by their mean position.
- **Rows followed to the frame** (emergence, `EMERGENCE.extendEnds`): from each end, one plant spacing at a time along
  the row's last stretch, strict test then the light-scaled relaxed one with both alleys quiet; stops at the frame, a
  verge, the later planting, green alleys or two empty positions. Row ends judged right: 29 % to 77 %.
- **Weed tiers** (emergence, `EMERGENCE.tierBySeedlings`): off-row green larger than the photograph's own 90th-percentile
  seedling stays a weed candidate (red); smaller green is counted apart (grey, `tier: "small green"`), never called a
  weed (96 % of decided grey marks were indeed not weeds). Green where no row was read is not judged. Red candidates
  2,230 to 188 over the 23 photographs; their precision only 24 % to 32 %: verge stubble and the crop's own leaves
  within 13 cm of the row remain. A lattice check (is the green at an empty planting position) was measured and does
  not separate them: real weeds also stand beside a corn plant.
- **Establishment**: patches cut by the frame not judged; no green in the lens's black corners; an empty stretch
  running out to a field end is the headland, not a gap (`EDGE.headlandNotGap`), the row drawn to its last corn; a row
  where both sides are grass stops unless its band is 1.5x greener (`EDGE.bothAlleysGreen`, `overGreenerAlley`). Weed
  candidates 64 to 20 (48 % to 73 % right), gaps 99 to 56 (77 % to 89 %).
- **Mid leaf pieces** (`FINE.leafPieces`): a seedling candidate the corn reaches through looser leaf is a leaf piece.
  The layer halved (91,793 to 42,405) but is still mostly leaf pieces (4 of 27 decided right): not solved.
- **Late reader** (stage `"late"`, `LATE`): rows from how green the canopy is against its surroundings, the mid row
  logic, rows at least half the longest run; nothing between rows judged, no plant count. In Photo Scout as "late".
  By eye the lines follow the leaf bands; no per-point check is possible under a closed canopy.

Tests: `src/test/rowCropValidationFixes.test.ts` (each fix on a rendered scene, most shown to matter by switching it
off; the headland test is a guard only). Probes: `scripts/rowCrop/{validateCorn,contextProbe,latticeProbe,rimProbe,
rowEndsProbe,edgeRuleProbe,weedSizeProbe}.ts`, `validate_crops.py`, `validate_report.py`; the procedure is the
`/validate-corn` skill.
