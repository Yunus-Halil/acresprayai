# MaSC-assisted corn row reconstruction (2026-11-04)

Question (Yunus, 2026-11-04): can MaSC's plant positions recover planting rows the green-mask reader misses (dark
seedlings, low contrast, thin stands), as independent evidence beside the reader, without replacing it and without
treating a MaSC box as proof of maize? Nothing here is wired into the app; Photo Scout and the Field Twin do not import
any of it.

## What was built

- `src/lib/rowCrop/plantRows.ts` (not imported by the app; 16 unit tests in `src/test/plantRows.test.ts`):
  - `rowsFromPoints`: rows from plant centres. Direction from the angle at which the centres pile into the fewest
    across-bins; strips along the rows, clusters across, linked strip to strip. A row needs >= 6 plants, plants tight on
    its line (median residual <= 12 % of the spacing), dense along it (>= 25 % fill), and a neighbouring row at a
    spacing shown by at least two row pairs (or twice it). Rows span their plants only and are cut at gaps over 2.5
    spacings (no rows through headlands or roads). Several spacings are kept (one per planting). Scattered points and a
    single line of plants make no rows (tested).
  - `hybridRows` (C, reader first): the reader's rows kept; plant rows that duplicate a reader row confirm it; plant
    rows on the reader's lattice within two rows of a corn row are recovered corn rows; a plant row beside a reader row
    (closer than a spacing allows) replaces it only where the reader row holds <= 25 % of the plant row's detector
    plants over their shared stretch (the reader row was drawn off the plants); plant rows away from the reader's rows
    with neighbours of their own are planted rows, crop unconfirmed; everything else rejected.
  - `detectorLedRows` (D, detector first): MaSC's own rows where they stand; the reader's rows kept only where no MaSC
    row lies within a spacing of them (MaSC is blind past V10). A MaSC row inside the reader's corn ground is labelled
    "corn row", outside it "planted row, crop unconfirmed".
- `scripts/rowCrop/plantRowBench.ts`: the four approaches (A reader only, B MaSC rows only, C, D) on the same photos,
  scored against hand-labelled plants; pictures per approach in the results hub (reader "Plant rows").
- `scripts/rowCrop/rowrefPrepare.py`: four plant-labelled sets in one layout (D:\swardus-research\datasets\rowref).
- MaSC inference was run once per set (`masc_detect.py`, factor 3, NMS IoU 0.3, confidence 0.3) and reused.

## How it is scored

Reference rows are built from the labelled plant centres by the same `rowsFromPoints` (a mild bias towards B and D;
the plants-on-a-row measure does not depend on them). A labelled plant is on a row when within a quarter of the
reference row spacing of one. A drawn row is true when at least half its length lies within that of one reference row.
"Lost" counts labelled plants a reader row held that an approach leaves on no row (errors MaSC introduces). Weeds are
not labelled except on USU: "crop called weed" is a reader weed candidate on a labelled plant.

