# One adaptive corn reader: no stage asked for (2026-11-03)

The four corn readers (emergence, establishment, mid, late) each assumed the whole photo was one growth stage, and
something outside the photo chose which one ran: a dropdown in Photo Scout (default establishment), `--stage` on the
benches, the folder name in the validation runner. The `suggestStage(px)` planned on 2026-11-02 (whole photo, shown
as a suggestion) was never built. On 2024corn2 (UAV3DCrop 2024 Day001_Corn2, V3 to V5 corn in a folder named
`emergence`) the wrong reader ran and set the corn aside as "too big for a seedling".

`readCornAdaptive` (src/lib/rowCrop/adaptive.ts) replaces that choice. It is the default ("auto") in Photo Scout.

## What was actually wrong on 2024corn2

Read on the original pixels, not on the reader's output:

1. **The reader was chosen by the folder name.** The emergence reader caps a seedling's size; V4 plants are over it.
2. **Most frames hold two plantings.** The left half has rows about 2.1 times closer than the right half (76 cm and
   about 160 cm at the assumed scale; the absolute spacing is unknown without a pixel size). Checked at full
   resolution on photograph 10: no plants between the right half's rows. The establishment reader measures one pitch
   per photo, so the half at the other pitch failed its lattice tests, its rows were dropped, and its corn, now about
   a pitch from the kept rows, became weed candidates. Photographs 10 to 13 and 21 to 27, read as "thin stands", are
   mostly this.
3. **Verges decide a photo's direction** when they are large (photograph 3), the third failure already in the brief.

So the fix had to judge the photo before any reader runs, part by part.

## The design

```
photo -> assess.ts: cells of about 1/12 of the frame, each judged over its 3 x 3 window
           green share, row direction, pitch and its strength, alley depth, green component size
           -> the field's direction (cells' consensus), its plantings (pitch clusters), each cell's state:
              seedlings | rows | canopy | closed | cover | bare | unknown
      -> plans: one per (stage, planting) the readable regions call for
           seedlings -> emergence, rows -> establishment, canopy -> mid, closed -> late
           each plan reads the WHOLE frame with the field's direction (+-3 deg) and its planting's pitch (+-12 %) as a prior
      -> ownership: each cell belongs to its region's plan, else to the plan whose rows run through it, else nobody
      -> findings of each plan kept on the ground it owns; nobody's green is uncertain, never a finding
```

The stage readers' own rules are untouched. With one planting at one stage (every photograph of the old
emergence and establishment sets) the adaptive read is the stage reader's own read, its geometry kept from a verge's
pull.

Rules that carry the agronomy, each measured or pinned by a test:

- **One field, neighbouring stages.** Corn in one field differs by about one growth band across a frame. A region two
  bands from the main reading (a "closed canopy" beside seedlings) is a verge, a lawn or another field and is not
  read unless it is at least half the main reading's size. The wild and mown verges of the emergence set read as
  closed canopy at 39 to 176 cm "spacings" and a late reader traced rows through the grass until this rule.
- **A second reading needs at least 4 cells** (about 4 % of the frame): a whole-frame read is not spent on a patch.
- **Rows are cut at a reading's boundary only where the other reading draws that row itself** (within a third of the
  narrower pitch), and a reading draws on other ground only to continue a row it holds on its own (two points there).
- **A weed candidate on a row another reading drew there is that row's crop.**
- **Corn on a row the reader did not hold is not a weed** (unsupportedSlots): candidates on an empty slot of the
  reader's lattice, at least 3 of them, each at least half the region's typical plant, are "corn on an unsupported
  row", drawn amber with the slot's line dashed. A lone candidate on an empty slot stays a weed candidate: being near
  a row line proves nothing by itself.
- **The pixel size is only ever the one given.** Without one the main reading assumes its scale from its own rows, as
  the stage reader does; a second planting is measured in the main reading's metres.

## What was tried and dropped

- **Reading each region on a crop of the photo** (the first version, earlier on 2026-11-03). It broke what every reader
  builds around the whole frame: the emergence reader straightens the lens about the frame's centre, follows rows into
  the dim rim, cuts them at the field's edge from their neighbours. On emergence photograph 100 one seedling field was
  split around a sparse middle into two crops, each straightened about the wrong centre: rows crossed and 50 red weed
  candidates appeared where the frozen reader has none.
