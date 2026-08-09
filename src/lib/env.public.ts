/** Client-safe config. Only `NEXT_PUBLIC_*` values belong in this file. */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  stay22AffiliateId: process.env.NEXT_PUBLIC_STAY22_AID ?? "tidefit",
};