Sets: **MatchPlant** (27 maize frames, every plant boxed; independent), **UAVmulticrop maize** (51 French plots,
independent), **MSDD 2022 test** (696 Missouri tiles; MaSC's own test split, so it flatters MaSC), **UAVmulticrop sugar
beet and sunflower** (NOT corn: the crop-identity test), **USU** (Utah, weed boxes: real weeds taken off the list), and
our own emergence, Corn2, establishment and mid photos (no labels: counts and pictures).

## Results

Labelled plants on a row (A reader / B MaSC rows / C hybrid reader-first / D detector-led):

| Set | A | B | C | D | crop called weed A / C / D | plants lost B / C / D |
|---|---|---|---|---|---|---|
| MatchPlant (independent) | 71.0 % | 94.7 % | 83.1 % | **95.9 %** | 570 / 365 / **17** | 258 / 32 / 149 of 6,181 |
| UAVmulticrop maize (independent) | 38.3 % | 44.9 % | 50.6 % | **54.5 %** | 188 / 188 / 151 | 512 / 6 / 10 of 2,012 |
| MSDD all (MaSC's test split) | 49.0 % | 80.0 % | 64.3 % | **82.3 %** | 137 / 133 / **71** | 1,550 / 1 / 620 of 19,840 |
| MSDD V2-V4 (dark seedlings) | 27.1 % | 72.0 % | 58.0 % | **72.8 %** | 16 / 16 / 1 | 105 / 0 / 33 of 2,483 |
| MSDD tiles the reader read nothing on (13,204 plants) | 0 % | 69.8 % | 37.5 % | 69.8 % | | |
| Sugar beet (NOT corn) | 83.6 % | 58.6 % | 83.6 % | 87.7 % | 11 / 11 / 4 | |
| Sunflower (NOT corn) | 71.8 % | 14.7 % | 71.8 % | 71.7 % | 259 / 259 / 259 | |

Rows: on MatchPlant 48 % of the reader's drawn rows are false (it draws rows on the soil between the maize rows, about
the right spacing and half a row out); B 4 %, C 40 %, D 24 % (D's false rows are the reader pieces it keeps at frame
edges). On MSDD: A 51 %, B 2 %, C 44 %, D 35 %. Reference rows recovered on MSDD: A 57.7 %, B 94.7 %, C 76.9 %,
D 95.6 %. Row position, where a row lies on a reference row: median offset A 1.8-2.0 %, B and D 0.8 % of the spacing.

USU (Utah, 8,668 labelled weeds): of the 302 reader weed candidates on a labelled weed, C takes 0 off the list and D
takes 5 (1.7 %); D takes 150 of 3,261 candidates off in all.

Cost (this laptop's CPU, 10 threads): MaSC inference about 4.7 s per 20 MP photo (0.4 s per 1920 px tile, 0.8-1.5 s
per French plot), peak memory 1.1-1.3 GB; the row steps B, C, D take under 10 ms. The reader itself takes 0.3-4 s.
MaSC scale 2 versus 3 on the French maize: no material difference (54.5 % vs 53.8 % for D).

## Findings

1. **Plant positions recover rows the colour reader cannot see.** On the MSDD tiles where the reader read nothing
   (mostly dark V2-V4 seedlings), D puts 70 % of the labelled plants on a row, from 0 %. On both independent maize sets
   D beats the reader (MatchPlant 71 -> 96 %, French maize 38 -> 55 %), and its rows sit closer to the real rows.
2. **The reader is often confidently wrong on frames unlike ours, and reader-first fusion (C) cannot fix that.** On
   MatchPlant and MSDD about half of the reader's drawn rows are false; C keeps them and gains far less than D.
3. **Detector-led fusion (D) is the better geometry wherever MaSC sees plants (V2-V10)**, and falls back to the reader
   past V10. It loses some plants the reader's rows held (149 of 6,181 on MatchPlant, 620 of 19,840 on MSDD): reader
   rows over plants MaSC did not box.
4. **Crop identity is unsolved, and the "corn ground" rule confirms nothing.** MaSC boxes sugar beet (rows on 43 of 60
   plots) though rarely sunflower (7 of 78); the reader reads beet and sunflower rows too. D labels 115 sugar beet rows
   "corn rows". A plant row must be reported as a planted row until the crop is confirmed by something else.
5. **Weeds**: on MatchPlant D takes 553 corn plants off the weed list (570 -> 17) and 12 unjudged candidates; on MSDD
   137 -> 71.

## Verdict

The hybrid meaningfully improves row reconstruction on independent fields, in the detector-led form (D), not the
reader-first form (C). It is not ready to integrate as "corn rows": nothing in it tells corn from sugar beet. An
integration plan is below, gated on a crop-identity check; the current reader stays the app's reader until then.

## Integration plan (when approved)

1. Runtime: MaSC weights are CC BY 4.0, the YOLOv9 code GPL-3.0. Export the weights to ONNX and run them with
   onnxruntime (no YOLOv9 code shipped); confirm with a licence review that the exported graph carries no GPL code
   before shipping. Keep it a separate, optional service (like the local weed service) until then.
2. Geometry: D in `readCornAdaptive` behind a flag: MaSC rows where it holds rows, reader rows elsewhere; reader's
   green judgement redone against the final rows (D currently only takes candidates off the list; it does not re-judge
   green on rows it replaced).
3. Crop identity: rows from plant positions are "planted rows" in every report until confirmed (operator's crop entry,
   the corn check model on the row's plants, or a seedling-shape check); never "corn" from MaSC alone.
4. Gates before turning it on: the eye test on our own flights, and the four benches here re-run with no regression in
   plants lost.

## Our photos (no labels)

| Set | rows A / B / C / D | D: MaSC corn rows + crop unconfirmed / reader pieces kept | weed candidates off the list C / D |
|---|---|---|---|
| Emergence (22 photos) | 636 / 636 / 636 / 637 | 636 + 0 / 1 | 0 / 182 of 641 |
| Corn2 emergence (63) | 1,687 / 1,320 / 1,687 / 1,445 | 1,315 + 5 / 125 | 0 / 11 of 88 |
| Establishment (15) | 531 / 499 / 531 / 553 | 499 + 0 / 54 | 0 / 0 of 20 |
| Mid (40) | 1,065 / 98 / 1,074 / 1,179 | 43 + 55 / 1,081 | 0 / 0 of 705 |

On our own flights the reader is already right where MaSC sees plants: MaSC's rows land on the reader's rows, and D
changes the geometry little. At emergence D takes 182 weed candidates off the list; an eye check of 16 of them, cut from
the originals, found about 12 corn seedlings on their row and 4 too blurred or dark to judge, none clearly a weed. At
mid D keeps the reader's rows (MaSC is blind past V10) and adds the neighbouring soybean planting's rows as crop
unconfirmed (55). Photo 100's dark later planting is read as rows by MaSC.

Pictures: results hub, reader "Plant rows", one run per set and approach, plus the evidence sheets.
