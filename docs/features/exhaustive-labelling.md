# Exhaustive weed labelling (DJI_0301, two windows)

The 414 weed labels on DJI_0301 are points with no size, and nobody claimed they are every weed. A grade cannot be
scored on cover against them (`docs/eval/`). This is how to make the first truth that can: inside the two windows of
`evaluation/groundtruth/image1/regions-exhaustive.json` (image1-A at 3600, 2400 and image1-B at 150, 150, each
1200 x 900 photo pixels, about 12 x 9 m), **every** weed labelled, each with its size.

The tool is `scripts/annotate/annotate.html`, a page opened straight from disk; nothing is uploaded. Its arithmetic is
in `scripts/annotate/labelCore.js` (tested in `src/test/annotateCore.test.ts`).

## Opening a region

1. Open `scripts/annotate/annotate.html` in Chrome or Edge.
2. **Region image**: `evaluation/groundtruth/image1/DJI_0301.JPG` (the whole photo, so a weed on the outline is seen
   whole; the photo is kept on this machine only, not in git).
3. **Predictions**: `evaluation/groundtruth/image1/results/image1-full.predictions.json`. It places the image in the
   photo and sets **cm/px** (0.9864, from the camera's EXIF and its height: an estimate for flat ground). Without it
   a drag cannot set a size and a region cannot be opened.
4. **Earlier labels**: `evaluation/groundtruth/image1/DJI_0301.labels.json` the first time; afterwards your own latest
   export, so the sizes and tags you made are carried on.
5. **Exhaustive regions**: `evaluation/groundtruth/image1/regions-exhaustive.json`, then pick **image1-A** (or
   image1-B) under **Region**. The view fits the window, the photo outside it is dimmed, its outline is drawn in yellow,
   and the footer keeps the count: labels inside, with a diameter, without, and weeds sized of weeds.

## Labelling

- **Size a weed**: press on its centre, drag to the edge of its canopy, release. The disc is drawn at the size it
  stores (`diameterCm` = twice the drag in photo pixels times cm/px), so you can check it against the plant; drag
  again to correct it.
- **Size an existing point**: press on the label's centre (within a few screen pixels of it) and drag; that label
  takes the size, no new label is made.
- **A plain click** still makes a point label with no size, as before (or the size typed under "diameter cm").
- Classes: `1` weed, `2` crop, `3` uncertain (what the imagery cannot settle). `z` undoes the last label. Scroll to
  zoom; pan with the right button or Shift and drag.
- **`n`: next unsized.** Jumps to the next weed or uncertain label inside the active region that has no diameter yet,
  centres it, zooms in, and rings it in white. Size it, press `n` again. Crop labels are never asked for a size.

## The rules

- **A weed touching the outline is labelled if its centre is inside.** Its disc may run over the line. A weed whose
  centre is outside is left out, however much of it is in.
- **Every weed, however small.** Including ones under 5 cm (about five pixels across): zoom in until the plant fills
  a good part of the screen before dragging. If you cannot tell a speck from a weed, label it `uncertain` and size it.
- One label per plant. A clump you cannot split is one label with one disc round the clump; say so by labelling it
  `uncertain` if you are not sure it is one plant.
- Trees (`crop`) need no size; they are kept for the ground cut.

## What "done" means

A region is done when **every weed inside its outline has a disc**: the footer reads `weeds N of N sized`, `n` says
every label is sized, and a last pass over the window at full zoom finds no unlabelled weed. Then tick **every weed
labelled** and press **export JSON**.

## Saving

The export downloads as `<region id>.labels.json` (for example `image1-A.labels.json`). Every label whose centre is
inside the active region carries `exhaustiveRegion: "image1-A"`; labels outside it carry no tag (or the tag they came
in with). The file holds all the photo's labels, so it is also the "Earlier labels" for the next session. Move it to
`evaluation/groundtruth/image1/` and commit it. The harness takes only the tagged labels as exhaustive truth; the
untagged ones stay what they were, partial points.
