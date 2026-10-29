# Crop profile benchmark: corn rows on a field map, and the grade on them (corn)

Run 2026-10-29, code 7acf984+uncommitted. The map pattern pass with the corn profile reads the rows (src/lib/weedVision/patternRows.ts), Stage 1 reads the map at the profile's 3 cm, and the grade runs on those rows, all on stand-in maps (scripts/cropProfiles/standInMap.ts): the 60 held-out rendered scenes, whose true rows and weeds are known, and the three early-corn photos. No real corn field map has been run: that test is still owed.

Rendered scenes: rows found -, rows on the crop (three quarters of the lines within a quarter pitch) -, mean share of lines on the crop -. Refused until confirmed, then graded: - of scenes with rows. Field cover against the true weed cover between the rows (beyond 15 cm of a true row): mean absolute error -, bias - over 0 graded scenes; - on scenes with straw stripes. Photos with rows: 2 of 15 (directtest: directtestimagery, not used in development).

| Map | Kind | Rows found | Rows | Spacing (cm) | Lines on crop | On-green ratio | Read (cm/px) | Cells assessed | Field cover | True cover | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 102.JPG | photo | false | 0 | - | - | - | - | 0 of 0 | - | - | - |
| 37.JPG | photo | false | 0 | - | - | - | - | 0 of 0 | - | - | - |
| 39.JPG | photo | false | 0 | - | - | - | - | 0 of 0 | - | - | - |
| 42.JPG | photo | false | 0 | - | - | - | - | 0 of 0 | - | - | - |
| 63.JPG | photo | false | 0 | - | - | - | - | 0 of 0 | - | - | - |
| 64.JPG | photo | true | 6 | 96.8 | - | 1.995 | 2.9 | 140 of 154 | 0.294 | - | high |
| 67.JPG | photo | false | 0 | - | - | - | - | 0 of 0 | - | - | - |
| 70.JPG | photo | false | 0 | - | - | - | - | 0 of 0 | - | - | - |
| 71.JPG | photo | false | 0 | - | - | - | - | 0 of 0 | - | - | - |
| 72.JPG | photo | false | 0 | - | - | - | - | 0 of 0 | - | - | - |
| 89.JPG | photo | true | 35 | 75.8 | - | 7.272 | 2.9 | 2149 of 2160 | 0.101 | - | action |
| 99.JPG | photo | false | 0 | - | - | - | - | 0 of 0 | - | - | - |
