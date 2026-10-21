# Row and crop detection without a model: what the literature says, against what Swardus does (2026-10-21)

Three literature sweeps on 2026-10-21 (classical row geometry; plant placement and the vegetation signal; field
conditions and classical-versus-deep-learning head-to-heads), read against the pipeline as built: a vegetation mask
(excess green + Otsu, `src/lib/weedVision/fieldRows.ts`), an angle sweep over projection profiles for row direction,
autocorrelation of the perpendicular profile for pitch, a circular-mean phase (`src/lib/weedScout/rows.ts`), the
photo pattern pass with its vegetation/brightness signals, blocks and settled row lines (`src/lib/photoScout/pattern.ts`),
and the orchard lattice from three clicks refined by least squares (`src/lib/weedVision/layout/plantingLayout.ts`).

Figures are quoted as the papers state them; "n/r" means the accessible text gave none. Many publisher pages blocked
full-text fetches, so some entries rest on abstracts or open mirrors.

## Verdict

**Do not switch.** The current pipeline is the same family as the best-measured classical methods (Chen 2021 rotates
in 0.1° steps and keeps the angle with the sharpest column histogram; the autocorrelation pitch is the Fourier peak of
Delenne, Zhu and Gai). No paper found shows deep learning materially better than classical methods for row geometry on
clean early-season rows on the same data. The measured gap opens under heavy weeds, curved rows and closed canopy, and
the classical methods that close most of it (TMGEM dynamic programming, per-row RANSAC) cost 0.1 to 1.75 s per frame.
No published method, with or without a model, recovers row-crop geometry from nadir RGB after canopy closure.

**Plant positions at our scale come from the pattern, not from detection.** Every plant-counting result is at 0.3 to
4 mm per pixel. At 5 cm per pixel the evidence supports row geometry plus expected positions from the sowing pattern
(David et al. 2021 use "the sowing pattern as prior"; Salamí et al. 2019 reach F1 99.09% where olives are regularly
spaced; vineyard work turns gap length into missing vines by the planting spacing). This is the rule built on
2026-10-21: a position on a kept row is a crop unless the ground is plainly bare (`docs/features/planting-layout.md`).

**The olive failure is a signal failure, confirmed.** No paper separates a tree crown from a grass sward by colour
alone. What works uses texture (grass is flat, crowns are rough: Haddadi et al. 2020, 93% count agreement), the crown's
cast shadow (Demissie et al. 2025, candidate shadows at HSV V < 50%), and crown-shape correlation (olive template
matching F 94%). Otsu assumes two balanced classes and is the wrong threshold for a scene that is mostly lit ground
(Mardanisamani & Eramian 2022).

## Row geometry: methods against the current approach

| Family | Key papers | What it eats | Reported accuracy | Speed | Weeds | Curves | Closed canopy |
|---|---|---|---|---|---|---|---|
| Hough (skeleton, pattern, gated) | Bah 2018; Winterhalter 2018; Leemans & Destain 2006; RoWeeder 2024 | mask → skeleton / lines | CRDA 0.31–0.53 wheat, 0.93–0.98 cotton (Chen 2021); IoU 0.58 on CRBD challenging (Khan 2024); KS gate on line angles rejects weed-only line sets | 2 ms (Khan) to 84 ms (RoWeeder) | weakest once weeds appear | no | no |
| Projection sweep (ours) | Chen 2021 (0.1° steps, column histogram, LSQ per row); Hassanein 2019 (hue variance); Moldvai 2025; Ferreira 2025 | mask or hue | CRDA cotton 0.99–1.00, wheat 0.66–0.82 at 2 cm/px (Chen); 0.9° median angle error (Ferreira, 2.8 s on ARM) | sweep cost | weeds push the valleys up (Moldvai) | per window only | invalid (Chen) |
| Fourier / autocorrelation | Delenne 2008; Zhu 2020; Gai 2024/25 | luma or mask | < 3% spacing and orientation error on 86% of 271 vine plots (Delenne); < 3° / < 0.1 m (Zhu); Gai adds Hanning window + DTFT peak refinement and phase from the spectrum | one FFT per window | spectral contrast collapses with inter-row grass (Romeo 2012) | locally linear only | n/r |
| Orientation fields | Marais-Sicre 2014; Rocha 2022 (gradient median, 200 px blocks); Gesser 2019 | pan / gradient | 90% within 40° (satellite); < 2% gap-length error (Rocha) | cheap | n/r | by short blocks | n/r |
| Gabor / matched filter | Hague & Tillett 2001; Vioix 2002; Bossu 2008 | luma | n/r in retrieved text; wavelets beat Gabor (Bossu 2009) | per pixel | by design (non-periodic residual) | no | n/r |
| Template / LSQ / RANSAC | Vidović 2016 (TMGEM); Khan 2024 (CAROLIF: HDBSCAN + RANSAC); IJGI 2024; Romeo 2012 | mask | TMGEM IoU 0.75, 95.2% challenging, 1.75 s; CAROLIF 0.73, 95.7%, 108 ms; 0.46–0.79° (IJGI 2024); 97% vs Hough 86–91% (Romeo) | 0.1–1.75 s | TMGEM "insensitive to weeds and shadow"; plain LSQ weed-biased | TMGEM, quadratic (García-Santillán 2017: 86–93%) | n/r |
| Orchards at field scale | Comba 2015 (Hough-space clustering + TLS); Comba 2018 (3D local orientation maps); RCGP (PMC7288116) | grey / cloud / NG index | 100% rows at 2.1–6.7 cm/px, 98.7–100% tree columns (RCGP) | n/r | robust to inter-row grass (Comba) | Comba 2018 (3D) | n/a |

