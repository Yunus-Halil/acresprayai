# Classical baselines on `dev_check`

3 runs; every run saw the same 690 images and 4020 reference weed observations. IoU matching 0.5 unless stated.

## Raw (every component down to 1 px counts) and with a 25 px scoring floor

| run | dets/img | P raw | R | F1 raw | P crop-aware | F1 crop-aware | A+B recall | floor 25: P raw | R | F1 raw | P crop-aware | F1 crop-aware | A+B recall | FP bg/img | FP crop/img |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| exg_exr | 615.5 | 0.001 | 0.112 | 0.002 | 0.001 | 0.002 | 0.1256 | 0.039 | 0.112 | 0.058 | 0.129 | 0.120 | 0.1256 | 0.6 | 11.81 |
| exg_fixed_t0.05 | 2491.0 | 0.001 | 0.485 | 0.002 | 0.001 | 0.002 | 0.6199 | 0.088 | 0.481 | 0.149 | 0.116 | 0.187 | 0.6199 | 18.43 | 7.61 |
| exg_fixed_t0.08 | 1501.0 | 0.002 | 0.383 | 0.003 | 0.002 | 0.003 | 0.477 | 0.096 | 0.381 | 0.153 | 0.149 | 0.214 | 0.477 | 9.28 | 8.24 |

## Recall by category (IoU 0.5) and found rate (coverage 0.5)

| run | A | B | C | D | tiny | small | medium | large | found A | found B | found small | merged w/ crop (all) | merged w/ weed (all) | split (all) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| exg_exr | 0.128 | 0.099 | 0.192 | 0.060 | 0.025 | 0.063 | 0.322 | 0.615 | 0.132 | 0.099 | 0.153 | 0.090 | 0.050 | 0.014 |
| exg_fixed_t0.05 | 0.629 | 0.494 | 0.653 | 0.162 | 0.531 | 0.443 | 0.565 | 0.667 | 0.685 | 0.543 | 0.693 | 0.175 | 0.113 | 0.086 |
| exg_fixed_t0.08 | 0.485 | 0.370 | 0.544 | 0.124 | 0.383 | 0.338 | 0.509 | 0.667 | 0.515 | 0.444 | 0.541 | 0.159 | 0.105 | 0.067 |

## Vegetation pixels and runtime

| run | veg IoU vs plants (median / p10) | plant pixel recall | pixel precision | steady total ms (median / p95) | cold first image ms | wall s (parallel) |
|---|---|---|---|---|---|---|
| exg_exr | 0.838 / 0.634 | 0.865 | 0.966 | 46.84 / 49.83 | 52.84 | 24.7 |
| exg_fixed_t0.05 | 0.758 / 0.609 | 0.983 | 0.769 | 48.17 / 53.22 | 53.44 | 26.2 |
| exg_fixed_t0.08 | 0.808 / 0.711 | 0.968 | 0.833 | 46.1 / 48.3 | 51.16 | 27.3 |
