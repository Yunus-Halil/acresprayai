# Crop profile benchmark: corn rows on a field map, and the grade on them (corn)

Run 2026-10-23, code 8158614. The map pattern pass with the corn profile reads the rows (src/lib/weedVision/patternRows.ts), Stage 1 reads the map at the profile's 3 cm, and the grade runs on those rows, all on stand-in maps (scripts/cropProfiles/standInMap.ts): the 60 held-out rendered scenes, whose true rows and weeds are known, and the three early-corn photos. No real corn field map has been run: that test is still owed.

Rendered scenes: rows found 0.983, rows on the crop (three quarters of the lines within a quarter pitch) 0.85, mean share of lines on the crop 0.873. Refused until confirmed, then graded: 1 of scenes with rows. Field cover against the true weed cover between the rows (beyond 15 cm of a true row): mean absolute error 0.023, bias 0.023 over 59 graded scenes; 0.025 on scenes with straw stripes. Photos with rows: 3 of 3.

| Map | Kind | Rows found | Rows | Spacing (cm) | Lines on crop | On-green ratio | Read (cm/px) | Cells assessed | Field cover | True cover | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0359_jpg.rf.d79059c10c | photo | true | 18 | 76.5 | - | 14.429 | 2.9 | 486 of 486 | 0.028 | - | low |
| ba2a945c-2f8f-4e02-981 | photo | true | 9 | 76.8 | - | 178.092 | 2.9 | 140 of 154 | 0.058 | - | moderate |
| pic1.jpg | photo | true | 5 | 76.1 | - | 136.828 | 2.9 | 48 of 48 | 0.014 | - | low |
| evaluation-1 | scene light 0.5 cm | true | 25 | 50.9 | 1 | 4.911 | 2.9 | 299 of 300 | 0.025 | 0.022 | low |
| evaluation-2 | scene red+straw 0.5 cm | true | 16 | 76.2 | 0 | 0.206 | 2.9 | 300 of 300 | 0.001 | 0.003 | trace |
| evaluation-3 | scene dark+straw 2 cm | false | 0 | - | - | - | - | 0 of 0 | - | 0.006 | - |
| evaluation-4 | scene light 2 cm | true | 23 | 50.9 | 1 | 30.93 | 2.9 | 348 of 352 | 0.013 | 0.006 | low |
| evaluation-5 | scene red+straw 1 cm | true | 9 | 55.6 | 1 | 9.289 | 2.9 | 88 of 108 | 0.063 | 0.002 | moderate |
| evaluation-6 | scene red 0.5 cm | true | 11 | 76.4 | 1 | 174.376 | 2.9 | 300 of 300 | 0.003 | 0.002 | trace |
| evaluation-7 | scene red+straw 0.3 cm | true | 9 | 76.6 | 1 | 68.251 | 2.9 | 108 of 108 | 0.035 | 0 | low |
| evaluation-8 | scene red 0.5 cm | true | 13 | 76.2 | 1 | 13.408 | 2.9 | 300 of 300 | 0 | 0 | none |
| evaluation-9 | scene red+straw 1 cm | true | 10 | 76.2 | 0 | 0 | 2.9 | 108 of 130 | 0.023 | 0 | low |
| evaluation-10 | scene red 3 cm | true | 10 | 50.6 | 1 | 6.489 | 5.7 | 70 of 70 | 0.028 | 0.026 | low |
| evaluation-11 | scene light 3 cm | true | 29 | 76.1 | 1 | 45.573 | 5.7 | 1036 of 1036 | 0.019 | 0.007 | low |
| evaluation-12 | scene red 3 cm | true | 25 | 75.9 | 1 | 256.801 | 5.7 | 638 of 638 | 0.024 | 0 | low |
| evaluation-13 | scene dark+straw 3 cm | true | 23 | 75.9 | 1 | 10.046 | 5.7 | 713 of 744 | 0.033 | 0.017 | low |
| evaluation-14 | scene dark+straw 2 cm | true | 9 | 76.2 | 1 | 84.645 | 2.9 | 88 of 108 | 0.022 | 0.003 | low |
| evaluation-15 | scene light 2 cm | true | 11 | 56.2 | 1 | 21.501 | 2.9 | 76 of 88 | 0.014 | 0.007 | low |
| evaluation-16 | scene light 1 cm | true | 17 | 76.2 | 1 | 22.721 | 2.9 | 300 of 336 | 0.072 | 0.005 | moderate |
| evaluation-17 | scene red+straw 0.5 cm | true | 13 | 56 | 1 | 50.647 | 2.9 | 130 of 130 | 0.01 | 0.004 | trace |
| evaluation-18 | scene light 3 cm | true | 9 | 52.5 | 1 | 2.443 | 5.7 | 48 of 48 | 0.286 | 0 | high |
| evaluation-19 | scene red+straw 0.5 cm | true | 17 | 50.8 | 1 | 55.732 | 2.9 | 300 of 300 | 0.004 | 0.003 | trace |
| evaluation-20 | scene dark+straw 0.5 cm | true | 54 | 19.2 | 0.481 | 5.204 | 2.9 | 0 of 300 | 0 | 0 | none |
| evaluation-21 | scene red+straw 1 cm | true | 7 | 70.1 | 1 | 16.838 | 2.9 | 52 of 63 | 0.046 | 0.01 | low |
| evaluation-22 | scene red+straw 0.3 cm | true | 12 | 50.9 | 0 | 0 | 2.9 | 108 of 108 | 0.02 | 0 | low |
| evaluation-23 | scene red 1 cm | true | 15 | 75.9 | 1 | 62.092 | 2.9 | 540 of 588 | 0 | 0 | none |
| evaluation-24 | scene dark 0.5 cm | true | 13 | 91.3 | 1 | 31.44 | 2.9 | 300 of 300 | 0.002 | 0.001 | trace |
| evaluation-25 | scene light 2 cm | true | 25 | 55.9 | 1 | 16.392 | 2.9 | 494 of 494 | 0.016 | 0.012 | low |
| evaluation-26 | scene light 3 cm | true | 9 | 76.2 | 1 | 22.433 | 5.7 | 108 of 117 | 0.008 | 0.005 | trace |
| evaluation-27 | scene red 1 cm | true | 9 | 68.9 | 1 | 73.207 | 2.9 | 88 of 108 | 0 | 0 | none |
| evaluation-28 | scene red+straw 0.5 cm | true | 16 | 76.3 | 0 | 0.385 | 2.9 | 300 of 300 | 0.01 | 0.013 | low |
| evaluation-29 | scene dark 0.5 cm | true | 9 | 76.4 | 1 | 23.872 | 2.9 | 88 of 99 | 0.02 | 0.006 | low |
| evaluation-30 | scene dark 3 cm | true | 31 | 75.9 | 1 | 31.395 | 5.7 | 972 of 972 | 0.057 | 0.008 | moderate |
| evaluation-31 | scene light 3 cm | true | 27 | 90.9 | 1 | 48.953 | 5.7 | 1064 of 1102 | 0.112 | 0.009 | action |
| evaluation-32 | scene red 0.5 cm | true | 9 | 70.6 | 1 | 171.676 | 2.9 | 70 of 80 | 0.003 | 0.001 | trace |
| evaluation-33 | scene red+straw 1 cm | true | 7 | 91.3 | 1 | 137.479 | 2.9 | 130 of 130 | 0.003 | 0 | trace |
| evaluation-34 | scene light 1 cm | true | 17 | 76.3 | 1 | 54.124 | 2.9 | 348 of 352 | 0 | 0 | none |
| evaluation-35 | scene dark 2 cm | true | 11 | 51 | 1 | 204.678 | 2.9 | 62 of 63 | 0 | 0 | none |
| evaluation-36 | scene dark+straw 3 cm | true | 19 | 76.1 | 1 | 509.031 | 5.7 | 336 of 352 | 0.053 | 0 | moderate |
| evaluation-37 | scene dark+straw 3 cm | true | 7 | 75.8 | 1 | 280.105 | 5.7 | 63 of 63 | 0.002 | 0.001 | trace |
| evaluation-38 | scene red+straw 2 cm | true | 15 | 76.3 | 1 | 13.605 | 2.9 | 312 of 336 | 0.009 | 0.007 | trace |
| evaluation-39 | scene dark+straw 1 cm | true | 9 | 75.8 | 1 | 9.109 | 2.9 | 108 of 108 | 0.181 | 0.003 | action |
| evaluation-40 | scene light 0.3 cm | true | 7 | 76.1 | 1 | 33.645 | 2.9 | 108 of 108 | 0.053 | 0.006 | moderate |
| evaluation-41 | scene red 0.3 cm | true | 9 | 76 | 1 | 44.191 | 2.9 | 108 of 108 | 0.003 | 0.004 | trace |
| evaluation-42 | scene red+straw 2 cm | true | 27 | 56 | 1 | 164.444 | 2.9 | 638 of 638 | 0 | 0 | trace |
| evaluation-43 | scene dark 1 cm | true | 7 | 76.6 | 1 | 8.257 | 2.9 | 53 of 63 | 0.05 | 0.025 | moderate |
| evaluation-44 | scene red+straw 2 cm | true | 23 | 76.1 | 1 | 114.177 | 2.9 | 972 of 972 | 0 | 0 | trace |
| evaluation-45 | scene dark 0.3 cm | true | 7 | 76.2 | 1 | 143.403 | 2.9 | 108 of 108 | 0 | 0 | trace |
| evaluation-46 | scene light 0.3 cm | true | 9 | 76.3 | 1 | 88.699 | 2.9 | 108 of 108 | 0.009 | 0.002 | trace |
| evaluation-47 | scene dark+straw 1 cm | true | 15 | 91.4 | 1 | 10.122 | 2.9 | 562 of 588 | 0.021 | 0.012 | low |
| evaluation-48 | scene light 0.5 cm | true | 17 | 69.8 | 1 | 72.927 | 2.9 | 300 of 300 | 0.002 | 0.001 | trace |
| evaluation-49 | scene light 2 cm | true | 25 | 69.9 | 1 | 7.793 | 2.9 | 840 of 850 | 0.035 | 0.025 | low |
| evaluation-50 | scene dark 3 cm | true | 24 | 75.9 | 1 | 80.618 | 5.7 | 713 of 768 | 0.023 | 0.004 | low |
| evaluation-51 | scene red 0.3 cm | true | 8 | 76 | 1 | 141.678 | 2.9 | 108 of 108 | 0.001 | 0 | trace |
| evaluation-52 | scene red+straw 0.5 cm | true | 10 | 69.7 | 0 | 0.083 | 2.9 | 88 of 99 | 0.011 | 0.003 | low |
| evaluation-53 | scene dark 1 cm | true | 9 | 76.2 | 1 | 7.415 | 2.9 | 128 of 130 | 0.027 | 0.015 | low |
| evaluation-54 | scene red+straw 2 cm | true | 26 | 55.9 | 1 | 105.698 | 2.9 | 432 of 432 | 0 | 0 | trace |
| evaluation-55 | scene light 0.5 cm | true | 6 | 77.7 | 0 | 0 | 2.9 | 54 of 63 | 0.011 | 0 | low |
| evaluation-56 | scene light 1 cm | true | 29 | 76.3 | 1 | 31.5 | 2.9 | 956 of 972 | 0.035 | 0.003 | low |
| evaluation-57 | scene light 0.5 cm | true | 15 | 70 | 1 | 18.935 | 2.9 | 300 of 300 | 0.005 | 0.004 | trace |
| evaluation-58 | scene red+straw 2 cm | true | 29 | 76.3 | 1 | 43.33 | 2.9 | 959 of 972 | 0.047 | 0 | low |
| evaluation-59 | scene light 0.3 cm | true | 9 | 76.3 | 1 | 7.168 | 2.9 | 108 of 108 | 0.015 | 0.012 | low |
| evaluation-60 | scene dark+straw 2 cm | true | 22 | 75.8 | 0 | 0 | 2.9 | 577 of 588 | 0.067 | 0 | moderate |
