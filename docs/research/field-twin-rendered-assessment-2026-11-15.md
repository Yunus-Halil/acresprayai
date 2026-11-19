# A rendered Field Twin: product value or cosmetics? (2026-11-15)

- **Asked by:** the founder, after seeing the photo-ground preview. He wanted a recognisable rendered field (Field / Scouting / Geometry), not photographs projected flat.
- **Method:** five investigations, each run separately and read-only:
  - the viewer;
  - the stored data;
  - the photographic work;
  - external practice and literature;
  - user value.
- **Then:** three independent judgements (agronomist, graphics engineer, sceptical product lead) and a claim-by-claim check.
- **Nothing in either repository was changed.** All numbers come from read-only scripts over the stored twins. The private flight was processed only on this computer. Below it is called "the private early-stage corn flight".
- **Tags:** [V] measured or read in the code. [H] estimate or judgement.

## 0. What I got wrong

- **Section 6 of the 2026-11-14 visual research turned his three modes into "Field lens / Evidence lens / Founder diagnostics".** It kept the shape of his idea but **changed what the Field mode is made of, from rendered to photographic**.
  - That was presented as a recommendation, not as a disagreement for him to decide.
  - Its premise, "you trust only what you see drawn over imagery", is a *verification* preference. It is a strong reason for a photo verification mode. It is not proof that a photograph should be the field.
- **Section 3B rejected rendering for reasons that hold only for rendering from the *detections*.**
  - It never considered rendering the *observed vegetation*.
  - It also over-counted: "about 35k plants" includes 13,818 objects between the rows. The crop candidates number 18,912 [V].

## 1. What the visualization problem actually is

There are two problems, and fixing one does not fix the other.

### 1. Design and hierarchy: why it looks like CAD even on clean data

- The public test twins have clean rows and no plants at all, and they still read as a technical drawing.
- What causes it [V, `TwinCanvasLayer.ts`, `style.ts`]:
  - **Colours:** neon colours chosen to stand out over photographs, drawn on a near-black ground.
  - **Ground:** three near-blacks, no soil.
  - **Fixed pixel sizes:**
    - A plant is a dot of radius clamp(0.025·px/m, 1.4, 4) px, so at full zoom a 5–25 cm seedling is an 8 px dot.
    - A row is a 1.5–6 px cyan line, where a real row is a 10–30 cm band of leaves.
  - **Certainty shown by glyph:** dot, ring, grey dot, ×, and five dash patterns.
  - **Plants never green, by design.**
  - **Nothing to scale:** no zoom ever shows the field at its real dimensions.
- **Hierarchy:**
  - Every stop of the Detail dial draws the diagnostic vocabulary: stretches and certainty classes.
  - For corn the dial changes almost nothing; only `vegetation` and `cornUncertain` move.
  - No layer draws the crop as vegetation. The missing piece is a renderer layer, not a control.
- **Cost:** today's look is also the most expensive one. Stroking 35k arcs took about 370 ms per whole-field frame in a headless desktop benchmark (unverified on devices).

### 2. Reconstruction: what caps any honest plant-by-plant rendering (private flight)

- **Plants are points only.** `plants.json` has no size or shape.
  - The reader computes a shape for each plant (`greenPoints.ts:113-131`, `PlantShape` area, solidity and width) and a typical size per photo (`typicalPx`).
  - Both are thrown away (`cornV1.ts:371`, `cornField.ts:161`) [V].
- **Located plants per metre of drawn row:**
  - Mean 3.18 [V].
  - That is 43 % of a plausible 7.4/m. The plausible figure assumes the along-row spacing peaks at 12–14 cm; the true seeding rate is unknown [H].
  - 28 % of metres are empty [V].
- **The misses follow the flight, not the field:**

  | Photographs covering the metre | Plants per metre |
  |---|---|
  | 5–9 | 0.8 |
  | 25+ | 4.7 |

  [V] Empty metres come in runs: 38 % of empty metres are in runs of 5 m or more, against 0.65 % if they were random [V].
- **The twin already refuses to call these gaps:** 3,333 stretches with no plant seen are left out (twin note) [V].
- **"About half the plants have no dot" overstates the misses.**
  - The 65.5 % counts green *pixels* on rows more than 4 cm from a dot.
  - The leaves of a located plant that reach past 4 cm also count [V, `photoGroundCheck.ts:110-127`].
  - Per metre, 43 % is the defensible figure.
  - The true stand is **unmeasured**.

