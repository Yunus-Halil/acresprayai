# Pilot applications

The form behind "Apply to Pilot", the table it writes to, and the two ways an application
becomes visible.

## Route map

| Route | Auth | What it is |
|---|---|---|
| `/apply` | none | The application form. Linked from the landing page's pilot band. |
| `/admin/pilot-applications` | signed in **and** on the admin allowlist | The whole pipeline, newest first |

## The form

One page, three sections, fourteen fields. Deliberately no multi-step wizard — a farmer or an
extension agent should be finished in under two minutes.

The fields, their options, and the validation rules live in **one place**:
[`supabase/functions/_shared/pilotApplication.ts`](../../supabase/functions/_shared/pilotApplication.ts).
The React page reaches it through `src/lib/pilotApplication.ts`, the `pilot-apply` function
imports it directly, and the migration's `CHECK` constraints mirror its option lists. Adding a
field is one edit plus a migration; there is no second copy to forget.

Behaviour worth knowing:

- **Validation is per-field and on blur.** Errors appear as you leave a field you have visited,
  never before you have reached it, and never all at once at the end. Pressing submit with
  errors reveals all of them and focuses the first.
- **`drone_model` is conditional** — only asked when `drone_status` is `Have a spray drone`.
  If someone fills it in and then changes their answer, `normalise()` drops the value server-side
  so it cannot reach the row, and a `CHECK` constraint would reject it if it did.
- **A failed submission keeps every answer on screen.** This form gets filled in on a phone.
- Success replaces the form in place with a confirmation. No redirect, no separate thank-you page.
- Optional answers left blank are stored as `NULL`, not `''`.

## Submission path

The form posts to the **`pilot-apply`** edge function rather than inserting through PostgREST.

That is the whole reason the function exists: the notification email has to happen on every
submission, and a client-side insert cannot be relied on to trigger one. Doing both in one
function means there is a single path from "farmer pressed submit" to "Yunus has an email", and
it lives in the repository rather than in dashboard webhook configuration.

`verify_jwt = false` in `supabase/config.toml` — applicants are not signed in. What constrains
the endpoint is the shared validator (server-side, authoritative) and the RLS insert policy.

**The insert policy means a direct PostgREST insert is still possible.** It would be validated by
the policy but would not send an email. If that ever matters, drop the anon insert policy and the
function's service-role write becomes the only door.

Order of operations: validate → insert → email. The email is **best effort and never fails the
request**. An application recorded but not emailed is recoverable — it is in the table and the
admin view shows it. An application lost because the mail provider had a bad minute is not.
The response carries `notified: true | false` and a failure is logged.

## Notification email

Sent through **[Resend](https://resend.com)** from `supabase/functions/_shared/email.ts`.

Resend rather than Supabase's built-in SMTP because that sender is reserved for auth mail
(confirmations, password resets) and is rate-limited accordingly; borrowing it for notifications
risks throttling sign-up mail.

Plain text, no template — it is read on a phone.

### Secrets

| Secret | Required | Default | Notes |
|---|---|---|---|
| `RESEND_API_KEY` | **yes, for mail to send at all** | — | Without it the application still saves; the function logs `[email] RESEND_API_KEY not set` and returns `notified: false` |
| `PILOT_NOTIFY_TO` | no | `yunus@swathwise.com` | Where notifications go |
| `PILOT_NOTIFY_FROM` | no | `SwathWise <onboarding@resend.dev>` | Resend's shared sender needs no domain verification but **only delivers to the Resend account's own address**. Set this to an address on a verified domain once swathwise.com is verified in Resend |
| `PILOT_ADMIN_EMAILS` | no | `yunus@swathwise.com` | Comma-separated allowlist for the admin read endpoint |

```bash
supabase secrets set RESEND_API_KEY=re_... --project-ref iftkcpcwxnpbllyfadit
```

## Reading applications

`pilot_applications` has no readable SELECT policy for anyone, so the **`pilot-applications`**
edge function holding the service-role key is the only way rows come back out.

Per the rule in [architecture/auth.md](../architecture/auth.md), every service-role read is
preceded by an explicit authorisation check. Here that check is an **email allowlist**
(`PILOT_ADMIN_EMAILS`) rather than a row-ownership test, because these rows have no owner.

| Caller | Response |
|---|---|
| No bearer token | 401 |
| Token resolving to nobody | 401 |
| Signed in, not on the allowlist | **403** |
| Signed in, on the allowlist | 200 with up to 500 rows, newest first |

403 rather than the uniform 404 used elsewhere in the tree: that 404 exists to stop a caller
probing which scan ids exist. There is no id to probe here, and a signed-in user who is not an
admin is better told so than left guessing. Responses are `Cache-Control: private, no-store` —
the body is a list of other people's contact details.

The `/admin/pilot-applications` route is wrapped in `RequireAuth`, the same guard `AppLayout`
uses for `/app/*`. **That guard only proves someone is signed in.** It is the function's
allowlist that protects applicants, which is why the two are tested separately.

## Tests

| File | Covers |
|---|---|
| `src/test/pilotApply.test.tsx` | Required-field refusal, blur-time validation, the conditional field appearing and disappearing, answers surviving a failed submit |
| `src/test/edge/pilot-apply.test.ts` | Exactly one row per submission, every answer mapped to its column, option values rejected, `drone_model` dropped, the application surviving a mail failure or a missing API key |
| `src/test/edge/pilot-applications.test.ts` | 401/403/200 by caller, no rows leaking in a refusal, `private` caching |
| `src/test/adminPilotApplications.test.tsx` | Signed-out redirect to `/auth`, no bounce mid-session-restore, rows rendered, 403 reported as a refusal rather than an empty pipeline |
| `src/test/pilotApplicationSchema.test.ts` | The RLS contract, asserted against the migration text — no readable SELECT policy for any role, insert validated rather than `WITH CHECK (true)` |

That last one is a schema-contract test, not a live RLS test. It exists because the protection is
one `CREATE POLICY` away from being undone and nothing in the application code would fail if it
were.
