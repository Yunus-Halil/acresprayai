# PhenoBench setup

Version 1.1.0 (December 2023). Archive `PhenoBench-v110.zip`, about 7.6 GB,
official MD5 `5168bba762053725890478432cdbdb1d`. Source: https://www.phenobench.org/dataset.html

The lab never downloads the archive. Download it yourself, check the hash, and
extract it outside the repository.

```
certutil -hashfile PhenoBench-v110.zip MD5        # Windows
md5sum PhenoBench-v110.zip                        # Linux / macOS
```

Extraction needs roughly 8 GB free beyond the archive. On this machine the
extracted tree is 2,872 PNG files under `D:\Drive2downloads\PhenoBench-v110\PhenoBench`.

## Expected layout

The archive extracts to a folder with a nested `PhenoBench` directory. Either
level can be given to the lab; it finds the one that holds `train/images`.

```
<root>/
  README.MD
  train/
    images/            1407 x  <MM-DD>_<frame>_<Pnnnnnnn>.png   RGB uint8 1024x1024
    semantics/         1407 x  same names                        uint16, values 0..4
    plant_instances/   1407 x  same names                        uint16, ids > 0
    leaf_instances/    1407 x  same names                        uint16, ids > 0
    plant_visibility/  1407 x  same names                        uint8, 0..255
    leaf_visibility/   1407 x  same names                        uint8, 0..255
  val/                  772 images, same six folders
  test/
    images/             693 images, no annotations published
```

Semantic ids: 0 background, 1 crop, 2 weed, 3 partial crop, 4 partial weed
(partial = under 50% visible). Filenames start with the 2020 acquisition date:
05-15, 05-26 or 06-05.

## Point the lab at it

Any one of these, in this order of precedence:

1. `--root <path>` on any script
2. environment variable `WEEDLAB_PHENOBENCH_ROOT`
3. `configs/local.json` (copy `configs/local.example.json`), key `phenobench_root`

`output_dir` in the same file (or `WEEDLAB_OUTPUT_DIR`, or `--out`) says where
rendered pictures and profiles go. Choose a drive with a few gigabytes free.

If the dataset is not found, every script prints these instructions and exits
with code 2 without running anything else.

## Check it

```
D:\swardus-research\weed-vision-lab-venv\Scripts\python -m pytest -m dataset
```

verifies the official counts (1407 / 772 / 693), that every image has all five
annotation files, and that the first image of each labelled split validates.

## Official devkit

`pip install phenobench` (MIT, version 0.1.0) provides a loader, a validator
(`phenobench-validator`) and the official evaluator (`phenobench-eval --task
{semantics,panoptic,leaf_instances,plant_detection,leaf_detection,hierarchical}
--phenobench_dir <dir> --prediction_dir <dir> --split {train,val}`). The
evaluator's `eval` extra pins `torchmetrics==0.10.3` and pulls torch; it is not
installed in the lab venv yet. The devkit source was inspected (not installed)
to confirm the class mapping and the weed-instance rule the lab reproduces.
