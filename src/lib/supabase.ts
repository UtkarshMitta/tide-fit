import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { serverEnv } from "@/lib/env";
import { publicEnv } from "@/lib/env.public";

/**
 * Server-side Supabase. Optional: when the env vars are absent this returns
 * null and the app falls back to anonymous, in-memory trips.
 */
export async function createServerSupabase() {
  if (!publicEnv.supabaseUrl || !publicEnv.supabaseAnonKey) return null;

  const cookieStore = await cookies();
  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot mutate cookies; the auth callback route refreshes sessions.
        }
      },
    },
  });
}

export async function getCurrentUser() {
  const supabase = await createServerSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

/**
 * Service-role client for the `trips` table.
 *
 * Trip rows are reached two ways that RLS cannot both express with the public
 * anon key: an owner listing their own trips, and anyone opening a shared link.
 * The old schema squared that circle with `select using (true)`, which — since
 * the anon key ships to the browser — made the whole table world-readable.
 *
 * With supabase/002_tighten_rls.sql applied, RLS is owner-only and every trip
 * read/write goes through this client instead. Authorization moves into the
 * application: `getTrip` is a capability lookup on an unguessable server-minted
 * randomUUID, and `listTripsForCurrentUser` filters on the id resolved from the
 * user's own session. Those explicit filters are now load-bearing — this client
 * bypasses RLS, so a missing `.eq("user_id", ...)` would leak other users' rows.
 *
 * Returns null when the key is absent, which is what keeps the app working on
 * the pre-002 schema.
 */
export function createServiceSupabase() {
  if (!publicEnv.supabaseUrl || !serverEnv.supabaseServiceRoleKey) return null;

  return createClient(publicEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
