# Pilot access: what to do outside the repository

The founding-pilot branch (`pilot/field-twin`) makes pilot membership a server-side fact. The code is in the repository; the steps below are the parts only the founder can do, in the Supabase dashboard, the Resend dashboard and the deploy. Nothing here has been run by the branch.

## Status on the live project (2026-11-09)

Done from the CLI:
- Sections 1 and 2: the only accounts were the founder's two, both confirmed. All seven migrations are applied. Both founder rows exist, there are no duplicate jobs, and the unique index exists.
- Section 3: all fourteen functions are deployed. Unsigned calls to pilot-admin, pilot-notify and weather return 401.
- Section 4.1: sign-ups are off. Email confirmation stays on.
- Section 4.2: the redirect list keeps its entries. `https://www.swardus.com**` became `https://www.swardus.com/**`, because the old pattern also matched look-alike domains. `http://localhost:8080/**` was added.
- Section 4.3: the email link lifetime is 24 hours.

Still open:
- `PILOT_NOTIFY_FROM`, which needs a domain verified in Resend.
- Unsetting `PILOT_ADMIN_EMAILS`.
- Custom SMTP (4.4) and leaked-password protection (4.5).
- The terms (section 8).
- The web app deploy (section 5).

Order matters. **Database first, then the edge functions, then the web app.** A web app deployed before the database shows every account "Swardus is being updated". Edge functions deployed before the database refuse everyone, the founder included, because they read `pilot_members`.

## 1. Before applying anything: who has an account today

Run in the SQL editor:

```sql
select id, email, created_at, last_sign_in_at from auth.users order by created_at;
```

After the migration, only accounts with an active row in `pilot_members` can read or write anything. The founder's addresses are seeded automatically:
- yunushalilerdogan5@gmail.com
- yunus@swardus.com
- yunus@swathwise.com

Every other existing account keeps its data but sees "This account is not in the pilot" until it is invited.

## 2. Apply the migrations

```
supabase/migrations/20261109120000_pilot_access.sql              membership, the gate on every table and on storage, the odm_tasks column lock
supabase/migrations/20261109120100_odm_uuid_unique.sql            one scan per ODM task id (skips itself, with a notice, if duplicates exist)
supabase/migrations/20261109130000_field_twins.sql                the saved-twin registry
supabase/migrations/20261109140000_app_events.sql                 pilot telemetry (insert-only for participants)
supabase/migrations/20261109150000_reviews_feedback_consent.sql   finding reviews, feedback, consent
supabase/migrations/20261109160000_admin_access_log.sql           every time the founder opens a participant's twin
supabase/migrations/20261109170000_founder_tools_only.sql         the founder's tables founder-only; participants' files only in their Field Twin folder
```

