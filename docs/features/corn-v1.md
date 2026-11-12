# Corn V1 (2026-11-04)

The production corn read in Swardus: one drone photograph in; rows, what each row is, and findings out, each with the
evidence behind it. Code `src/lib/rowCrop/cornV1.ts` (+ `greenPoints.ts`); in the app through Photo Scout (crop corn,
growth stage "auto"). Decision support only: nothing here decides a treatment.

Since 2026-11-12 the seedling mask also sees leaves darker than their soil, on photographs the green read does not
already read as bands or a canopy: [corn-dark-seedlings.md](corn-dark-seedlings.md). The tag `corn-v1.0` and
everything measured below are the read without it (`baselineSeedlings`).

## The architecture and why it won

Two independent reads of where the rows run, fused so that the one fit for the ground decides, and findings drawn
only from rows the evidence holds:

```
photo ──► green read   (adaptive.ts: regions judged, each read by its stage reader: emergence / establishment / mid / late)
      └─► plant read   (greenPoints.ts: plants located on the soil, no model ──► plantRows.ts: rows where many line up)
                 │
                 ▼
          fusion (cornV1.ts)   plant rows lead where they stand; a green row with a parallel plant row closer than a
                 │             neighbouring row would be is dropped there (the plants contradict it)
                 ▼
          confidence per row   high: both reads agree | a row one read missed between two rows both agree on | green alone
                 │             on band ground (establishment/mid, >= 70 % of the row on green, >= 4 spacings long) | late
                 │             canopy with >= 85 % on green | a plant DETECTOR's rows alone (server tier only)
                 ▼             medium: anything else (green alone over seedlings; plants located on the green alone)
          identity             corn: entered as corn + high + main planting + a spacing corn can be planted at
                 │             probable crop: every other planted row      unknown vegetation: green on no row
                 ▼
          findings             weed candidate: between rows beside a corn row (never on a row's line, never on the
                               line where an unread row of the planting runs); stand gap: on a corn row both reads
                               support, with no plant located inside it; everything else withheld and drawn grey
```

