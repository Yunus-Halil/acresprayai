# Corn stage readers: the benchmark of 2026-11-02 and one improvement plan per stage

Brief (Yunus, 2026-11-02): ingest everything about the corn detection, every stage and its outputs in
`directtestimagery`; benchmark every corn stage reader, find the weakest, turn that into one concrete engineering
plan; repeat for every stage. The Swardus Direct limits are in
[swardus-direct-limits-2026-11-02.md](swardus-direct-limits-2026-11-02.md).

Everything here was run on this machine (Ryzen 5 9600X, Node 24) at commit 32b32d2 on the four photo sets Yunus
gave (`directtestimagery/`, gitignored, all 5280 × 3956, EXIF stripped, so every metre rests on the assumed 76.2 cm
row spacing). Pictures of every read are beside the photographs in `<set>/outputs/row-crop/b1102-<stage>/`. There
are still no hand-counted plants or hand-drawn weeds for any of these photographs, so no number below is an accuracy
against truth: the evidence is internal consistency, the pictures, and what the code demonstrably cannot do.

## 1. What exists

One reader, `src/lib/rowCrop/readRowCrop.ts`, with a stage variant chosen by `RowCropParams.stage`; Photo Scout's
growth-stage selector passes it, the bench takes `--stage`. The whole row is the crop; only green clear of every
row's band is ever a finding.

| Stage | Corn | Variant | Code | Built | Photos given |
|---|---|---|---|---|---|
| Emergence | VE to V2, seedlings on bare soil | `"emergence"` | `emergence.ts` + `seedlingGreen.ts` | 2026-10-30 | `veryearlystage`, 23 |
| Establishment | V2 to V7, rows with open soil between | `"establishment"` (the default, frozen) | `readRowCrop.ts` | 2026-10-29 | `estabilishmentphase`, 15 |
| Mid | V8 to tasselling, canopy nearly meeting | `"mid"` | `readRowCrop.ts` (`MID`) + `fineSeedlings.ts` | 2026-10-29 | `midphase`, 40 |
| Late | closed canopy, VT onward | none | refused or misread by the other variants | not built | `verylatestagecorn`, 13 |

Also in `midphase/outputs`: the WeedsGalore checkpoint run as published (does not transfer), our DINOv2 segmenter
(`corn-seg-*`, best corn mask, calls almost no weeds) and its hybrid (`corn-seg-hybrid`), none wired into the app.
The map pass (orthomosaic) and the Field Twin still read corn with the lattice pattern pass, not this reader.

## 2. The benchmark

### 2.1 What was measured

For each set, the bench (`npm run bench:row-crop -- --photos <set> --stage <stage> --tag b1102-<stage>`) was run
fresh, its table compared with the recorded run, and the pictures of the photographs named below were looked at at
full resolution. Where a photograph set overlaps itself (the mid set 1 to 28 is one serpentine flight) that overlap is
the only truth-free check of a count, and it has not been used yet (section 4).

### 2.2 Results per stage

| Stage, variant | Photos | Rows read | Time per photo | Internal checks | What the pictures show | What it cannot do |
|---|---|---|---|---|---|---|
| Emergence | 23 | 23 of 23, 19 to 39 rows each, coherence 0.87 to 0.92 | 1.1 to 1.6 s | Fresh run matches the recorded one within the pale-seedling change: plants per frame +15 to +35 %, gaps halved (54: 300 to 175), rows the same or one more | Rows sit on the planter lines everywhere including the lens-bent edges; verge and road excluded. The orange gaps are mostly misses: in the dim left corner of 54 whole rows carry gaps where seedlings are visible by eye. Photograph 100's later planting (right third) forms no rows and its seedlings are listed as weeds (249) | Tell a missed pale seedling from a real skip; read two plantings in one frame; count against ground truth |
| Establishment | 15 | 15 of 15, 33 to 37 rows each | 0.5 to 0.8 s | Identical to the recorded run, number for number | Every visible row on the crop; 1 to 15 between-row patches each; the lawn boxed out. Rows run on across the headland lawn and the road in 34 and 63 (orange "gaps" on the lawn, 18 rows dropped on 63); weeds among the leaves are never seen | Stop a row at the field's edge; see a weed inside the band (USU recall 9 %); verify its stand estimate |
| Mid | 40 | 36 of 40 with a consistent direction and pitch (1, 2 hold no rows; 16 holds two plantings and reads 6 short lines across the wrong direction) | 4.3 s median, up to 5.4 s (0.2 s for a refusal) | Identical to the recorded run on all 40, number for number; the fine seedling pass is about 80 % of the time | Rows traced through the dense stand with 32 to 34 cm bands; the amber seedling layer sits on sprouts on the alley floor in 22 and 11; verge excluded; 0 to 1 escape a frame | Weeds among the leaves (USU recall 3 %); a second row direction in the frame; any precision figure for the 1,500 to 4,300 seedlings per frame |
| Late, run with establishment | 13 | "rows" on all 13, but in the verge and the lawn, not the corn | 0.4 to 0.7 s | The recorded run is reproduced: 467 to 1,103 "weeds" on 10, 21, 28 are the mown verge's grass; 10.7 to 19 m² of "weed" a frame | The canopy is solid green and is boxed out; rows are drawn through the grass beside the field; every tussock in the lawn is a red weed. Wrong on every frame, refused on none | Everything: the variant has no notion of a closed canopy |
| Late, run with mid | 13 | direction and pitch right on all 13 (coherence 0.44 to 0.51), but 7 to 25 rows kept of 30 to 80 traced: fragments | 4.1 to 5.0 s | No weeds at all (0 to 1 a frame): the verge test holds | The kept rows are short runs on the right lines (28, 68); in 9 two "rows" stand on the lawn with amber seedlings on them. The mid rule that a row stands only where its band is greener than its alleys fails at a closed canopy, so most of every row is cut | Keep a row across a closed canopy; report anything |

