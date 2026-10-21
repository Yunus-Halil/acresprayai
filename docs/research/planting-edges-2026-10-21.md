# The planting's edges: how fields are laid out at their ends, and what the literature does about it (2026-10-21)

One web sweep on 2026-10-21, after the operator saw a row stop three small trees short of the track while its
neighbours ran on ("understand the pattern at the edges and perimeters, where the other rows stop, find the
averages"). Sources inline; "not found" where searches came up empty; figures from a search summary only are marked.
What was built from it is in `docs/features/planting-layout.md` ("The planting's edges").

## Practice priors

| System | Rule | Numbers | Source |
|---|---|---|---|
| Row crops | Headland is a small multiple of the implement width; growers plant 2 to 3 planter passes around the perimeter | 9 to 12 m for a 4 or 6 row planter; "at least 12 rows or 2 planter widths" | Wikipedia "Headland (agriculture)"; grower forums (anecdotal) |
| Row crops, guidance | Headland = track spacing × passes; the first headland track sits half a track inside the boundary; interior passes are driven perpendicular to the headland | k × implement width, k integer | John Deere AutoTrac / AutoPath on-screen help |
| Row crops, section control | The last seed of an interior row lands at the intersection with the last headland row ("plant-to-row"); operators may set a skip or an overlap | example skip 15 cm | John Deere Section Control page and tuning procedure |
| Row crops, point rows | A row that meets the boundary at an angle stops where it meets it, row by row, so ends are staggered along the oblique boundary; without section control the wedge is double-planted | double-planted area 0.1 to 20% of a field (46 Tennessee fields); mean 2.1% with a 38 ft planter | AgGateway glossary; US 8,296,052; Prather, Esri UC 2012; Jernigan et al., Beltwide 2011 |
| Row crops, headlands | Headlands yield less and are themselves planted, parallel to the boundary | corn grain −14% (2,648 New York fields); soybean −14% | Cornell 2020; Agronomy Journal |
| Grassed waterways | A strip crossing the rows; the planter is lifted over it | at least 12 m wide where crossed | NRCS 412 |
| Cereals, tramlines | Sprayer width a multiple of the drill width; the headland sprayed first | booms 12 to 36 m; rhythms 12/18/24/30 m | Horsch tramline rhythms; GRDC spray manual |
| Vineyards | A headland at row ends for anchors and turning; rows start from a baseline (fence or road) and end on a perpendicular set by the 3-4-5 rule | at least 9 m, 9 to 12 m for harvesters; French AOC turning strips at least 3 m for rows over 30 m; alleys 2 to 3.2 m, at most one per six rows | Grape Grower's Handbook; Cornell LERGP; NC State layout; BO Agri cahiers des charges |
| Orchards | Room at the ends to turn tractor and sprayer; rows set back from the boundary; French customs count 7 m per planted border (3 m canopy + 4 m machinery) | 5 to 20% of a block to headlands, 10% typical (grower calculator); orchard tractors turn in under 3.5 m | OSU EM 9077; OMAFRA; Douane FAQ Agro 2025; a grower calculator (non-authoritative) |
| Olive (Spain) | Setting out by an auto-guided tractor on the chosen grid: rows machine-straight from a baseline | alleys under 8 m hinder mechanisation | Vida Rural 2008, 2000 |
| First-tree setback from a fence in metres | not found | | |

## Methods

| Task | Method | Reported | At the edges | Source |
|---|---|---|---|---|
| Field boundary, classical | Canny on multi-temporal Sentinel-2 + watershed | OA 92.9%, MAE 24.5 m | closed polygons | Watkins & van Niekerk 2019, CEA 158:294 |
| Field boundary, classical | Multi-temporal Landsat edge + region, no training | 92.7% per-pixel crop-field accuracy (CONUS) | | Yan & Roy 2014, 2016 |
| Vineyard parcel + rows (classical) | FFT: the periodic signal gives the parcel mask, orientation and pitch at once | 90% of parcels | the block outline is the extent of the lattice signal | Delenne et al. 2010, CEA 70:78 |
| Row skeletons (classical) | Skeletonised vegetation mask with geometric constraints | n/r | skeleton endpoints are row ends (not evaluated) | Nolan et al. 2015, MODSIM |
| End-of-row, orchard robot | Change in the point-cloud distribution near the row end | 100% within 7 m, 0.54 m mean error (summary only); fails when the next block's rows are aligned across a headland under about 5 m | the one explicit "row ended vs more trees ahead" statement | Peng, Fei, Vougioukas 2023, Machines 11:84 |
| End-of-row, vineyard LiDAR | Line fit to the end pole | 0.23 to 0.26 m real | vegetation past the pole shifts the apparent end | Bertoglio et al. 2023 |
| Orchard rows from LiDAR | Alpha shape per row, PCA, canopy-profile minima | 92% trees separated | row polygon ends where the shape ends | Hadas et al. 2018, ISPRS Archives |
| Citrus inventory | Multi-task network with a nominal spacing prior | trees 95 to 99%, gap recall 63 to 94% | gaps only along detected rows | ISPRS Annals IV-3/W2 2020 |
| Missing vines | Positions at constant spacing along the detected row; a gap is a position without canopy | n/r | | de Castro et al. 2020; Primicerio et al. 2017 |
| Expected positions, maize | Modal spacing along the row; expected count = row extent / spacing | missing-seedling R² 0.77 to 0.93 | row extent from the first and last detection, so a missing end plant shortens the row | Gao et al. 2025, Frontiers in Plant Science 16 |
| Gap rule, garlic | RANSAC row fit; missing when an interval exceeds k × the median | precision 75%, F1 67% | | Lee et al. 2026 |
| Seed-level as-planted maps | RTK + seed-tube sensors log each seed | seed-to-plant error 16 to 43 mm | the planter log is the truth for where rows end | Precision Agriculture 2005; US 12,279,545 |
| Headland detection from nadir imagery | not found | | | |
| Row end from the neighbouring rows' ends | not found | | | |
| Crossing vs hole by co-occurrence across rows | not found | | | |
| Lattice completion by voting across rows | not found | | | |

## Rules, and what was built

1. **Rows end on end lines set out from a baseline, not where the plants happen to stop** (vineyard and orchard
   layout guides; olive groves set out by guided tractor; the planter's last seed at the headland pass). A true end is
   shared by the neighbouring rows; a short row is short by whole spacings while its neighbours reach the line (Gao
   2025 under-counts for exactly this reason). Built as a local consensus rather than one straight line: a position on
   a kept row is planted when at least half of the neighbouring rows, two each way, hold a plant at the same index,
   inside the field. The local form follows a curved boundary and staggered point-row ends, which a single straight
   line cannot. No published method does this; it is an inference from how fields are planted.
2. **A crossing is a gap at the same index in every row it touches; a hole is in one row among planted neighbours**
   (waterways at least 12 m wide crossing the rows; vineyard alleys across the rows at most one per six rows). Built:
   the consensus fills the hole and leaves the crossing, since no neighbour is planted there.
3. **The outer row is a full row, one pitch out; nothing is invented between it and the fence** (planters make a
   full outer pass; orchards set rows back by an unstated machinery distance). Built: a row beyond the outermost is
   accepted only when at least three of its positions inside the field show a crown over the bar, 15% of them, with
   soil between positions where the planting's plants stand apart (a weed strip along a track is green at every
   position and is not a row).
4. **A headland is itself planted, with rows parallel to the boundary**, a second lattice at right angles (Deere;
   Cornell; AOC). Not crossed by the along rule, since no interior row's neighbour is planted beyond the end line;
   the perpendicular headland planting would be a planting of its own, marked by the operator, as any block is.
5. **Priors kept for later**: headland widths (2 to 4 implement widths for row crops, 9 m for vineyards, 7 m per
   orchard border in French accounting), the aligned-next-block ambiguity under 5 m (Peng 2023), and the planter's
   own section-control log as the authority where it exists. None is used yet; the field's own pattern decides.
