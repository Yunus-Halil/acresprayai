
-- Profiles
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  farm_name text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "own profile select" on public.profiles for select using (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);

-- Auto create profile
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, farm_name)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'farm_name');
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- Fields
create table public.fields (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  crop text not null,
  area_hectares numeric not null default 0,
  location text,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.fields enable row level security;
create policy "own fields all" on public.fields for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Drones
create table public.drones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  model text not null default 'AgriPulse X1',
  battery int not null default 100,
  status text not null default 'idle',
  created_at timestamptz not null default now()
);
alter table public.drones enable row level security;
create policy "own drones all" on public.drones for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Scans
create table public.scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  field_id uuid references public.fields on delete set null,
  image_path text,
  status text not null default 'pending',
  ai_summary text,
  detections jsonb,
  health_score int,
  created_at timestamptz not null default now()
);
alter table public.scans enable row level security;
create policy "own scans all" on public.scans for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Jobs
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  field_id uuid references public.fields on delete set null,
  scan_id uuid references public.scans on delete set null,
  drone_id uuid references public.drones on delete set null,
  type text not null default 'spray',
  status text not null default 'scheduled',
  scheduled_at timestamptz not null default now(),
  chemical text,
  dose_l_ha numeric,
  area_ha numeric,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.jobs enable row level security;
create policy "own jobs all" on public.jobs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Storage bucket for scan images
insert into storage.buckets (id, name, public) values ('scans', 'scans', false) on conflict do nothing;
create policy "own scan uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'scans' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own scan read" on storage.objects for select to authenticated
  using (bucket_id = 'scans' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own scan delete" on storage.objects for delete to authenticated
  using (bucket_id = 'scans' and (storage.foldername(name))[1] = auth.uid()::text);
