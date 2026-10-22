# Weed pressure evaluation

Scores the weed-pressure grade (`src/lib/weedVision/pressure/grade.ts`) against ground truth, so a change to the grade
can be measured instead of argued about. It runs headless: Stage 1 (`twoStage/stage1.ts`, `readStage1`) reads the
fixture's imagery through its `draw` injection, so no browser or map tiles are needed, and every step after the pixels
is the app's own code (`readStage1`, `gradePressure`, `cropGroupOf`, `canopyClosedOf`, the row-crop guard, the 0.5 m
cell of `PRESSURE_CELL_M`).

```
npm run eval:pressure -- --fixture path/to/fixture-dir     # writes docs/eval/<name>-<date>.md and .json
npm run eval:pressure -- --synthetic                       # the synthetic fixture, made in code
npx vite-node scripts/eval/pressure/orchard.ts             # the grade's own counts on the five orchard trial frames (no truth)
```

`--date` sets the date in the file names (default today) and `--out` the directory (default `docs/eval`).

## A fixture

One directory per field:

```
fixture.json
ortho.tif       or   z22.rgba       the imagery
rows.json                           the field's rows (optional: three clicks in fixture.json instead)
objects.json                        weeds a model found (optional)
truth.csv                           the quadrats
```

### fixture.json

```json
{
  "name": "example-orchard",
  "crop": "apricot",
  "ring": [[38.3512, 38.3101], [38.3512, 38.3122], [38.3497, 38.3122], [38.3497, 38.3101]],
  "raster": { "kind": "geotiff", "file": "ortho.tif" },
  "rows": "rows.json",
  "objects": "objects.json",
  "photoBased": false,
  "truth": "truth.csv"
}
```

| Key | What it is |
|---|---|
| `name` | The fixture's name: the report is `docs/eval/<name>-<date>.md`. |
| `crop` | The field's crop as it would be on file, or `null`. It sets the crop group and the action point exactly as in the app. A row crop (corn, soybean, cotton, wheat and the like) without layout rows is refused, as the app refuses it. |
| `group` | Optional: `"orchard"`, `"wide-row"` or `"cereal"`, to override the group the crop gives. |
| `ring` | The field boundary: `[lat, lng]` pairs, or the path of a GeoJSON file holding one Polygon (or a Feature or FeatureCollection with one). |
| `raster` | The imagery, either form below. |
| `rows` | The path of a `FieldRows` JSON (`src/lib/weedVision/fieldRows.ts`: what the app reads or fits; a saved planting layout has `"source": "layout"`), or `{ "clicks": [[lat, lng], [lat, lng], [lat, lng]] }`: two neighbouring plants in one row and one plant in the next row, fitted with the app's planting-layout fitter as the operator's three clicks are, or `null` for no rows. |
| `objects` | Optional: a JSON array of the app's `FrameDetection` or `GroundPlant` records (weeds with `centre`, `areaM2`, `diameterM`, `klass: "weed"`). Without it the grade runs on Stage 1's pixels alone, as it does after "Scan this field" with no model run. |
| `photoBased` | `true` when the objects came from the kept photographs (seen-in counts then matter for the tier). Default `false`. |
| `canopyClosed` | Optional `true` or `false`; left out, it is read from Stage 1 as the app reads it. |
| `truth` | The path of the truth CSV. |

**The imagery**, in one of two forms:

- `{ "kind": "geotiff", "file": "ortho.tif" }`: an orthomosaic GeoTIFF in EPSG:4326, EPSG:3857 or a WGS 84 UTM zone
  (EPSG:326xx north, 327xx south), the projections ODM and most drone software write. Bands 1 to 3 are red, green and
  blue; a fourth band is alpha; a pixel zero in every band is no data. It is resampled onto Web Mercator pixels at
  the zoom nearest its own pixel (never finer), each output pixel the mean of up to 4 x 4 samples. Read with
  geotiff.js, already a dependency of the app's orthomosaic import (`src/lib/orthoImport.ts`), so the harness adds no
  dependency. Anything else, reproject first: `gdalwarp -t_srs EPSG:3857 in.tif ortho.tif`.
