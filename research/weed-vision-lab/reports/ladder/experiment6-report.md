# Experiment 6: resolution ladder, local inference service, Swardus research preview, DJI trial

Date 2026-10-13. Research branch `research/weed-vision-lab` at `74a6eaf` (Experiment 5 committed). Integration on
branch `experiment/weed-vision-preview`, uncommitted, awaiting approval. Nothing pushed; `main` untouched.
In-sample for ERFNet throughout the PhenoBench numbers; the DJI observations are separate and have no reference masks.

## 1. Resolution ladder (`reports/ladder/ladder_dev_tune.md`, `ladder_dev_check.md`)

The frozen pipeline (ERFNet argmax, with and without the one-pixel erosion, 8-connected components) run at 1, 1/2, 1/3
(344 px, effective 0.336), 1/4 and 1/8 of native resolution. Images area-downsampled; references downsampled the same
way (class by area-weighted majority, instances kept where coverage is at least 0.5; references that vanish are counted
as misses in the native-space columns). Two scorings: in the scaled space, and after upsampling the labels back to native
against the untouched references, which is what the integration outputs.

dev_tune (717 images, 4,121 reference weed observations), IoU 0.5:

| scale | px | config | A | B | C | D | tiny | small | medium | A+B at IoU 0.3 | IoU med | IoU p10 | bF1 | pixel P | pixel R | FP bg/img | FP crop/img | vanished refs | native: A | native: small | native: IoU | ERFNet ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1024 | argmax | 0.840 | 0.826 | 0.878 | 0.765 | 0.425 | 0.777 | 0.913 | 0.974 | 0.651 | 0.460 | 0.771 | 0.724 | 0.950 | 2.31 | 0.21 | 0 | 0.840 | 0.777 | 0.651 | 518 |
| 1 | 1024 | erode 1 | 0.898 | 0.826 | 0.929 | 0.793 | 0.424 | 0.818 | 0.927 | 0.967 | 0.698 | 0.496 | 0.845 | 0.814 | 0.892 | 1.37 | 0.15 | 0 | 0.898 | 0.818 | 0.698 | 518 |
| 1/2 | 512 | argmax | 0.586 | 0.558 | 0.579 | 0.318 | 0.063 | 0.418 | 0.699 | 0.822 | 0.539 | 0.000 | 0.818 | 0.589 | 0.883 | 1.70 | 0.74 | 19 | 0.565 | 0.392 | 0.524 | 93 |
| 1/2 | 512 | erode 1 | 0.675 | 0.663 | 0.639 | 0.390 | 0.069 | 0.483 | 0.752 | 0.786 | 0.604 | 0.000 | 0.893 | 0.721 | 0.818 | 0.51 | 0.84 | 19 | 0.640 | 0.453 | 0.579 | 93 |
| 1/3 | 344 | argmax | 0.360 | 0.395 | 0.315 | 0.159 | 0.015 | 0.208 | 0.489 | 0.640 | 0.426 | 0.000 | 0.793 | 0.539 | 0.808 | 1.78 | 1.29 | 28 | 0.334 | 0.186 | 0.422 | 46 |
| 1/3 | 344 | erode 1 | 0.445 | 0.616 | 0.385 | 0.204 | 0.005 | 0.260 | 0.561 | 0.604 | 0.455 | 0.000 | 0.855 | 0.667 | 0.727 | 0.54 | 1.45 | 28 | 0.413 | 0.226 | 0.443 | 46 |
| 1/4 | 256 | argmax | 0.261 | 0.221 | 0.174 | 0.078 | 0.001 | 0.120 | 0.346 | 0.485 | 0.277 | 0.000 | 0.661 | 0.500 | 0.733 | 1.50 | 1.55 | 58 | 0.229 | 0.095 | 0.271 | 30 |
| 1/4 | 256 | erode 1 | 0.294 | 0.419 | 0.264 | 0.121 | 0.000 | 0.135 | 0.464 | 0.438 | 0.100 | 0.000 | 0.522 | 0.632 | 0.637 | 0.43 | 1.64 | 58 | 0.248 | 0.097 | 0.085 | 30 |
| 1/8 | 128 | argmax | 0.053 | 0.072 | 0.084 | 0.010 | 0.000 | 0.009 | 0.149 | 0.143 | 0.000 | 0.000 | 0.000 | 0.293 | 0.427 | 1.00 | 1.67 | 912 | 0.031 | 0.001 | 0.000 | 14 |
| 1/8 | 128 | erode 1 | 0.090 | 0.133 | 0.105 | 0.020 | 0.000 | 0.017 | 0.197 | 0.136 | 0.000 | 0.000 | 0.000 | 0.610 | 0.332 | 0.28 | 1.81 | 912 | 0.058 | 0.007 | 0.000 | 14 |

