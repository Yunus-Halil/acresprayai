# How farmers plant: the planting-geometry catalogue (2026-10-21)

One web sweep on 2026-10-21 (interrupted once by a session limit and resumed), after the operator's instruction:
"research how farmers plant crops; it's always a row pattern and very specific; put that in the algorithms".
Numbers carry their source; "inference" marks the researcher's arithmetic; "not found" marks empty searches. What
was built from it: `src/lib/plantingPractice.ts` (the catalogue, the stagger snap, the frame description in the
Crop rows panel) and the row finder's spacing table (`ROW_SPACINGS_M`).

## Row crops

| Crop | Region | Row pitch | In-row | Notes | Source |
|---|---|---|---|---|---|
| Corn | US, Canada | 30 in (76 cm) on about 85% of acres; 20, 22, 15 in and twin 7.5-on-30 in the northern Corn Belt | 5.5 to 8 in (14 to 20 cm) for 26,000 to 37,600 plants per acre | USDA 2006 objective-yield mean 30.5 in | DuPont Pioneer via hoards.com; USDA NASS 2007; Iowa State; NC State |
| Corn | UK, Germany | 75 cm, "the vast majority" | 10.6 to 21 cm for 12 to 6 plants per m² | | KWS UK; LfL Bayern |
| Corn | Turkey | 70 cm (60 to 80 coastal; 40 to 60 interior) | 15 to 25 cm | | Ministry provincial brochures (Isparta, Bartın, Şanlıurfa) |
| Soybean | North America | drilled 7.5 in, 15 in, 30 in, "evenly divided" (2011); 15 in gaining; Iowa about half at 30 in | 1.5 to 6 in; plants do not resolve in imagery | | Intelseed 2011, 2016; Farm Progress; Iowa State |
| Cotton | US South | 36 to 38 in on most farms (Southeast), 38 in (Mississippi), 40 in (north Alabama, Texas); 30 in trials; skip-row 2×1 and 2×2 | 2 to 4 plants per ft (8 to 15 cm) | | UF IFAS AG200; MSU Extension; Beltwide 2008 |
| Cotton | Turkey | 70 to 76 cm | 14 to 20 cm | | Ankara University |
| Wheat | US | 7.5 in standard; 5, 10, 15 in trialled | 16 to 18 seeds per ft | tramlines | Michigan Wheat; MSU; UNL |
| Wheat | EU, UK, Turkey | 12.5 cm drills, 12 to 16 cm usual, 25 cm emerging; Turkey 12.5, 14, 17, 20 cm | not resolvable | tramlines 24 or 36 m | Amazone; Farmers Journal; Siirt University; Gaziantep brochure |
| Sunflower | US, Turkey | 30 in (76 cm) US; 70 cm Turkey; 60 cm Thrace trials | 20 to 27 cm US; 25 to 35 cm Turkey | | SDSU; Ankara University; Uludağ |
| Sugar beet | EU; Idaho | 45 or 50 cm; 22 to 24 in | 18 to 22 cm; thinned to 9 to 12 in | | KWS; USDA ARS |
| Potato | US | 34 to 38 in, 36 average | 10 to 13 in | | NDSU; Idaho Potato |
| Vegetables | California | 40 in beds with 2 lines, 80 in beds with 5 to 6 or more | | nested lattice | UCCE Monterey |
| Rice | transplanted | 30 × 15, 25 × 20, 25 × 25 cm; machine rows fixed at 30 cm | | | JICA; Bangladesh Agronomy Journal |

Planter accuracy: a skip is a spacing over 1.5 times the target, a double under half (Iowa State); a university test
gave 0.35% doubles, 1.21% skips, CV 24.3% (Väderstad); field surveys found a mean standard deviation of plant
spacing of 4.5 in over 354 Indiana and Ohio fields and 3.3 in in Wisconsin (Purdue). Row straightness: GNSS
pass-to-pass 2.5 cm (RTK) to 15 cm (SF1), 20 to 25 cm WAAS; measured on 24 Turkish cotton and corn fields, mean
pass-to-pass deviation 5 to 7 cm regardless of GNSS tier. Within a planter pass the row pitch is fixed by the frame;
the "guess row" between passes carries the driving error. Adjacent single rows have no phase relation (inference
from independent row meters); twin rows are staggered on purpose into a diamond (Monosem, Great Plains). Curved rows
occur on contours (2 to 10% slopes) and in pivot circles.

## Orchards and vineyards

