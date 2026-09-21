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
-- THE CODE HALF IS ALREADY IN PLACE. src/lib/supabase.ts exposes
-- createServiceSupabase(), and src/lib/store.ts routes every trip read/write
-- through it while keeping the cookie-bound anon client for auth, so
-- auth.uid() still resolves. Both degrade to the old anon-key path when
-- SUPABASE_SERVICE_ROLE_KEY is unset.
--
-- TO APPLY:
--   1. Set SUPABASE_SERVICE_ROLE_KEY in the server env (never NEXT_PUBLIC_).
--   2. Run this file in the Supabase SQL editor.
-- Doing step 2 without step 1 leaves the app unable to read any trip, since
-- the anon key will no longer satisfy the new SELECT policy.
--
-- AFTER THIS, authorization for trips lives in the application rather than in
-- RLS: getTrip is a capability lookup on an unguessable server-minted
-- randomUUID (so shared links keep working, including for anonymous trips),
-- and listTripsForCurrentUser filters on the id resolved from the caller's own
-- session. Those explicit filters are load-bearing — the service role bypasses
-- RLS, so a missing .eq("user_id", ...) would leak other users' rows.

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
