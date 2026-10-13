# Field-testing readiness: Swardus open-row weed intelligence

2026-10-13, at the end of the last planned algorithm sprint before the feature freeze. What
is in place, what each step needs, and what would block a real test. "Verified" below means
unit tests and generated images, unless it says "in the browser".

## Checklist

| Step | State | What to do on the day |
|---|---|---|
| Upload and analysis end to end | Built; not yet run on a flown field in the browser by the founder (owed since 2026-10-08) | Upload the flight with "keep original photos" on; wait for ODM; open the scan; run the scout; let the photo pass finish |
| Detection overlays in the app | Built: spots, pattern layer, vegetation layer (clean, measurement, diagnostic views), closer look with outlines; verified by tests and generated images, not in the browser | Open each view at zoom 17, 19 and 21; confirm the map stays responsive while panning |
| Crop / weed / uncertain on the map | Built: crop never a spot; uncertain grey; refused spots magenta in the diagnostic view | Check a field edge and a headland read as uncertain, not as weeds |
| Physical canopy measurements | Built: per spot, in its photo at native resolution, with confidence and refusal reasons; sizes unverified against the ground | Open ten spots; note the size line and the Measurements table; note any refusals and their reasons |
| Matching detections to ground-measured plants | Built: `npm run validate:sizes -- --truth plants.json --scan <id>` by spot id, position or photo pixel | Record each measured plant's spot id from the popup (fastest), else a receiver position |
| Ground-truth recording | Format and instructions in `docs/operations/ground-truth.md` and `scripts/bench/referencePlants.example.json`; detection labels via `scripts/annotate/annotate.html` | Twenty plants: two crossed widths with a tape, a photo straight down with a ruler, the spot id or position |
| Exporting results | Saved runs in `scan_patterns` and `scan_findings` (measurements inside the finding, generated columns for size); mission export as before; evaluation JSON from the bench scripts | After the review, "Save all" to the archive; copy the scan id for the validation command |

## Blockers for a real test

1. **Nothing has been run end to end in the browser on a flown field.** Every phase since
   2026-10-08 was verified by tests and generated images. The first flown field will be the
   first browser verification; budget a day for what it shows.
2. **The Air 3S drone enum for the flight planner is still unknown** (owed since the flight
   planning work); a plan exported for it may not load. Plan the survey manually if it fails.
3. **Photo-to-ground projection accuracy is unverified** (flat ground at one height; about
   0.2 m per metre of height error at the frame centre, 0.7 m at a corner). A receiver
   position per plant, or two surveyed landmarks visible in the photos, is what pins it.

## Not blockers, but known

- Weeds under about 6 cm at a 36 m flight are coverage, not spots (the pass's component
  floor at its decode scale): the one confirmed mechanism from image1, parked at the
  decision gate until exhaustive labels exist.
- Weeds that touch a continuous crop row are the row's component and so crop.
- Shaded, pale canopy is under-segmented by an unquantified amount.
- Size accuracy, detection precision and row accuracy are unverified; the benchmark tooling
  for each exists and waits for labels and measurements.
