# TideFit

AI trip planning for travelling athletes. Most travel planners tell you the weather. TideFit tells you whether you can actually train: it fetches sport-specific condition data for every day of a trip, classifies each day **safe / caution / unsafe** against tunable thresholds, grounds the plan in live web search so it names real beaches and trails, and narrates each day as a short voice briefing.

Built for the Checkout Travel & Hospitality Hackathon.

## What makes it different

- **Per-sport condition engine.** Swimmers get marine sea state (wave height, wave period, sea surface temperature). Runners get air quality as US AQI. Cyclists and hikers get wind gusts, feels-like temperature, rainfall and UV. Every verdict carries the measurement that drove it, so a badge is always explainable.
- **Grounded itineraries.** Tavily search results are fed into the itinerary prompt, and the model is instructed to only name venues that appear in those results. The trip page lists the sources it used.
- **Safety actually changes the plan.** On an unsafe day the itinerary moves the session indoors or swaps the sport instead of cheerfully sending you into 1.9 m shorebreak.
- **Bookable lodging, not just a map.** Stay22's Accommodations API supplies real stays with live prices, ratings and per-supplier deeplinks, ranked to favour well-reviewed properties that actually have a quote for your dates.
- **Degrades cleanly.** Every integration is optional. With zero API keys you still get real condition data, classification, a rule-based itinerary and a device-voice briefing.

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · Supabase (auth + saved trips) · Vercel

**Sponsor APIs:** Tavily (search grounding) · ElevenLabs (voice narration) · Stay22 (Accommodations API + map widget)

**Condition data:** Open-Meteo Geocoding, Marine and Forecast APIs (no key) · Open-Meteo Air Quality or OpenWeatherMap Air Pollution · Strava (optional training load) · Google Calendar (optional sync)

## Getting started

```bash
npm install
cp .env.example .env.local   # every key is optional
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). With no keys configured you get live condition data and the rule-based itinerary. Add `TAVILY_API_KEY` and `OPENAI_API_KEY` for grounded LLM itineraries, and `ELEVENLABS_API_KEY` for studio narration.

### Optional setup

- **Supabase** — run `supabase/schema.sql` in the SQL editor, then set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Without it, trips live in the server's memory for the session.
- **Google Calendar** — create an OAuth client with redirect URI `{APP_URL}/api/calendar/callback` and the `calendar.events` scope.
- **Strava** — create an API application whose callback domain matches your host; TideFit uses `{APP_URL}/api/strava/callback` and the `activity:read` scope.

## Demo safety

Live demos break when sponsor APIs rate-limit on stage, so there are three layers of protection:

1. **A canned sample trip** at `/trip/demo-lisbon` — a 3-day Lisbon multi-sport trip with pre-written itinerary text and search results. Its measurements still run through the real `classifyDay` pipeline, so the demo can never disagree with the live threshold config. Day 2 deliberately shows the planner refusing an open-water swim in 1.9 m surf.
2. **Pre-rendered narration.** Run `npm run demo:audio` before going on stage to bake the three ElevenLabs clips into `public/audio/`. The player uses them if present and only calls the API when they are missing.
3. **A panic switch.** Set `TIDEFIT_DEMO_MODE=true` and every trip request returns the sample trip, regardless of destination.

## Tuning the safety rules

All thresholds live in `src/lib/thresholds.ts`:

```ts
swimming: [
  { kind: "ceiling", key: "waveHeightMax", label: "Wave height", unit: "m",
    safeUpTo: 0.5, cautionUpTo: 1.2 },
  ...
]
```

Three rule shapes cover every metric: `ceiling` (bigger is worse), `floor` (smaller is worse, like a short choppy wave period) and `window` (a comfort band with bad extremes, like temperature). `maxRisk` caps how bad a single metric may make a day, so rain and UV degrade a session without declaring it unsafe on their own. Severe weather codes (thunderstorms, heavy freezing rain) override everything.

Check your changes against live data without touching the UI:

```bash
npm run check:conditions -- "Lisbon" "Denver"
```

## Project layout

```
src/lib/conditions.ts   geocoding, per-sport condition fetch, classification
src/lib/thresholds.ts   every safety number, in one tunable file
src/lib/search.ts       Tavily wrapper for local grounding
src/lib/itinerary.ts    LLM itinerary + deterministic fallback
src/lib/voice.ts        ElevenLabs TTS with per-character caching
src/lib/stay22.ts       Stay22 Accommodations API client + quality ranking
src/lib/lodging.ts      lodging discovery: Stay22 first, Tavily fallback
src/lib/calendar.ts     Google Calendar OAuth + event creation
src/lib/strava.ts       Strava OAuth + training load summary
src/lib/planner.ts      the end-to-end pipeline
src/lib/demo.ts         the canned Lisbon trip
src/components/DayCard.tsx     conditions, itinerary text, audio player
src/components/LodgingList.tsx bookable stays with live prices
src/components/LodgingMap.tsx  Stay22 map embed
```

## How lodging works

Two tiers, so the trip page always has somewhere to stay:

1. **Stay22 Accommodations API** (`STAY22_API_KEY`) — live inventory near the destination with prices for your exact dates, ratings, thumbnails and an Allez deeplink per supplier. TideFit picks the cheapest supplier that actually quoted a price, prices in the destination's local currency, and reads the affiliate id back out of the returned links so the map widget matches the booking links without extra configuration.
2. **Tavily fallback** (`TAVILY_API_KEY`) — a search scoped to booking sites, filtered to URL shapes that are a single property page rather than a "10 best hotels" listicle, with Allez links built by hand. Real names and working links, no prices.

Ranking deserves a note, because the naive version is bad. The feed is ordered by distance, so at a city centroid the first rows are one-review studios; but the best-reviewed hotels often have no price for the requested dates. The tiers therefore require *both* review credibility and a live quote, relaxing only to fill remaining slots. Requesting a larger page makes this worse rather than better — `pageSize=20` pads the response with duplicates and unpriced rows, while ~12 comes back unique and fully priced.

Check any destination without touching the UI:

```bash
npm run check:lodging
```

## Notable implementation details

- **Marine data for inland cities.** Marine models only cover water cells, so a city centroid a few kilometres inland returns nulls. TideFit probes outward in eight directions (throttled, since Open-Meteo rejects request bursts), uses the nearest cell that has a sea state, and tells you how far away it sampled. If there is no modelled water within 60 km it says so and plans pool sessions instead of guessing.
- **Honest unknowns.** Air-quality forecasts run about 5 days out and weather about 16. Days beyond those horizons are marked "no data" rather than given a false verdict, and a swim is never graded on wind alone when the sea state is missing.
- **US AQI from raw pollutants.** When `OPENWEATHER_API_KEY` is set, PM2.5 and PM10 concentrations are converted using the EPA 2024 breakpoints so the number means the same thing as the Open-Meteo `us_aqi` fallback.
- **Voice endpoint is not an open TTS proxy.** `/api/voice` takes a trip id and a date, builds the script server-side, and caches by content hash so replays don't re-bill.

## Deploying

Push to GitHub, import into Vercel, and add the same environment variables. Set `NEXT_PUBLIC_APP_URL` to your deployed origin so the OAuth redirect URIs match. Supabase is strongly recommended in production: without it, trips are stored per-instance in memory and a shared link can 404 on a different serverless instance.

## Disclaimer

Condition classifications come from forecast models and a threshold config. They are a planning aid, not a guarantee — always defer to local lifeguards, trail authorities, and how you feel on the day.