Why this and not the alternatives (all measured on hand-labelled maize from other people's fields, see the results):

- **The green read alone (the app until today) is confidently wrong on unfamiliar frames.** About half its rows on
  MatchPlant, MSDD and the French plots lie on the soil between the maize rows; every weed and gap found from them is
  wrong (MatchPlant: 362 of its 629 stand gaps false, 312 maize plants called weeds).
- **Plant positions put rows on the plants** (MaSC-assisted geometry, earlier today: MatchPlant 71 -> 96 % of plants
  on a row). The question for production was whether that needs a model. It does not need one to fix the geometry:
  plants located on the green with no model put the French plots' plants on rows as well as MaSC (56 % vs 55 %), and
  in the fusion they drop the green read's wrong rows and take the maize off the weed list. MaSC is better on
  MatchPlant and MSDD's dark seedlings (rows from its plants are false 2-4 % of the time, from green points 17-30 %),
  so V1 trusts green-point rows only where the green read agrees, and keeps a detector hook for MaSC as a server tier.
- **Evidence-gated findings are what make it safe.** The brief's rule, a questionable row must not become a false gap
  or weed, is the design: a stand gap needs both reads to see nothing; a weed needs a corn row beside it and a place no
  row of the planting runs.
- **Crop identity rests on the operator's entry and the reads agreeing, because nothing measured tells corn from
  another row crop by its look** (below). V1 never says "corn" from pixels alone.

## Components: retained, replaced, discarded

| Component | Decision | Why |
|---|---|---|
| Adaptive green read (assess + stage readers: emergence V2, establishment + field edge, mid, late) | **Retained** as the green read | The right instrument where plants grow into bands and canopies; already eye-validated on our flights |
| `rowsFromPoints` (plant rows, multiple spacings, cut at roads/headlands) | **Retained**, now production | Rows where many plants line up; scatter makes none |
| Plants located on the green (`greenPoints.ts`, new) | **Added**, production plant read | No model, no download, no licence; runs in the browser |
| Detector-led fusion (variant D) | **Retained** as the fusion's geometry rule | Beat the reader-first hybrid on every maize set |
| Reader-first hybrid (variant C) | **Discarded** | Keeps the reader's wrong rows; gained far less |
| MaSC (YOLOv9 maize seedling detector) | **Kept as an optional server tier, NOT shipped** | Best plant read measured (V2-V10), but YOLOv9 code is GPL-3.0, 4.7 s and 1.1-1.3 GB per 20 MP photo on CPU; `readCornV1(..., { detectorPoints })` takes its positions |
| Corn check v1 (DINOv2-small + head) | **Discarded from V1** | As crop identity it does not separate (French plots, plant-level corn share >= 0.9: maize 58 %, sugar beet 15 %, sunflower 21 % of plots pass); its weed clearing is done better by the plant read; ~80 s per photo on CPU |
| Leaf-shape crop check (solidity, leaf width) | **Discarded** (measured) | Maize 0.70-0.78 solidity, sugar beet 0.66-0.75: no separation at drone pixels |
| Row spacing as crop evidence | **Weak gate only** | Corn is planted at 38-91 cm, beet at 45-50, soy at 19-76; a pixel size from the flight height is 10-20 % off. Only a spacing corn is never planted at (< 29 cm, > 114 cm) rules corn out; between corn's own spacings it is a note |
| "Corn on an unsupported row" (adaptive) | **Retained**, extended | V1 adds the slot rule: green where the planting's next row runs is unknown vegetation |

## Crop identity

Three classes, never more than the evidence holds:

- **Corn row** (cyan): the field is entered as corn, the row is high confidence, it is in the photo's main planting, and
  the spacing is one corn can be planted at.
- **Planted row, crop not confirmed** (amber dashes): every other planted row: a second planting beside the main one
  (the soybean planting beside corn on mid photo 17), rows only one read supports, rows of a field not entered as corn.
- **Unknown vegetation** (grey outlines): green on no row that is not a confident weed candidate.

A sugar beet or sunflower field wrongly entered as corn is read as corn rows (measured below): no visual evidence we
have separates them. The operator's crop entry is the identity; the read only ever withholds it.

## Operating envelope (what V1 is for)

V1 is **review-only decision support**: it draws what it read for a person to check. Crop identity is the operator's
entry; no weed candidate or stand gap becomes a treatment, a prescription or a grade on its own, and nothing outside
Photo Scout (developer mode) uses it.

| | In the envelope | Outside it (V1 says little or nothing, by design) |
|---|---|---|
| Camera | Nadir (straight down) drone photographs, a mapping flight | Oblique photographs; handheld close-ups |
| Height / pixel | Mapping height, about 0.3-1.5 cm per pixel, 10+ rows in the frame | Close-ups (a few rows in the frame, under ~0.1 cm per pixel); coarser than ~2 cm per pixel (seedlings vanish) |
| Crop and stage | Corn in rows, entered as corn by the operator, emergence to about V10 on soil; mid and late canopy rows | Another row crop entered as corn (read as corn: the entry is the identity); broadcast or drilled cereals |
| Scene | A field with bare soil between the rows | Severely obscured canopy, standing water, heavy residue over the rows, solid weed cover |
| Light | Ordinary daylight, the lens's dim rim included | Night, deep shadow across the frame |

## Major remaining limitations (measured at 507bc30)

**Plants withheld from confirmed corn rows.** Findings only come from rows called corn; the rest are drawn as planted
rows with the crop not confirmed, and nothing is reported on them. Share of the hand-labelled plants:

| Set | on any row V1 draws | on a CONFIRMED corn row | withheld (on a row, not confirmed) | on no row at all |
|---|---|---|---|---|
| MatchPlant (maize, 27 frames) | 78.3 % | 25.7 % | 52.6 % (67 % of the plants on rows) | 21.7 % |
| French maize (49 plots) | 60.0 % | 35.6 % | 24.4 % (41 %) | 40.0 % |
| MSDD Missouri (696 tiles) | 74.5 % | 41.3 % | 33.2 % (45 %) | 25.5 % |
| (the reader before V1, for comparison) | 71 / 40 / 49 % | the same: it called every row corn, about half of them wrongly | 0 % | |

So on fields it has never seen, V1 confirms the rows under a quarter to two-fifths of the plants and withholds the rest;
with MaSC's plants (server tier, not shipped) it confirms 54-79 %. On our own flights almost every row is confirmed
(emergence 636 of 676, establishment 517 of 532).

**Genuine weed detections lost.** The reader before V1 reported every off-row green patch beside any row, right or
wrong; V1 reports only those beside confirmed corn rows and off the planting's lattice:

| Set | real weeds the reader hit | of them V1 still reports | lost | candidates reported A / V1 | share that are real weeds A / V1 |
|---|---|---|---|---|---|
| USU Utah (labelled weeds, weed-heavy V5-V7) | 302 | 94 | **69 %** | 3,261 / 551 | 9 % / 17 % |
| (V1 with MaSC's plants) | 302 | 133 | 56 % | 3,261 / 799 | 9 % / 17 % |

Without weed labels on our own flights, the counts: emergence 49 -> 44, establishment 20 -> 20, mid 705 -> 577,
Corn2 88 -> 27 (not checked by eye). Where the loss comes from: weeds growing along the rows are lined up by the plant
read like crop, and weeds beside rows V1 cannot confirm are withheld as unknown vegetation. The withheld candidates are
still drawn (grey); none is deleted.

**Also:** crop identity cannot be told from the pixels (a beet or sunflower field entered as corn reads as corn rows);
false stand gaps remain 12-16 % on Missouri and MatchPlant; accuracy on our own flights is not measured (no labels).

## Results

Final run at code 507bc30 (`D:\swardus-research\cornv1-run.sh`; pictures in the results hub, reader "Corn V1 (production)").
A = the adaptive reader as the app ran it until today; **V1 = Corn V1 as shipped** (plants located on the green, no
model); V1+MaSC = the same fusion with MaSC's plants (server tier, not shipped). The fields entered as corn throughout.

**Hand-labelled maize from other people's fields** (the fair tests: none of it was used to build anything):

| | MatchPlant (27 frames) | French maize (49 plots) | MSDD Missouri (696 tiles; MaSC's own test split) |
|---|---|---|---|
| False share of CORN rows (the rows findings come from), A / V1 / V1+MaSC | 48.2 / **17.5** / 4.7 % | 50.7 / **8.1** / 5.2 % | 51.3 / **8.7** / 3.8 % |
| Maize called weed (reported candidates on a labelled plant) | 312 / **1** / 4 | 83 / **24** / 25 | 137 / **55** / 51 |
| False stand gaps (on no real row, or with a plant inside) | 362 of 629 / **12 of 78** / 13 of 84 | 33 of 133 / **6 of 71** / 6 of 70 | 451 of 2,562 / **183 of 1,470** / 225 of 1,730 |
| Labelled plants on any drawn row | 71 / **78.3** / 96.5 % | 40.1 / **60** / 57.1 % | 49 / **74.5** / 82.7 % |
| Labelled plants on a CORN row | 71 / **25.7** / 65.3 % | 40.1 / **35.6** / 54.1 % | 49 / **41.3** / 78.9 % |

Read it as: V1 finds far more of the plants' rows, and the rows it calls corn (the only ones findings come from) are
right 82-92 % of the time against the reader's 49-52 %. The price is coverage: where the two reads cannot agree V1
says "planted row, crop not confirmed" and reports nothing there (MatchPlant: a quarter of the plants on corn rows).
Two UAVmulticrop maize label files are broken (boxes span the plot) and are not scored.

**Weeds, Utah (USU, 64 weed-heavy V5-V7 mosaics, 8,668 labelled weeds):** reported candidates A 3,261 / V1 551 /
V1+MaSC 799; of them on a labelled weed 302 / **94** / 133 (precision 9 % -> 17 % -> 17 %). V1 reports a sixth as many
candidates, about twice as often a real weed, and keeps under a third of the reader's real hits (see Limits).

**Crops that are not corn, entered as corn (UAVmulticrop):** sugar beet: V1 calls 128 of 189 rows corn; sunflower:
225 of 388. Expected and stated: nothing V1 measures tells them from corn by their look.

**Our own flights (no labels; counts and pictures):**

| Set | rows A / V1 (of which corn) | weed candidates A / V1 | stand gaps A / V1 |
|---|---|---|---|
| Emergence (22 photos) | 636 / 676 (636) | 49 / 44 | 979 / 798 |
| Corn2 V3-V5 (63) | 1,687 / 1,444 (1,092) | 88 / 27 | 4,627 / 3,635 |
| Establishment (15) | 531 / 532 (517) | 20 / 20 | 56 / 53 |
| Mid (40) | 1,065 / 1,499 (1,032) | 705 / 577 | 120 / 62 |
| Late (13) | 296 / 554 (333) | 0 / 0 | 5 / 4 |

On our establishment field V1 keeps the reader's findings almost exactly (it was already right there); at emergence it
keeps the rows as corn and withholds the gaps neither read confirms. The extra rows at mid and late are plant rows on
the canopy texture, drawn amber (not corn), never a source of findings.

**Decision experiments behind the design (same day):**

| Question | Measured | Decision |
|---|---|---|
| Plants located on the green vs MaSC as the plant read | rows on labelled plants (fusion): French 56 vs 55 %, MatchPlant 77 vs 96 %, MSDD 73 vs 82 %; rows from plants alone false 17-30 % vs 2-4 % | green points ship (no model); their rows alone are medium confidence; MaSC kept as a server tier |
| Leaf shape as crop identity | solidity maize 0.70-0.78, beet 0.66-0.75 | discarded |
| Corn check v1 as crop identity | French plots passing at corn share >= 0.9: maize 58 %, beet 15 %, sunflower 21 % | discarded |
| Green rows alone, by what holds them (MatchPlant + MSDD) | establishment/mid at support >= 0.7: right 67 of 77; emergence alone: 47 of 211; "late" on seedling tiles: false 66 of 67 | band rows at 0.7 trusted, emergence alone not, late only at 0.85 |
| Rows on the agreed rows' lattice (a row one read missed) | chained: MatchPlant false 18 of 24; only between two agreed rows: no rise | only between two agreed rows |

## Limits, uncertainty behaviour and regressions

- **Coverage on unfamiliar frames.** Where the plant read and the green read do not agree, V1 reports nothing: on
  MatchPlant a quarter of the labelled plants sit on corn rows (65 % with MaSC). That is the conservative trade the
  brief asked for, and the main thing MaSC as a server tier would buy back.
- **Weed recall in weedy establishment fields** (Utah): plants located on the green also line up weeds that grow along
  the rows, so V1 keeps 94 of the reader's 302 real-weed hits (MaSC plants: 133). Precision doubles; recall falls.
- **Crop identity is the operator's entry.** A sugar beet or sunflower field entered as corn is read as corn rows. The
  spacing check only rules out spacings corn is never planted at (< 29 cm, > 114 cm); between corn's spacings it is a
  note (pixel sizes from the flight height are 10-20 % off; Utah's put 76 cm rows at 109 cm).
- **Close-range photos** (a few rows in the frame, ~0.05 cm per pixel): no row structure to read; V1 says nothing
  rather than guess (a shrunken copy was tried: it read tillage marks as rows, so it is not done). Built for mapping
  flights (10-30 m, 20+ rows per frame).
- **Gaps:** still 12 % false on MSDD (183 of 1,470) and 15 % on MatchPlant; reported only where both reads see
  nothing, but a plant both miss (dark, under a neighbour's leaf) still makes one.
- **Uncertainty behaviour:** every row carries its evidence (both reads, plants only, green only) and confidence; every
  withheld finding is drawn grey with its reason in the read (crop on a row, unknown vegetation, gap not confirmed).
- **Regressions against the reader:** fewer findings wherever it is unsure (above); on our own establishment field none
  measured (20 / 20 weeds, 53 / 56 gaps); Corn2 weed candidates 88 -> 27 (not checked by eye).
- **Accuracy on our own flights is not measured** (no labels there): counts and pictures only; owed: the eye test.

## Cost and deployment

Per 20 MP photo on this laptop's CPU (Node; the browser is similar or a little slower): green read 2-6 s, plants
located 2-2.7 s, fusion under 0.3 s: about 1.6x the reader alone. Memory: the photo at full size (84 MB RGBA) plus the
seedling mask (20 MB) and work buffers; no model, nothing downloaded. Photo Scout now reads corn at full size
(seedlings are a centimetre wide; it used to shrink to 4,096 px) and runs on the page's thread: the page pauses while
a photo is read.

For millions of acres: everything shipped is plain TypeScript, licence-clean (our code), no GPU, and per photo, so it
runs in a worker or on any server. The plant read and the emergence reader both compute the same seedling mask:
sharing it saves ~2 s per photo (not done yet). MaSC as a server tier: export the CC BY 4.0 weights to ONNX and run
them with onnxruntime (no GPL YOLOv9 code shipped), after a licence review of the exported graph; ~0.4 s per 1,920 px
tile on CPU, much less on a GPU; it plugs in as `readCornV1(..., { detectorPoints })`.

Nothing here decides a treatment: the outputs are rows, identities and candidate findings for a person to look at.

## In the app, and how to test it

1. Run the app (`npm run dev`), open Photo Scout (`/app/photo`; reload with Ctrl+Shift+R if it was open).
2. Drop corn photos on the page. Nothing to set: the crop starts on Corn, the growth stage on "auto: Corn V1", and
   each photo is read as soon as it is added (a few seconds each; the page pauses while it reads).
3. Click a photo in the list to see its drawing.
4. Look for: cyan corn rows on the plants; amber dashed rows where the crop is not confirmed (a second planting, rows
   only one read holds); red outlines only between corn rows; orange gaps only on corn rows; grey outlines and thin
   grey dashed gaps = withheld (crop on a row, unknown vegetation, gaps not confirmed). The summary's first three
   lines (Corn V1, Behind the rows, Withheld) give the counts.
5. To compare with the reader before V1: open More options and choose a growth stage by hand (that stage's reader alone, unchanged).

Benchmark: `npx vite-node scripts/rowCrop/cornV1Bench.ts --images <dir> --out <dir> [--labels <dir>] [--usu <dir>]
[--masc <dir>] [--points <dir>]`; the run behind this page is `D:\swardus-research\cornv1-run.sh`, pictures in the
results hub, reader "Corn V1 (production)" (`npm run hub:results`).

## Toward Swardus Direct / Field Twin

Built 2026-11-04: Corn V1 over a whole field, every photograph's read projected through Direct's camera frames and the
evidence of overlapping photographs combined; measured on three real overlapping corn flights. See
[corn-v1-field.md](corn-v1-field.md). Still to build: the corn stage in the Field Twin builder, the twin bundle's corn
section and the viewer layers; our own corn flights need camera headers first.
