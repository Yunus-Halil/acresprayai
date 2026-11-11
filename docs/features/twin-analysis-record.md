# The analysis record of a corn Field Twin

Status, 2026-11-11: **on for the founder's own account**; for a participant, on once the pilot terms that describe it (`pilot-2026-11-v2`) are approved and that participant has agreed to them.

## Why

A saved twin keeps the field's findings and small crops of the photographs behind them. The build knew more, and discards it when its tab closes: what Corn V1 read in every photograph, where every aligned camera stood, where each finding lies in each photograph, and which pixels each crop was cut from. Without those the photographs can never be combined over the field again from the saved twin (`cornField` takes the reads and the cameras, not the twin). The record keeps them, so that later, and only if it is decided, the field's combination can be reproduced exactly, combined again with an operator's corrections, and new crops cut at a known place once the operator selects the original photographs again. None of that is built: today the record is only made and stored.

## What it is

One more private file beside the twin: `orthos/<user id>/field-twins/<twin id>/analysis.json.gz` (gzipped JSON, format `swardus-twin-analysis-v1`, `src/lib/fieldTwin/analysis.ts`).

| Part | What |
|---|---|
| `reads` | Corn V1's read of every photograph, exactly as the field combination received it (`CornPhotoRead`, no further rounding: rounding to whole pixels saved 8 % and broke reproduction on every test flight) |
| `frames` | every aligned camera (lens numbers, position, attitude, boresight) and the flat ground plane's height |
| `fieldOptions`, `engine` | the combination's settings and the versions that made it |
| `sightings` | where each weed observation and gap of the twin lies in each photograph that reported it, original-frame pixels, under the twin's own ids |
| `crops` | for each evidence crop (by its atlas cell, as the twin's evidence entry names it): the photograph and the square of it the crop was cut from |
| `photographs` | name, file size, pixel size, capture time |

Not in it: pixels, and any digest of the original files (to be added with the re-selection of originals, when that is built and checked).

## What it is not

- Not part of the twin. `twin.json` is the same with and without it (tested on a real build, byte for byte apart from the build time). It is not one of the bundle's files, the viewer never reads it, and `parseTwin` knows nothing of it.
- Not needed by anything. Every twin saved without one, and every orchard twin, opens exactly as before. Corn builds only.
- Not able to hurt a save. The twin is saved and marked ready, and the session has stopped guarding the tab, before anything of the record starts.
- Not shared. Same owner-only folder and storage rules as the twin; deleted with the twin; the founder's twin viewer signs only `twin.json(.gz)` and `atlas-N.jpg`, so it is never handed out even with troubleshooting permission. No export, no training, no other account.

## Who gets one

`src/lib/fieldTwin/analysisAccess.ts`:

- `TWIN_ANALYSIS_ENABLED` (`analysisConfig.ts`) is the one switch. False: no build makes a record, nothing is saved, nothing waiting is sent.
- The founder's own account: yes (also while previewing the participant experience: it is still the founder's account and data).
- A participant: only when the pilot terms in force are approved (`TERMS_APPROVED`), are listed in `TERMS_DISCLOSING_ANALYSIS` (`pilot-2026-11-v2` is), and are the version this participant agreed to. Until the founder approves the wording no participant's build makes one, and their choices are not read for it. A participant who agreed only to the earlier terms gets none.

This decides what the app does. It guards a disclosure, not the data: the record only ever goes to the signed-in account's own folder, which the storage rules enforce.

To open it to participants: approve the terms (`TERMS_APPROVED = true`). Every participant is asked to agree to the new version on their next visit; from then on their corn builds keep the record.

## Getting it to the account

The record goes up after the twin is saved, which is the moment the build page says the tab may close. So (`src/lib/fieldTwin/analysisOutbox.ts`):

1. The twin is saved and marked ready. The session is no longer busy.
2. The record is gzipped and written to the browser's own database on the device (IndexedDB, `swathwise.twin-analysis-pending`).
3. It is uploaded beside the twin.
4. Once the account has it, the copy on the device is removed.

If the tab closes, the device sleeps or the connection drops between 2 and 4, the copy stays, and is sent the next time the same account has the app open (a few seconds after the app loads, and again whenever the connection comes back; never while a build is running or saving in that tab).

| Rule | How |
|---|---|
| Only as the account it belongs to | Each waiting record carries its account. Another account on the device does not send, read or remove it; the session is checked again at the moment of sending; the storage rules refuse any other folder regardless |
| Never stale | Before sending, the twin is looked up as the signed-in account. Gone (deleted, on any device): the record is dropped unsent. Not ready: it waits |
| Deleting a twin | `deleteTwin` removes the folder's files, the list entry, and the waiting record. A record still in the air when its twin is deleted is taken out when it lands: the twin is looked up again after every upload, on whichever device deleted it. A folder left with only a record (the sending tab closed in that instant) is removed the next time the account's twins are listed, and is never listed as a twin |
| Expiry | Dropped after 7 days, or after the account's storage has refused it 8 times |
| Sign-out | What waits for that account on the device is removed |
| Storage limit | At most 5 waiting records and 20 MB on a device; the oldest make room. A single record over 8 MB gzipped is not saved at all |
| Two tabs | One tab sends at a time (Web Locks where the browser has them); a record handed to an upload in the last two minutes is left alone. Sending the same record twice replaces it with itself |
| A browser with no database of its own | The record is sent once, as before; nothing is kept |

