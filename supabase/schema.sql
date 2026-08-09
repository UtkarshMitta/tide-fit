-- TideFit saved trips. Run this in the Supabase SQL editor.
-- Trips are anonymous-friendly: user_id is null for trips created without signing in.

create table if not exists public.trips (
  id uuid primary key,
  user_id uuid references auth.users (id) on delete cascade,
  destination text not null,
  start_date date not null,
  days smallint not null check (days between 1 and 14),
  sports text[] not null default '{}',
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists trips_user_id_created_at_idx
  on public.trips (user_id, created_at desc);

alter table public.trips enable row level security;

-- Anyone holding the link can read a trip, which is what makes a shared
-- itinerary URL work. Nothing sensitive is stored in the payload.
drop policy if exists "trips are readable by link" on public.trips;
create policy "trips are readable by link"
  on public.trips for select
  using (true);

-- Anonymous visitors may create unowned trips; signed-in users own theirs.
drop policy if exists "anyone can create a trip" on public.trips;
create policy "anyone can create a trip"
  on public.trips for insert
  with check (user_id is null or user_id = auth.uid());

drop policy if exists "owners can update their trips" on public.trips;
create policy "owners can update their trips"
  on public.trips for update
  using (user_id is null or user_id = auth.uid())
  with check (user_id is null or user_id = auth.uid());

drop policy if exists "owners can delete their trips" on public.trips;
create policy "owners can delete their trips"
  on public.trips for delete
  using (user_id = auth.uid());
