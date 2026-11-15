# Build performance pass: four safe fixes, measured (2026-11-15)

- **Branch:** `feature/photo-ground` (commit a1a6f68 and the measuring tools before it). Not merged; photo ground is still founder-only.
- **Follows:** [photo-ground-founder-stage-2026-11-15.md](photo-ground-founder-stage-2026-11-15.md), section 4.
- **Setup:** measured on this laptop (12 logical cores, Windows 11, Chrome 157 headless) on the private 123-photograph corn flight, with photo ground on.

## What changed

Nothing in the detection, its thresholds, the plants, the rows or the camera fit changed.

1. **Tie rasters released** (`pool.ts` `release`, `cameras.ts`).
   - Each helper drops the grey rasters it holds as soon as the last tie round is over.
   - Before, they stayed until the build ended, through the whole corn stage.
2. **Memory-aware scheduling** (`build/concurrency.ts`). The page reports the device to the worker, because a worker cannot see a touch screen and iPadOS Safari calls itself a Mac.

   | Device | Helpers | Corn reads at once |
   |---|---|---|
   | Tablet or phone | up to 3 | 2 |
   | Browser stating 4 GB or less | up to 3 | 2 |
   | Browser stating 2 GB or less | up to 2 | 1 |
   | Anything else | cores − 1, up to 6 | 3, as before |

   The device check now shows the plan a build would use on the device.
3. **Ties balanced.**
   - Before: groups were split into contiguous runs with an equal *number of photographs* each.
   - Now: contiguous runs with an equal *number of pairs* each.
   - The runs stay contiguous so that each helper needs few rasters.
   - Ties are still sorted back into pair order. The rejection counts are now also in name order, so the report no longer depends on which helper answers first.
4. **Canvases and bitmaps freed immediately** (`browserPhotos.ts`, `freeCanvas.ts`, the detail worker, the evidence crops).
   - A bitmap is closed as soon as it has been drawn.
   - A canvas is shrunk to zero size as soon as its pixels have been read, instead of waiting for garbage collection.

**Over the photographs.**
- I was wrong earlier: the white dashed line that crossed the photographs was not the photo footprints. It is the **field edge estimated from the rows** (`boundary` layer, block source "rows").
- It is now hidden over the photographs. It comes back with **Full → Diagnostics → "Field edge from the rows, over the photographs"**.
- Without photographs it is drawn as before.
- The photo footprints were already a Diagnostics layer, off by default.
- The edge traced from what the photographs show, an edge the operator corrected, and the line where the flight ends are drawn as before.

## Equivalence

**Method.**
- `twinBuildProfile.mjs --outputs` keeps each build's results:
  - the twin (rows, plants, gaps, weeds, evidence links, footprints);
  - the analysis record (the aligned cameras and every photograph's corn read);
  - the camera report;
  - the overview manifest;
  - the SHA-256 of every file (the atlas and all 258 overview tiles).
- `outputsDiff.mjs` compares two builds field by field. It leaves out only the build's own clock (`builtAt`, timings, each helper's tie time, the helpers used).

**Result: every build of the new code is identical to the baseline.** That covers the three default runs, the traced run, the heap-sampled run, the tablet plan (3 helpers, 2 corn reads) and 3 helpers. The three baseline runs are also identical to each other.

**Unit test** (`buildConcurrency.test.ts`).
- Setup: 12 photographs of the apricot sample. Helpers 1 (inline), 2, 3 and 6, answering in a random order.
- Result: the cameras, the fit and the tie report are identical, and no helper holds a raster afterwards.

**One thing the test found, and why it does not affect the app.**
- A first version of the test let one helper's tasks overtake each other, so a tie task could run before a raster it needed arrived, and the cameras changed.
- A real worker takes its messages in the order they are sent, so this cannot happen in the browser. The browser equivalence runs confirm it.
- The test pool now keeps each helper's order.

## Measurements

Before and after runs were interleaved in the same session, each from its own worktree and dev server.

| | Baseline (3 runs) | After (3 runs) |
|---|---|---|
| Twin ready | 180.4 / 181.4 / 172.3 s (mean 178) | 163.3 / 175.4 / 178.4 s (mean 172) |
| Cameras | 62.1 / 65.1 / 59.4 s (mean 62) | 53.5 / 50.4 / 58.8 s (mean 54) |
| Corn | 113.0 / 111.5 / 108.7 s | 105.5 / 120.4 / 114.8 s |
| Peak, page process | 2.63 / 2.88 / 2.59 GB (mean 2.70) | 2.15 / 2.03 / 2.14 GB (**mean 2.11**) |
| Peak, all of Chrome | 3.25 / 3.24 / 2.95 GB (mean 3.15) | 2.51 / 2.40 / 2.50 GB (**mean 2.47**) |
| Page process once the twin is ready | 1.71 / 1.74 / 1.75 GB | 1.13 / 1.19 / 1.21 GB |
| Overview after the twin | about 6 s | about 6 s |

