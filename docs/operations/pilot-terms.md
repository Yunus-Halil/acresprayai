# The pilot terms: what they rest on, and what is still to decide

The terms participants see are `src/pages/PilotTerms.tsx` (served at `/pilot-terms`), version `pilot-2026-11-v2`. The agreement screen is `src/components/pilot/ConsentScreen.tsx`. **The wording is a draft until the founder approves it** (`TERMS_APPROVED` in `src/lib/pilot/consent.ts`); it was written to describe what the code does, not reviewed by a lawyer.

## What changed from v1

| | v1 | v2 |
|---|---|---|
| Agreement | terms plus two optional ticks | one screen, one button (**Agree & Continue**), one optional tick |
| The founder opening a participant's Field Twins | the participant's own optional tick | part of the terms: agreeing allows it; every opening recorded where the participant can read it |
| Research use of imagery | optional tick | optional tick, never pre-ticked, never carried over from an earlier version |
| Analysis record of a corn Field Twin | did not exist | described; made for a participant only under approved terms they agreed to |

A participant who agreed to v1 keeps exactly what they chose there until they agree to v2 themselves: the server opens a twin only when that participant's own newest agreement row allows it (`openTwin` in `supabase/functions/pilot-admin/monitor.ts`), and their builds make no analysis record.

## What each statement rests on

| The terms say | In the system |
|---|---|
| Photographs are not uploaded | The build runs in the browser; storage rules let a participant write only into their own Field Twin folder |
| What a Field Twin and an analysis record hold | `src/lib/fieldTwin/types.ts`, `src/lib/fieldTwin/analysis.ts`; a test reads a real record for pixels and digests |
| The record is private, not shown, not part of what the founder opens | The account's own folder (storage rules, tested as SQL); nothing in the app reads it; the founder's viewer hands out only `twin.json(.gz)` and `atlas-N.jpg` (tested) |
| A waiting copy for at most 7 days, removed on sign-out | `src/lib/fieldTwin/analysisOutbox.ts`, tested |
| The founder may open Field Twins, every opening recorded | `openTwin`: the participant's newest agreement, the log written first, nothing opened if the log cannot be written (tested); the participant reads their own log rows |
| No other participant sees anything | Row-level and storage rules, tested as SQL |
| Research use is off unless ticked | `saveConsent` writes what is ticked; the box starts unticked and an earlier version's answer is not shown (tested) |
| Activity record without names or places | `src/lib/pilot/telemetry.ts`: counts, timings, crop, camera model, error text passed through a pattern filter |
| Deleting a Field Twin | `deleteTwin`: every file in the folder, the list entry, the reviews (cascade), the waiting record (tested) |
| Deleting everything on request | By hand: "Removing a participant's data on request" in `pilot-access.md` |

Two limits on these, which the wording respects: the founder's access through the app is logged, but the database's administrator can also reach any file through the provider's console, which is not; and the error filter removes what looks like a path, file name or coordinate, it cannot prove nothing slips through.

## Still to decide

**For a lawyer:**

- Who "Swardus" is as a legal entity, and the governing law and venue. The terms name neither.
- The no-warranty sentence and any limit of liability for a free pilot. The terms say only that findings are not promised to be complete or correct.
- "What is yours": the permission to store and process, and the use of feedback and ideas.
- Whether a privacy statute applies. The comprehensive state privacy laws most likely do not reach a pilot this size (Virginia's applies from 100,000 consumers a year, or 25,000 with over half of revenue from selling personal data; Maryland's from 35,000, or 10,000 with over a fifth of revenue from selling it), and both are written for people acting as individuals, not in a commercial or employment role. What does apply regardless is that the terms must be true, which is why every statement above is tied to the code. Breach-notification duties depend on what is held and where the person lives.
- A participant employed by a university or agency may have rules of their own about agreeing to terms or sharing field data; the terms do not address an employer.

**For the founder:**

- "We will tell you if your data was exposed" and "as soon as we reasonably can" for deletion are promises: keep them only if they will be kept.
- What happens to a participant's data when their place ends and they do not ask: today it is kept, and the terms say so.
- How long the activity record and feedback emails are kept: today, indefinitely.
- Whether sign-in emails go through Resend or the provider's own mail (a dashboard setting); the terms name both.
- Whether a participant should be able to withdraw the founder's access to their Field Twins while staying in the pilot. Today the way out is to write or to leave.

**Technical, before any research use:** the research choice is recorded and shown on the desk, and nothing reads it, because nothing uses imagery for research. A gate with a test must exist before anything does, and "a change applies from then on" needs a meaning for examples already used.
