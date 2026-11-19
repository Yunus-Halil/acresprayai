# Photo ground: founder-only stage, device testing, performance (2026-11-15)

- **Branch:** `feature/photo-ground`. It follows [photo-ground-integration-2026-11-14.md](photo-ground-integration-2026-11-14.md).
- **Not merged to main.** No participant sees any of it, and the photo-retention terms are unchanged.
- **Measurement setup:** everything below was measured on this laptop (12 logical cores, Windows 11, Chrome 157, headless) on the private 123-photograph corn flight (5280 x 3956 photographs, about 0.9 ha), unless a field is named.

## 1. Founder-only access

| Who | Photo ground |
|---|---|
| The founder's own account (role `founder` in `pilot_members`, as the database states it) | yes, in every build |
| The founder previewing the participant experience | no (the preview shows what participants see) |
| A participant, an account outside the pilot, an account whose role is still loading | no |
| `VITE_FIELD_TWIN_PHOTO_GROUND=1` | on for everyone, **in a development build only**; a deployed build ignores it, so no deployment setting can turn it on for participants |
| `VITE_FIELD_TWIN_PHOTO_GROUND=0` | off for everyone, the founder too, in any build (the kill switch) |

**Where the gate sits.** It is `photoGroundFlag.ts` (`photoGroundAllowed`, `usePhotoGround`), and it gates every entry point:
- **The builds** (`TwinNew`, the workbench): only the founder's builds make the overview and keep the photographs in the tab.
- **The viewer** (`FieldTwinView`): the Photographs panel, the photographs behind a finding, and the key over the photographs.
- **The dev preview:** loads an overview only with the developer's switch, and shows none at `?audience=participant`.

**Direct addresses.**
- Photo ground has no page of its own; it only lives inside the founder's twin views.
- The new device check (section 2) is a founder route (`/app/device-check` under `FounderOnly`). A participant who types its address is sent home, like every founder tool.
- The dev preview route exists only in development builds.

**What the gate protects.**
- Like every gate in the browser, it decides what the app shows and does.
- Photo ground sends nothing and reads nothing from the account, so there is no server data behind it to protect.
- The code ships in the bundle, and the repository is public. Someone patching their own browser could run it over their own photographs. That is their own data on their own device.

**Tests** (`photoGroundUi.test.tsx`, `twinNewPage.test.tsx`):
- Every row of the table above.
- The founder's build is started with photo ground; a participant's is not.
- A participant, the founder's preview and a loading account see no panel, no evidence section and no overview request.
- The kill switch hides it from the founder too.

**A reopened twin.** The overview lives only in the tab that built the twin. A reopened twin shows the founder a short panel instead: "Shown only in the tab that built this twin: nothing of them is kept. Build it again on this device to see them." Participants see nothing.

## 2. iPad

**No iPad was available here, so nothing below was measured on one.** I cannot run iPadOS Safari from this computer. The WebKit build for Windows does not carry iPadOS's memory or canvas limits, so testing with it would mislead.

### Two risks found by reading the build against WebKit's known limits

1. **Canvas size.**
   - A corn build reads every photograph at its full size on one canvas (`browserPhotos.decode(1)`): 5280 x 3956 = 20.9 million pixels for this flight.
   - iPadOS Safari long refused canvases over 16,777,216 pixels. A developer's measurements put iOS 18's limit at 67 million pixels, but Apple does not document it.
   - On an iPad still on iPadOS 17, every corn read could fail. It would not crash; the build would say Corn V1 could not read any photograph.
2. **Memory.**
   - The build's page process peaks at 2.4–2.9 GB on this laptop (section 4).
   - Safari runs the page and all its workers in one web content process, and iPadOS stops a process that uses too much memory. The limit depends on the iPad and is not published.
   - A stopped build shows up as the page reloading, with the build gone.

### What is built so that the iPad test gives answers

