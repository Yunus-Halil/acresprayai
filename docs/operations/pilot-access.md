# Pilot access: what to do outside the repository

The founding-pilot branch (`pilot/field-twin`) makes pilot membership a server-side fact. The code is in the repository; the steps below are the parts only the founder can do, in the Supabase dashboard, the Resend dashboard and the deploy. Nothing here has been run by the branch.

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
supabase/migrations/20261109120000_pilot_access.sql   membership, the gate on every table and on storage, the odm_tasks column lock
supabase/migrations/20261109120100_odm_uuid_unique.sql one scan per ODM task id (skips itself, with a notice, if duplicates exist)
```

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

All of these changed. Deploy every one, plus the new `pilot-admin`:

`odm-submit` `odm-poll` `odm-asset` `ortho-import` `ortho-url` `bake-tiles` `tile` `ndvi-tile` `bench-detect` `weather` `pilot-applications` `pilot-apply` `pilot-admin`

```
supabase functions deploy odm-submit odm-poll odm-asset ortho-import ortho-url bake-tiles tile ndvi-tile bench-detect weather pilot-applications pilot-apply pilot-admin
```

**Secrets** (Edge Functions → Secrets):

| Secret | Value | Why |
|---|---|---|
| `RESEND_API_KEY` | already set? | invitations and notifications |
| `PILOT_NOTIFY_FROM` | e.g. `Swardus <pilot@swardus.com>`, a sender on a domain verified in Resend | Without a verified domain, Resend delivers only to its account owner, so invitations to participants do not arrive. The pilot desk then shows the link to send by hand. |
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

## Removing a participant's data on request

This is a manual procedure for the pilot. It is filled in as the twin, review and feedback tables arrive; see the deletion section of `docs/operations/pilot-data.md` when it exists.
