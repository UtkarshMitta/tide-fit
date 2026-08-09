import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { publicEnv } from "@/lib/env.public";

/**
 * Server-side Supabase. Optional: when the env vars are absent this returns
 * null and the app falls back to anonymous, in-memory trips.
 */
export function createServerSupabase() {
  if (!publicEnv.supabaseUrl || !publicEnv.supabaseAnonKey) return null;

  const cookieStore = cookies();
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
  const supabase = createServerSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
