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

## Pointed at by Yunus the same day

WeedsGalore (GFZ, github.com/GFZ/weedsgalore): code Apache-2.0, data CC BY 4.0, DeepLabv3+ checkpoints offered for
RGB and multispectral input (uni-weed and multi-weed, deterministic and probabilistic; 887 MB, now at
`C:\swardus-research\models\weedsgalore\ckpts.zip`), trained on one German maize field at 0.25 cm a pixel from a
Phantom 4 Multispectral. No licence is stated for the checkpoints themselves. Not run yet: it would be a second
opinion on the green inside the band (weeds in the row), which the rules cannot give; whether it transfers to 0.5 cm
consumer RGB is unproven.