The founder is seeded only from a **confirmed** address (an unconfirmed account holding one of the founder's addresses could have been registered by someone else). If yours is unconfirmed, confirm it or add the row by hand as below.

With the CLI: `supabase db push`. Without it: paste each file into the SQL editor, in this order.

Then check:

```sql
select user_id, role, status, email from public.pilot_members;                        -- the founder row(s)
select odm_uuid, count(*) from public.odm_tasks group by 1 having count(*) > 1;        -- should be empty
select indexname from pg_indexes where indexname = 'odm_tasks_odm_uuid_unique';        -- should exist
```

If the founder's row is missing (signed in with another address), add it:

```sql
insert into public.pilot_members (user_id, role, status, email)
select id, 'founder', 'active', email from auth.users where email = 'YOUR ADDRESS';
```

## 3. Deploy the edge functions

All of these changed. Deploy every one, plus the new `pilot-admin` and `pilot-notify`:

`odm-submit` `odm-poll` `odm-asset` `ortho-import` `ortho-url` `bake-tiles` `tile` `ndvi-tile` `bench-detect` `weather` `pilot-applications` `pilot-apply` `pilot-admin` `pilot-notify`

```
supabase functions deploy odm-submit odm-poll odm-asset ortho-import ortho-url bake-tiles tile ndvi-tile bench-detect weather pilot-applications pilot-apply pilot-admin pilot-notify
```

**Secrets** (Edge Functions → Secrets):

| Secret | Value | Why |
|---|---|---|
| `RESEND_API_KEY` | already set? | invitations and notifications |
| `PILOT_NOTIFY_FROM` | `Swardus <yunus@swardus.com>`, a sender on a domain verified in Resend | Without a verified domain, Resend delivers only to its account owner, so invitations to participants do not arrive. The pilot desk then shows the link to send by hand. |
| `PILOT_NOTIFY_TO` | yunus@swardus.com | Where application notifications go, and the reply-to on invitations. The default is now this address. |
| `PILOT_SITE_ORIGINS` | optional, e.g. `https://swathwise.com,https://www.swathwise.com` | Where invitation links may send people back to. The default list covers both domains and localhost:8080. |
| `PILOT_ADMIN_EMAILS` | unset it once the founder row exists | It no longer defaults to an address. The founder role decides now. |

## 4. Auth settings (Authentication → Sign In / Providers, URL Configuration, Emails)

1. **Turn off "Allow new users to sign up".** Invitations from the pilot desk still work with it off, because they use the admin API. With it on, a stranger can still create an account, but that account can read nothing and is shown "not in the pilot".
2. **Redirect URLs**: add `https://<site>/auth`, `https://<site>/auth/welcome` and `https://<site>/app` for each live domain, plus `http://localhost:8080/**` for local testing. A link whose return address is not on this list is sent to the Site URL instead.
3. **Email link lifetime** ("Email OTP Expiration"): raise it from 1 hour to 24 hours (86400 s), so an invitation still works the next morning.
4. **Custom SMTP: required for password resets and emailed sign-in links.** Supabase's built-in mailer only delivers to the project's own team members' addresses, so a participant asking for a reset gets nothing without it. Resend offers SMTP: host `smtp.resend.com`, port 465, user `resend`, password the API key, sender on the verified domain.
5. **Leaked-password protection**: turn it on (the 2026-08-20 audit found it off).

## 5. Deploy the web app

Only after steps 2 to 4. The branch must not be merged to `main` before you have tested it (see section 7).

## 6. Inviting someone

The pilot admin panel is `/admin/pilot`. Its **System health** tab reads the live settings (sign-ups, email confirmation, email sending, the database, stray accounts) and says what to fix.

An invitation never adopts an account it did not create. If the address already has an account that was never in the pilot, the panel refuses and asks you to delete that account in Supabase first: with sign-ups open, anyone could have registered the address with a password of their own. Someone already in the pilot (active, paused or ended) gets a fresh sign-in link instead.

If your site is not on swathwise.com or swardus.com, set `PILOT_SITE_ORIGINS`: invitation links return only to the listed origins (localhost is not a default).

1. Open `/admin/pilot` as the founder.
2. Type the address, name and organisation, or press Invite beside an application.
3. The page says whether the email went out, and always shows the link with a Copy button.

The link creates the account. It opens `/auth/welcome`, where the person chooses a password, or skips that and signs in later by emailed link or Google.

To stop someone's access, use **Pause** or **End** on the same page. It takes effect on their next request and nothing is deleted. Restore brings it back.

## 7. Checking it yourself

These steps are written for the founder to run, and none has been run on the live project.

1. As the founder: everything works as before, plus `/admin/pilot`.
2. Invite a second address you own. Open the link in a private window, set a password, sign out, sign in again with it, then try "Forgot your password?" (needs step 4.4).
3. Sign in with a Google account that was never invited. You should land back on the sign-in page with "That account is not invited to the pilot" (with sign-ups off). With sign-ups on, you should see "This account is not in the pilot".
4. As the participant, open `/app/fields` by typing it: you are sent home. Open a scan or tile URL from the founder's account: 403 or 404.
5. Pause the participant on the pilot desk, then reload their window: "This account is not in the pilot".

## 8. Before the first invitation: the pilot terms

`src/pages/PilotTerms.tsx` (served at `/pilot-terms`) is a plain-language draft: what the pilot is, what is saved and what stays on the participant's computer, what is recorded, the two optional choices (troubleshooting access, research use), the processors (Supabase, Vercel, Resend), ending. **Read it, change what is wrong, ideally have a lawyer look, then set `TERMS_APPROVED = true` in `src/lib/pilot/consent.ts`.** Until then the page says it is a draft. Participants accept it once (and again whenever `TERMS_VERSION` changes); the founder is not asked.

## Removing a participant's data on request

A participant can delete any Field Twin themselves (the list's bin icon removes its files, its record and its reviews). To remove everything for one person, in the SQL editor, with their user id:

```sql
-- 1. What there is
select 'twins' t, count(*) from public.field_twins where user_id = :'uid'
union all select 'reviews', count(*) from public.twin_reviews where user_id = :'uid'
union all select 'feedback', count(*) from public.pilot_feedback where user_id = :'uid'
union all select 'events', count(*) from public.app_events where user_id = :'uid'
union all select 'files', count(*) from storage.objects where (storage.foldername(name))[1] = :'uid';
```

2. Delete their files in the dashboard (Storage: every bucket, the folder named after their user id). Storage objects must be removed through the Storage API or dashboard, not by deleting rows.
3. Delete the account (Authentication, Users, the user, Delete). Every pilot table references `auth.users` with ON DELETE CASCADE, so their memberships, twins, reviews, feedback, consents and events go with it.
4. Run the query in step 1 again: every count is 0.

The older orthomosaic tables (`odm_tasks`, `user_annotations` and others) have no foreign key to `auth.users`; for a founder-tool account, delete those rows by `user_id` as well.

## Security limits worth knowing

- **Rate limits in the database.** Events are capped at 120 a minute per person, reviews at 300 a minute, feedback at 20 an hour. Feedback email alerts are capped at 10 an hour per person. The application form stops emailing above 30 applications an hour, and sends one confirmation per address per day.
- **Server-dated records.** Events, consents, feedback, reviews and Field Twin records are dated by the database, and a participant cannot set their dates.
- **Links cannot switch accounts.** A sign-in carried in a link is taken only on the sign-in pages, and never over an existing sign-in. Someone cannot send a link that signs the reader into the sender's account.
- **Founder powers.** An invitation to someone already in the pilot returns a working sign-in link to the founder's screen, which is how links can be re-sent by hand. Treat the founder account accordingly: use a strong password and two-factor sign-in on the Google account.
- **A paused founder** keeps tile access for up to 5 minutes (a per-instance cache in the tile functions).