(ERFNet ms are per image in a 3-thread worker that shared the CPU with a second worker and the integration tests; the
single-process figure at native resolution is 264 ms, Experiment 5.)

Reading:

- **Half resolution costs a quarter of the isolated weeds and half of the small ones.** A recall 0.90 to 0.67, small 0.82
  to 0.48, tiny 0.42 to 0.07; crop false positives quadruple (0.15 to 0.84 per image) as shrunken rosettes start to look
  like weeds. Inference is 5.5 times cheaper.
- **A third and below is not a working regime** (A 0.45, 0.29, 0.09). At 1/8, 912 of 4,121 references vanish from the
  downsampled reference itself.
- **Fragmentation and thin leaves:** the loss is concentrated in the tiny and small bands at every step; medium weeds hold
  up to 1/3 (0.56). Boundary F1 in the scaled space looks stable only because the boundaries being compared are coarse.
- **Erosion:** improves A recall and halves background false positives at 1, 1/2 and 1/3; at 1/4 it still lifts recall but
  collapses the median IoU (0.28 to 0.10): a one-pixel erosion at 1/4 scale is a four-pixel erosion on the plant. Recommendation:
  **keep the one-pixel erosion at processing scales down to 1/3; disable it at 1/4 and below; never scale the erosion
  radius up** (the halo is one pixel of the network's output, not one pixel of the world). The service exposes
  `erfnet_argmax` for scales where erosion is off.
- **Practical resolution requirement:** the pipeline needs the object scale it was trained at. Its performance is
  a function of pixels per plant, not of altitude; a weed that occupies about 100 to 1,000 px at PhenoBench's sampling
  needs to occupy that many pixels in the processed image. No flight altitude or physical detection limit is claimed:
  PhenoBench's ground sampling distance for these images is not stated in its archive, and the DJI cameras' geometry
  was not verified here.

dev_check confirmation: table at the end of this report (`ladder_dev_check.md`).

## 2. The local inference service (`weedlab.service`, Flask, 127.0.0.1:8765)

Endpoints, schema, limits and tiling are documented in `docs/research-preview.md`. Tiled inference cuts the optionally
rescaled image into 1024 px tiles with 128 px overlap, normalises each tile as a PhenoBench image, blends softmax maps
with a linear ramp, and extracts components once from the blended map, so a weed on a seam is one instance (tested:
`tests/test_service.py::test_blob_across_tile_boundary_is_one_instance`). Nineteen service tests cover the tile plan and
padding, ramp weights, tiled-equals-untiled on a single tile, coordinate mapping back through a processing scale,
instance id stability, flags, RLE and polygons, input validation, the missing-checkpoint 503, the asynchronous job
lifecycle and reference evaluation. The geometry path was found quadratic on the first real photograph (measuring each
instance on the full 50-megapixel mask) and rewritten crop-local: 2,762 instances on a 50-megapixel label image in 5.6 s.

## 3. The Swardus research preview

`/app/weed-vision`, dev builds with `VITE_WEED_VISION_PREVIEW=true` only, lazy chunk, flag-gated route and sidebar entry,
dev proxy `/weed-vision-api`, no CORS, no Supabase writes. Upload, Detect Weeds with tile progress, outlines / fills /
numbers / crop regions toggles, zoom and pan (existing `PhotoViewer`), click-to-inspect with the max-span line drawn,
count, per-weed pixel geometry, run diagnostics (timings per stage, tiles, processing size, memory, versions, checkpoint
hash), warnings, clear, algorithm selector (five algorithms, each labelled with its benchmark), two-run comparison
(cyan second overlay, paired-instance differences), JSON / CSV export, and reference-mask scoring mode (TP / FP / missed
regions drawn). Ten frontend tests cover the flag, the never-throwing client with job polling, export, comparison,
overlay rendering and the upload-to-overlay-to-select-to-clear workflow against a mocked service; the full existing
suite (120 files, 1,783 tests) passes; `npm run build` passes with the page as an unused chunk; the dev proxy was
verified by curl through the running dev server.

Not driven in a browser by me: the page was exercised by its tests and the service by real photographs; the hands-on
browser run is yours (per your standing preference). Launch commands are in `docs/research-preview.md`.

## 4. Real DJI photographs through the service (`D:\swardus-research\weed-vision-lab-outputs\preview-tests\`)

No reference masks exist for these frames; the numbers below are counts and timings, plus one point-level check. They
are separate from the PhenoBench metrics and are not accuracy claims.

| photograph | camera | size | algorithm | scale | tiles | instances (tiny) | total s | ERFNet forward s | geometry s | peak MB | JSON KB |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DJI_0301 (young orchard, inter-row weeds) | Phantom 4 RTK | 5472 x 3648 | selected | 1.0 | 24 | 2,951 (931) | 20.2 | 9.7 | 8.6 | 1,052 | 2,957 |
| DJI_0301 | | | ERFNet argmax | 1.0 | 24 | 3,624 (1,408) | 20.2 | 9.5 | 8.9 | 1,110 | 3,510 |
| DJI_0301 | | | ExG 0.08 | 1.0 | - | 17,681 (15,324) | 21.9 | - | 21.5 | 1,052 | 12,824 |
| DJI_…0097 (close-range tape photo, dense grass) | Air 3S | 8192 x 6144 | selected | 0.5 | 20 | 526 (258) | 11.6 | 8.0 | 1.5 | 1,110 | 730 |
| DJI_…0097 | Air 3S | 8192 x 6144 | selected | 1.0 | 63 | 1,197 (535) | 36.2 | 24.8 | 3.4 | 2,121 | 2,028 |

(Timings taken while the ladder occupied most of the CPU; the service ran on 3 threads.)

Point check on DJI_0301 against the open-row benchmark's 414 weed and 104 tree points (not exhaustive, so recall only):

| algorithm | instances | labelled weed points inside a predicted weed | tree points inside a predicted weed |
|---|---|---|---|
| ERFNet + erosion (selected) | 2,951 | 312 / 414 (0.75) | 51 / 104 (0.49) |
| ERFNet argmax | 3,624 | 337 / 414 (0.81) | 53 / 104 (0.51) |
| ExG 0.08 | 17,681 | 272 / 414 (0.66) | 88 / 104 (0.85) |

Observations from the rendered overlays:

- Isolated inter-row weeds on exposed soil are found with masks that follow the visible canopy; 12.8% of the frame is
  called weed, which the renders show is mostly the young trees: the sugar-beet crop class does not transfer to an
  orchard, so half the trees are outlined as weed (ExG outlines nearly all of them, as a colour rule must).
- Tile boundaries produced no visible duplicates (fragmented instances: 0 in every run).
- Thin grass is fragmented into many tiny instances; 931 of 2,951 instances are under 25 px and flagged.
- The Air 3S close-range frame is a scale failure, not a detector failure: at roughly ten times finer sampling than
  PhenoBench, a dandelion rosette is labelled crop, dark wet soil patches are labelled crop (29% of the frame), and
  grass blades are labelled weed. At 0.5 scale the counts halve but the mislabelling pattern stays. This is the ladder's
  lesson in the other direction: the network needs its training object scale, finer as well as coarser.
- Shadows: hard tree shadows on soil are not called weed by ERFNet (they were a halo source for ExG).

What to supply for a proper DJI test: nadir frames of weeds on exposed soil at a sampling where a seedling spans tens to
hundreds of pixels (the PhenoBench regime), a few with crops at seedling stage, and, for any number to be reported, a
reference mask for at least one frame (the preview's evaluation mode takes a PNG).

## 5. Limitations and failure cases

- All PhenoBench numbers are in-sample for ERFNet; the holdout is untouched.
- The crop class is sugar beet. On other crops and on trees it does not transfer; the preview reports crop regions only
  as "ERFNet crop class", never as "crop".
- Scale: the pipeline works at its training sampling only (section 1). The preview records the processing scale and warns
  when it is under 1; it cannot know the photograph's ground sampling.
- Measurements are pixels. No calibration exists in the preview; the EXIF is shown, not used.
- 50-megapixel frames at native scale take about 36 s and 2.1 GB on this CPU; the geometry stage is 10% of that, the
  network 70%.
- Thin and grass-like plants fragment under erosion (Experiment 5), and the DJI frames are full of them.
- Erosion is a one-pixel correction of this network's output at native scale; it must be re-measured on any other network
  or sampling.

## 6. Licensing

`docs/licensing-audit.md` (delivered this session): our `erfnet.py` derives from PRBonn's unlicensed copy of Eromera's
CC BY-NC 4.0 code; the checkpoint carries no stated licence; the dataset's two licence texts conflict. The preview and
the service are research-only, loopback-only, never embed the checkpoint in a bundle, and are confined to the branch.
The inventory's licence row was corrected (BY-NC, not BY-NC-SA); the matching docstring in `erfnet.py` is a pending edit.

## dev_check confirmation (690 images, 4,020 reference weed observations; appended when the run completed)

| scale | px | config | A | B | C | D | tiny | small | medium | IoU med | bF1 | FP bg/img | FP crop/img | vanished | native: A | native: small | native: IoU |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1024 | argmax | 0.8478 | 0.8765 | 0.8897 | 0.6864 | 0.4375 | 0.7617 | 0.9071 | 0.6661 | 0.7875 | 2.29 | 0.24 | 0 | 0.8478 | 0.7617 | 0.6661 |
| 1 | 1024 | erode 1 | 0.8865 | 0.8395 | 0.914 | 0.7006 | 0.4552 | 0.7877 | 0.916 | 0.7075 | 0.8675 | 1.39 | 0.16 | 0 | 0.8865 | 0.7877 | 0.7075 |
| 1_2 | 512 | argmax | 0.5945 | 0.3457 | 0.596 | 0.3035 | 0.1297 | 0.4164 | 0.7328 | 0.5359 | 0.8155 | 1.64 | 0.7 | 19 | 0.5805 | 0.401 | 0.5257 |
| 1_2 | 512 | erode 1 | 0.686 | 0.4691 | 0.6433 | 0.3411 | 0.1074 | 0.4725 | 0.7939 | 0.6061 | 0.9 | 0.56 | 0.72 | 19 | 0.6491 | 0.4396 | 0.5752 |
| 1_3 | 344 | argmax | 0.3729 | 0.321 | 0.3553 | 0.1344 | 0.0281 | 0.2041 | 0.5509 | 0.4286 | 0.7797 | 1.89 | 1.24 | 23 | 0.3474 | 0.1818 | 0.42 |
| 1_3 | 344 | erode 1 | 0.4503 | 0.284 | 0.4284 | 0.167 | 0.0112 | 0.257 | 0.612 | 0.4444 | 0.8475 | 0.6 | 1.44 | 23 | 0.4063 | 0.2208 | 0.4253 |
| 1_4 | 256 | argmax | 0.2551 | 0.1605 | 0.2221 | 0.0509 | 0.0073 | 0.1049 | 0.4122 | 0.2806 | 0.6608 | 1.56 | 1.61 | 55 | 0.226 | 0.0838 | 0.2757 |
| 1_4 | 256 | erode 1 | 0.3105 | 0.2099 | 0.2679 | 0.0866 | 0.0 | 0.133 | 0.4975 | 0.1416 | 0.5654 | 0.53 | 1.6 | 55 | 0.2735 | 0.1045 | 0.1092 |
| 1_8 | 128 | argmax | 0.0769 | 0.12 | 0.0551 | 0.0175 | 0.0 | 0.0128 | 0.1718 | 0.0 | 0.0 | 1.05 | 1.71 | 837 | 0.0484 | 0.0065 | 0.0 |
| 1_8 | 128 | erode 1 | 0.1246 | 0.12 | 0.0766 | 0.0371 | 0.0 | 0.0274 | 0.2328 | 0.0 | 0.0 | 0.28 | 1.95 | 837 | 0.0686 | 0.0081 | 0.0 |