- `{ "kind": "rgba", "file": "z22.rgba", "z": 22, "left": 520703613, "top": 429340293, "width": 1748, "height": 1165 }`:
  raw RGBA bytes, `width * height * 4`, row-major, in Web Mercator global pixels at zoom `z` (pixel (x, y) is global
  (left + x, top + y)). This is what `research/weed-vision-lab/scripts/prep_two_stage_trial.py` writes for the
  orchard trial frames. A raster finer than the read zoom is box-filtered down to it.

The grade reads at the zoom whose pixel is nearest 4 cm (`fieldReadPlan`), so imagery finer than that is read
coarser, as in the app.

### truth.csv

One quadrat per line: a north-up square on the ground, its centre, its side, the weed cover share of its ground and
its object count. A header names the columns, in any order; `id` is optional; lines starting with `#` are comments.

```
id,lat,lng,side_m,cover,count
q1,38.35081,38.31104,1.0,0.12,9
q2,38.35077,38.31139,0.5,0,0
```

| Column | Meaning |
|---|---|
| `lat`, `lng` | The quadrat's centre, WGS 84. |
| `side_m` | Its side, metres (0.5 m and 1 m are the common frames; at least one 0.5 m grade cell, better two or more). |
| `cover` | Weed canopy cover of the quadrat's ground as a share, 0 to 1 (12% is `0.12`; a percent over 1 is refused). Measure it on the ground the grade sees: between the rows, off the crop's canopy. A quadrat on a tree row is not assessed by the grade and is listed, not scored. |
| `count` | Weed plants (objects) rooted in the quadrat. |

Say how the truth was made (who, when, which frame or field visit, photographs) in a `truth.md` beside it: the report
is only as good as the truth.

## What the report says

- **Per quadrat**, predicted cover and count against truth, and the **mean absolute error and bias** over the quadrats
  scored. The grade's cover for a quadrat is the overlap-weighted weed over visible ground of the cells it covers, the
  same measure the grade classes on. A quadrat is scored when at least half of it lies in assessed cells; the rest are
  listed, never scored as weed-free.
- **At the scheme's action point**, a confusion matrix of act / don't act with precision and recall. The truth acts
  when its cover is at or over the action point; the grade acts when at least half of the quadrat's assessed overlap
  is in cells classed at the action point or over (the cells the map draws red, judged over the 2.5 m treatment unit).
- **Patch IoU**: the grade's patch cells (5% cover over the unit, 8-connected) against the truth quadrats at or over
  the action point, by area, inside the quadrats only (the truth says nothing outside them). The same with the cells
  classed at the action point beside it.
- **Not assessed**: the cells inside truth quadrats the grade could not judge, counted once each by reason
  (no rows, partly imaged, mostly crop row, shadow, too little ground, outside the field).

## The fixtures here

- **Synthetic** (`synthetic.ts`, made in code): a 40 x 30 m orchard of bare soil, crowns 1 m in radius on a
  6 x 4 m lattice, and twelve 3 m weed patches of small green discs between the rows, the truth counted off the painted
  pixels. Every pixel is soil or plainly green and every quadrat sits on whole cells, so it must score near zero error;
  `src/test/pressureEval.test.ts` holds it to that. A failure there is a defect in the harness or the grade.
- **Orchard trial frames** (`orchard.ts`): the five orchard frames of the two-stage trial with their fitted layouts
  and cached RF-DETR windows, read from `D:\swardus-research\weed-vision-lab-outputs\two-stage-trial-2026-10-19`. No
  truth exists for them, so they give the grade's own counts (confirmed, action cells, escapes) before and after a
  change, not accuracy.
- **WeedsGalore** (`fixtures/weedsgalore/`): a placeholder for the row-crop reader. See its README.
