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
  supabase: Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey),
  googleCalendar: Boolean(serverEnv.googleClientId && serverEnv.googleClientSecret),
  strava: Boolean(serverEnv.stravaClientId && serverEnv.stravaClientSecret),
};

export function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing ${name}. Add it to .env.local — see .env.example.`);
  return value;
}
