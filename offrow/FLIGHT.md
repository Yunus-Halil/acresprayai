# Friday flight plan

One shot. The purpose of this flight is not pretty imagery. It is to answer one
question with measured data:

> **At what ground sample distance does off-row detection of a 3 cm weed stop
> working?**

Everything below serves that. If something has to be cut, cut it in the order
given in [If you are running out of time](#if-you-are-running-out-of-time).

A second thing is true and worth saying once: **the ground truth is the part you
cannot redo.** Imagery can be re-flown next week. A 3 cm weed that was not
measured, photographed and staked on Friday is gone, because it will be 8 cm by
then. Budget your time accordingly — the truth work is the expensive half.

---

## 0. Before you leave the house

### 0.1 Get the camera's three numbers

Nothing in this plan is a fixed altitude, because the altitude depends on the
camera and no camera has been committed to. You need, for the actual body you
are flying:

- **sensor width in mm** (the physical active area, not the "1 inch" marketing
  name)
- **pixels across** that width
- **true focal length in mm** (not the 35 mm equivalent)

These are in the manufacturer's spec sheet, and the focal length is also in the
EXIF of any photo the camera has already taken (`FocalLength`, not
`FocalLengthIn35mmFilm`). Take one photo of your hand and read it off. **Do not
guess**: the whole ladder shifts if the focal length is wrong.

Then:

```
offrow sensor --sensor-mm <W> --px <N> --focal-mm <F> \
              --cruise 8 --frame-interval 1 --frontlap 0.80 --sidelap 0.70 \
              --alt 10,14,20,29,40,58,80
```

and

```
offrow sensor --sensor-mm <W> --px <N> --focal-mm <F> --target-gsd-mm 5.5
```

which prints the altitude for the 5.5 mm/px target rung. Write the numbers on
the back of this page.

Also get the **shortest frame interval the camera will actually sustain** while
writing to the card. It is often slower than the advertised burst rate. If you
do not know it, measure it: point the camera at the floor, set interval shooting
to 1 s, run it for two minutes, and count the files. If it drops frames, use the
interval that does not.

### 0.2 Worked examples, so the numbers look familiar

At 8 m/s cruise, 1 s frame interval, 80 % frontlap, 70 % sidelap, over a 50 × 50 m
plot. `line-sp` is the spacing between flight lines; `3 cm px` is how many pixels
across a 3 cm weed lands on.

**1 inch, 20 MP, 24 mm equivalent** (13.2 mm / 5472 px / 8.8 mm):

| target GSD | altitude | swath | line spacing | lines | ground speed | lines time | 3 cm weed |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 2.7 mm | 9.8 m | 14.8 m | 4.4 m | 13 | 2.0 m/s | 5.5 min | 11.1 px |
| 3.7 mm | 13.5 m | 20.2 m | 6.1 m | 10 | 2.7 m/s | 3.1 min | 8.1 px |
| **5.5 mm** | **20.1 m** | **30.1 m** | **9.0 m** | **7** | **4.0 m/s** | **1.5 min** | **5.5 px** |
| 8.0 mm | 29.2 m | 43.8 m | 13.1 m | 5 | 5.8 m/s | 0.7 min | 3.8 px |
| 11.0 mm | 40.1 m | 60.2 m | 18.1 m | 4 | 8.0 m/s | 0.4 min | 2.7 px |
| 16.0 mm | 58.4 m | 87.6 m | 26.3 m | 3 | 8.0 m/s | 0.3 min | 1.9 px |
| 22.0 mm | 80.3 m | 120.4 m | 36.1 m | 3 | 8.0 m/s | 0.3 min | 1.4 px |

**Four Thirds, 20 MP, 24 mm equivalent** (17.3 mm / 5280 px / 12.29 mm) lands
within 3 % of the same altitudes: 10.1, 13.9, **20.6**, 30.0, 41.3, 60.0, 82.5 m.

So: **if your camera is a 20 MP mapping camera of either format, the target rung
is about 20 m and the ladder runs 10 m to 80 m.** A 50 MP 1 inch body doubles
every altitude (target rung 30 m).

### 0.3 Pack list

Flight:
- Aircraft, **all** batteries, charged. Charger and inverter if you have a vehicle.
- Two memory cards, both formatted. Card space for ~2000 frames.
- Tablet/controller charged. Sun hood.

Ground truth, which is the part that cannot be redone:
- **Tape measure**, 30 m, and a 5 m tape.
- **50 or more ground markers** for weed positions. Bright plastic tent pegs or
  golf tees with orange flagging tape. Small enough not to be in the frame at
  the weed itself — see §2.3 on where to put them.
- **Size-ladder targets**: matte green card or plastic, cut into discs of
  **1.5, 2, 2.5, 3, 4, 6 and 10 cm** diameter, five of each. The ladder is
  bunched at the small end on purpose: synthetic testing puts the whole
  transition between found and missed inside 1.8 to 3.6 cm at the target
  resolution, and sizes above 4 cm are all found and tell you nothing. Green, matte, not
  glossy. A garden centre's plastic plant label sheets work; so does painted
  card sealed with matte varnish.
- **A colour reference**: a grey card, or a colour checker if you own one.
- **Two scale bars**: any rigid object of accurately known length, 1 m and 2 m,
  laid flat and left in the scene for the whole flight.
- **Ground control points**: five, distributed. A 30 × 30 cm chequerboard on
  stiff board, or gaffer-tape crosses on plywood. Only needed if the aircraft is
  not RTK; see §5.2.
- **RTK rover or a good handheld GNSS** if you have one.
- Camera or phone for close-up photos of every marked weed, with a ruler in frame.
- Notebook and pencil (pens fail in dew), or a phone with a form.
- Knee pads. You will be on the ground for an hour.

---

## 1. Choose the plot

**One plot, 50 × 50 m, inside a single field, at least 30 m from any headland.**

Why 50 m: it is wide enough that the lowest rung still only needs a few minutes
of flying, and it is more than 60 rows across at 30 inch spacing, which is far
more than any row fit needs.

Why away from the headland: headlands break the row geometry and are excluded
from scoring anyway. Ground truth spent there is wasted.

Requirements, in order of importance:

1. **Corn at V2 to V6.** Four to six visible leaf collars. After canopy closure
   the whole method is out of scope.
2. **Weeds actually present, small, and between the rows.** Walk the field first.
   If the field is clean, you have no truth to collect; find a dirtier field or a
   dirtier corner. A weedy field is a *better* flight than a clean one.
3. **Flat.** Relief makes the low rungs hard to ortho and changes the GSD across
   the plot, which corrupts the very thing being measured.
4. **Uniform row direction.** Contour planting is handled by the code but adds a
   variable you do not want on the one day you have.

Mark the four corners of the plot with a GCP-style marker and record their
positions. Everything else references these.

**Measure the row spacing yourself.** Lay the 30 m tape perpendicular to the
rows, count the number of row centres it crosses, and divide. Do it in two places.
Do not write down what the grower says without checking it: the row spacing is an
input to the detector, and `rows.py` warns when the recovered pitch disagrees
with the supplied one by more than 10 %, which is a warning you want to be about
the imagery rather than about a number somebody misremembered.

---

## 2. Ground truth: the part you cannot redo

Do this **before** you fly, so the markers are in the imagery, and finish the
close-up photography **after** you fly, so you are not rushing the flying.

### 2.1 Lay the reference objects

Place, inside the plot and clear of each other:

- The **two scale bars**, one along the rows and one across them, at opposite
  corners. They stay put for every rung.
- The **colour reference**, flat, near one corner, in the open.
- The **five GCPs**, spread across the plot and not in a straight line, with one
  near the centre. Survey each one if you can.

### 2.2 Lay the size-ladder targets

This is what populates the small end of the size distribution, which is the only
end that speaks to the flight spec.

Lay a **target lane**: a 30 m line across the rows, marked at each end. Along it,
place the green discs in a repeating size order (2, 3, 4, 6, 8, 12, 16 cm), each
one **centred between two rows**, with a 1 m gap between consecutive discs.
Record, for each: its diameter, its distance along the lane from the start
marker, and which inter-row gap it sits in.

Then lay a **second short lane** of 3 cm discs only, this time deliberately
placed at varying distances from the row centre: on the row, a quarter of the way
out, half way, and at the midpoint. Five of each. This is what measures whether
the band fraction of 0.30 is the right call.

**Be honest about what these are.** A green plastic disc is not a leaf. It gives
an exact answer about the *detection floor versus size and GSD*, because its size
and position are known to the millimetre, and it gives a misleading answer about
*colour*, because its spectrum is not chlorophyll. That is why the colour
reference is in the frame, and why the real-plant truth below is not optional.

### 2.3 Mark and measure the real weeds

Walk the plot in transects. For every weed you find inside the plot, up to about
80 of them:

1. Push a marker into the ground **20 cm due north of the weed**, not at it. A
   marker at the weed hides the weed from the camera, which is the one thing you
   cannot afford. Note the offset direction in your notes and keep it the same
   for every weed.
2. Measure the weed's **widest canopy diameter** with the 5 m tape, in
   centimetres. This is the number recall is binned by, so it matters more than
   the species.
3. Note its **species** if you know it, or "broadleaf" / "grass" if you do not.
4. Note whether it is **in-row or between rows**, and roughly how far from the
   row centre.
5. Take a **close-up photo with a ruler in frame**.
6. Give it an ID and write it on the marker tape.

**Bias your effort hard towards the small ones.** This is not a general
preference, it is where the answer lives. On synthetic imagery at the target
resolution, recall goes from 0 percent at 1.8 cm to 100 percent at 3.6 cm, and
everything above that is found by anything. A 20 cm weed contributes nothing to
the finding. If you run short of time, stop recording weeds over 6 cm entirely
and spend every remaining minute on the ones under 3 cm.

Measure the small ones carefully, to the nearest 5 mm. At these sizes a 1 cm
error in the recorded diameter moves a weed a whole bin.

### 2.4 Record the crop

Ten plants, spread across the plot:

- **V-stage** (count leaf collars).
- **Canopy diameter**, widest, in centimetres.
- **Plant height** in centimetres. This sets the shadow length and it is the one
  number that makes a synthetic scene look like your field.
- **In-row spacing**: measure 10 consecutive plants along one row and divide.

And once for the plot: **row spacing** (§1), **row bearing** (compass, or from
two GCPs), and an estimate of **planter skip rate** — count gaps in 20 m of row.

---

## 3. Time of day

**Fly the main ladder within 90 minutes of solar noon.** High sun means short
shadows, and shadows are the dominant nuisance for a vegetation mask.

Then, if you have battery left, **repeat the 5.5 mm target rung late**, at a
solar elevation of about 30 degrees, with long shadows. This costs one short
flight and gives a matched pair — the same ground, the same targets, two shadow
regimes. `vegetation.py`'s whole shadow strategy is the chromaticity
normalisation, and this pair is the only way to find out whether it survives
contact with a real low sun. It is the highest-value optional flight on the list.

**Uniform overcast is not a disaster, it is arguably better** for the mask: no
shadows, even illumination, no hotspot. If Friday is flatly overcast, fly the
ladder anyway and note it — but then the low-sun repeat becomes impossible, so
say so in the log rather than leaving a gap.

**Do not fly in broken cloud.** Illumination changing between frames is the worst
case for a mosaic: the same ground gets two exposures and the chromaticity
normalisation cannot fix a scene that changed between captures. Wait for it to be
consistently clear or consistently overcast.

Wind: at the low rungs the aircraft is flying at 1.5 to 3 m/s. In 8 m/s of wind
it will crab and struggle to hold line spacing. Under 5 m/s is comfortable, over
8 m/s abandon the low rungs and keep the high ones.

---

## 4. The flights

### 4.1 Camera settings — get these right or the day is wasted

- **Manual exposure. Locked.** Auto-exposure between frames is the single most
  damaging setting for this work: it changes the RGB of the same ground between
  overlapping frames, and the chromaticity normalisation that handles shade
  cannot undo an exposure change. Meter once over the crop, lock it, fly.
- **Fixed white balance.** Daylight, not auto. Same reason.
- **Fixed focus**, at infinity or manually set on the crop. Autofocus hunting
  between frames changes the effective sharpness per frame.
- **Shutter 1/1500 s or faster.** This is not a preference; it is the motion
  blur limit. Blur in pixels is ground speed times exposure time divided by GSD,
  and at every rung from 2.7 mm to 11 mm the speed scales with the GSD, so the
  requirement comes out at the same 0.69 ms across the whole frame-limited
  ladder. At 1/1000 s the low rungs are visibly smeared and you will have flown
  an expensive blur test.
- **ISO** as low as 1/1500 s allows. Expect ISO 200–400 in good sun. Noise is
  less damaging than blur here.
- **Aperture** mid-range, f/4 to f/5.6 on most of these lenses. Wide open costs
  corner sharpness, stopped far down costs diffraction, and at 1.8 mm/px
  diffraction is real.
- **Shoot RAW + JPEG** if the card holds it. If you can only have one, JPEG is
  acceptable — but then record the picture profile, and do not use a "vivid" or
  high-saturation profile, which distorts chromaticity non-linearly.
- **Nadir.** Gimbal at −90°. Check it between flights; they drift.

### 4.2 Overlap

**80 % front, 70 % side.** Higher than the usual 75/65, deliberately:

- The low rungs have a large baseline-to-height ratio, which makes feature
  matching harder, and overlap is the cheapest fix.
- Corn at V4 is a field of near-identical small green objects, which is a
  genuinely hard matching problem. Over-overlapping is insurance.
- It costs ground speed, and ground speed is not the constraint on a 50 m plot.

### 4.3 The ladder

Fly, in this order. **The order is the priority order** — if you lose the
aircraft or the light after rung 3, you still have the answer's core.

| # | Target GSD | Why this rung | Cut? |
|---|---|---|---|
| 1 | **≈2.7 mm** (the lowest safe altitude, ~10 m) | The truth rung. A 3 cm weed is 11 px here, which is enough to hand-label from the ortho. Everything else is scored against what this one shows. | Never |
| 2 | **5.5 mm** | The target. This is the resolution a 30 m flight gives on a 50 MP body, and 20 m on a 20 MP body. The whole product hinges on this rung. | Never |
| 3 | **11 mm** | The pessimistic end of the plausible band. A 3 cm weed is 2.7 px, below the 4 px detection floor. Expect this to fail; that failure is data. | Never |
| 4 | **3.7 mm** | Fills the gap between 1 and 2. | If short |
| 5 | **8.0 mm** | Fills the gap between 2 and 3, and is where the floor is probably crossed. | If short |
| 6 | **16 mm** | | If short |
| 7 | **22 mm** | What a normal 120 m mapping mission gives. Included so the answer covers what operators actually fly today. | If short |

**Do not fly below about 10 m over the crop.** Multirotor downwash visibly moves
corn seedlings at low altitude — the plants are not where they were between one
frame and the next, which breaks both the ortho and the truth. The published work
this repo is chasing flew at 11 m for exactly this reason. If your camera cannot
reach 2.7 mm/px at 10 m, your finest rung is whatever 10 m gives, and that is
fine: write down what it was.

### 4.4 One larger pass, at the target rung only

After the ladder, fly **2 to 5 acres of the same field at the 5.5 mm rung**,
covering ordinary ground you have not truthed.

This is not for recall. It is for **false positives per acre**, which is the
metric the operator actually pays for and which a 50 × 50 m plot cannot estimate:
a quarter-acre plot gives a denominator so small that one spurious flag reads as
four per acre. A few real acres gives a number worth quoting.

### 4.5 Between every flight

- Land, swap the battery, **check the gimbal is still at −90°**.
- Confirm the card is still writing and the frame count went up by roughly what
  you expected.
- Write the log entry (§6) *before* the next takeoff. You will not remember.

---

## 5. What SwathWise's pipeline needs to turn this into orthos

The detector reads one orthomosaic per rung. What it needs from the ortho
process is narrow but non-negotiable, and two of the requirements are ones that
default settings get wrong.

### 5.1 Hard requirements — `io.py` refuses rasters that break these

1. **A projected CRS in metres.** UTM for your zone, or a state plane. **Not
   EPSG:4326.** Every threshold in this repo is in metres and a raster in degrees
   makes all of them nonsense. Most ortho tools will happily default to WGS84
   lat/lon; change it.
2. **Square pixels.** `io.gsd_m()` refuses a transform whose x and y scales
   differ, because "one metres-per-pixel number" has to be true for the
   ground-unit thresholds to mean anything.
3. **North-up, unrotated.** A rotated transform is refused for the same reason.
4. **One ortho per rung, each at its own native GSD.** Do not resample them all
   to a common resolution — the resolution *is* the independent variable, and
   resampling 11 mm imagery to 2.7 mm would produce a rung that measures nothing.
5. **All rungs in the same CRS**, so truth surveyed once applies to all of them.
6. **GeoTIFF, tiled, with overviews.** Tiled matters: the windowed reader decodes
   only the tiles a window touches, and a striped TIFF makes it read full-width
   strips instead.

### 5.2 Accuracy

The truth is surveyed on the ground and the detections come off the ortho, so
the two have to land on top of each other. The matching tolerance in `eval.py` is
25 cm by default.

- **With RTK/PPK on the aircraft**: good to a few cm. Still put out the five GCPs
  and process them as **checkpoints, not control** — they then measure the error
  rather than hiding it. Record the reported RMSE.
- **Without RTK**: the GCPs are control, and you need them. Absolute accuracy
  without GCPs is metres, which is ten times the matching tolerance and would
  make every detection a false positive and every weed a miss.

### 5.3 Settings that quietly ruin small objects

- **Blending: off, or minimal.** Multi-band blending and feathering average
  overlapping frames together, which smears exactly the few-pixel objects this
  whole exercise is about. Prefer a mosaic that takes each output pixel from one
  source frame. If the tool insists on blending, record the setting.
- **No sharpening, no contrast enhancement, no colour balancing between frames.**
  Any of these change chromaticity spatially and defeat the shadow handling.
- **Ortho resolution = native GSD.** Not "high" or "×2". Upsampling invents
  detail and the area-versus-GSD behaviour this repo measured becomes untestable.
- **Surface model**: a DSM is fine, but over a flat field at V4 it will be noisy.
  A plane or a smoothed DSM gives a cleaner ortho than a noisy mesh does.

### 5.4 Also keep the raw frames

Archive the original frames alongside the orthos. Two reasons: per-frame
detection with multi-view consensus is explicitly a later possibility and needs
them, and if an ortho turns out to have been built with blending on, the frames
are the only way back without re-flying.

---

## 6. The flight log

One row per flight, written before the next takeoff. Copy this into your
notebook now.

```
flight #        target GSD        altitude (m AGL)
time (local)    solar elevation   cloud: clear / thin / overcast / broken
wind (m/s)      direction
shutter         ISO       aperture      WB      focus
frontlap %      sidelap %  ground speed (m/s)   frame interval (s)
frames captured card #
gimbal checked at -90: Y/N
anything odd (gusts, a bird, a cloud shadow crossing, a dropped frame burst)
```

And once for the day:

```
field, plot corner coordinates, row spacing (measured), row bearing
crop V-stage, mean canopy diameter, mean height, in-row spacing, skip rate
weeds: count marked, size range, species seen
soil: dry / moist / wet patches present
last rain
target lane: start marker position, disc order, disc sizes
GCP positions and how they were measured
```

---

## 7. If you are running out of time

Cut in this order. Everything above a line is worth more than everything below.

1. Ground truth on the small weeds (§2.3). **Never cut.** This is the only
   irreplaceable thing on the list.
2. Rungs 1, 2 and 3 of the ladder (2.7, 5.5, 11 mm).
3. The size-ladder targets (§2.2).
4. The larger FP-per-acre pass (§4.4).
5. Rungs 4 and 5 (3.7, 8.0 mm).
6. The low-sun repeat (§3).
7. Rungs 6 and 7 (16, 22 mm).
8. Crop measurements (§2.4) — these can be estimated from the imagery later,
   badly, which is better than nothing.

---

## 8. What comes back, and what happens to it

Bring home:

- One ortho per rung, meeting §5.1.
- The raw frames.
- The truth notebook, transcribed into a CSV the same evening while it is fresh:
  `id, easting, northing, diameter_cm, species, in_row, notes`.
- The close-up photos, named by weed ID.

Then:

```
offrow detect --ortho <rung>.tif --boundary plot.geojson \
              --row-spacing-in <measured> --out cand_<rung>.geojson
offrow grid   --candidates cand_<rung>.geojson --cell-m 10 --out review_<rung>.geojson
```

and the truth CSV becomes the GeoJSON `eval.read_truth()` expects, with
`diameter_m` on every feature — **recall is binned by diameter and a truth file
without it cannot be scored the way this repo reports.**

The output is the recall-versus-GSD curve, per diameter bin, with the row-model
confidence plotted beside it so that a fall in recall can be attributed to the
right cause. The smallest bin is the one that answers the question at the top of
this page. Everything else is context.

Two expectations to carry into Friday, so neither result is a surprise.

**The rows are expected to hold.** On synthetic scenes the row geometry survives
all the way to 11 mm/px — a 76 cm pitch is 69 pixels even there — and what
degrades is the weed, from 17.6 px at 1.8 mm to 2.7 px at 11 mm. If the flown
data agrees, the flight spec is set by the weed and not by the rows. If it
disagrees, and the rows fall apart on real imagery well before the weeds do, that
is the more interesting result and it changes what `rows.py` has to become.

**The false-positive rate is the number this flight is really for.** On synthetic
imagery it is zero, at every area floor tested, which is a statement about
synthetic soil and not a prediction. Real soil has stones, residue and dry clods
that a chromaticity threshold will sometimes call green. The area floor in
`blobs.py` is what removes them, it currently sits at 1 cm2, and it is the one
parameter in the whole detector that cannot be set without flown imagery: too
high and it deletes the 3 cm target, too low and the operator drowns in flags.
The larger pass in section 4.4 exists to measure it. **Do not skip that pass
unless the aircraft is down.**
