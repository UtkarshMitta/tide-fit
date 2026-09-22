import { publicEnv } from "@/lib/env.public";

/** Server-side integration config. Every key is optional: TideFit degrades feature by feature. */
export const serverEnv = {
  tavilyApiKey: process.env.TAVILY_API_KEY,
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM",
  elevenLabsModelId: process.env.ELEVENLABS_MODEL_ID ?? "eleven_turbo_v2_5",
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  openWeatherApiKey: process.env.OPENWEATHER_API_KEY,
  /**
   * Bypasses RLS, so it must never be exposed to the browser — no NEXT_PUBLIC_
   * prefix, and only ever read from server modules. Optional: without it trip
   * storage falls back to the anon key and the pre-002 schema.
   */
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  stay22ApiKey: process.env.STAY22_API_KEY,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  stravaClientId: process.env.STRAVA_CLIENT_ID,
  stravaClientSecret: process.env.STRAVA_CLIENT_SECRET,
  appUrl:
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"),
  /** Forces the canned Lisbon trip for every request — the on-stage panic switch. */
  demoMode: process.env.TIDEFIT_DEMO_MODE === "true",
};

export const integrationStatus = {
  tavily: Boolean(serverEnv.tavilyApiKey),
  elevenLabs: Boolean(serverEnv.elevenLabsApiKey),
  llm: Boolean(serverEnv.openAiApiKey),
  openWeather: Boolean(serverEnv.openWeatherApiKey),
  stay22Api: Boolean(serverEnv.stay22ApiKey),
  supabase: Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey),
  supabaseServiceRole: Boolean(publicEnv.supabaseUrl && process.env.SUPABASE_SERVICE_ROLE_KEY),
  googleCalendar: Boolean(serverEnv.googleClientId && serverEnv.googleClientSecret),
  strava: Boolean(serverEnv.stravaClientId && serverEnv.stravaClientSecret),
};

export function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing ${name}. Add it to .env.local — see .env.example.`);
  return value;
}

/**
 * Warns once, at server start, when Supabase is configured but trip storage is
 * still on the anon key.
 *
 * The original supabase/schema.sql grants `select using (true)` on the trips
 * table. Since the anon key ships to the browser, that leaves every saved trip
 * publicly readable. The fix is supabase/002_tighten_rls.sql plus this key, and
 * both are easy to forget — a misconfigured deployment looks and behaves
 * completely normally, which is exactly why it needs to be noisy here.
 */
if (
  typeof window === "undefined" &&
  integrationStatus.supabase &&
  !integrationStatus.supabaseServiceRole
) {
  console.warn(
    "[tidefit] Supabase is configured without SUPABASE_SERVICE_ROLE_KEY.\n" +
      "          Trip storage is using the anon key, which means the trips table is\n" +
      "          only as private as its RLS policies. If you have not applied\n" +
      "          supabase/002_tighten_rls.sql, every saved trip is publicly readable.\n" +
      "          Verify with: npm run check:rls",
  );
}