The late set is the weakest by a distance: it is the only stage whose read is confidently wrong rather than
incomplete, and nothing in the app refuses it. The order of the rest, by how far the drawn picture is from what a
farmer would accept: mid (the seedling layer is the one output with no check at all), emergence (gaps that are
misses), establishment (rows into the verge).

### 2.3 The late stage is readable: a probe

The failure is the binary mask: at a closed canopy every pixel is green, the row periodicity vanishes from a 0/1
mask, and the variants that need soil between the rows find none. The green *amount* still carries the rows. A probe
(scratchpad, numpy, the centre third of each photograph at a 2 cm work pixel, the across-row profile of raw excess
green detrended and autocorrelated between lags of 80 and 240 photo pixels):

| Photo | Direction | Autocorrelation at the pitch, excess green | Same, brightness | Lag (photo px) |
|---|---|---|---|---|
| 9 | 90° | 0.76 | 0.17 | 160 |
| 22 | 92° | 0.84 | 0.18 | 160 |
| 28 | 92° | 0.87 | 0.19 | 160 |
| 42 | 92° | 0.83 | 0.21 | 156 |
| 57 | 92° | 0.89 | 0.16 | 160 |

160 photo pixels at the assumed 76.2 cm is 0.48 cm a pixel, the same scale the other sets read. So a late variant
that reads the rows from the continuous green profile (plant centres greener than the shadowed alleys), not from a
thresholded mask, has a strong signal to stand on. Brightness alone does not (0.16 to 0.21).

## 3. Plan 1, the weakest: a late-stage variant

Goal: a `"late"` variant that draws the rows on a closed canopy, refuses what it cannot read with the reason, never
lists the verge as weeds, and reports what is worth reporting after canopy closure. Decision support only: no product,
no rate.

What a farmer can use at this stage, from the corn research (`docs/research/crops/corn/`): the between-row weed
window is shut (post window closes at V8 or 30 in), so between-row weed listing is wrong to even attempt; what still
matters is the stand's continuity (missing stretches, lodged or drowned patches show as breaks in the row texture
and as darker, lower canopy), the field's edge, and a stage estimate (VT shows tassels as texture). Everything else
(ears, silks, nutrient colour) is out of reach of a 0.5 cm RGB nadir photograph and stays out.

Steps, all in `src/lib/rowCrop/`:

1. **`late.ts`, `readLate(px, P, opts)`**, dispatched from `readRowCrop` like `readEmergence`; constants in `LATE`,
   never read by the other variants.