- **Handing the assessment's assumed scale to the reader as if it were given.** The reader then chose a finer work
  raster: slower, and more small patches judged (establishment photograph 64: 5 weed candidates against 2).
- **A coarser raster for the assessment's direction search** (every 6 work pixels instead of 4): 100 ms faster, but
  319 of 16,632 cells changed state and second plantings appeared and vanished on the mid and late photographs.
  Kept at 4.

## Results

All runs on this machine (Ryzen 5 9600X, Node 24), photographs 5280 x 3956 without EXIF, so every metre rests on the
assumed 76.2 cm row spacing. The frozen readers are the committed stage readers (f7f77b8) chosen by hand per folder,
run in the same process without a geometry; on the emergence and establishment sets their counts match a run from a
clean checkout of f7f77b8 on every photograph and every count (0 differences). "Agreement" is the share of one read's
row length that the other's rows run along within a quarter of a pitch. Benchmarks:
`directtestimagery/benchmark-adaptive-v3` (emergence) and `-v4` (the rest), pictures under each set's `pictures/`.

### Old emergence set (veryearlystage, 23 photographs): no regression

| Measure | Adaptive | Frozen emergence |
|---|---|---|
| Readings chosen | emergence on all 23 | (chosen by hand) |
| Rows | 658 | 659 |
| Row length | 12,511 m | 12,513 m |
| Agreement, both ways | 100 % / 100 % | |
| Plants | 70,490 | 70,501 |
| Possible seedlings | 2,034 | 2,032 |
| Supported missing plants | 3,012 | 3,010 |
| Gaps | 1,007 | 1,011 |
| Red weed candidates | 49 | 49 |
| Small green, counted apart | 615 | 623 |
| Duplicated rows | 0 | 0 |
| Errors | 0 | 0 |
| Time a photograph, median (max) | 2.22 s (2.65 s) | 1.60 s (1.98 s) |

### Old establishment set (estabilishmentphase, 15 photographs): no regression

| Measure | Adaptive | Frozen establishment |
|---|---|---|
| Readings chosen | establishment on all 15 | (chosen by hand) |
| Rows | 531 | 531 |
| Agreement, both ways | 100 % / 100 % | |
| Gaps | 56 | 56 |
| Weed candidates | 20 | 20 |
| Field ends | 204 | 204 |
| Errors | 0 | 0 |
| Time a photograph, median (max) | 1.30 s (1.55 s) | 0.73 s (0.77 s) |

The added time is the assessment: 0.61 to 0.62 s median a photograph (0.74 s at most).

### 2024corn2 (63 photographs, the field that exposed the problem)

Not a holdout any more: it was looked at while the design was built.