Already matched: the sweep (Chen, Hassanein, Moldvai), the autocorrelation pitch (= the Fourier peak), the phase from
the perpendicular profile, windowing (Rocha, Comba 2018), the operator-anchored lattice + least squares (Leemans &
Destain, Comba's TLS). The photo pattern pass already has blocks by angle and pitch, settled row lines within a third
of the pitch, a brightness signal for closed canopy, and square-grid handling.

Materially better, with numbers:
1. Pitch refinement: window the profile and interpolate the spectral peak (Gai 2024). At 5 cm/px a 76 cm corn row is
   15 px per period and a 20 cm wheat row is 4 px, so an uninterpolated lag is coarse; Chen's wheat already fell to
   0.66–0.82 at 2 cm/px.
2. Per-row fit: gate points to ±0.375 × pitch of each predicted line and fit with RANSAC or TLS, not plain LSQ (Chen
   2021; Khan 2024).
3. A validity gate: RoWeeder's KS test on line angles, Moldvai's in-row concentration ratio. Nothing rejects a
   "pattern" found in pure weeds.
4. Joint estimation of angle, offset and spacing (Winterhalter; Leemans) avoids locking the pitch to a harmonic.
5. Curves: per-window straight rows (Rocha; Comba 2018); TMGEM or quadratic fits inside a window at a cost.
6. Closed canopy and heavy weeds: switch signal (luma, texture, DSM); no classical nadir-RGB result exists.

## Plant positions and the vegetation signal

| Method | Signal and rule | Reported | Scale, crop, stage |
|---|---|---|---|
| Row-profile peaks with spacing constraint (Bai 2022) | green mask, row lines, 1-D profile along the row, peaks = plants | maize R² 0.76, RRMSE 4.4%; sunflower 0.89, 4.3%; watershed baseline 0.48 / 0.82 | RMSE rises sharply below 1.16 cm/px (maize), 3.84 cm/px (sunflower) |
| Handcrafted vs DL (David 2021) | segmentation → rows → sowing pattern as prior | handcrafted maize rRMSE > 0.2; Faster R-CNN < 5% with in-domain images | 16,247 plants, early stages |
| ExG + Otsu + row/inter-row geometric decision tree (Varela 2018) | contours inside the row auto-labelled corn | accuracy 0.96 at 2.4 mm/px, 0.68 at 19.2 mm/px | corn V2–V3 |
| Voted along-row spacing (PMC12141268, 2025) | sweep candidate spacing, take the mode | leakage R² 0.77–0.93 | 10 m AGL maize |
| Decorrelation stretch + fixed HSV (Gnädinger 2017) | individuals recovered at 76–83% cover | R² 0.89, error ≤ 5% | maize BBCH 13–15 |
| Regular-spacing olive counting (Salamí 2019) | on-board classical processing, regularly spaced trees | F1 99.09% | orchard |
| Template matching, olive (E3S 2024) | crown template correlation on the orthoimage | F 94%, recall 92%, precision 98% | 2,719 trees |
| Texture for trees vs grass (Haddadi 2020) | NDVI entropy and variance; grass variance < 0.2, trees > 0.2 | 93% count agreement | grassed apple orchard |
| Shadow as crown cue (Demissie 2025) | candidate shadows at HSV V < 50% | DL F1 0.86, no classical baseline | olive, 0.55 cm/px |
| Sugarcane skips (de Souza 2017; Luna & Lobo 2016) | gaps along the planted line by spacing | skip length R² 0.97; gap map OA 92.9% | field scale |

Vegetation signal:
- ExGR at a fixed zero threshold beats ExG + Otsu on residue and straw: quality 0.88 ± 0.12 vs 0.53 ± 0.39 (Meyer &
  Neto 2008); chosen over ExG by Zhao 2018 and Wu 2020; ExG and NGRDI over-segment. With residue ExG reached 46% vs
  k-means 91% (Shirzadifar 2020).
- Otsu fails when the classes are unbalanced or lighting uneven (Mardanisamani 2022; SATE 2025 reports plain Otsu at
  66.5%). Alternatives: a fraction-constrained threshold (Jeon 2011, 2.1–2.9% error), Kirk's greenness + intensity
  Gaussian (2009).
- Hue is illumination-free for the angle step (Hassanein 2019); brightness finds rows in a closed canopy where
  chromaticity is shadow-blind.
- Crown vs sward in RGB only: no colour index found; texture, shadow and shape are the published cues.

Stage windows (plants separable): corn V2–V3, soybean 14–20 days after planting (decline after 27), cotton 10–14 days,
wheat 1–2 leaves and under 0.40 mm/px only. Drilled wheat at our scale is rows only.

## Conditions

| Condition | What breaks | Without a model | Cost |
|---|---|---|---|
| Curved rows | global straight-line assumption | piecewise linear per segment (García-Santillán 2017, 86–93%); DP too slow for the browser; no paper on pivot circles | 2–4× the angle step |
| Direction changes in one field | one global angle | local Fourier orientation map, region-grow plots of equal angle and spacing (Delenne 2008: 1°, 3.3 cm); intersecting rows 0.46–0.79° (IJGI 2024) | one extra pass |
| Twin rows, skip rows, tramlines | harmonics in the spectrum | crop-prior spacing set and an explicit ambiguity flag; nothing published resolves it from imagery | negligible |
| Closed canopy | mask-based points invalid (Chen 2021) | orchards keep rows by height contrast; row crops need DSM; cache the pre-closure row map | n/a |
| Heavy weeds | rows merge, Hough over-detects | KS gate (RoWeeder), in-row concentration ratio (Moldvai 2025, F1 86% at moderate infestation), Hough-space clustering (Comba 2015) | O(n) |
| Residue, soil state | ExG binarisation fails | ExGR, dual threshold + median, hue | one pass |
| Shadows, seams, wind | ExGR takes shadow as plant; horizontal shadow worst even for U-Net (83.9%) | hue for the angle; single frames over the mosaic (Sweet 2022) | free |
| Scale | rows survive coarse GSD, plants do not | rows at 2–7 cm/px (RCGP 100%); plants need ≤ 1 cm/px; wheat rows at 5 cm/px are 3–4 px | n/a |

Head-to-head evidence: de Silva 2024 (colour baseline 52.6% vs U-Net 90.25% on a ground-robot set with dense weeds and
shadow); Khan 2024 (five classical methods, same CPU: TMGEM 0.75 > CAROLIF 0.73 > cluster-LSQ 0.70 > sliding window
0.61 > Hough 0.58); RoWeeder (Hough rows + components F1 70.4, within 12 points of fully supervised 82.8, with zero
labels); Chen 2021 (LSQ beats Hough on cotton and wheat, both die at closure); Montana State 2025 (drone at 65 ft vs a
camera sprayer: omission RGB/ExG 41–65%, NIR 48–74%, YOLO 78–85%; RGB thresholding most consistent, YOLO located
patches but severely undercounted). No paper argues classical methods are preferable; several say they suffice for row
geometry without training data.

Datasets with row-line or plant truth: CRDLD v2.1 (ground robot, licence not stated), CRBD (ground), David 2021 (UAV,
CC BY 4.0, zenodo 4890370), PhenoBench, WeedsGalore, WeedMap (orthomosaics), Agriculture-Vision (no row lines). No
public UAV orthomosaic with row-line truth for corn, soy, cotton or wheat was found.

## What was built from this, and what was measured (2026-10-21)

1. On-row positions are crops; skips only on bare ground. Built. DJI_0301: 113 plants, 94 of 104 labelled trees.
2. Plant signal: ExGR at a fixed zero replaces ExG + Otsu in the weed-vision mask. Built. On the grassed olive
   frames it reverses the mask's polarity (crowns 0.88 against sward 0.76 where Otsu gave 0.48 against 0.64).
3. Orchard crown score. Built as texture + shadow within a crown radius; measured on the olive frames neither
   discriminated (luma spread 23.4 vs 23.3; shadow 0.13 vs 0.14), and a per-field colour witness from the three
   marks read the wrong way on one frame of two and was removed. What held the lattice on grass was two rules in the
   fitter instead: the marks hold the lattice (0.5 m), and a plant leaves its slot only for ground twice as green.
   Olive: 198 of 820 trees within 0.6 m against 3; the residual is planting drift a rigid three-click lattice cannot
   follow without contrast (`docs/features/planting-layout.md`).
4. Pitch: finest prominent peak within 0.75 of the strongest, alternative reported, planted-spacing table and an
   ambiguity note. Built. A Hann taper and an overlap-corrected autocorrelation were tried and reverted: with them a
   low-lag bump beat the true peak, and every multiple peaked alike.
5. Validity gate: the coherence of the phase (circular-mean length) under 0.15 means no rows; applied on measured
   pitches only; the photo pass falls through to brightness when a vegetation fit is gated. Built. It exposed that one
   closed-canopy test had passed on a 1% modulation of a shadow-blind mask.
6. Blocks and curves: already in the photo pass (blocks by angle and pitch, per-window angles with the median as
   hint). Verified, not rebuilt.
7. Per-row fit: a second settling pass with Tukey's biweight over the first line. Built.

Out of scope by evidence: row-crop geometry after canopy closure, individual plants under about 1 cm/px, drilled-wheat
plants, in-row weeds under canopy.

## Sources

Row geometry: Bah, Hafiane, Canals 2018 (arXiv 1805.12395); Chen et al. 2021, Remote Sensing 13:3526
(10.3390/rs13173526); De Marinis et al. 2024, RoWeeder (arXiv 2410.04983); Winterhalter et al. 2018, IEEE RA-L
(10.1109/LRA.2018.2852841); Leemans & Destain 2006, IVC (10.1016/j.imavis.2006.02.004); Hussaini, Voigt, Stein 2024
(10.18420/giljt2024_14); Hassanein et al. 2019 (10.5194/isprs-archives-XLII-2-W13-349-2019); Ferreira et al. 2025
(10.1016/j.atech.2025.101425); Rocha et al. 2022 (10.1016/j.inpa.2022.04.003); Moldvai et al. 2025, Agronomy 15:1762;
Søgaard & Olsen 2003; Peña et al. 2013, PLOS ONE 8:e77151; RCGP apple orchard (PMC7288116); Gai et al. 2024/25, CEA
229:109666 (10.1016/j.compag.2024.109666); Zhu et al. 2020, JSTARS (10.1109/JSTARS.2020.2985506); Delenne et al. 2008,
IJRS 29:1153 and 2010, CEA 70:78; Hague & Tillett 2001, Mechatronics 11:1; Vioix et al. 2002; Bossu et al. 2008/2009;
Vidović, Cupec, Hocenski 2016, Pattern Recognition 55:68; Khan et al. 2024, Frontiers in AI 7 (10.3389/frai.2024.1435686);
IJGI 2024 13:376 (10.3390/ijgi13110376); Romeo et al. 2012 (PMC3353495); Montalvo et al. 2012; Yang et al. 2022,
Frontiers in Plant Science 13:916474; García-Santillán et al. 2017, Biosystems Engineering 156:61; Comba et al. 2015,
CEA 114:78 and 2018, CEA 155:84; Primicerio et al. 2017; Ronchetti et al. 2020, Remote Sensing 12:1967; Marais-Sicre
et al. 2014; de Silva et al. 2024, JFR (10.1002/rob.22238); Bah et al. 2020, CRowNet (10.1109/ACCESS.2019.2960873).

Plants and signal: Bai et al. 2022 (10.1007/s11119-022-09907-1); David et al. 2021 (bioRxiv 10.1101/2021.04.27.441631);
Varela et al. 2018 (10.3390/rs10020343); Gnädinger & Schmidhalter 2017 (10.3390/rs9060544); Feng et al. 2020
(10.3390/rs12111764); Zhao et al. 2018 (PMC6160740); Jin et al. 2017, RSE 198:105; Koh et al. 2019 (PMC6584986);
Donmez et al. 2021 (10.1016/j.compag.2021.106273); Wu et al. 2020 (10.3390/rs12010133); Salamí et al. 2019
(10.3390/rs11030316); Haddadi, Leblon, Patterson 2020, ISPRS Archives XLIII-B2:1211; de Souza et al. 2017; Luna & Lobo
2016 (10.3390/rs8060500); Louargant et al. 2018, Remote Sensing 10:761; Meyer & Neto 2008, CEA 63:282; Mardanisamani &
Eramian 2022 (10.1002/ppj2.20042); Kirk et al. 2009 (10.1016/j.biosystemseng.2009.07.001); Jeon et al. 2011 (PMC3231458);
Shirzadifar et al. 2020, Biosystems Engineering 200:377; Demissie et al. 2025 (arXiv 2510.26573); Jiménez-Brenes et al.
2019 (10.1371/journal.pone.0218132); Pathak et al. 2022 review, CEA 198.

Conditions and comparisons: Vong et al. 2021, CEA; Velumani et al. 2021 (10.34133/2021/9824843); Sun et al. 2020,
Sensors 20:2985; Sweet et al. 2022 (10.1002/ppj2.20044); Montana State NARC 2025/2026 (10.3389/fagro.2026.1817915);
Iowa State weed-map demo 2024 (crops.extension.iastate.edu); GRDC 2023 weed mapping update; Agriculture 2025 15:2151
review (10.3390/agriculture15202151).