**Device check (`/app/device-check`, founder only).** It runs only on the device, and "Copy the report" puts it all on the clipboard. It checks:
- The browser's facts: whether it is seen as an iPad, cores, the storage quota, and the features the build uses.
- **The largest canvas it draws**, in the page and in a worker, at 16.8 / 20.9 / 48.8 / 67.1 MP.
- **One of the flight's photographs read exactly as a build reads it.** That means the camera's preview, then the full size, with the time taken and whether the pixels came back empty, which is what a refused canvas does.

**The stopped-build marker (`buildTrace.ts`).** For the founder's builds only, the device keeps a small note of the build:
- the start time;
- the number of photographs;
- the stage reached;
- the last moment it was heard from (every 5 s).

It holds nothing from the photographs and is removed when the build finishes, fails or is cancelled. If a note is still there on the next visit, while no build is running, that build was stopped by the browser. New Field Twin and the device check then say so: "did not finish … last heard of 92 s in, during "corn" … on an iPad that is usually Safari running out of memory."

### The procedure (founder, on the iPad)

1. Sign in on the branch's preview. Open **Founder tools → Device check**, tap **Copy the report**, and paste it into a note. The "20.9 MP" rows answer the canvas question at once.
2. Still in the device check, choose **one** photograph of the corn flight. If "Full size" says *not read*, a corn build cannot work on this iPad yet.
3. Build from **30 photographs** of the flight in **New Field Twin** (Corn), with the iPad on power and no other tabs open. Note the time shown at the end. Open the twin:
   - Do the photographs show under it?
   - **Open the flight's photographs:** select the same 30 from Files or Photos.
   - Try **Sharper photographs for this view**.
   - Tap a plant and a row to see "Every photograph that saw it".
4. Repeat with **60**, then all **123**. After any build that vanishes or reloads the page, open the device check: the marker gives the stage and the seconds at which it stopped.
5. Send the copied reports and the counts that worked. That gives the largest flight this iPad can build today and the stage that limits it.

What I expect, and it is not measured:
- An M-series iPad with 8 GB or more and iPadOS 18 or later should pass the canvas check, but may run out of memory on the full 123-photograph build.
- An iPad on iPadOS 17 is likely to fail the canvas check.

## 3. Keeping the overview: research only, nothing built

The overview that would be kept is 259 JPEG tiles plus a manifest:
- 6.0 MB for the 123-photograph corn flight (6.7 MB/ha);
- 4.0 MB for the apricot block.

The detail tiles (57–69 MB/ha) are not a candidate, because they are re-cut in 1–2 s from the photographs.

### Three ways

| | A. Ephemeral (today) | B. IndexedDB on the device | C. Re-cut on reopen from cameras already saved |
|---|---|---|---|
| What is stored | nothing | the overview tiles and manifest, about 6–7 MB/ha, in this browser | nothing new: **the founder's corn twins already save their aligned cameras** in the analysis record (`analysis.ts`, `framesFromAnalysis`) |
| Reopened twin, same device | no photographs | photographs at once | photographs about 6 s after the flight's folder is opened again |
| Reopened twin, another device | no | no | yes, if the photographs are on that device |
| Detail and evidence | need the files | need the files | need the files (the same step opens them) |
| Imagery retained | none | derived imagery on the device until deleted or evicted | none |
| Terms (participants) | as now | needs a paragraph like the analysis outbox's: what is kept on the device, for how long, how it is removed | the record's terms say it "is not shown in the app"; using its cameras in the viewer needs those words changed. Twins without a record (orchards, participants without the v2 agreement) have no saved cameras |
| Work | none | a store keyed by account and twin, a delete path, a settings line | a loader for the record, then the existing `overviewGround` in a worker |

### How browsers treat option B

From the browsers' own documentation:
- **Quota is not the limit at 6–7 MB a twin.**
  - Chrome and Edge give an origin up to 60 % of the disk.
  - Safari 17 and later (iOS 17, iPadOS 17, macOS 14) gives about 60 % per origin and 80 % for all origins; Safari before 17 gave 1 GiB, then asked.
  - Firefox gives 10 % of the disk or 10 GiB in best-effort mode.