**In one line:** with perfect detections it would still look like CAD (design); with perfect design, a field built plant by plant would still draw the detector, not the field (reconstruction).

### Known but not shown

- **Plants per metre for each row.**
  - 98 rows with stats; q10/50/90 = 0.6 / 1.9 / 4.7 [V].
  - Shown only in the row inspector. Every row is the same cyan.
- **Plant spacing.**
  - Mode 12–14 cm [V].
  - The twin stores `plantSpacingM = 0`.
- **Green between the rows.**
  - 13,818 points [V].
  - Grey × marks, at Full only.
- **Per-photo vegetation hulls.**
  - 3,114 in `analysis.json` [V].
  - Not read by the viewer.

## 2. What a genuinely rendered field could be

There are two different things that could be called a rendered field.

### C. Rendered from the detections (plants drawn where Swardus located plants)

- **Early corn: fails.**
  - It would draw about 43 % of the plausible stand.
  - Bare stretches would follow the photo coverage, so it would look like a replant field. That is not invented plants but **invented absence**, in the most trusted visual form there is.
  - Size and shape are not stored.
- **Orchards: honest today.**
  - Every tree has a measured crown radius (q50 1.08 m) that repeats across views (CV 0.048) [V].
  - So per-tree crowns at measured size are measurement, not illustration.

### D. Rendered from what was observed (recommended for row crops)

The ground is built from what every pixel of the photographs showed, with the twin's structure on top:

- **Soil:**
  - colour sampled from the photographs on a 25 cm grid;
  - typical soil RGB about 150/139/115, varying 14–17 per channel across the field [V];
  - about 43 KB for this field [H].
- **Vegetation:**
  - the green mask at 1.6 cm, about 1.15 MB/ha [V];
  - in the measured leaf colour, olive RGB about 85/79/53 [V], not stock "corn green".
- **Rows as bands at their real width, toned by the green measured along them:**
  - at field zoom this is how the rows stay visible;
  - seedlings vanish from any raster between 3.2 and 6.4 cm/px [V].
- **Up close, each located plant as its own observed outline:**
  - taken whole from the most overhead photograph that saw it;
  - not merged across photographs, because the 6 cm camera residual is the size of the plant [V/H].
- **Unknown ground as its own state, never soil-coloured.**

Two dimensions are enough. Three dimensions add nothing at this stage: the seedlings are about as tall as the camera residual.

