# Founding pilot terms, proposed version `pilot-2026-11-v2`

**A draft for the founder's review. Not approved, not in force, and not what the app shows.** The terms participants see are `src/pages/PilotTerms.tsx` (version `pilot-2026-11-v1`, itself marked a draft until `TERMS_APPROVED` is set). Nothing in the app changes until the founder approves a wording and it is put in that page.

Square brackets mark things the founder or a lawyer must decide.

What this version adds to the proposal of 2026-11-10: the section **The analysis record of a corn Field Twin**, one sentence under **Deleting**, and one clause under **Your two choices**. No participant's build makes an analysis record until a version carrying that section is approved and that participant has agreed to it (`TERMS_DISCLOSING_ANALYSIS` in `src/lib/fieldTwin/analysisConfig.ts`).

---

## Founding pilot: terms and privacy

### The pilot

The founding pilot is an early version of Swardus, offered free to a small number of invited growers, consultants and researchers so that we can learn from real fields. It will have mistakes and it will change.

What Swardus shows are observations for you to check, not advice. Swardus does not recommend treatments, products or rates, and decisions about your field remain yours.

### Your photographs

Your drone photographs are read in your browser, on your own device. They are not uploaded.

### What a saved Field Twin contains

When a build finishes, the Field Twin is saved to your account. It holds:

- the map Swardus built: the rows, plants and findings it measured and, where it drew one, the edge of the field, each with its position on the ground (latitude and longitude);
- small crops cut from your photographs around the findings;
- facts about the flight: the name you gave the field, how many photographs were used, each photograph's file name and the ground it covered, the camera model, the date of the flight, and whether positions came from RTK or standard GPS.

When the map shows surroundings (roads, place names), the map pieces for your field's area are fetched from OpenStreetMap's servers, which therefore learn roughly where the field is.

### The analysis record of a corn Field Twin

For a corn Field Twin, Swardus also saves the working data the build produced on the way to the map, as an analysis record beside the Field Twin. It holds:

- for every photograph that was used: its file name, file size, size in pixels and the time it was taken; where the camera was at that moment (latitude, longitude and height), which way it was pointing, and the lens values of the camera;
- what Swardus read in each photograph: where in the photograph it found the rows, each plant, each patch of other growth and each gap;
- where each finding on the map lies in each photograph that showed it, and which part of which photograph each crop was cut from.

It holds no photographs and no image data.

We keep it so that the analysis of your field can be reproduced later exactly as it was made, for example to take your corrections into account in your own Field Twin. Today nothing does that yet; the record is only stored.

The record is private to your account, as your Field Twin is. It is not shown in the app. It is not used to train a shared model, it is not exported, and it is not shared with other participants. It is deleted when you delete the Field Twin. It is not part of troubleshooting access (below): the founder's view of a Field Twin does not include it.

It is saved a moment after the Field Twin itself. If that is interrupted (the tab is closed, or the connection drops), a copy waits in your browser's storage on that device and is sent the next time you open Swardus there while signed in. The waiting copy is removed once it has been saved, when you sign out on that device, when you delete the Field Twin there, or after 7 days, whichever comes first; it is never sent for a Field Twin that has been deleted. A Field Twin whose record never arrives is complete without it.

### Your reviews

When you mark a finding correct, not sure or wrong, we save your answer, what Swardus had said about the finding, what you said was there instead if you chose one, and any note you wrote. If you redraw the edge of the field, the outline you drew is saved as well. Your reviews never change the saved Field Twin.

### Feedback

What you send through Feedback is kept and emailed to Swardus's founder. Sent with your words: the page you were on, the Field Twin it was about if any, the app version, your browser and window size, and the last error the app met, if any. Your name, organisation and email address go with it so that we can reply. Your photographs do not.

### What we record about how the pilot goes

To find out where Swardus works and where it fails, we record what happens in the app, under your account: for example that a build started, the crop, the camera model, how many photographs it used, how long each step took, whether it finished, whether the analysis record was saved and how large it was, and any error. Error messages are filtered to take out file names, folder paths and coordinates before they are recorded. We do not put photographs, field names, positions or boundaries in this record.

### What Swardus's founder sees

Swardus is run by its founder, who sees the following for every participant, in order to run the pilot and find errors:

- your account: your email address, your name and organisation if you gave them, when you joined and when you last signed in;
- the list of your Field Twins, but not their contents: each one's name, crop, flight date, number of photographs, camera model, area, and whether it saved completely;
- your reviews: your answers, what you said was there, and your notes;
- your feedback;
- the record described above;
- your two choices below.

The founder does not open a Field Twin itself (its map, its positions, its crops of your photographs) unless you allow it below.

### Your two choices

Both are optional, both start switched off, and the pilot works the same either way.

*Troubleshooting access.* If you allow it, Swardus's founder may open your Field Twins to look into a problem. Every opening is recorded with its date and reason, and you can see the list under Help, Your data choices. Without it, your Field Twins are not opened. With it, what is opened is the Field Twin: its map and its crops. The analysis record of a corn Field Twin is not opened.