- **Eviction.**
  - Storage is best-effort unless `navigator.storage.persist()` is granted. Chrome and Safari decide silently, by heuristics; Safari grants it, for example, to a Home Screen web app. Firefox asks the user.
  - Under storage pressure the least recently used origin is evicted **whole**. That would also take the analysis outbox's waiting records, as it already would today.
- **Safari's 7-day rule.** With tracking prevention on (the default), Safari deletes all of a site's script-written storage, IndexedDB included, "after seven days of Safari use without user interaction on the site".
  - An operator who opens Swardus once per flight, every few weeks, would usually find the saved overview gone.
  - A Home Screen web app has its own counter, reset by using the app.
- **Private browsing** clears it when the window closes.

### Privacy (B)

A saved overview is an unencrypted picture of the grower's field, readable by anyone using that browser profile; a shared farm-office computer is the realistic case. Option B would need:
- every entry keyed by account and twin;
- other accounts' entries removed at sign-in, as builds already are (`releaseSessionOfOtherAccount`);
- all entries removed at sign-out, as the analysis outbox does;
- a twin's entry removed when the twin is deleted, and another device's copy removed the next time that device lists the twins;
- a "Remove the photographs from this device" control;
- the space used shown, from `navigator.storage.estimate()`.

### Recommendation

1. **Keep A for participants** until founder use shows that the photographs are worth keeping.
2. **For the founder, C is the better next step than B.** It retains no imagery, works on any device holding the photographs, and has no eviction or 7-day problem, because the cameras live in the account. It does need the photographs opened again: about 6 s plus the folder picker.
3. **Build B only if operators show they reopen twins without their photographs at hand**, and then with the deletion rules above.