2. **Work raster** at 2 cm (the probe's scale; leaves are 5 to 10 cm wide, finer buys nothing).
   **Continuous green** per pixel: soil-relative ExGR *excess* (the `excess` array `greenMaskWithExcess` already
   returns), not the mask. High-pass over 1.5 m so a bright verge beside a dark field does not swamp the rows.
3. **Direction and pitch** from that continuous profile with the existing `rowDirection` and `pitchFromProfile`
   (they take any float raster). Refuse when the best autocorrelation is under 0.3 (the lawn and the sky) with the
   reason "no row pattern at any spacing: a closed field without visible rows, or not a row crop".
4. **Readable ground** by the mid rule (3 m windows coherent at the pitch); the lawn, the verge and a second field at
   another direction fail it. Those become `excluded` with the reason, drawn as grey outlines. Nothing is ever
   judged there.
5. **Rows** by the mid strip chain, but on the continuous profile with the troughs as the alleys (they are shadow
   troughs now, deep and regular, as the probe shows). Band half-width: half the pitch (the canopy meets).
6. **Report, per row:** the green excess along the row in 25 cm bins against the row's own median; a run under
   40 % of the median longer than 1 m is a **break** (drawn orange, as gaps are), reported as "the canopy is open or
   low here: a missing or lodged stretch, worth a look", never as a count of plants. Field-level: share of the
   readable ground in breaks, the number of rows, the pitch, and a canopy closure figure (share of ground pixels over
   the soil margin).
7. **No weeds.** The read says so in its notes: "After canopy closure weeds between the rows are not judged from
   above; the post window is closed (check your label)."
8. **Stage detection, first step** (Yunus, 2026-10-29: later, after the variants). A `suggestStage(px)` in
   `params.ts` from three numbers every variant already computes: vegetation fraction, the strongest periodicity on
   the binary mask, the strongest on the continuous excess. Emergence under 3 % green; establishment when the mask
   is periodic; mid when green is over 45 % and troughs are found; late when the mask is solid but the excess is
   periodic. Shown in Photo Scout as "looks like: late (change if wrong)", never silently applied.
9. **Where it shows:** Photo Scout's stage selector gains "late"; the bench takes `--stage late`.

Acceptance, all visible: rows drawn on the corn in at least 12 of the 13 late photographs (16-style frames excepted
and refused with the reason), zero red outlines on the verges of 10, 21 and 28, the lawn grey, the breaks drawn on
the three photographs where a stretch is visibly open by eye (22 bottom, 42, 60). A rendered late scene in
`scripts/cropProfiles/scenes.ts` (closed canopy with shadow troughs, a verge, a 2 m break) pins the test:
rows within 3 cm, the break found, the verge refused. Effort: one day; the mid variant's pieces are all reusable.

## 4. Plan 2: mid stage, the unchecked seedling layer and the second direction

Weakest point: the 1,500 to 4,300 seedlings per frame have no check of any kind, and Yunus does not want a labelling
step forced on him ([no-labelling-push]). The mid set holds its own check: photographs 1 to 28 are one serpentine
flight with 60 to 80 % overlap, so the same alley floor is read in two to four frames. A seedling found in frame A
and not in frame B at the same ground spot is either a miss or a false find; the agreement rate between frames is a
precision-and-recall proxy that costs no labels. The same check serves the establishment stand estimate.

1. **Overlap consistency bench** (`scripts/rowCrop/overlapBench.ts`): pairs of consecutive photographs registered to
   each other by phase correlation on the quarter-size grey (the soil-tie code in `directGeoref/fft.ts` and
   `soilTies.ts` does exactly this; no GPS needed because the registration is image to image), then every seedling,
   between-row plant and escape of A projected into B and matched within 4 cm. Reports: share of A's findings seen
   in B, by class, per pair, and draws the two frames side by side with matched (green) and unmatched (red) marks.
   A number for the first time, from the photographs alone. Expected on the current code: well under half for
   seedlings (the pass is at the pixel limit); the figure sets the target for the next two steps.
2. **Second row direction in one frame** (photo 16, and any headland): the 3 m coherence windows already carry the
   best direction per window if `rowDirection` is run per window (coarse, 10° steps, then refined once per region).
   Cluster the windows into regions of one direction (connected, within 5°), read each region as its own frame
   (direction, pitch, strips, bands), and refuse regions under 10 m². The drawn lines in 16 then follow both
   plantings. The twin builder's corn rows (not built) will need this too.
3. **Speed:** 80 % of the 5 s is `fineSeedlings` over the whole 21 MP frame. Run it only over the judged ground
   (the `judgeWork` mask, typically 40 to 60 % of the frame), skip the full-frame flood for `CORN` where the band
   mask already says corn, and reuse the soil grids. Target 2 s a photograph, bit-identical seedling list (test).

Acceptance: the overlap bench reports an agreement rate per class on the mid flight; after step 2, photo 16 shows
rows on both plantings; after step 3, the b1102-mid table is identical except the ms column. Effort: two days.

## 5. Plan 3: emergence, gaps that are misses (built 2026-11-02 as emergence V2: corn-row-reader.md)

Weakest point: the gaps. 67 to 181 gaps and 30 to 95 m of "no seedling" per frame, most of it in the vignetted
corners and the sunlit rows where the seedling mask loses pale leaves, as the pictures of 54 show. A farmer reading
"181 gaps" would replant; the read says "not a confirmed skip" in its notes, which nobody reads over a picture.

1. **A second look inside every gap** at the photo's own pixel: along the fitted row line through the gap, a 6 cm
   band, with the seedling mask's thresholds relaxed by a third (strong 11, weak 7, bright 20) and a size floor of
   6 px. Anything found is a **probable seedling** (drawn hollow green), the gap is then split around it. What
   remains is a **gap**. Report both counts; the picture distinguishes them. Because the search is confined to the
   planter line, the looser threshold cannot add weeds off the rows.
2. **Vignetting**: the corners are darker by up to 40 % on these frames. Measure the frame's radial brightness fall
   on soil pixels (block medians by radius) and flatten it before the mask; the thresholds then hold in the corners
   the way they hold in the centre. One pass over the preview-size raster, cheap.
3. **Off-row listing**: the new mask tripled the "weeds" on 100 (89 to 249), 72 and 40: pale specks on a second
   planting's furrows and at the frame edges. Keep the 2 cm² floor for a weed but require, for anything under
   6 cm², a strong pixel (the hysteresis seed) and no furrow line through it (a furrow line is a row of such specks
   at the pitch: when the specks off the rows themselves form a comb at the pitch, they are reported as "a second
   planting just emerging, not read", drawn grey, not red).
4. **The lens coefficient** is fitted per photograph (0.06 on this camera). It is a property of the lens: fit it on
   the first three frames of a set in Photo Scout and the bench and hold it for the rest; the per-frame search
   (41 coefficients × 7 directions) is a third of the read's time.

Acceptance: on 54 the gaps in the lit centre rows stay and the corner rows lose most of theirs (count the gap
metres per frame before and after; the picture shows hollow green marks where seedlings are visible by eye); 100
reports its right third as a second planting; the b1102-emergence rows and plants change by under 2 % elsewhere.
Effort: one day.

## 6. Plan 4: establishment, rows that do not stop (built 2026-11-02: corn-row-reader.md, "where the field ends")

Weakest point: the rows run off the field. In 34 and 63 the cyan lines cross the headland lawn and the road, carrying
orange gaps on the lawn and dropping rows, and the between-row cover figure includes that ground. The in-field read
is right everywhere looked at.

1. **Row ends by the standing test**, ported from the mid variant (`rowStandsAt`: band green at least 25 % and
   1.5 times the alleys over 1.5 m) with establishment constants (band 15 %, 2 times the alleys, since V3 rows are
   thin lines on soil): each row keeps its longest standing run, is extended at most one strip beyond it, and the
   rest is cut. The lawn is then outside every row and no gap is drawn there. The mid variant already proves the
   rule drops no in-field row.
2. **The band's edge at the frame's edge**: a row's band is one width along the row; at the frame edge where the
   lens bends the row the band is the same, fine; nothing to do.
3. **Stand estimate** (marked unverified for a month): the overlap bench of plan 2 gives it a consistency figure for
   free on any establishment flight with overlap; the 15 photographs here are single frames, so it waits for a
   flight.

Acceptance: 34 and 63 show no row on the lawn or road, no gap outside the field, between-row cover computed over the
field only; the other 13 photographs unchanged number for number (the establishment tests pin them). Effort: half a
day.

## 7. Order, and what Yunus sees after each

1. Late variant (plan 1): the 13 closed-canopy photographs read right, "late" in the Photo Scout selector, a stage
   suggestion line.
2. Mid overlap bench + second direction (plan 2): the first agreement number for the seedling layer, photo 16 read.
3. Emergence second look (plan 3): gaps split into probable seedlings and gaps on 54.
4. Establishment row ends (plan 4): no rows on the lawn in 34 and 63.

Each plan ends with pictures beside the photographs and a Photo Scout read; none depends on labels. The segmenter
line of work (weeds among the leaves, USU recall 9 % and 3 %) is not in this list: it is the one thing position rules
cannot reach and it needs either hand-checked outlines or a model trained on our own frames, both Yunus's call.
