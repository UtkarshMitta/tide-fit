# TideFit

**Trip planning for athletes who need to train while they travel.**

Most travel planners tell you the weather. TideFit tells you whether you can actually train. Give it
a destination, some dates and your sports, and it fetches sport-specific condition data for every
day of the trip, classifies each day **safe / caution / unsafe** against tunable thresholds, then
writes a day-by-day plan around real local places — narrated as a short morning voice briefing.

A swimmer gets marine sea state. A runner gets air quality. Cyclists and hikers get wind, heat and
UV. Every verdict carries the measurement that produced it, so a badge is always explainable. On an
unsafe day the plan changes: the session moves indoors, or the sport swaps, rather than cheerfully
sending you into 1.9 m shorebreak.

Originally built for the Checkout Travel & Hospitality Hackathon.

---

## Quick start

```bash
npm install
cp .env.example .env.local   # every key is optional
npm run dev
```

Open <http://localhost:3000> and plan a trip. **You need no API keys to run this** — with an empty
`.env.local` you still get live condition data from Open-Meteo, real safety classification, a
rule-based itinerary and a device-voice briefing.

Requires **Node 22 or newer**.

Adding keys turns on more, feature by feature — see [Configuration](#configuration). Nothing breaks
when a key is missing; that feature just degrades.

Want to see the finished article without planning anything? Visit
[`/trip/demo-lisbon`](http://localhost:3000/trip/demo-lisbon) for a canned 3-day Lisbon trip.

---

## How it works

The pipeline lives in [`src/lib/planner.ts`](src/lib/planner.ts): geocode → fetch and classify
conditions per sport → ground the plan in live web search → write the itinerary → find lodging near
the session. Every stage degrades on its own, so a dead upstream costs you that feature rather than
the trip.

**Per-sport condition engine.** Swimmers get wave height, wave period and sea surface temperature.
Runners get air quality as US AQI. Cyclists and hikers get wind gusts, feels-like temperature,
rainfall and UV. Severe weather codes (thunderstorms, heavy freezing rain) override everything.

**Missing data is never treated as good news.** A metric with no forecast is `unknown`, and a day
containing any `unknown` cannot come back `safe`. Air-quality forecasts run about 5 days out and
weather about 16; days beyond those horizons are marked "no data" rather than given a false verdict.
A swim is never graded on wind alone when the sea state is missing.

**Grounded itineraries.** Tavily search results are fed into the itinerary prompt, and the model may
only name venues that appear in those results. The plan names the place, never the page: forums and
social sites are excluded from the search, URLs are withheld from the prompt, and publisher
suffixes are stripped from headlines. Search results are treated as untrusted data — they are
sanitised and fenced so a web page cannot issue instructions to the model.

**Marine data for inland cities.** Marine models only cover water cells, so a city centroid a few
kilometres inland returns nulls. TideFit probes outward in eight directions (throttled, since
Open-Meteo rejects bursts), uses the nearest cell with a sea state, and tells you how far away it
sampled. With no modelled water within 60 km it says so and plans pool sessions instead of guessing.

**Bookable lodging near the session, not the city centroid.** Stay22's Accommodations API supplies
real stays with live prices and ratings, measured from the training spot — a named beach or
trailhead when search and geocoding can pin one, otherwise an honest fallback to the city centre.

**Travel logistics in every day plan.** Mode of transport, door-to-door time, when to leave and how
to get back, grounded in a live local-transport search once the training spot is known.

**Briefed out loud.** Each day is narrated by ElevenLabs, cached by content hash so replays don't
re-bill. `/api/voice` takes a trip id and a date and builds the script server-side, so it cannot be
used as an open text-to-speech proxy. Without an ElevenLabs key the browser's own speech synthesis
reads the briefing instead.

### Tuning the safety rules

Every safety number lives in [`src/lib/thresholds.ts`](src/lib/thresholds.ts):

```ts
swimming: [
  { kind: "ceiling", key: "waveHeightMax", label: "Wave height", unit: "m",
    safeUpTo: 0.5, cautionUpTo: 1.2 },
  ...
]
```

Three rule shapes cover every metric: `ceiling` (bigger is worse), `floor` (smaller is worse, like a
short choppy wave period) and `window` (a comfort band with bad extremes, like temperature).
`maxRisk` caps how bad a single metric may make a day, so rain and UV degrade a session without
declaring it unsafe on their own.

Check your changes against live data without touching the UI:

```bash
npm run check:conditions -- "Lisbon" "Denver"
```

### How lodging ranking works

Two tiers, so the trip page always has somewhere to stay:

1. **Stay22 Accommodations API** (`STAY22_API_KEY`) — live inventory centred on the training spot,
   with prices for your dates, ratings, thumbnails and a deeplink per supplier. TideFit picks the
   cheapest supplier that actually quoted, prices in local currency, and reads the affiliate id back
   out of the returned links so the map widget matches the booking links.
2. **Tavily fallback** (`TAVILY_API_KEY`) — a search scoped to booking sites and filtered to URL
   shapes that are a single property page rather than a "10 best hotels" listicle. Real names and
   working links, no prices.

Ranking deserves a note, because the naive version is bad. The feed is ordered by distance, so at a
city centroid the first rows are one-review studios — while the best-reviewed hotels often have no
price for the requested dates. The tiers therefore require *both* review credibility and a live
quote, relaxing only to fill remaining slots. Requesting a larger page makes this worse rather than
better: `pageSize=20` pads the response with duplicates and unpriced rows, while ~12 comes back
unique and fully priced. Quality decides which five stays make the list; the list is then sorted
cheapest first, since that is the order a traveller compares in.

Check any destination without touching the UI:

```bash
npm run check:lodging
```

---

## Configuration

Everything below is optional. Copy `.env.example` to `.env.local` and fill in what you want.
Condition data from Open-Meteo (geocoding, marine, forecast, air quality) needs no key at all.

| Variable | What it turns on | Without it |
|---|---|---|
| `TAVILY_API_KEY` | Live web search grounding, so the plan names real spots and events | Generic session descriptions, no named venues |
| `OPENAI_API_KEY` | LLM-written itinerary (`OPENAI_MODEL`, default `gpt-4o-mini`) | Deterministic rule-based template |
| `ELEVENLABS_API_KEY` | Studio voice narration (`ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`) | Your browser's built-in speech synthesis |
| `STAY22_API_KEY` | Bookable stays with live prices | Tavily search across booking sites — names and links, no prices |
| `NEXT_PUBLIC_STAY22_AID` | Affiliate id for the map widget | Read back from the API response when `STAY22_API_KEY` is set |
| `OPENWEATHER_API_KEY` | Air quality via OpenWeatherMap instead of Open-Meteo | Open-Meteo `us_aqi` |
| `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sign-in and saved trips | Trips kept in server memory and a temp-dir cache |
| `SUPABASE_SERVICE_ROLE_KEY` | Owner-only row-level security — **see [Deploying](#deploying)** | Trip storage uses the anon key and the original schema |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Google Calendar sync | Sync button disabled |
| `STRAVA_CLIENT_ID` + `STRAVA_CLIENT_SECRET` | Training-load-aware intensity for every visitor | Each visitor can supply their own app credentials instead |
| `NEXT_PUBLIC_APP_URL` | Base URL used to build OAuth redirect URIs | Falls back to `VERCEL_URL` when deployed on Vercel, else `http://localhost:3000` |
| `TIDEFIT_DEMO_MODE` | Forces the canned Lisbon trip for every request | Normal planning |

### Optional setup

- **Supabase** — run `supabase/schema.sql` in the SQL editor, then set the two `NEXT_PUBLIC_SUPABASE_*`
  values. For anything public, also read [Deploying](#deploying) before you expose it.
- **Google Calendar** — create an OAuth client with redirect URI `{APP_URL}/api/calendar/callback`
  and the `calendar.events` scope.
- **Strava** — either set `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` so every visitor can connect
  with one shared app, or skip it and let each visitor paste their own Client ID and Secret from
  [strava.com/settings/api](https://www.strava.com/settings/api) (Authorization Callback Domain =
  your host; TideFit uses `{APP_URL}/api/strava/callback`). Note that visitor-pasted credentials are
  stored in that visitor's browser cookie for 30 days — see [Security](#security). Without Strava,
  trips still plan; intensity just isn't auto-adjusted from recent training.

---

## Development

```bash
npm run dev          # dev server on :3000
npm test             # unit tests (node:test via tsx)
npm run typecheck    # tsc --noEmit
npm run lint         # next lint
npm run build        # production build; works with zero keys
```

CI runs typecheck, lint, test and a zero-key build on every push and pull request
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

Tests in [`src/lib/safety.test.ts`](src/lib/safety.test.ts) concentrate on the parts where being
wrong matters: the classifier's fail-safe behaviour, threshold boundaries, the OAuth return path,
the untrusted-text sanitiser and the Strava training-load summary.

> **Don't run `npm run build` while `npm run dev` is live.** They share `.next/`, and the build
> clobbers the dev server's vendor chunks — you get a spurious
> `Cannot find module './vendor-chunks/...'` 500. Stop the dev server first.

### Project layout

```
src/lib/planner.ts      the end-to-end pipeline
src/lib/conditions.ts   geocoding, per-sport condition fetch, classification
src/lib/thresholds.ts   every safety number, in one tunable file
src/lib/search.ts       Tavily wrapper + untrusted-text sanitiser
src/lib/itinerary.ts    LLM itinerary + deterministic fallback
src/lib/voice.ts        ElevenLabs TTS with per-character caching
src/lib/stay22.ts       Stay22 Accommodations API client + quality ranking
src/lib/lodging.ts      lodging discovery: Stay22 first, Tavily fallback
src/lib/anchor.ts       resolves where the training actually happens
src/lib/calendar.ts     Google Calendar OAuth + event creation
src/lib/strava.ts       Strava OAuth + training load summary
src/lib/oauth-state.ts  CSRF nonce shared by both OAuth flows
src/lib/rate-limit.ts   per-IP limits on the endpoints that cost money
src/lib/store.ts        trip persistence: Supabase, memory and temp-dir cache
src/lib/demo.ts         the canned Lisbon trip
src/components/         DayCard, LodgingList, LodgingMap, AudioBriefing, StravaConnect
supabase/               schema plus the hardened RLS migration
```

### Demo safety

Live demos break when sponsor APIs rate-limit on stage, so there are three layers of protection:

1. **A canned sample trip** at `/trip/demo-lisbon` — a 3-day Lisbon multi-sport trip with
   pre-written itinerary text and search results. Its measurements still run through the real
   `classifyDay` pipeline, so the demo can never disagree with the live threshold config. Day 2
   deliberately shows the planner refusing an open-water swim in 1.9 m surf.
2. **Pre-rendered narration.** Run `npm run demo:audio` before going on stage to bake the three
   ElevenLabs clips into `public/audio/`. The player uses them if present and only calls the API
   when they are missing.
3. **A panic switch.** Set `TIDEFIT_DEMO_MODE=true` and every trip request returns the sample trip,
   regardless of destination.

---

## Deploying

Push to GitHub, import into Vercel, and add the same environment variables. Set
`NEXT_PUBLIC_APP_URL` to your deployed origin so the OAuth redirect URIs match.

Supabase is strongly recommended in production: without it, trips are stored per-instance in memory
and a shared link can 404 on a different serverless instance.

**Before you expose a deployment publicly, do these two things in this order:**

1. Set `SUPABASE_SERVICE_ROLE_KEY` in the server environment — never with a `NEXT_PUBLIC_` prefix.
2. Run [`supabase/002_tighten_rls.sql`](supabase/002_tighten_rls.sql) in the Supabase SQL editor.

The original `supabase/schema.sql` grants `select using (true)` on the trips table. Because the
anon key ships to the browser by design, that makes **every saved trip readable by anyone** who
takes that key from your page source — destinations, dates and full itineraries for every user. The
migration makes trips owner-only; the service-role key is what lets the server keep serving shared
links. Doing step 2 without step 1 leaves the app unable to read any trip.

Rate limits on `/api/trips` and `/api/voice` are in-process, so the effective ceiling is
`limit x instances`. That is fine for one host or a small deployment. For real production traffic,
move them behind a shared store (Vercel KV, Upstash) or your platform's WAF.

---

## Security

The repository has been audited; findings, severities and what was fixed are in
[`docs/AUDIT.md`](docs/AUDIT.md). Two things are worth knowing before you deploy:

- **Trips are protected by an unguessable URL, not by an access check.** Anyone holding a trip link
  can read that trip. That is intended — it is what makes a shared itinerary work — but it means a
  trip id is a secret.
- **Visitor-pasted Strava credentials live in a browser cookie** for 30 days (`httpOnly`,
  `SameSite=lax`, and `Secure` whenever `NEXT_PUBLIC_APP_URL` is `https`). A Strava *application*
  secret is a long-lived credential, so for a public deployment prefer setting
  `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` on the server and leaving the paste path unused.

Next.js 14 is out of active support and `npm audit` reports advisories against it. The two
critical-rated ones are not reachable in this app's configuration — it uses no `next/image` and no
Server Actions, and is not Windows-hosted — but a deliberate upgrade to a supported major is
outstanding. The analysis is in `docs/AUDIT.md`.

---

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · Supabase (auth + saved trips) · Vercel

**APIs:** Open-Meteo Geocoding, Marine, Forecast and Air Quality (no key) · Tavily (search
grounding) · OpenAI (itinerary) · ElevenLabs (narration) · Stay22 (Accommodations API + map widget)
· OpenWeatherMap (optional air quality) · Google Calendar (optional sync) · Strava (optional
training load)

---

## Disclaimer

Condition classifications come from forecast models and a threshold config. They are a planning aid,
not a guarantee — always defer to local lifeguards, trail authorities, and how you feel on the day.

## License

[0BSD](LICENSE) — public-domain-equivalent. Use it for anything, commercially or otherwise, with no
attribution required and no conditions attached.