| Measure | Adaptive | Frozen establishment | Frozen emergence (the folder name's choice) |
|---|---|---|---|
| Readings chosen | establishment at two spacings on 44, one on 19 | | |
| Row lines | 1,444 | 1,298 | 852 |
| Row length | 18,889 m | 15,660 m | 8,554 m |
| Frozen establishment rows the adaptive rows run along | 99.5 % | | |
| Weed candidates | 88 | 723 | 3,622 (and 8,155 small green) |
| Photographs with 10 or more weed candidates | 3 | 16 | 40 |
| Field ends | 194 | 138 | 0 |
| Duplicated rows | 1 | 0 | 1 |
| Errors | 0 | 0 | 0 |
| Time a photograph, median (max) | 1.63 s (1.84 s) | 0.63 s (0.89 s) | 1.89 s (2.18 s) |

By eye on the drawn pictures (directtestimagery/benchmark-adaptive-v4b/corn2/pictures): photographs 3, 6, 10, 21 and
61 have rows on the corn of both plantings, the field's end drawn along the verge, the gravel road uncertain and
unread. On 3, 4 and 61 the frozen establishment reader held 2 to 6 rows.

Remaining on 2024corn2:

- **Photograph 27** (16 candidates): where the two plantings meet the field's end, rows run on into the weedy
  headland as wobbly traces; the field-edge cut works left and right of it.
- **Photographs 26 and 183** (10 candidates each): not inspected one by one. 183 has the same 10 with the frozen
  establishment reader.
- **More gaps**: 4,627 against 3,555, in proportion to the row length added; not checked by eye.

### Mid and late sets (routing check; their readers unchanged)

| Measure | Adaptive, mid set (40) | Frozen mid | Adaptive, late set (13) | Frozen late |
|---|---|---|---|---|
| Readings chosen | mid 30, late 5, mid + establishment 5 | | late 13 | |
| Row lines | 1,059 | 979 | 295 | 296 |
| Frozen rows the adaptive rows run along | 99.5 % | | 100 % | |
| Weed candidates | 705 | 705 | 0 | 0 |
| Time a photograph, median | 4.93 s | 4.33 s | 1.18 s | 0.64 s |

- **Mid photographs 86 to 91 are mixed growth**: a strip of younger rows on bright soil beside the dense corn. The
  younger rows are read by the establishment reader (rows the mid reader did not draw); two short spurious traces stand
  in the bare strip between them.
- **Mid photographs 1, 2, 16, 17 and 18 are judged closed canopy** and read by the late reader: rows drawn (on 1 and 2
  the mid reader refuses and draws none), but nothing between them is judged, so their few mid-reader weed candidates
  are not reported. On 17 the late reader also draws two rows in the lawn below the corn, and the seedling field on the
  left, planted across the main rows, is uncertain and unread (one row direction per frame).

## The thin-stand case, pinned

`src/test/rowCropAdaptive.test.ts`, "keeps the corn of a thin row out of the weeds": a rendered V3 stand, two rows
thinned to one plant in twelve (about one every 1.9 m). The frozen establishment reader drops both rows and calls at
least 3 of their surviving plants weeds; the adaptive reader calls none of them weeds. On the real photographs the
rule fired on none (0 corn on unsupported rows): with each planting read at its own pitch, the rows that were dropped
on 2024corn2 are held.

## Speed

| Set | Adaptive, median | Frozen stage reader, median |
|---|---|---|
| Emergence | 2.22 s | 1.60 s |
| Establishment | 1.30 s | 0.73 s |
| 2024corn2 (mostly two readings) | 1.63 s | 0.63 s |
| Mid | 4.93 s | 4.33 s |
| Late | 1.18 s | 0.64 s |

The assessment costs 0.56 to 0.62 s a photograph (0.80 s at most), a second planting one more read. It was 1.5 to
2.2 s at the start of the day; the per-pixel work in its windows is now table-driven with the same result.

## Research and data

- **Published stage classifiers** (searched 2026-11-03): none reads V-stages from single RGB frames with per-stage
  accuracy. Plant-size features resolve emergence stage only within a few days (Vong et al., 0.20 to 0.49 exact,
  0.55 to 0.88 within 3 days); growth-stage work that reaches 95 % uses LAI, cover and canopy height, not RGB alone. So
  the assessment reads structural states (seedlings, rows, canopy, closed), not V-stages.
- **Row geometry**: the Pattern Hough Transform (Winterhalter et al., RA-L 2018) fits angle, offset and spacing of all
  rows together, the literature's version of one shared geometry; dynamic programming along rows (Vidovic, Cupec and
  Hocenski, Pattern Recognition 2016) is the known way to carry a weak row through gaps, worth trying if real thin rows
  appear.
- **Models**: MaSC YOLOv9 maize-stand weights (Zenodo, trained on MSDD) are the only plausible challenger for plant
  points; MSDD is CC BY-NC-SA and the weights' licence conflicts with it, and detectors are reported fragile across
  pixel sizes (Velumani et al. 2021). Not adopted: nothing here failed for lack of plant recognition; it failed for lack
  of the right geometry.
- **The Maize-Weed Image Dataset** (D:\Drive2downloads, 500 annotated of about 36,900): handheld, oblique, ground-level
  photographs from Nigeria with boxes for maize and weeds. Its viewpoint and scale (a leaf across hundreds of pixels,
  no rows visible as rows) do not match nadir drone frames at 0.4 to 1 cm a pixel, so it cannot teach row geometry or
  stage; at most a crop-versus-weed leaf classifier for close-ups. Not used.
- **Unseen frames**: UAV3DCrop (CC BY 4.0) has corn in 2023, 2024 (Corn1 and Corn2 on nine days) and 2025. 48 nadir
  frames, picked by camera pose (within 5 degrees of straight down, spread over the field), are in
  `directtestimagery/holdout`: 12 each from 2024 Day001_Corn1 and 2025 Day007, Day028 and Day033 (Day019 has no
  poses). They were not opened while the code was built.