It works on the same device and browser only, which is acceptable for an optional file. Events: `twin_analysis_saved` (sizes, duration, `later` when it was a later visit) and `twin_analysis_failed` (`waiting`: whether a copy is on the device). Corn twins saved against records saved is the measured loss rate.

## Measured

All on this desktop (12 cores), Chrome 157 headless, the 40-photograph UAV3DCrop Day023 corn flight.

**The build, with and without the record** (the development builder, two builds each way):

| | Without the record | With the record |
|---|---|---|
| Twin ready, quiet machine (2026-11-10, first measurement) | 66.2 s, 66.1 s | 65.1 s, 65.1 s |
| Twin ready, machine about 86 % busy with other programs (2026-11-10, the integrated branch) | 123.4 s, 124.4 s | 111.3 s, 120.4 s |
| Peak memory, all of the build's Chrome processes (sampled every 2 s) | 2.56, 2.55 GB (earlier 2.56, 2.61) | 2.56, 2.67 GB (earlier 2.65, 2.76) |
| The twin | 16 rows (11 corn, 5 probable), 11 weed observations (7 confirmed), 0 gaps, 1 atlas | the same |

No difference in build time either time; the second set is slower throughout because the machine was shared, and says only that the record does not add to it. The memory figures differ by less than the sampling can resolve (one decoded photograph is 84 MB; the record is under 1 MB).

The record of that build: 685 KB of JSON, 248 KB gzipped (23 to 28 ms in the browser on the busy machine, 17 ms on the quiet one), 40 photographs, 41,435 located plants, 18 crop sources, 11 weed observations' sightings.

**The whole path in a real browser** (the app's own build session, save, device copy and upload; the account's tables and storage answered by the test script, so nothing reached the live project):

| Checked | Result |
|---|---|
| A build for an account that gets the record | Twin saved and ready; the record asked for 66 ms after the twin was marked ready; stored (247,918 bytes) beside `twin.json.gz` and `atlas-0.jpg`; the device's database empty afterwards |
| The stored twin opened again from storage | Same twin: 16 rows, 11 weed observations, 0 gaps, 1 atlas |
| The field combined again from the stored record, read as any later reader would | The stored twin's rows, weed observations and gaps exactly, for both builds |
| The record's upload never answers, and the tab is closed | Twin already saved and ready; the record (247,916 bytes) on the device; the twin opens whole with no record beside it |
| Next visit, at once | Left alone (it could still be an upload under way) |
| Next visit, as another account | Nothing sent, nothing asked |
| Later visit, the storage refuses | Kept, one refusal counted |
| Later visit | Sent, stored, the device's database empty; the record reads back with its 40 photographs |
| The twin deleted | No file left in its folder, no list entry, nothing on the device |
| A build for an account that gets no record | Twin saved the same; no record made, none on the device, no upload asked |
| An orchard-mode build asked for a record | Built; no record made (23 photographs that are not an orchard: the orchard path ran, its result means nothing) |

From the earlier measurements on three flights (cached reads): 104 to 264 KB per 40 photographs, 1 to 2.6 MB extrapolated to the pilot's 400-photograph limit, a re-read of the field from the stored record identical to the build's in 11 to 37 ms.

## Limits known

- Not measured: a commercial DJI corn flight, Safari, a tablet, a real upload over a slow connection.
- A waiting record is plain data in the browser's storage on that device until it is sent or removed.

## Switching off

`TWIN_ANALYSIS_ENABLED = false`. Records already saved stay beside their twins until the twin is deleted; records waiting on devices are no longer sent and expire.

## Tests

- `src/test/fieldTwinAnalysis.test.ts`: contents, exact reproduction after a gzip round trip, inputs untouched, no pixels or digests, refusals, the real four-photograph build with and without.
- `src/test/fieldTwinAnalysisSave.test.tsx`: an account that gets none; order of the twin's save, the device copy and the upload; failure and hang of the upload; a device that keeps nothing; orchard never asked.
- `src/test/fieldTwinAnalysisOutbox.test.ts`: an upload cut short finished on the next visit with the record whole; another account, a deleted twin, a twin not ready, expiry, the try limit, the storage limits, sign-out; deleting a twin with a record waiting or in the air.
- `src/test/fieldTwinAnalysisAllowed.test.tsx`: who gets one, as shipped and under terms that disclose it; when the app sends what waits.
- `src/test/fieldTwinAnalysisAccess.test.ts`: storage path and size cap, the pilot's storage rules as SQL (another participant, an outsider, a paused participant), the founder's viewer.
