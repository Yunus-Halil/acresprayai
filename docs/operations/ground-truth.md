# Ground truth for weed sizes: collecting it and checking Swardus against it

Until this has been done on twenty plants, every size Swardus shows is a consistent pixel
measurement with a confidence, not a verified one. `docs/features/weed-size.md` says so; this
is how to change that.

## In the field

Take about twenty plants, spread over sizes (a few under 10 cm, most 10 to 40 cm, a few
larger) and over the field. For each plant:

1. **Canopy diameter.** Two crossed widths of the canopy at its widest, from above, with a
   tape; record their average in centimetres. That is the equivalent-circle diameter the
   measurement reports.
2. **Canopy area, when you can.** A quadrat photo straight down with a ruler in frame, traced
   later, gives the area in cm². Skip it rather than guess.
3. **Which plant it is.** Any one of these, the first being the surest:
   - the spot's id from the app: open the spot, Measurements, the grey id at the bottom
     (`c-...`); or
   - a position from a receiver or a marker you can find on the map afterwards; or
   - the camera's filename and the canopy centre in the original photo's native pixels
     (open the original, not a resized copy).
4. Who measured, when, and anything odd (the plant was trampled, half in shadow, two plants
   you could not tell apart).

## The file

A JSON array, one object per plant; `scripts/bench/referencePlants.example.json` shows every
field and the rules. `diameterCm` is required, and one way to match the plant. Nothing the
software did not see is ever filled in for you.

```json
{ "fieldId": "north-block", "scanId": "<scan id>", "plantId": "c-spot-12", "lat": 38.9, "lng": -77.5,
  "diameterCm": 18, "areaCm2": null, "measuredBy": "Y.E.", "measuredAt": "2026-10-20", "notes": "" }
```

## Running the comparison

Against a scan's saved findings (the sizes the app made and stored), with the service-role
key in the environment as for the other benchmarks:

```
npm run validate:sizes -- --truth path/to/plants.json --scan <scan id>
```

Against the original photos directly, for plants that name a photo and a pixel (no pose: the
photo is measured flat, so this checks the segmentation, not the projection):

```
npm run validate:sizes -- --truth path/to/plants.json --dir path/to/photos
```

The report prints the match rate and how each plant was matched, mean and median absolute
diameter error, the median signed error (a bias shows here), the relative error, the area
error where you gave areas, the positional error where you gave coordinates, and the same
errors by pixel size and by the measurement's confidence. Under twenty measured plants the
verdict says accuracy is not established and the numbers describe those plants only. The
full record goes to `data/bench/validation/`.

## What the positional error can and cannot say

A plant's position in the app comes from the photo through the camera pose on a flat ground
plane at one height. The error at a plant is about (distance from the frame centre over
flying height) times the ground height error, plus whatever the orthomosaic itself is off
by. A receiver's position carries its own error, often a metre or more without
corrections. So a positional error under a metre says little; a consistent offset across
many plants in one direction says the ground height or the map is off, and that is worth
knowing. Ground control points surveyed in the field, or landmarks you can find in both the
photo and the map, are what would pin it down.