Sources:
- [WebKit: Updates to storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [MDN: Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [WebKit: Full third-party cookie blocking and more (the 7-day cap)](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)
- [canvas area limits on iOS (16,777,216 px)](https://pqina.nl/blog/canvas-area-exceeds-the-maximum-limit/)
- [one developer's measurement of iOS 18's limit](https://lionpuro-com.pages.dev/posts/canvas-is-finally-usable-on-safari)

## 4. Where the 123-photograph build spends its time and memory

**Tools.**
- `scripts/directGeoref/twinBuildProfile.mjs` drives the same build as the benchmark. It samples memory per Chrome process every second, tagged with the stage. `--heaps` samples each worker's V8 heap and ArrayBuffer memory over the DevTools protocol; `--trace` records the V8 sampling profiler on every thread.
- `profileSummary.mjs` turns that trace into self and inclusive time per function, per thread.
- Nothing in the build was changed to measure it, except one development-only line recording when each stage starts.

### Runs (same flight, same code)

| Run | Twin ready | Photographs | Cameras | Corn | Page process peak | All of Chrome |
|---|---|---|---|---|---|---|
| default (6 helpers), memory | 182.4 s | 2.6 s | 63.1 s | 114.4 s | 2.87 GB | 3.23 GB |
| **3 helpers**, memory | 181.3 s | 2.5 s | 82.5 s | 95.0 s | **2.44 GB** | **2.79 GB** |
| default, CPU-traced | 163.2 s | 2.5 s | 56.9 s | 102.2 s | 2.85 GB | (trace inflates it) |
| default, worker heaps sampled | 157.3 s | 2.6 s | 54.4 s | 98.2 s | 2.93 GB | (DevTools inflates it) |
| 2026-11-14, main / flag on | 178.3 / 169.3 s | | | | | 2.78 / 2.76 GB (2 s sampling) |

- **Twin ready ranged 157–182 s across six runs of identical code.** A difference under about 25 s between two single runs is not a result.
- Sampling every second instead of every 2 s finds a higher peak: 3.2 GB, not 2.8.

### Time

Over a traced run, the build used **490 s of processor time**:

| Where | CPU | What |
|---|---|---|
| Corn V1 reads, helpers | **265 s** (54 %) | on **exactly 3 helpers, 88 s each** (`CORN_STAGE.maxParallel = 3`, a memory cap). Inside each 2.2 s read: the row reader and the emergence reader (about 1.1–1.2 s each, nested), the cell assessment 0.66 s, the seedling mask 0.34 s, the plant points 0.21 s |
| Soil ties, helpers | **200 s** (41 %) | split **51 / 44 / 43 / 33 / 20 / 9 s** over the 6 helpers. The FFT (`fft1`) is 108 s of it, window sampling 32 s, correlation 31 s |
| Build worker | 20 s | camera fit 5.3 s, plants first 6.1 s, field combination 2.1 s, overview 3.3 s, reading the photographs 1.3 s |
| Page | 0.4 s | React, progress |

On 12 cores the work would fit in about 45 s if it were spread evenly. It takes 160–180 s because:
1. **The corn stage uses 3 of the 6 helpers**, and the other 3 are idle for about 100 s.
2. **The ties are unbalanced.** Pairs are grouped by their first photograph in contiguous blocks, and early photographs have more partners. The camera stage waits for the slowest helper (51 s) instead of the average (33 s).
3. **The stages run one after another.** The corn reads need the aligned cameras' pixel size, so they wait for the whole camera stage.

The pairs are not wasted: 3,878 of the 4,270 pairs within 45 m really overlap (each footprint is about 43 m across). This flight's overlap is simply very high: every ground point is in about 30 photographs.

### Memory

Per worker, from the heap-sampled run (ArrayBuffers are the pixel and raster arrays):

| Stage | Build worker | Helpers (all 6) | Page process in total |
|---|---|---|---|
| after reading the photographs | 0.2 GB | 0.03 GB | 1.2 GB |
| cameras (ties) | 0.18–0.2 GB | **0.67–0.70 GB**: each helper holds 185–215 MB of tie rasters | 1.3–1.35 GB |
| corn | 0.18 GB | **1.1–1.2 GB**: the tie rasters **are still held**, plus 3 full-size reads | **2.1–2.9 GB** |
| after the twin | 0.18–0.29 GB | 0.56 GB, still held | 1.7 GB |

- The rest of the page process, about 1–1.4 GB at the peak, is outside V8's counters. The decode's image bitmap and canvas take about 170 MB per photograph being read; then come V8's own code and heaps, and garbage not yet collected.
- **The largest single waste is about 0.6–0.7 GB of tie rasters** that the helpers keep through the whole corn stage, after the cameras are done. They are copies: on this flight every photograph overlaps nearly every other, so each helper needs nearly all of them.

### Opportunities that change no result

Ranked by the gain for an iPad.

| # | Change | Expected | Result identical? |
|---|---|---|---|
| 1 | **Release the helpers' tie rasters when the cameras are aligned** | peak −0.6 to −0.7 GB (about 2.9 → 2.2 GB page process) | yes: nothing reads them after that |
| 2 | **Size the pool by memory, not cores**: 3 helpers measured the same total time as 6 (181 vs 182 s) at 0.44 GB less; on an iPad, 2 corn reads at once | −0.4 GB measured (3 helpers) | yes (the ties are sorted back into pair order) |
| 3 | **Balance the ties** by pair count across the helpers | cameras about 57 → 38 s | yes (same pairs, same order after the sort) |
| 4 | **Free the decode canvas and bitmap as soon as the pixels are read** | some of the ~170 MB per read in flight; measure | yes |
| 5 | **A faster FFT** (precomputed twiddles; two real windows in one complex transform) | ties 200 → about 100–130 s of CPU, cameras −10 to −15 s | **not bit-identical**: the last bits of the floats change, so a tie at a threshold could flip. Needs an equivalence run (tie count, residual, twin unchanged within tolerance) |
| 6 | **Corn reads on more helpers where memory allows** (e.g. 6 on a desktop with 16 GB) | corn about 100 → 55 s | yes, but +0.5 GB per extra read: a desktop-only choice |

**Not done, and each would need your approval because it changes what is detected:**
- reading fewer photographs for corn (each point is in about 30 of them; a subset sized for 3–5 views per point would cut corn time and memory several-fold, but changes the "seen by most photographs" votes);
- capping tie partners per photograph (changes the camera fit);
- starting corn reads on header cameras while the ties run (changes the pixel size the reader is given).

The three-minute build is dominated by **how the work is scheduled** (idle helpers, unbalanced ties, serial stages) and by the flight's very high overlap, **not by the photographic overview** (6 s, after the twin). Opportunities 1–4 are safe engineering, and I would do them first.

## 5. Founder visual acceptance

**Screenshots.** Every state you are asked to approve, for three twins: the 40-photograph Day023 corn test, the private corn flight, and apricot (28 of its 71 photographs are on this computer). Local only, because the private flight never leaves this machine; listed in the hand-over message:

1. the field;
2. the edge of the flight;
3. rows over the overview;
4. close, overview only;
5. close, with detail cut from the files;
6. a certain plant selected, with every photograph that saw it;
7. a row selected;
8. Full detail (probable plants and unconfirmed courses);
9. a probable plant selected;
10. an unconfirmed stretch selected;
11. the same twin as a participant sees it.

What I checked, and what needs your eye:

| | Result |
|---|---|
| Field overview | photographs under the twin; dark where nothing was photographed; the hatch only there |
| Individual plants | rings on the seedlings in the private flight (shots 4–6). **Fixed today:** a selected plant was not ringed on the map; it now is |
| Row geometry | cyan rows on the plant rows; on the header-only test flights, a few centimetres off at the closest zoom (the measured seams, 10 cm) |
| Original-photo evidence | every crop shows the plant inside its ring, in up to 4 photographs, nearest nadir first; 0.5–0.6 s |
| Close-up | detail in 1.1–2.9 s from 4–8 photographs |
| Coverage | the flight's edge reads clearly. **For your eye:** a white dashed line crosses the photographs, e.g. through the soil between two rows in the Day023 close-up. Over photographs it looks like a feature. (Corrected later the same day: it is the field edge estimated from the rows, not the photo footprints; it is now hidden over the photographs, see [photo-ground-performance-2026-11-15.md](photo-ground-performance-2026-11-15.md).) |
| Uncertainty | Full shows probable plants as dashed rings and unconfirmed courses as thin grey lines; their inspectors say "probable" and "not confirmed"; Standard hides them |
| Participant | the same twin, no photographs, no panel |

**On the projection's accuracy.**
- The zero-pixel-difference test of 2026-11-14 shows only that the integrated code is the experiment's code. It does not show that the projection is right on the ground.
- What does speak to that are the measured alignment (certain plants on vegetation 72.6 % against 2.8 % at half a spacing, no systematic offset; seams with a 5 cm median where soil ties exist) and these crops from the original photographs, where the ring sits on the plant in every view.
- Neither is a ground survey: without RTK, the whole twin can sit a metre or more off satellite imagery, as its own key says.

## 6. Recommendation

1. **Next: your iPad pass, on the branch's preview, signed in as the founder**, following section 2's procedure. Its result decides what comes after.
2. **Then the safe performance work (section 4, items 1–4), measured the same way.** It changes no result, and items 1–2 matter most for the iPad. I have not started it, because you asked for the investigation first.
3. **Overview persistence:** option C for the founder when you want reopened twins to show their photographs; option B only after real use shows it is needed.
4. **Production for the founder only:** merging this branch to main would put it at swardus.com for your account only. The gate and the kill switch are in place, but I have not merged it.
5. **Participants:** not yet. They need the iPad result, the memory work, and a decision on what the terms say about photographs on the device.
