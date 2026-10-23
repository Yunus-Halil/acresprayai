# WeedsGalore

Maize, 70 cm rows with plants 20 cm apart, one field near Potsdam (Germany), four dates (sown 9 May 2023; flights 25 May,
30 May, 6 June, 15 June; herbicide on 12 June). DJI Phantom 4 Multispectral at 5 m, 0.25 cm a pixel. Semantic and
instance labels: maize, amaranth, barnyard grass, quickweed, other weed. 156 patches of 600 x 600 px split 104/26/26 by
location (the authors' split).

- **Licence:** CC BY 4.0, confirmed on the dataset's own README at https://doidata.gfz.de/weedsgalore_e_celikkan_2024/
  on 2026-10-23. Cite Celikkan et al. 2025, arXiv 2502.13103.
- **Download:** `weedsgalore-dataset.zip` (321 MB) on 2026-10-23, to `D:\swardus-research\datasets\weedsgalore\`. It is
  outside git, and the 11 GB orthomosaics were not downloaded.
- **Used by** the crop-profile benchmark (`npm run bench:crop-profile -- --suite weedsgalore` and `--suite stage`),
  after `python -I scripts/cropProfiles/prep_weedsgalore.py`. Results are in `crop-profiles/corn/10_validation/results/`.

**Still not a fixture for this grade.** The weed-pressure grade refuses corn on rows it read itself (the corn profile's
`weed-pressure-grade` capability is unsupported until a continuous-row map reader exists), and a 1.5 m patch is not a
field map. When that reader exists, the orthomosaics (one per date) become this directory's fixture. The labelled
patches give the truth quadrats (`truth.csv`, format in `../../README.md`).
