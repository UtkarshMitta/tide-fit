import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env.public";

/** Returns null when Supabase is not configured, so auth UI can hide itself. */
export function createBrowserSupabase() {
  if (!publicEnv.supabaseUrl || !publicEnv.supabaseAnonKey) return null;
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
