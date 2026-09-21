-- PROPOSED migration — review before running. Not applied by schema.sql.
--
-- WHY
-- ---
-- schema.sql grants `select using (true)` on public.trips, with the comment
-- "anyone holding the link can read a trip". That is not what the policy does.
-- NEXT_PUBLIC_SUPABASE_ANON_KEY ships to the browser by design, so the policy
-- makes the entire table readable to anyone who takes that key from the page
-- source and queries PostgREST directly:
--
--   curl "https://<project>.supabase.co/rest/v1/trips?select=*" \
--        -H "apikey: <anon key>"
--
-- That returns every trip anyone has ever planned: destination, start date,
-- duration, sports and the full payload, grouped by user_id. Travel plans are
-- personal data — where a named account will be, and when.
--
-- Two further policies are looser than intended:
--   * insert `with check (user_id is null or user_id = auth.uid())` lets an
--     unauthenticated client write arbitrary rows into the table.
--   * update `using (user_id is null or ...)` lets anyone rewrite ANY
--     anonymous trip, including one another visitor is about to open.
--
-- APPROACH
-- --------
-- Link sharing does not actually need public SELECT. Nothing in the app reads
-- trips from the browser: `getTrip` and `listTripsForCurrentUser` both run
-- server-side in src/lib/store.ts, and the trip page is a Server Component.
-- So trips can be owner-only at the RLS layer while shared links keep working,
-- provided the server reads them with a key that is not the anon key.
--
-- APPLYING THIS REQUIRES A CODE CHANGE TOO:
--   1. Add SUPABASE_SERVICE_ROLE_KEY to the server env (never NEXT_PUBLIC_).
--   2. Give src/lib/store.ts a service-role client for trip reads and writes,
--      keeping the anon/SSR client for auth so auth.uid() still resolves.
-- Run this migration only together with that change, or anonymous trips stop
-- being readable at all.
--
-- TRADE-OFF: after this, a trip created while signed out is readable only by
-- the server that holds the service key. That is the intended behaviour, but
-- it does mean anonymous trips are no longer world-readable by link if the
-- code change is skipped.

begin;

-- Read: owners only. Server-side reads use the service role, which bypasses RLS.
drop policy if exists "trips are readable by link" on public.trips;
create policy "owners can read their trips"
  on public.trips for select
  using (user_id is not null and user_id = auth.uid());

-- Write: a signed-in client may only insert rows it owns. Anonymous trips are
-- written by the server with the service role, not by the browser.
drop policy if exists "anyone can create a trip" on public.trips;
create policy "signed-in users create their own trips"
  on public.trips for insert
  with check (user_id is not null and user_id = auth.uid());

-- Update: owners only. Previously any client could rewrite any anonymous trip.
drop policy if exists "owners can update their trips" on public.trips;
create policy "owners can update their trips"
  on public.trips for update
  using (user_id is not null and user_id = auth.uid())
  with check (user_id is not null and user_id = auth.uid());

-- Delete was already owner-only; restated here so the whole policy set is in
-- one place.
drop policy if exists "owners can delete their trips" on public.trips;
create policy "owners can delete their trips"
  on public.trips for delete
  using (user_id is not null and user_id = auth.uid());

commit;
