# TideFit security & correctness audit

**Scope:** full repository at `7790bbe` — security and secret handling, correctness of the
safety-classification logic, code quality, dependencies, with the Strava integration as a focus
area.
**Method:** static review of all 45 source files, plus a local dev server (zero API keys) probed
with `curl`. No live deployment exists to test.
**Date:** 2026-09-21.

Every finding below was confirmed empirically against the running app unless marked otherwise.
Several plausible-looking issues turned out to be defused by design; those are recorded in
[What was checked and found sound](#what-was-checked-and-found-sound), because knowing what is
*not* wrong is half the value of an audit.

---

## Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | OAuth callbacks accept any code — no CSRF binding | High | **Fixed** |
| 2 | Supabase RLS exposes every trip to anyone with the anon key | High | Migration proposed — needs owner action |
| 3 | Strava application client secret stored in a browser cookie | High | Reported — product decision |
| 4 | No rate limiting on the endpoints that spend money | High | **Fixed** |
| 5 | Poisoned search results reach the itinerary prompt unfiltered | Medium | **Fixed** (defence in depth) |
| 6 | OpenWeather AQI bucketed by UTC, not destination-local date | Medium | **Fixed** |
| 7 | Next.js 14.2.35 carries a critical-rated advisory set | Medium | Reported — reachability analysed |
| 8 | `wave_period_max` used against a "smaller is worse" rule | Low | Reported |
| 9 | Strava status pill can never light up on the paste-credentials path | Low | **Fixed** |
| 10 | `/auth/callback` missed the `//` guard the other callbacks had | Low | **Fixed** |
| 11 | Trip cache reads stale data ahead of Supabase; disk mirror never evicted | Low | Reported |
| 12 | No CI, no tests, no LICENSE | Low | CI + tests **added**; LICENSE reported |

---

## Fixed in this branch

### 1. OAuth callbacks accepted any authorization code — High

`src/app/api/strava/callback/route.ts` and `src/app/api/calendar/callback/route.ts` used `state`
purely to carry an in-app return path. Nothing tied the callback to the browser that began the
flow, and neither route carried a nonce.

**Failure scenario.** An attacker starts a Strava authorization for their own account, intercepts
their own `code`, and gets a victim to load
`/api/strava/callback?code=<attacker code>&state=/`. The victim's browser exchanges the attacker's
code and stores the attacker's tokens. From then on the victim's trip plans are shaped by the
attacker's training load. The same shape applies to the Google Calendar flow, where the victim's
calendar sync writes into an account they do not control.

**Fix.** `src/lib/oauth-state.ts` mints a random nonce per authorize request, stores it in a
short-lived httpOnly cookie, and echoes it in `state`. The callback validates with a constant-time
compare and clears the nonce so a state is good exactly once. No shared signing secret, so it works
across serverless instances.

**Verified.** A forged callback now redirects to `?strava=error` / `?calendar=error` without
exchanging the code; a legitimate flow passes state validation and proceeds.

### 4. No rate limiting on the endpoints that spend money — High

`POST /api/trips` fans out to Open-Meteo, Tavily, Stay22 and an LLM on every call, with
`maxDuration = 60`. `POST /api/voice` bills ElevenLabs per character. Both are unauthenticated —
correctly so, since the demo must work signed-out — and neither had a limit.

**Verified before the fix:** eight concurrent unauthenticated trip builds from one client, all
`200`. On a deployed instance with keys configured, a trivial loop drains the host's API budget.

**Fix.** `src/lib/rate-limit.ts` adds a per-IP fixed-window limiter (10/min trips, 20/min voice)
applied *before* any upstream work, returning `429` with `Retry-After`. Verified: exactly 10 pass,
the 11th gets `429 Retry-After: 57`, and a different IP is unaffected.

**Limitation, stated in the module docstring:** the limiter is in-process, so the effective ceiling
is `limit x instances`. That is the right shape for one host or a small Vercel deployment; a real
production deployment should move it behind Vercel KV / Upstash or a WAF.

### 5. Poisoned search results reached the itinerary prompt — Medium

`groundingForPrompt` in `src/lib/search.ts` interpolated Tavily `title` and `content` into the
prompt verbatim. Those are arbitrary web pages that happen to rank for a destination. The prompt's
safety rules are instructions, not a boundary.

**Why it matters more here than in a typical RAG app:** rule 2 ("never program an outdoor session
for a sport marked UNSAFE") *is* the product. A page that ranks for "Lisbon open water swimming"
and contains text addressed to the model is a path to softening a safety verdict.

**Fix — defence in depth, not a guarantee.** `sanitiseForPrompt` strips fenced blocks, markdown
headings and common "ignore previous instructions" phrasings, and caps each result at 600
characters. The block is wrapped in `<<<WEB_RESULTS>>>` markers, and a new system-prompt rule 11
states its contents are data that cannot override rules 1–10. Tavily's own synthesized answer goes
through the same sanitiser.

The real boundary remains structural and was already correct: the model's output is Zod-validated,
and the conditions block is built server-side from measurements the model never supplies. A
successful injection can bias prose; it cannot alter a measured verdict.

### 6. OpenWeather AQI bucketed by UTC date — Medium

`fetchOpenWeatherAqi` (`src/lib/conditions.ts`) did
`new Date(entry.dt * 1000).toISOString().slice(0, 10)`, bucketing hourly readings by **UTC** while
the rest of the pipeline works in destination-local dates.

**Failure scenario.** For Tokyo (UTC+9), readings from 00:00–09:00 local are attributed to the
previous day. A morning pollution peak is reported against a day it did not occur on — and the
adjacent day gets a cleaner number than reality. This only affects hosts who set
`OPENWEATHER_API_KEY`; the Open-Meteo default path already requests local time.

**Fix.** Bucketing now uses `Intl.DateTimeFormat` in `place.timezone`, with a UTC fallback for
non-IANA zone values such as `"auto"`.

### 9. The Strava status pill could never light up — Low

This is what prompted the audit, and the feature is **not** unimplemented. Strava is wired end to
end: `planner.ts:69` calls `getTrainingLoad()` and feeds the result into `generateItinerary`,
`page.tsx` renders `<StravaConnect>`, and all four routes work.

The footer pill read `integrationStatus.strava`, which is
`Boolean(STRAVA_CLIENT_ID && STRAVA_CLIENT_SECRET)` — **server env only**. On a deployment using the
documented paste-your-own-credentials path, the pill read "not configured" permanently, even for a
connected visitor. A working feature that reports itself as absent.

**Fix.** The pill now also lights up when the visitor is actually connected.

### 10. `/auth/callback` missed the protocol-relative guard — Low

`src/app/auth/callback/route.ts` checked `next.startsWith("/")` only, while both OAuth callbacks
also rejected `//`. **Not exploitable** — verified that `?next=//evil.com` produced
`Location: http://localhost:3000//evil.com`, which stays on-origin — but it was the one place the
guard was weaker than its siblings. All three now share one `safeReturnPath` helper that also folds
the backslash form (`/\evil.com`), which the URL spec normalises to `//`.

### 12. No CI and no tests — Low

The repo had `typecheck`, `lint` and `build` scripts and nothing running them, and zero test
coverage on a codebase whose job is safety classification.

**Added.** `.github/workflows/ci.yml` runs typecheck, lint, test and a zero-key build on push and
PR. `src/lib/safety.test.ts` adds 13 tests (`npm test`, `node:test` via the existing `tsx`
dependency — no new runtime dependency) covering fail-safe behaviour, threshold boundaries, the
OAuth return path and the sanitiser.

CI earned its place on the first run: it failed on Node 20, because `node --test` only accepts glob
paths from Node 22 onward and the local machine was on Node 24. The workflow now pins Node 22 and
`package.json` declares `engines: { node: ">=22" }` so the floor is explicit rather than
accidental.

---

## Needs your decision

### 2. Supabase RLS exposes every trip — High

`supabase/schema.sql:22` grants `select using (true)`, commented as "anyone holding the link can
read a trip". That is not what it does. `NEXT_PUBLIC_SUPABASE_ANON_KEY` ships to the browser by
design, so the policy makes the whole table readable to anyone who lifts that key from the page
source:

```
curl "https://<project>.supabase.co/rest/v1/trips?select=*" -H "apikey: <anon key>"
```

That returns every trip anyone has planned — destination, dates, duration, sports, full payload —
grouped by `user_id`. Travel plans are personal data: where a named account will be, and when.

Two further policies are looser than intended: `insert` lets an unauthenticated client write
arbitrary rows, and `update using (user_id is null or ...)` lets anyone rewrite **any** anonymous
trip, including one another visitor is about to open.

**Proposed:** `supabase/002_tighten_rls.sql`, written but deliberately **not applied**. Link sharing
does not need public SELECT — nothing reads trips from the browser; `getTrip` and
`listTripsForCurrentUser` are both server-side. The migration makes trips owner-only and requires a
matching code change (a service-role client for trip reads in `store.ts`, `SUPABASE_SERVICE_ROLE_KEY`
in server env). Both must land together or anonymous trips stop being readable. It touches the
owner's Supabase project, so it is yours to run.

### 3. Strava application client secret lives in a browser cookie — High

`src/lib/strava.ts:105` stores a visitor-pasted Strava **application** client secret in
`tidefit_strava_client_secret` for 30 days. Confirmed against the running server:

```
set-cookie: tidefit_strava_client_secret=...; Max-Age=2592000; HttpOnly; SameSite=lax
```

`httpOnly` and `SameSite=lax` are right, and `secure` is set whenever `NEXT_PUBLIC_APP_URL` is
`https`. But a third-party application secret is a long-lived credential that should not live
client-side at all: any XSS-adjacent issue, any misconfigured `NEXT_PUBLIC_APP_URL` that leaves it
on `http`, or anything with access to the cookie jar hands over a credential that can impersonate
the visitor's Strava app. It is also persisted *before* it has ever been validated against Strava.

This is a product decision rather than a pure bug, so I have not changed it. Three options:

1. **Drop the paste path.** Host-configured `STRAVA_CLIENT_ID`/`SECRET` only. Simplest and safest;
   costs the "any visitor can connect without host setup" property the README advertises.
2. **Seal it server-side.** Encrypt the secret with a server key and store only an opaque handle in
   the cookie. Keeps the feature, adds a required env var and a key-rotation story.
3. **Keep it, state it.** Leave the mechanism and tell the visitor plainly in the UI that their app
   secret will be stored in their browser for 30 days.

My recommendation is (1) for anything deployed publicly and (3) for a hackathon demo. Note the
cookie cannot simply be path-scoped to `/api/strava`: `getTrainingLoad()` needs it during
`POST /api/trips`.

### 7. Next.js 14.2.35 — Medium, but less alarming than `npm audit` suggests

`npm audit` reports **6 vulnerabilities (1 critical, 5 high)**, and the only offered fix is
`next@16`, a major upgrade. Checking reachability rather than taking the count at face value:

| Advisory | Reachable here? |
|---|---|
| RCE in Image Optimization API via AVIF (critical) | **No** — the app uses no `next/image` (`LodgingList.tsx:99` deliberately uses `<img>`), and `next.config.mjs` sets no `remotePatterns`, so remote images are blocked |
| RCE on Windows-hosted servers (critical) | **No** — deployed on Linux/Vercel |
| DoS / SSRF in Server Actions (high) | **No** — no `"use server"` anywhere in the codebase |
| Middleware/proxy cache poisoning (low) | **Partially** — the app does use middleware |
| postcss advisories (high) | **Build-time only** — not a runtime production risk |

Also note CVE-2025-29927 (the middleware auth-bypass class) was fixed in 14.2.25; 14.2.35 is
patched, and `src/middleware.ts` does no authorization anyway.

**Recommendation:** no emergency. Next 14 is out of active support and there is no patch within
14.2.x, so plan a deliberate 14 → 15 → 16 upgrade rather than running `npm audit fix --force`
inside an audit branch. Sixteen other dependencies are behind; `@supabase/*`, `@tavily/core` and
`lucide-react` are safe minor bumps today.

### 8. `wave_period_max` is used against a "smaller is worse" rule — Low

`thresholds.ts:38` defines wave period as `kind: "floor"` (short chop is harder to swim), but the
value fetched is `wave_period_max` — the day's **maximum** period (`conditions.ts:248`).

Asking "was there any long-period swell today?" is systematically optimistic about how organised
the water is. A day whose period peaks at 8 s but sits at 3 s for most of daylight scores `safe` on
that metric. The blast radius is contained — `maxRisk: "caution"` means this metric can never on its
own declare a day unsafe, so it under-reports caution rather than flipping unsafe to safe — but the
name and the rule disagree.

Not fixed: the honest fix is to request a mean or minimum period from Open-Meteo and retune
`safeFrom`/`cautionFrom` against it, which is a threshold-tuning decision, not a code fix.

### 11. Trip cache can serve stale data — Low

`src/lib/store.ts` reads memory → disk → Supabase in that order, so once a trip is in the
`globalThis` map or the `os.tmpdir()` mirror, Supabase is never consulted again and an updated row
is not seen. The disk mirror is also never evicted or size-capped, unlike the 50-entry memory map.
On a long-lived host that grows without bound.

Low impact today because trips are effectively immutable once built. Worth fixing if trips ever
become editable. (Path traversal via `diskPathFor` is **not** an issue — the `[^a-zA-Z0-9-]` strip
removes dots and slashes.)

### 12b. No LICENSE — Low

The repo is public with no license file, which means no one may legally reuse it. If that is
deliberate, fine; if it is an oversight, add one before the repo gets attention.

---

## What was checked and found sound

Recording these so they do not get re-audited later:

- **`/api/voice` is genuinely not an open TTS proxy.** The README claim holds. Verified: an unknown
  `tripId` returns `404`, and an extra `text` field in the body is ignored — the script is always
  rebuilt server-side from the stored trip.
- **The server/client env boundary holds.** `env.ts` / `env.public.ts` are correctly split. Grepped
  the production client bundle for all seven secret names: the only two hits are user-facing UI
  strings ("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable calendar sync" and an
  ElevenLabs fallback message). No secret values and no server modules reached the client.
- **Missing measurements fail safe, not unsafe.** `RISK_ORDER` puts `unknown: 1` above `safe: 0`, so
  `worstRisk` escalates a day with any data gap to at least `unknown` rather than grading it on the
  metrics that happen to be present. Confirmed with live data: Denver returns
  `swimming unknown — No open-water sea state available`, and a day with no land forecast at all
  returns `unknown`, never `safe`. This is the single most important property in the codebase and it
  is correct.
- **Severe weather genuinely overrides.** WMO code 95 forces `unsafe` past otherwise benign metrics.
- **`maxRisk` capping works in the right direction** — it caps nuisance metrics (gusts, rain, UV) at
  `caution` without capping real hazards; AQI 400 still returns `unsafe`.
- **Middleware does no authorization.** It only refreshes the Supabase session, so the
  CVE-2025-29927 class of middleware-bypass mistake does not apply.
- **SSRF via `buildUrl` is not reachable.** Every call site passes a fixed base constant and user
  input only ever lands in `searchParams`.
- **`typecheck` and `lint` are clean** on the original code and after every commit in this branch.

---

## Verification

All checks run against this branch:

```bash
npm run typecheck   # clean
npm run lint        # clean
npm test            # 13/13 pass
npm run build       # succeeds with zero keys configured
npm run check:conditions -- "Lisbon" "Denver"
```

`check:conditions` against live Open-Meteo returns explainable verdicts for both a coastal and an
inland city, with Denver correctly reporting `unknown` for swimming rather than inventing one.

The canned demo at `/trip/demo-lisbon` still runs real measurements through the real `classifyDay`
and still refuses the day-2 open-water swim: *"1.9 m is past the 1.2 m hard stop and gusts of
58 km/h exceed the 55 km/h cycling limit."*

> Note when re-running these: do not `npm run build` while `npm run dev` is live — they share
> `.next/` and the build clobbers the dev server's vendor chunks, producing a spurious
> `Cannot find module './vendor-chunks/...'` 500. Stop the dev server first.