*Research use of your imagery.* If you allow it, the crops of your photographs, together with your reviews of them, may be used as examples to test and improve how Swardus reads fields. Without it, your crops are used only to show you your own Field Twin. Today Swardus has no export of participants' imagery and trains no shared model on it. This choice records your permission, [and we will tell you before the first such use].

Your Field Twins and reviews are not shared outside Swardus without asking you first, other than with the services named below that store and deliver them for us.

You can change either choice at any time under Help, Your data choices. A change applies from then on.

### Who handles the data

Swardus runs on Supabase (accounts, database and file storage, in the United States) and Vercel (the website), and sends email through Resend: invitations to you, and your feedback to Swardus's founder. They process data on our behalf to run the service. Pages load their fonts from Google, and map surroundings come from OpenStreetMap; like any website you visit, these services see your device's internet address. If you sign in with Google, Google handles that sign-in. A few display settings are remembered in your browser only.

### Deleting

You can delete any Field Twin from your list at any time. That removes its map, its crops of your photographs, its analysis record if it has one, its place in your list and your reviews of it. What stays: the lines about it in the record of how the pilot goes, which hold nothing of the twin's contents, and any feedback you sent about it.

You can ask us to delete everything we hold about you: your account, your Field Twins, your reviews, your feedback, your choices, the record of your activity and your application to the pilot. We do this by hand, [within 30 days]. Copies in emails already delivered and in our providers' backups are not removed at once; [they expire within N days].

### Ending

You can leave the pilot at any time, and we may end it or your place in it. When a place ends you can no longer sign in to your Field Twins. What is saved [stays until you ask us to delete it / is deleted after N days].

### Changes to these terms

If what Swardus saves or how it is used changes, these terms change first, under a new version, and you are asked to agree again before you continue.

### Contact

Questions, requests to delete data, or anything else: [contact address].

---

## Short wording that changes with it

These live outside the terms page and repeat the same claims:

- **Agreement screen, second line:** "Your photographs stay on your device. Your Field Twins are saved privately in your account, with crops of your photographs and where the field is, and you can delete them at any time. For corn, the build's working data (camera positions and what was read in each photograph, no images) is saved with it."
- **Agreement screen, third line:** "We record how the app is used (what ran, how long it took, errors), and Swardus's founder reads your reviews and feedback to run the pilot."
- **Troubleshooting choice, hint:** "Optional. Without it, your Field Twins are not opened."
- **Research choice:** "Let crops of my photographs, with my reviews of them, be used to improve Swardus". Hint: "Optional. Nothing is used this way today. Never shared outside Swardus without asking you first."
- **Feedback footnote:** add the window size and the last error.
- **Build page:** "this computer" becomes "this device".

## What each promise about the record rests on

| The terms say | In the system |
|---|---|
| No photographs, no image data | The record's format has no field for pixels or for a digest of a file; a test reads a real record and looks for both |
| Private to your account | The file is in the account's own folder; the storage rules refuse any other account (tested as SQL against the pilot's rules) |
| Not shown in the app | Nothing in the app reads it |
| Not part of troubleshooting access | The founder's twin viewer hands out only the twin's own files by name; tested with a participant who allowed access. As with Field Twins, this is a commitment, not a lock: the database's administrator can reach any file through the provider's console |
| Deleted with the Field Twin | Deleting a twin removes every file in its folder, and the copy waiting on the device (tested) |
| A waiting copy for at most 7 days, removed on sign-out | `src/lib/fieldTwin/analysisOutbox.ts`, tested. It is removed when the app sees the sign-out on that device; a browser whose site data is cleared loses it too |
| Not trained on, not exported, not shared | Nothing reads the record except the tests |
| Agreed to before any is made | A participant's build makes one only under an approved version listed in `TERMS_DISCLOSING_ANALYSIS` that this participant agreed to; the list is empty today |

## Still to decide

**Legal (for a lawyer):** who "Swardus" is as a legal entity and the governing law; no-warranty and liability wording for a free pilot; who owns the Field Twins and what licence Swardus has to store and process them; whether a privacy statute applies and what it would require.

**Retention (the founder's decisions):** how fast a deletion request is carried out; what happens to a participant's data when their place ends and they do not ask; how long the activity record is kept; how long feedback emails are kept; backup and log retention at the providers.

**Technical:**

- The research choice gates nothing today, which is safe only because nothing uses imagery for research. The gate must be built, with a test, before any research use.
- Withdrawing research permission "from then on" is undefined for examples already used. Nothing has been used; decide before it matters.
- Agreeing again pre-fills the earlier choices. Under this version the research choice means something narrower, so it should start unticked when the version changes.
- Whether the sign-in emails go through Resend or the provider's own mail is a setting only the founder can see; the "Who handles the data" paragraph depends on it.
- Putting this version live means: the terms page, the agreement screen, `TERMS_VERSION`, adding the version to `TERMS_DISCLOSING_ANALYSIS`, and `TERMS_APPROVED`. Every participant is then asked to agree again.