**Memory per worker** (heap-sampled runs; ArrayBuffers plus heap):

| | Baseline | After |
|---|---|---|
| Helpers during corn | 1,491 MB | 1,044 MB |
| Helpers once the twin is ready | 600 MB | 66 MB |

What the helpers still hold during corn is the photographs being read.

**Peak per stage** (page process, after):
- cameras 1.72–1.87 GB;
- corn 2.03–2.15 GB.

The cameras stage is now nearly the peak. That is why the ties stay in contiguous runs: dealing them out more freely would scatter the rasters over more helpers.

**Tie time per helper:**
- Before (trace): 51 / 44 / 43 / 33 / 20 / 9 s; the slowest was 1.5 times the mean.
- After (every run): for example 30–47 s and 29–45 s; the slowest is about 1.2 times the mean.

A pair's cost is not its count: it depends on the overlap and stops at 60 ties. So equal pair counts are close, but not exact.

**Plans compared** (one run each):

| Plan | Twin ready | Cameras | Corn | Page process peak | All of Chrome |
|---|---|---|---|---|---|
| Laptop default (6 helpers, 3 corn reads) | 163–178 s | 50–59 s | 105–120 s | 2.03–2.15 GB | 2.40–2.51 GB |
| 3 helpers, 3 corn reads | 206 s | 84 s | 118 s | 2.01 GB | 2.37 GB |
| **Tablet plan** (3 helpers, 2 corn reads) | 245 s | 87 s | 154 s | **1.70 GB** | 2.06 GB |

- With the rasters released, 3 helpers now save only 0.1 GB on a desktop and cost about 30 s, so the desktop keeps 6.
- The tablet plan costs about 70 s and saves another 0.4 GB.

**Processor use** (traced run).
- The helpers are busy about 52 % of 6 × 178 s.
- Three helpers read corn for about 140 s each. The other three finish their ties in 35–48 s and then wait.

| Run | Corn read CPU per helper (same code) |
|---|---|
| Trace taken earlier today | 88 s |
| This trace | 103 s |

The machine was slower in this session, so CPU totals from different sessions cannot be compared; the interleaved runs above can.

## What it amounts to

- **Memory: about 0.6 GB less at the peak, measured.**
  - Page process: 2.70 → 2.11 GB.
  - All of Chrome: 3.15 → 2.47 GB.
  - Page process once the twin is ready: 1.7 → 1.2 GB, which matters while the founder looks at the twin with photographs on an iPad.
- **Time: the cameras stage is about 8 s faster.** The whole build is not measurably faster: 178 → 172 s is inside the spread of single runs (157–182 s).
- **Why.** The build waits on the corn reads, about 110 s on three helpers. Nothing approved in this pass changes that.

## iPad risks that remain

1. **Canvas size, unchanged by this pass.** A corn read still draws the 20.9 MP photograph on one canvas. An iPad on iPadOS 17 (limit 16.7 MP) will likely fail every corn read, whatever the memory. The device check answers this in seconds. If it fails, the next step is a tiled decode that keeps the reader's full resolution, which needs your approval.
2. **Memory.**
   - The tablet plan peaked at 1.70 GB in Chrome on this laptop. Safari counts differently, and the iPad's limit is not published.
   - 1.7 GB may still be too much for some iPads. Less memory is not the same as iPad compatibility.
   - The stopped-build marker reports the stage at which Safari stopped a build.
3. **Time.** About 4 minutes on this laptop with the tablet plan. An M-series iPad may be close to that; an older one will be slower.

## Next, each needs your decision

- **Corn reads on more helpers on a desktop.** Section 4's item 6: results identical, about +0.3–0.5 GB a read. The peak is now 0.6 GB lower, so a desktop could afford 5–6 reads at once: corn about 110 → 60 s, twin about 170 → 120 s. Not done, because it was not in this pass.
- **A faster FFT.** Not bit-identical; not done, as you asked.
- **Fewer photographs read for corn.** This changes the results; not done, as you asked.