## Unseen fields: the holdout, run once at 8fcec20

48 nadir frames from four UAV3DCrop flights none of this work had looked at, run once on the committed code
(`directtestimagery/benchmark-adaptive-holdout-8fcec20`). No stage is known, so both frozen readers of the two
focus stages ran beside it. There is no truth for these fields; the verdicts are by eye on the drawn pictures.

| Flight (12 frames each) | Readings chosen | Adaptive rows / weeds | Frozen emergence | Frozen establishment |
|---|---|---|---|---|
| 2025 Day007 (seedlings) | emergence on 12 | 311 / 18 | 311 / 18 (identical, 100 % agreement on every frame) | 229 / 204 |
| 2025 Day028 (mid) | mid 8, late 2, mid with establishment 2 | 328 / 210 | 49 / 26 | 258 / 919 |
| 2025 Day033 (late) | late 8, late with mid 3, establishment 1 | 210 / 5 | 14 / 3 | 87 / 151 |
| 2024 Day001_Corn1 (V3 to V5) | establishment 5, at two spacings 7 | 226 / 106 | 109 / 192 | 156 / 251 |

Errors: none. Time a frame, median: 2.2 s (seedlings), 4.9 s (mid), 1.3 to 1.4 s (establishment, late).

By eye:

- **Day007, frame 47**: seedling rows on the corn, the lawn left out, the unplanted soil above mostly unread. The
  routing is right on all 12 and the read is the emergence reader's own.
- **Day028, frame 637**: diagonal mid-stage rows, every row on the corn; the mid reader's between-row candidates and
  seedling layer as it draws them. Their accuracy is not checked here.
- **Day033, frame 609**: closed canopy, rows on the canopy, nothing judged between them; the tall grass verge is
  uncertain and has no rows.
- **Corn1, frame 831**: diagonal rows at two spacings, every row on the corn, no weed candidates; the frozen
  establishment reader holds 26 rows there too but the adaptive one reads both plantings.
- **Corn1, frame 884, the hardest**: rows on the corn at the top left; rows also traced across the bare, wheel-tracked
  headland where there is no corn; the red candidates along the field's end look like real small weeds; a large dense
  green patch in the field (it looks like a broadleaf weed patch) is left out as cover, so it is not reported at all.
- **Day033, frame 17, a real failure**: the left half is young rows of a broad-leaved crop (by eye soybean, not corn),
  read as corn rows; the corn itself, on the right, runs across them and is not read (one row direction per frame).

## Open failures

1. **Crop identity is not judged.** Rows of another crop (Day033 frame 17) are read as corn. A crop check (leaf shape,
   plant size against the corn profile, row spacing) is the next piece; nothing in the four readers can do it.
2. **One row direction per frame.** A second field planted across the first is uncertain and unread (mid photograph 17,
   Day033 frame 17). The plans could carry their own direction; the assessment already measures one per cell.
3. **A dense weed patch inside the field reads as cover** (Corn1 frame 884) and is not reported. It should become a
   weed-pressure region when it lies inside the field's rows rather than outside them.
4. **Rows run on into a weedy or wheel-tracked headland** where two plantings or the turning area meet the field's end
   (2024corn2 photograph 27, Corn1 frame 884); short spurious traces in a bare strip (mid photographs 86 to 91).
5. **Mid against closed canopy**: 5 of the 40 mid photographs are read as closed canopy; rows are drawn but the few
   between-row candidates there are not reported (abstaining, not a false alarm). The late reader drew two rows in a
   lawn on mid photograph 17.
6. **Speed**: 0.5 to 0.6 s more a photograph for the assessment, and a second planting doubles the reading time
   (2024corn2: 1.6 s against 0.6 s).
7. **No field truth.** Agreement with the frozen readers is measured; accuracy on the new behaviour (two plantings,
   mixed growth, holdout) is by eye on the sampled pictures only. 2024corn2 is no longer unseen; the holdout now is
   seen once.

## Where it is wired

- Photo Scout: "auto" is the default growth stage; the four stage readers stay selectable.
- Field Twin and the map: not wired; they still use the lattice pass.
- Benches: `npm run bench:adaptive -- --draw` (adaptive against the frozen readers, pictures);
  `scripts/rowCrop/assessStates.ts` (the assessment cell by cell, for speed changes that must not move it).