| Crop | System, region | Row pitch | In-row | Pattern | Source |
|---|---|---|---|---|---|
| Apple | tall spindle, US and EU | 3.35 m (3 to 4) | 0.9 m (0.9 to 1.2) | hedgerow | Cornell, UVM |
| Apple | semi-dwarf to half-standard, Ontario and US | 4.5 to 6.5 m | 2.4 to 5.5 m | rectangular | OMAFRA; Cummins Nursery |
| Apple | traditional, UK | 8 to 10 m | 7 to 9 m | square | Natural England |
| Pear | dwarf to standard, US | 3.6 to 6.7 m | 0.45 to 5.5 m | hedgerow to rectangular | Cummins; Good Fruit Grower |
| Peach | perpendicular V; open vase, US | 4.6 to 6.1 m | 1.5 to 2 m; 3.7 to 4 m | crowns lean across the row by design | Penn State; UGA; Arkansas |
| Apricot | Turkey (ministry brochure) | 5 × 5 to 8 × 8 m, 10 × 10 interior, dwarf 3 × 3.5 m | | square or rectangular | Alata Research Institute |
| Apricot, peach, plum | US nursery | 12 × 18 ft | | | Cummins |
| Sweet cherry | Turkey; US | mahaleb 4 × 5 or 5 × 5, standard 7 × 6 to 8 × 8, dwarf 2.5 to 3 × 5 m; US 6 × 16 ft, 3 × 4.9 m | | | Gaziantep, Antalya brochures; Good Fruit Grower |
| Almond | California | 24 × 24 ft square (76 per acre) to 14 × 21; hedgerow 11 × 22; 24 ft diamond gives rows 20.8 ft apart | | square, rectangle, offset, diamond, hedgerow; alternate rows are different cultivars | UC ANR 111497 |
| Walnut | California | 25 × 25 to 30 × 30 ft; hedgerow 22 × 15 ft | | | UC Davis |
| Pistachio | California | 20 × 20 ft | | males every 5th tree in every 5th row | UC ANR |
| Olive | Spain, Turkey | traditional 7 to 12 m square (69 to 120 per ha, 76% of Spanish area); intensive 5 to 8 × 4 to 7 m; super-high-density 1.35 × 4 m (2%) | | Turkey 5 × 5 to 7 × 7, Gemlik 4 × 6 | AEMO 2012 via EPPO; Eurostat 2023; Kilis and Alata brochures |
| Citrus | Mediterranean, Florida | 6.5 to 7.6 × 3 to 6 m; Florida denser | | | Wonderful Citrus; UF IFAS |
| Hazelnut | Oregon; Turkey | 20 × 20 or 18 × 18 ft; double density 10 × 20 thinned to a 20 to 22 ft triangle; Turkey ocak clumps at 6 × 4 to 5 m | | | OSU EM 9077; Turkish GI documents |
| Avocado | California | 20 × 15 ft; high density 10 × 10 | | 1 Zutano per 8 Hass | UC ANR |
| Kiwifruit | New Zealand, Italy | 3 to 5 m rows × 5 to 6 m | | males 1 in 6 to 9, or alternate rows | Te Ara; UC ANR; ISHS |
| Vineyard | France; New World; US | 1 × 1 m; 2.5 × 3.7 m; 6 to 8 × 8 to 12 ft | vines do not resolve | hedgerow | ckbk; UC Davis |

Patterns: square, rectangular, quincunx (a filler in the centre of each square), triangular or hexagonal (about 15%
more trees than square), hedgerow. Square "probably the most common" for pecans (NMSU); rectangular is what gives
machinery alleys; offset and diamond used for nuts (UC almond). No survey of pattern shares was found. Modern
mechanised orchards are rectangular with rows aligned (stagger 0); nut and traditional orchards may be offset by
half a spacing; high-density hedgerows have no cross-row relation at imagery scale (inference).

Setting out: the baseline half a spacing in from the boundary, a perpendicular by cross-staff or 3-4-5 (ICAR);
GPS marking of every tree position by contractors (OSU); RTK planting machines claim centimetre placement (vendor).
Row orientation north to south where the land allows (OMAFRA; WSU). Hand-planting tolerance from stakes: not found;
UF citrus notes that more than 2 in of lateral drift damages young trunks. Trunk-to-row-line deviation statistics:
not found; LiDAR row fits imply trunks within a few centimetres of a line.

Interplanting and pollinisers: apple one-in-nine (every third tree in every third row); almond alternate solid rows
of cultivars; pistachio 1 in 25; cherry 1 per 8 to 11; hazelnut 10% at every third tree and row; avocado 1 in 9;
kiwi males 1 in 6 to 9 or whole alternate rows. Fillers: pecan quincunx at the square's centre; hazelnut double
density removed in years 8 to 12; avocado temporaries in every other position. Tree loss: Florida citrus 3 to 4% a
year; one vineyard census 7.3% missing; apple and stone fruit rates not found.

## Priors the fitter carries

- Row crops: the pitch set per crop (above) for the row finder's harmonic check and ambiguity note; adjacent single
  rows at random phase, twin rows at half-spacing stagger; in-row spacing resolvable only for corn, sunflower, sugar
  beet, potato and cotton; soybean and wheat are rows only.
- Orchards: the frames above as a catalogue; stagger snapped to 0 or half a spacing only within a twentieth of the
  spacing and only when the operator's marks still hold on the snapped lattice; in-row placement tolerance about a
  tenth of the spacing for the trunk and a quarter for the crown centre (inference), which the fitter's `maxOffAlong`
  0.25 and `acrossHoldM` 0.3 m already match; a half-pitch doubt when trees read closer along the row than any frame
  but a hedgerow, and a swapped-axis doubt when rows read closer than the trees along them.
- Not used, kept here: planter skip and double rates (1 to 3%), the 5 to 7 cm pass-to-pass deviation, pollinizer
  and filler patterns, annual tree loss.
