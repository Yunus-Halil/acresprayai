# If participants' data may have been exposed

The pilot terms say: "If we learn of a security incident that affects your data, we will investigate it, act to contain it, and notify you as the law that applies requires." This is the procedure behind that sentence. It is written for one person (the founder) and a pilot of a few participants; keep it that size.

## What counts

Anything that means someone who should not have could have read, changed or removed a participant's data: a founder account or its email signed in to by someone else; a service-role key, database password or provider login that leaked; a rule or function found to let one account reach another's data; a provider (Supabase, Vercel, Resend, Google) reporting an incident that touches this project; a lost or stolen device signed in as the founder.

A bug that only showed someone their own data wrongly, or an outage, is not this. When unsure, treat it as one.

## First hour: contain

1. **Write down the time and what was noticed.** Everything after is easier with a timeline.
2. **Stop the way in.**
   - A leaked key or password: rotate it in the Supabase dashboard (Project Settings, API keys / Database), then set the new value where it is used (function secrets, Vercel environment).
   - The founder account: change the password, sign out all sessions (Authentication, Users, the user), check the Google account's recent activity and turn on two-factor sign-in if it is not on.
   - A rule or function at fault: pause what it guards. A participant can be paused from the desk (nothing is deleted, and nothing of theirs can be opened while paused). A function can be redeployed from the last known good commit.
3. **Do not delete anything yet.** Logs and rows are the evidence of what happened.

## First day: find out what was reached

- `admin_access_log`: every opening of a participant's Field Twin through the desk, with who, when and why.
- Supabase logs (Logs: API, Auth, Storage, Edge Functions) for the period: which accounts, which tables and files.
- Auth: sign-ins to the founder and participant accounts in the period.
- Resend: what was sent, and to whom.
- Vercel: deployments in the period, and who made them.

Write down, per participant: what of theirs could have been reached (account details, the list of Field Twins, the Field Twins themselves with positions and photograph crops, analysis records, reviews, feedback), and whether there is evidence that it was.

## Tell the people affected

- **Who decides what the law requires:** a lawyer, the same day. The duties depend on what was exposed and where each person lives; this document does not decide them.
- **What a notice says, in plain words:** what happened and when, what of theirs was involved, what has been done, what they may want to do (for example change a password they reuse), and how to reach the founder.
- **Tell participants even when no law requires it** if their Field Twins or account details were reached by someone else. That is a decision for the founder at the time, and the default in a pilot built on trust.
- A participant employed by a university or agency may need to tell their own organisation; say so in the notice.

## Afterwards

Fix the cause, with a test that would have caught it. Note in `pilot-access.md` what changed. If what Swardus stores or who can reach it changed as a result, the terms change first (a new version), and participants are asked again.
