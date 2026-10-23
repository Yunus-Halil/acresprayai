# Corn: what the imagery must be (pixel size, flight, ortho vs frames, quality checks)

Research date: 2026-10-23. Scope: RGB drone imagery of US corn, 0.3 to 5 cm per pixel, for row finding, planting
positions (stand), between-row weed cover, hotspot localisation back to the original photos, and weed segmentation and
measurement. No new trained models. This file extends section E of [../corn.md](../corn.md) and does not repeat it;
the sunflower altitude result (Peña 2014/2015), the four-pixel rule and the 400 ft ceiling arithmetic are there.

Evidence labels: **measured** (a study measured it on maize unless stated), **other crop** (measured, not maize),
**spec** (manufacturer specification), **vendor guidance** (software vendor's advice, not a study), **arithmetic**
(our calculation from the cited inputs), **estimate** (our judgement), **(snippet)** (only a search snippet was seen,
full text not read).

## 1. Pixel size against what it buys (corn)

| GSD (cm/px) | What it supports in corn | Evidence | Source |
|---|---|---|---|
| 0.25 to 0.35 | Individual plant detection and stand count at 3 to 5 leaves (about V3 to V5): AP 0.95, rRMSE 0.08 (Faster-RCNN). Average plant 437 to 2,253 px in area | measured, 8 sites, west France, 2016 to 2019, flights 15 to 26 m | Velumani et al. 2021, Plant Phenomics, [PMC8404552](https://pmc.ncbi.nlm.nih.gov/articles/PMC8404552/) |
| 0.48 | Multi-species weed boxes (lambsquarters, redroot pigweed, green foxtail) in forage corn, mAP@0.5 0.77 to 0.84 (trained detectors) | measured, 1 field, Utah, 10 m AGL | USU-Corn-WeedDB, [arXiv 2606.06709](https://arxiv.org/abs/2606.06709) |
| about 0.6 (0.63 to 0.66) | Stand count degrades sharply on NATIVE imagery at this pixel size: rRMSE 0.48, AP 0.64 with a 0.3 cm model; 0.29 with a model trained on degraded images; bicubic upsampling 0.43, GAN super-resolution 0.22. Synthetic (downsampled) 0.6 cm gave 0.10 to 0.11, so the loss is partly the native image quality (optics, compression, blur), not the pixel count alone | measured, 2 sites, flights 30 and 40 m | Velumani 2021, same |
| below 0.1 (1 mm) best; above 0.3 (3 mm) rapid accuracy loss | Weed mapping in maize (pixel-level) | measured (snippet), EGU 2025 abstract | [EGU25-15760](https://meetingorganizer.copernicus.org/EGU25/EGU25-15760.html) (snippet) |
| 0.3 to 0.5 | Weed species by appearance | other crops, see corn.md E | corn.md E |
| 1 to 2.5 | Detect a 10 cm weed (four-pixel rule) | other crop (sunflower) | Peña 2015, see corn.md E |
| 2 | Row finding 100% on training images (minor errors on short corner rows) and weed cover per 1 m x row-width cell: overall accuracy 86%, kappa 0.76, cover R² 0.89, RMSE 0.02. Maize at 4 to 6 leaves, weeds Amaranthus blitoides and Sorghum halepense the same size as the maize or smaller; row spacing 0.70 m. Tetracam mini-MCA-6 multispectral (NDVI > 0.20), not RGB | measured, 1 field, Madrid, Spain, 30 m | Peña et al. 2013, PLOS ONE, [PMC3795646](https://pmc.ncbi.nlm.nih.gov/articles/PMC3795646/) |
| 0.9 | Early-stage maize row lines: mean angular error 0.456° to 0.789°, better than a Hough-transform baseline on regular and intersecting rows | measured (snippet; MDPI page refused fetch), 30 m | ISPRS IJGI 2024, [10.3390/ijgi13110376](https://doi.org/10.3390/ijgi13110376) (snippet) |
| 1.5 to 3.8 | Row finding 100% at every height (40 to 100 m) | other crop (sunflower), see corn.md E | Peña 2014, corn.md E |
| 3 to 5 | Rows still found at early stages (by the sunflower and maize results above); between-row cover only as a coarse fraction; individual weeds under about 12 to 20 cm missed by the four-pixel rule; stand count not supported | arithmetic + estimate | from the rows above |

**What we did not find.** Row finding in maize is measured at single pixel sizes (2 cm Peña 2013; 0.9 cm IJGI 2024),
never swept. No maize study that measured row-finding accuracy against pixel size at 30, 20 and 15 in
(76, 51, 38 cm) row spacing. Our arithmetic only: at 3 cm a 76 cm alley is 25 px, a 51 cm alley 17 px, a 38 cm alley
13 px; a row needs at least a few pixels of bare soil either side to be separable, so narrow rows push toward 1 to 2 cm
once the canopy widens (estimate). No published Laplacian-variance threshold for drone crop imagery (section 4).

**Disagreement to keep in view.** Velumani found that a 0.6 cm native image is far worse than a 0.3 cm image
downsampled to 0.6 cm. Pixel size computed from height is therefore an upper bound on quality; real sharpness has to be
checked from the pixels (section 4).

## 2. Flight parameters

### 2.1 Height to pixel size, by drone

Formula: GSD = H x sensor_width / (focal_length x image_width_px). Where DJI does not publish the real focal length,
we used the published diagonal field of view instead: footprint width = 2H tan(dFOV/2) x (width/diagonal); GSD =
footprint width / image width px. Checked against DJI's own Phantom 4 RTK figure (H/36.5): the FOV method gives the same.

| Drone (RGB camera) | Published camera facts | GSD (cm/px), H in m | H for 0.5 / 1 / 2 / 3 cm | Source and evidence |
|---|---|---|---|---|
| Phantom 4 Pro / Phantom 4 RTK | 1 in CMOS, 20 MP, 5472 x 3648, 8.8 mm (24 mm equiv), FOV 84°, mechanical shutter 8 to 1/2000 s | H / 36.5 | 18 / 37 / 73 / 110 m | spec, [DJI P4 RTK](https://www.dji.com/phantom-4-rtk/info) |
| Mavic 3 Enterprise (3E) | 4/3 CMOS, 20 MP, 5280 x 3956, 24 mm equiv, FOV 84°, mechanical shutter 8 to 1/2000 s, electronic to 1/8000 s | about H / 36.7 (FOV method); H / 37.5 if the commonly quoted 12.29 mm focal and 17.3 mm sensor width are right (not verified) | 18 / 37 / 73 / 110 m | spec + arithmetic, [DJI Mavic 3E specs](https://enterprise.dji.com/mavic-3-enterprise/specs) |
| Mavic 3 Multispectral (3M) RGB | Assumed same 4/3 20 MP 84° camera as 3E; not re-fetched this session | about H / 36.7 | 18 / 37 / 73 / 110 m | arithmetic; corn.md E says the same; verify on the 3M spec page |
| Mavic 3T wide | 1/2 in CMOS, 48 MP, 8000 x 6000, FOV 84° | about H / 55.5 nominal (quad-Bayer; real resolving power lower) | 28 / 56 / 111 / (167, illegal) m | spec + arithmetic, DJI Mavic 3E page |
| Air 3S wide | 1 in CMOS, 50 MP, 8192 x 6144 max, 24 mm equiv, FOV 84°, f/1.8; shutter type not listed; timed shots every 2 s minimum at 12 MP, 5 s at 50 MP | 50 MP: about H / 56.9 nominal; 12 MP: about H / 28.4 | 12 MP: 14 / 28 / 57 / 85 m | spec + arithmetic, [DJI Air 3S specs](https://www.dji.com/air-3s/specs) |
| Mini 4 Pro | 1/1.3 in CMOS, 48 MP, 8064 x 6048, 24 mm equiv, FOV 82.1°, f/1.7; shutter type not listed; timed 2 s at 12 MP, 5 s at 48 MP; wind 10.7 m/s | 48 MP: about H / 57.9 nominal; 12 MP: about H / 28.9 | 12 MP: 14 / 29 / 58 / 87 m | spec + arithmetic, [DJI Mini 4 Pro specs](https://www.dji.com/mini-4-pro/specs) |

Caveats. (a) The 48 and 50 MP modes are quad-Bayer sensors; the nominal GSD overstates real detail. Treat the 12 MP
figure as the honest one until a resolution target says otherwise (estimate; no source measured it). (b) Air 3S and Mini
4 Pro do not list a mechanical shutter; an electronic rolling shutter skews moving scenes (estimate; the 3E lists both,
so the absence is meaningful but not proven). (c) Velumani's warning applies: 0.6 cm native from a small camera was far
worse than its nominal number.

### 2.2 Overlap over repetitive rows

| Guidance | Frontal / side | Reason given | Source |
|---|---|---|---|
| General terrain | 75% / 60% | baseline | vendor guidance, [Pix4D 202557459](https://support.pix4d.com/hc/en-us/articles/202557459) |
| Agriculture / uniform fields | 80% / 80%, fly higher | uniform crops make keypoint matching hard | vendor guidance, same; [Pix4D 203756125](https://support.pix4d.com/hc/en-us/articles/203756125) |
| Dense vegetation | 85% / 70% in one article, 85% / 85% in others | canopy looks different between overlapping photos | vendor guidance, [Pix4D 202560159](https://support.pix4d.com/hc/en-us/articles/202560159), [14988429657117](https://support.pix4d.com/hc/en-us/articles/14988429657117), [115002471546](https://support.pix4d.com/hc/en-us/articles/115002471546) |

Why rows need more: corn rows repeat every 76 cm, so feature matches can lock onto the wrong row (an aliasing error of
one row pitch) and leaves move between frames in wind; more overlap gives more independent views per point (estimate,
consistent with Pix4D's reasons). No maize study measuring stitching failure against overlap was found.

**Photo spacing and speed (arithmetic).** Along-track footprint with the 4:3 short side along track and FOV 84° is
about 1.08 H. Photo spacing = (1 - frontal overlap) x 1.08 H. At 40 m and 80% frontal: 8.6 m, so a drone limited to one
photo every 2 s (Air 3S, Mini 4 Pro timed mode at 12 MP) must fly at 4.3 m/s or slower; at 5 s (50/48 MP) 1.7 m/s.
At 85%: 6.5 m, so 3.2 m/s at 2 s.

### 2.3 Motion blur

Blur (px) = v x t_exposure / GSD. Sources agree on the formula and disagree on the limit: half a pixel
([Pix-Pro blog](https://www.pix-pro.com/blog/shutter-speed-iso-motion-blur-photogrammetry), vendor guidance, snippet)
or one pixel ([NTNU blog](https://ntnu.no/blogger/richard-hann/?p=419), snippet). PhenoFly's table: at 1 m/s and
1/2500 s, blur is 20% of a pixel at 2 mm GSD and 4% at 10 mm (Roth et al. 2018, Plant Methods,
[tables](https://plantmethods.biomedcentral.com/articles/10.1186/s13007-018-0376-6/tables/4), snippet).

| GSD | 1/500 s | 1/1000 s | 1/2000 s |
|---|---|---|---|
| Max speed for 0.5 px blur at 0.5 cm | 1.25 m/s | 2.5 m/s | 5 m/s |
| at 1 cm | 2.5 m/s | 5 m/s | 10 m/s |
| at 2 cm | 5 m/s | 10 m/s | 20 m/s |

(arithmetic). The P4 RTK and 3E mechanical shutter tops out at 1/2000 s.

### 2.4 Time of day and wind

Not found as maize-specific measured guidance (corn.md E already records that no maize study quantified sun angle,
shadow or wind). Practitioner guidance is to fly within about two hours of solar noon to shorten shadows, or under
uniform overcast (estimate; not sourced this session). Spec wind limits: 12 m/s (Mavic 3E, Air 3S, aircraft), 10.7 m/s
(Mini 4 Pro); these are aircraft limits, not image-quality limits. Leaves moving between overlapping frames is the
image-quality problem (estimate).

## 3. Orthomosaic against the original frames

| Topic | Fact | Evidence | Source |
|---|---|---|---|
| RTK positioning | P4 RTK and Mavic 3E RTK module: 1 cm + 1 ppm horizontal, 1.5 cm + 1 ppm vertical (RTK fix, RMS); 3E hovering ±0.1 m with RTK, ±0.5 m without | spec | DJI pages above |
| Ortho without RTK or ground control | Absolute accuracy "in the range of the GNSS receiver accuracy (few meters)"; with RTK/PPK, the RTK accuracy but never better than the project's relative accuracy | vendor guidance (snippet) | [Pix4D 202558889](https://support.pix4d.com/hc/en-us/articles/202558889) (snippet) |
| P4 RTK without ground control | DJI claims 5 cm absolute at 100 m (2.7 cm GSD); a vendor-linked test reports under 3 to 4 cm in most cases | spec claim + vendor test (snippet) | [Heliguy / Terra Drone](https://www.heliguy.com/blogs/posts/heliguy-and-terra-drone-europe-reveal-accuracy-of-the-dji-phantom-4-rtk) (snippet) |
| What metres of error mean here | A 2 m shift is about 2.6 row pitches at 76 cm: a hotspot located on a non-RTK ortho cannot be matched to a row by absolute coordinates; it must be matched through the photo-to-ortho geometry (the frame's own pixels), not GPS alone | arithmetic | |
| Ortho resampling | Maize stand counting, MaSC (University of Missouri, Phantom 4 Pro and Mavic 2 Pro video frames, 10 to 30 m, V2 to V10): R² 0.616 from mosaics vs 0.906 from raw frames. Authors blame stitching and blending: later frames overwrite earlier pixels, imperfect registration blurs and distorts seedlings; the WebODM mosaic showed holes and "melted" seedlings | measured, nursery plots | [arXiv 2510.07580](https://arxiv.org/html/2510.07580v1) |
| WeedsGalore | Annotated the central 600 x 600 px of raw frames, not the ortho; orthos kept for overview | measured practice | [arXiv 2502.13103](https://arxiv.org/html/2502.13103v1) |
| MatchPlant (USDA-ARS) | Detect on undistorted frames, then project to the ortho | method | [Zenodo 14856123](https://zenodo.org/records/14856123) |

**Relief displacement** (textbook photogrammetry): d = h x r / H, with h the plant height, r the ground distance from
the photo's nadir point and H the flying height. Worked (arithmetic): Mavic 3E at 40 m, a point 20 m from nadir
(near the frame edge; half-width is about 29 m):

| Plant height | Displacement at r = 20 m, H = 40 m | In 76 cm rows |
|---|---|---|
| 0.3 m (about V5) | 15 cm | a fifth of the alley |
| 1.0 m (about V10) | 50 cm | two thirds of the alley |
| 2.5 m (tasseling) | 125 cm | more than one row pitch |

So late-season tops lean across the alley at frame edges; an ortho built on a terrain surface keeps that lean, and
a seam between frames can shift a row by a row pitch. Use the centre of the frame (where r is small) for anything
measured in the alley (estimate from the arithmetic).

**Altitude and geometry from the file.** DJI writes XMP tags in the `drone-dji` namespace
(`http://www.dji.com/drone-dji/1.0/`). ExifTool's DJI table lists, without definitions: `AbsoluteAltitude`,
`RelativeAltitude`, `GimbalPitchDegree`, `GimbalRollDegree`, `GimbalYawDegree`, `FlightPitchDegree`,
`FlightRollDegree`, `FlightYawDegree`, `RtkFlag`, `RtkStdLat`, `RtkStdLon`, `RtkStdHgt`, `CalibratedFocalLength`,
`CalibratedOpticalCenterX/Y`, `DewarpData`, `DewarpFlag` ([ExifTool DJI tags](https://exiftool.sourceforge.net/TagNames/DJI.html), verified).
DJI publishes no official schema found this session. Secondary sources: `RelativeAltitude` is height above the take-off
point; `AbsoluteAltitude` is barometric/GNSS and reportedly switched from EGM96 to ellipsoid height in XMP 1.5,
a 10 to 30 m difference (forum, anecdotal) ([fast.io](https://fast.io/resources/drone-photo-metadata-extraction-gps-altitude-flight-data/), snippet).
So: use `RelativeAltitude` minus terrain change minus crop height for GSD, never `AbsoluteAltitude`;
`CalibratedFocalLength` (in pixels, on enterprise models) gives GSD directly as H / f_px (estimate; check against the
kept originals and `manifest.ts`). Terrain change and crop height both bias GSD.

## 4. Quality checks computable from the image

| Check | How | Published threshold | Source |
|---|---|---|---|
| Blur | Variance of the Laplacian on greyscale; higher is sharper | none universal; must be calibrated per sensor, height and scene | [arXiv 2204.08271](https://arxiv.org/pdf/2204.08271) (uses it); [ISPRS 2013](https://isprs-archives.copernicus.org/articles/XL-1-W2/361/2013/) (user-defined threshold) |
| Relative blur | SIEDS (Sieberth, Wackrow, Chandler): relative measure, compare within the same flight | relative only | [Loughborough](https://repository.lboro.ac.uk/articles/journal_contribution/Automatic_detection_of_blurred_images_in_UAV_image_sets/9448667) |
| Blur from flight log | Compute v x t / GSD from EXIF exposure and log speed | 0.5 or 1 px (section 2.3) | section 2.3 |
| Exposure clipping | Fraction of pixels at 0 or 255 per channel | not found | estimate |
| Shadow fraction | Fraction of dark low-saturation pixels | not found | estimate |

Recommended practice (estimate): rank frames within a flight by Laplacian variance computed on the same-size crop at
the same GSD, flag the bottom tail relative to the flight median, not an absolute number.

## 5. Parameter table (what to ask the operator to fly, corn)

| Purpose | Target GSD | Mavic 3E/3M, P4 | Air 3S / Mini 4 Pro (12 MP) | Overlap F/S | Max speed at 1/1000 s (0.5 px) | Stage window | Basis |
|---|---|---|---|---|---|---|---|
| Stand count, planting positions | 0.3 cm (0.5 at worst) | 11 m (18 m) | 9 m (14 m) | 80/80 | 1.5 m/s (2.5) | V2 to V5 | Velumani 2021 measured |
| Weed detection, individual | 0.5 cm | 18 m | 14 m | 80/80 | 2.5 m/s | before canopy closure | USU-Corn-WeedDB; EGU 2025 (snippet) |
| Weed cover between rows + rows | 1 to 2 cm | 37 to 73 m | 29 to 58 m | 80/80 | 5 to 10 m/s (photo interval binds first) | V2 to about V10 | Peña 2013 (2 cm, maize, multispectral) |
| Rows only, field overview | 2 to 3 cm | 73 to 110 m | 57 to 87 m | 75/65 | interval binds | early season | Peña 2013/2014 |

Flight height above the canopy, not take-off. Heights are arithmetic from section 2.1.

## 6. Gaps

1. No measured row-finding accuracy for maize against pixel size or row spacing (30/20/15 in).
2. No published blur, exposure or shadow threshold for crop drone imagery; ours must be calibrated on our flights.
3. No maize study on time of day, wind or shadow (also corn.md E).
4. Real resolving power of quad-Bayer 48/50 MP modes not measured.
5. No official DJI XMP schema; no peer-reviewed checkpoint study of a non-RTK DJI ortho without ground control found
   (Pix4D's "few metres" is vendor guidance).
6. Overlap for row crops: vendor guidance only; no maize study of stitching failure against overlap.
