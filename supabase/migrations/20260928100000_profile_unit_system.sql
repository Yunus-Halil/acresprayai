-- The unit system is a property of the person, not of a field or a browser.
-- It used to live in localStorage, seeded from whichever field was opened
-- first, so it did not follow the operator to a second device and nobody was
-- ever asked. Null means "never chosen": the app asks once at first sign-in.
alter table public.profiles
  add column if not exists unit_system text
  check (unit_system in ('metric', 'imperial'));