**Measured, inferred and illustrative:**
- **Measured:** soil colour, green mask, coverage, plant positions, plant outlines (size only as coarse classes: the same plant's area varies 1.5× between photographs, CV 0.18 [V]).
- **Inferred, and labelled so:** the course of a row through unconfirmed stretches; the band width.
- **Illustrative:** none allowed. Leaf shape, height and orientation would all be illustration for corn.

### Feasibility

- **Canvas 2D is enough** for soil, bands, mask tiles and outlines (benchmark: whole field 16–73 ms in the cheaper styles, headless desktop).
- **WebGL** would be needed only for smooth animated zoom over 35k or more instances, or for live photo warping.
- **iPad timing: none measured.**

## 3. Is it useful? (critical)

### Evidence against the premise

- **No commercial platform renders a synthetic field.** Sentera, Taranis, DroneDeploy, Agremo, Solvi, Pix4Dfields, Aerobotics, FieldView and Deere all show imagery or a plain map plus aggregates (heatmaps, zones, sample dots), each clickable to the source photo.
  - Synthetic crop rendering exists in the industry only to train models.
- **The display literature** (Smallman & St. John; Hegarty et al. 2012; Chong 2018; St. John et al. 2001):
  - people, experts included, prefer realism;
  - realism usually slows or worsens focused judgements;
  - users misjudge which display served them better;
  - realism helps orientation ("where am I") and shape understanding.
- **Early-corn decisions are numbers against a target:**
  - stand per acre against the seeding rate (Purdue AY-264-W);
  - uniformity;
  - skips in multiples of the spacing;
  - weed stage against the critical period.
  - A picture answers none of them.

### Where a rendered field genuinely helps

- **Orientation:** "this is my field, this part, this stage".
- **Persistence for participants.** Under the approved terms, photographs cannot be kept, so a reopened twin shows a participant no imagery at all (`PilotTerms.tsx:37,57`). An observed-vegetation layer is the only recognisable field they could keep. A raster mask may still need a line in the terms; per-plant outlines plausibly fit "the rows, plants and findings it measured" (:43). This is a legal call for him.
- **Rural links:**

  | Layer | Size |
  |---|---|
  | Vector twin | about 0.4 MB gzipped |
  | Mask | about 1.2 MB/ha |
  | Photo overview | 4.8–6.7 MB/ha |
  | Photo detail | 57 MB/ha |

- **Communication:** with a landowner, a banker, or a demo.

### Where it is equal or worse

- **Equal on every decision:** stand, replant, weed timing.
- **Worse for auditing:** stylisation removes the check that a photograph gives.
- **Harmful** if any bare-looking metre is really a detector or coverage hole.

### Claims that need people, not code (viewing tests, no labelling)

1. A 5-second test: "what is this, what stage, is it even?", on geometry, photographs and the rendering.
2. **The safety test:** "where would you replant?" on the rendering alone, then reveal the photographs. Count the marks that land on stand the photographs show.
3. The same test with unknown ground drawn as its own state.
4. Time and confidence to find a planted gap.
5. "Which would you send your landlord?" This is preference only, kept apart from accuracy.

## 4. The plants Swardus misses

Use four states, and never draw "not seen" as soil.

| State | Field zoom | Up close |
|---|---|---|
| Soil, well photographed | Sampled soil colour | Same |
| Crop located (certain or probable, on a row) | Part of the row band's tone | Its own observed outline, crisp edge; probable at lower opacity; certainty by emphasis, not glyph |
| Green seen, not identified (on-row unlocated, between rows) | Mask in a muted grey-olive, no outline; never the crop colour, never called a weed without a finding | Same |
| Inferred row (unconfirmed course) | Band edges only, no fill | Same; centrelines only in Geometry |
| Not photographed | Grey hatch | Same |
| Thinly photographed | Light veil (see below) | Same |

**New measurement: the mask is not free of the coverage artefact either** [V, the check's own run over 4,983 one-metre bins]:

| Photographs covering the metre | Green on the row | Same width half a spacing across |
|---|---|---|
| 0–9 | 12.2 % | 7.6 % |
| 25+ | 21.7 % | 0.6 % |

- It is less dependent on coverage than the dots: −31 % on confirmed rows, against −52 % for plants.
- It is still dependent. Seedlings in far, oblique views fall under the threshold [H].
- **So the veil for thinly photographed ground is required, not optional.**

**Skip candidates from pixels.**
- 275 well-photographed metres (20 or more photographs) have no located plant [V]:
  - 75 % of them still show at least 2 % green;
  - their median green is 3.9 %, against about 24 % on confirmed rows.
- "Row ground with almost no green in any photograph that saw it" is therefore measurable.
- That, not the rendering, is what would give Scouting something true to show. Today this flight has 0 gaps and 0 confirmed weeds.

## 5. Was the photographic work a mistake?

- **As engineering: no.** These parts are exactly what an honest rendered field needs:
  - camera alignment;
  - `pixelToGround`, `groundToPixel` and `groundSampleAt` (real metres per pixel);
  - footprint rings with the lens fold-back guard;
  - nearest-nadir selection;
  - gains between photographs;
  - the alignment check, which becomes the rendered layer's acceptance test;
  - evidence views and selectable plants;
  - the device check and the memory fixes.
- **As product direction: partly.**
  - The photographs as the *default ground* do not advance his concept.
  - So it goes for the founder-only overview integration, the panel and the drawing tuned to sit over photographs, and most of the retention research.
  - They remain right as the **verification lens**: one tap from any object to every photograph that saw it. Sentera and Taranis build trust the same way.
- **Rough tally [H]:** path D keeps about 65–75 % of the branch.

## 6. The paths compared

| | A: better geometry | B: photographs + overlays | C: plants rendered from detections | **D: field rendered from observations, photographs as evidence** |
|---|---|---|---|---|
| Feasibility | High | Built | Medium (size not stored) | High (inputs exist) |
| Looks like a field | No | Yes | Yes | Yes from mid stage. At very early stage, honestly: soil with faint stripes |
| Honest | Yes, illegible | Yes | **No** (invented absence) | Yes, if the four states and the veil hold |
| Participant can keep it | Yes | **No** (terms) | Yes | Likely; the mask may need terms wording |
| Rural link | ~0.4 MB | 5–57 MB/ha | ~1.5 MB | ~1.2–2 MB/ha |
| Decision value | Only if stand and skips are measured | Checking | Negative on stand | Orientation, plus uniformity of cover along rows |
| Corn / soy / orchard | All | All | Orchard only | Corn and soy until canopy closes (Day045's control is already 28 % green, so the tone must become row-minus-inter-row contrast). Orchard: use C. |

**Recommendation: D for row crops, C for orchards, B as the one-tap evidence lens, A reduced to the founder-only Geometry mode.**
- Two of A's fixes are owed whatever the choice: metric widths, and no stroke over 35k arcs.
- His three tabs map onto this:
  - **Field** = D;
  - **Scouting** = D dimmed, with findings and low-cover row bins brought forward;
  - **Geometry** = today's Full + Diagnostics.
- A mode axis is cheap in `style.ts`.
- One challenge to the concept: the concept's "Field, overlays hidden" is the mode least tied to any decision. It should be the ground every mode sits on; Scouting should be the default.

### What is missing, more than the rendering

1. Keeping `PlantShape` and `typicalPx`, as coarse size classes.
2. Green cover per row metre, with a coverage count.
3. Pixel-based skip candidates.
4. A seeding-rate input, so a stand can be stated against a target, as decision support.
5. Terms wording for a stored mask.
6. A mid-season grower corn flight and a soy flight.
7. Device timing.

## 7. The smallest convincing experiment (about 2.5 days, offline, nothing in the app)

- **Dataset: the private early-stage corn flight, on this computer only.**
  - It is the hard case: 97 % soil at field scale, low recall, and the only twin with plants and field-wide detail tiles.
  - Day023 runs as a stage reference only. It already looks like a field (41 % green) and has no plants, so it cannot fail.
- **Script:** a throwaway script in the scratchpad reads the stored `pg/detail`, `twin.json` and `plants.json` and writes PNG stills.
  - It writes nothing back.
  - The detection and reconstruction outputs cannot change.
  - The stills stay on this computer: never committed, never published.
- **Layers:**

  | Layer | Status |
  |---|---|
  | Soil colour grid | Measured |
  | Green mask at 1.6 cm | Measured |
  | Coverage hatch and veil from the footprints | Measured |
  | Row bands toned by green per 25 cm | Inferred |
  | Plant outlines from the nearest-nadir blob | Measured |
  | Anything illustrative | None |

- **Views:**
  - the whole field (~5 cm/px), a 40 m block (1.6 cm/px) and a 3–4 m patch (0.4–0.8 cm/px);
  - six windows chosen by coverage, not by eye;
  - each window side by side: today's geometry, photo ground, D, and a C control (located plants drawn as plants on soil).
- **Measured gate, before anyone looks:**
  - row-minus-control green by coverage stratum, printed with the stills;
  - known now: raw green falls with coverage, so the veil must carry it;
  - stop if the veiled render still shows thin-coverage ground as thin stand.
- **What the founder looks at:**
  1. The D field still alone: "What is this, what stage, where is the stand thin, where would you check for replant?"
  2. Then the photographs are revealed.
  3. Twenty random 2 m row windows, render then photograph: "same / thinner / fuller".
  4. Optionally, an agronomist does the same.
- **Go if all of these hold:**
  - recognised in 5 seconds;
  - at most 1 replant mark on stand the photographs show;
  - at least 16 of 20 windows "same";
  - no window shows soil-coloured bare row over photographed plants;
  - about 2 MB/ha or less;
  - preferred over charcoal as the base.
- **Stop if any of these happens:**
  - the veil still reads as bare ground;
  - D at field zoom adds nothing over the photo overview;
  - weeds and verge dominate it.

  In that case B stays the checking tool, and the effort goes to measurement (stand against target, pixel skip candidates) instead.
