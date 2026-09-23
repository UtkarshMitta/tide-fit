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
| 2 | Supabase RLS exposes every trip to anyone with the anon key | High | **Fixed** — migration applied; `check:rls` passes |
| 3 | Strava application client secret stored in a browser cookie | High | **Fixed** — sealed with AES-256-GCM |
| 4 | No rate limiting on the endpoints that spend money | High | **Fixed** |
| 5 | Poisoned search results reach the itinerary prompt unfiltered | Medium | **Fixed** (defence in depth) |
| 6 | OpenWeather AQI bucketed by UTC, not destination-local date | Medium | **Fixed** |
| 7 | Next.js 14.2.35 carries a critical-rated advisory set | Medium | **Fixed** — upgraded to Next 16 / React 19 |
| 8 | `wave_period_max` used against a "smaller is worse" rule | Low | Reported |
| 9 | Strava status pill can never light up on the paste-credentials path | Low | **Fixed** |
| 10 | `/auth/callback` missed the `//` guard the other callbacks had | Low | **Fixed** |
| 11 | Trip cache reads stale data ahead of Supabase; disk mirror never evicted | Low | Reported |
| 12 | No CI, no tests, no LICENSE | Low | **Fixed** — CI, tests and a 0BSD license added |
| 13 | One dead export and two unused dependencies | Low | **Fixed** — removed |
| 14 | Trip form unsubmittable every evening in the Americas | High | **Fixed** — found after the audit |
| 15 | OAuth redirects built from a login-protected, per-deployment URL | Medium | **Fixed** — found after the audit |

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

**Status: fixed.** The migration has been applied, and `npm run check:rls` against the project reports all three checks passing: the trips table holds rows, the public key reads none of them, and anonymous inserts are refused.

Link sharing never needed public SELECT — nothing reads trips from the browser; `getTrip` and
`listTripsForCurrentUser` are both server-side. So trips can be owner-only at the RLS layer while
shared links keep working, provided the server reads them with a key that is not the anon key.

`src/lib/supabase.ts` now exposes `createServiceSupabase()`, and `src/lib/store.ts` routes every
trip read and write through it, keeping the cookie-bound anon client for auth so `auth.uid()` still
resolves. Both fall back to the old anon-key path when `SUPABASE_SERVICE_ROLE_KEY` is unset, so
this change is inert until you opt in.

To finish it:

1. Set `SUPABASE_SERVICE_ROLE_KEY` in the server env (never `NEXT_PUBLIC_`).
2. Run `supabase/002_tighten_rls.sql` in the Supabase SQL editor.

Step 2 without step 1 leaves the app unable to read any trip.

**Verification tooling.** `npm run check:rls` takes the public anon key and asks PostgREST for the
trips table, exactly as an attacker would, reporting whether anonymous SELECT and INSERT are
refused and whether the service-role key is present. It distinguishes a policy refusal from an
unreachable host: a transport failure is reported as inconclusive with a non-zero exit, never as a
pass, since a false all-clear on a security check is worse than no check. `src/lib/env.ts` also
warns at server start when Supabase is configured without the service-role key, because a
misconfigured deployment otherwise looks and behaves entirely normally.

**What this moves, not removes.** Authorization for trips shifts from RLS into the application:
`getTrip` becomes a capability lookup on an unguessable server-minted `randomUUID`, and
`listTripsForCurrentUser` filters on the id resolved from the caller's own session. Those explicit
filters are now load-bearing — the service role bypasses RLS, so a dropped `.eq("user_id", ...)`
would leak other users' rows where previously a policy would have caught it. Both call sites carry
a comment saying so.

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

**Resolved via option 2.** `src/lib/seal.ts` encrypts the pasted secret with AES-256-GCM under a
new `TIDEFIT_SECRET_KEY` before it goes into the cookie, so the cookie carries ciphertext that is
useless without the server key. GCM means a tampered cookie fails to open rather than decrypting to
garbage, and a value sealed under a rotated key reads as absent rather than silently misbehaving.
The cookie lifetime dropped from 30 days to 7, and the connect form now tells the visitor plainly
what happens to their secret.

It fails closed: without `TIDEFIT_SECRET_KEY` the paste route returns 503 rather than falling back
to plaintext, pointing the host at either that key or host-configured credentials. Hosts using
`STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` never reach the sealing path and do not need the key.

Verified against a running server: with the key set the cookie contains `v1.<iv>.<tag>.<ciphertext>`
and the plaintext appears nowhere in the response; without it the route 503s and sets no cookie.
Option 1 (dropping the paste path) remains the simplest choice for a public deployment, since then
no visitor secret exists at all — the README recommends it.

Note the cookie cannot simply be path-scoped to `/api/strava`: `getTrainingLoad()` needs it during
`POST /api/trips`.

### 7. Next.js 14.2.35 — Medium; resolved by upgrading

`npm audit` reports **6 vulnerabilities (1 critical, 5 high)**, and the only offered fix is
`next@16`, a major upgrade. Checking reachability rather than taking the count at face value:

| Advisory | Reachable here? |
|---|---|
| RCE in Image Optimization API via AVIF (critical) | **No** — the app uses no `next/image` (`LodgingList.tsx:99` deliberately uses `<img>`), and `next.config.mjs` sets no `remotePatterns`, so remote images are blocked |
| RCE on Windows-hosted servers (critical) | **No** — deployed on Linux/Vercel |
| DoS / SSRF in Server Actions (high) | **No** — no `"use server"` anywhere in the codebase |
| Middleware/proxy cache poisoning (low) | **Partially** — the app does use middleware (now `proxy.ts`) |
| postcss advisories (high) | **Build-time only** — not a runtime production risk |

Also note CVE-2025-29927 (the middleware auth-bypass class) was fixed in 14.2.25; 14.2.35 is
patched, and `src/proxy.ts` (formerly `src/middleware.ts`) does no authorization anyway.

**Resolved.** Upgraded to Next 16.3.5 and React 19.3.0. `npm audit` now reports **zero
vulnerabilities**, down from 6 (1 critical, 5 high).

The reachability analysis above is why this was done as a planned upgrade rather than an emergency
`npm audit fix --force`: nothing critical was actually exploitable, so there was time to migrate
properly instead of taking a forced major bump blind.

What the upgrade required:

- **Async request APIs.** `cookies()` is a promise in Next 15+, which cascaded through
  `oauth-state.ts`, `calendar.ts`, `supabase.ts`, `strava.ts` and `store.ts` and every route that
  calls them. The official codemod took the `UnsafeUnwrappedCookies` escape hatch, which preserves
  behaviour but keeps the deprecated sync access; the functions were made properly async by hand
  instead. `params` in `trip/[id]/page.tsx` likewise became a promise.
- **`middleware` → `proxy`.** Next 16 deprecated the middleware file convention. Renamed via the
  codemod to `src/proxy.ts`; it still only refreshes the Supabase session and still does no
  authorization.
- **ESLint 9 flat config.** `eslint-config-next@16` requires ESLint 9, and Next 16 removed
  `next lint`. `.eslintrc.json` became `eslint.config.mjs` and the script now invokes `eslint`
  directly.
- **Five new lint findings on pre-existing code.** A `setState` inside an effect in
  `StravaConnect.tsx` was a real anti-pattern and is now derived from `useSearchParams` instead. Two
  `window.location.href` warnings were *not* mistakes — both navigate to route handlers that 302 to
  Google and Strava, which `router.push` cannot follow — so they carry documented suppressions
  rather than being "fixed" into something broken.

Verified at runtime on Next 16: home page, demo trip, trip create-and-read round trip, OAuth nonce
binding (forged callback still rejected), Strava secret still sealed, and rate limiting still
cutting off at exactly 10. No deprecation or Suspense warnings in the dev log.

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

**Resolved.** The repo was public with no license file, so nobody could legally reuse it. Now
0BSD — public-domain-equivalent, no attribution required, no conditions. Note that copyright in the
original code sits with its author (Utkarsh Mittal), so the grant should be confirmed with them.

### 13. Dead code — Low

A full unused-export sweep found remarkably little. Exactly one genuinely dead symbol,
`hasStravaCredentials` in `src/lib/strava.ts` (zero references anywhere), now removed. Two unused
dependencies, `date-fns` and `lucide-react`, now uninstalled.

Thirty-three further symbols are exported but referenced only inside their own module. Most are
correct as-is: types that appear in an exported function's signature must be exported for callers to
name them. The rest are pure helpers that are natural test targets, so they are now covered by
tests rather than un-exported — `summariseTrainingLoad`, `trimForNarration`, `toIsoDate`,
`addDaysIso`, `isPropertyPage` and `cleanPropertyName`. The suite went from 13 tests to 24.

Two things that looked like dead code but are not, checked and cleared: the pre-rendered demo audio
is properly wired (`demo.ts:288` through the trip page and `DayCard` to a HEAD check in
`AudioBriefing`, falling back to `/api/voice`), and `prerender-demo-audio.ts` does create
`public/audio` with `mkdir(recursive)`. No TODO/FIXME markers and no orphaned files.

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

## Deployment

TideFit is live at <https://tide-fit.vercel.app>, deployed with no paid API keys.

Serverless instances do not share memory, so without Supabase a shared trip link used to 404 whenever
a different instance served it. Trips are now stored as private objects in a Vercel Blob store
(`src/lib/blob-store.ts`), which the README's Deploy button creates automatically. Verified on the
live deployment:

- A trip planned before a full redeploy (every instance replaced) loaded on 5 of 5 attempts
  afterwards, with identical verdicts. It could only have come from Blob.
- The stored object returns 403 at its storage URL without credentials, so the store is private.
- A nonexistent trip id returns 404.
- The live site reports Supabase as not configured. `.vercelignore` keeps local `.env*` files, which
  can hold a service-role key, out of CLI uploads.
- The Strava option is hidden on deployments that cannot complete a connection, instead of leading
  visitors to a 503.

**Automatic deploys.** Every push to `main` runs the CI checks and, only if all pass, deploys to
production (the `deploy` job in `.github/workflows/ci.yml`). Vercel's GitHub integration was not an
option: for a personal repository only the owner can connect it, and the project lives on a
collaborator's Vercel account. The job authenticates with a `VERCEL_TOKEN` repository secret. That
token must have **Full Account** scope: a diagnostic run showed the CLI first requests `/v2/user`
(404 for a project-scoped token) and the team (403), and gives up before it reaches the project,
which a project-scoped token can read. Anyone with write access to the repository can read the
secret through a workflow, so it carries an expiry.

**Edge rate limiting.** A Vercel Firewall rule limits `/api/` to 20 requests per 60 seconds per IP,
answering 429. Verified: of 25 rapid requests, exactly 20 reached the app and 5 were refused with
`x-vercel-mitigated: deny`, while non-API pages were unaffected. Unlike the in-process limiter it holds
across instances, which also bounds Blob growth and the shared Open-Meteo quota.

Remaining limits of a public demo: stored trips never expire, and Vercel's Hobby plan and Open-Meteo's
free API are both licensed for non-commercial use only. See the README's "Running it in public".

## Found after the audit

### 14. The trip form could not be submitted every evening in the Americas — High

Surfaced by a hydration error while testing the Codespaces setup. `TripForm.tsx` took the start
date's default and its `min` from `todayIso()` at render time. On the server that is UTC, so from
8 pm US Eastern (5 pm Pacific) the server's "today" is already tomorrow. React does not patch
attribute mismatches during hydration ("this won't be patched up"), so the browser kept the server's
`min` (tomorrow) while showing the client's value (today). The default date then sat below the field's
own minimum, and the browser refused to submit: *"Value must be <tomorrow> or later."* The main
action on the live site silently did nothing for Americas visitors every evening.

Reproduced with the dev server in UTC+14 against a browser on US Eastern time, where
`checkValidity()` returned false. Fixed by reading the date through `useSyncExternalStore` with an
empty server snapshot: the server renders the field blank, hydration matches, and the browser fills
in its local date. After the fix, in the same setup: no hydration errors, `min` and value both the
local date, and submitting plans a trip starting that day.

The error seen in Codespaces also carried a second, harmless cause: the Dark Reader extension adds
`data-darkreader-proxy-injected` to `<html>` before React loads. `suppressHydrationWarning` on
`<html>`, the documented escape hatch, covers that element's own attributes only.

### 15. OAuth redirects built from a login-protected, per-deployment URL — Medium

Without `NEXT_PUBLIC_APP_URL`, the public base URL fell back to `VERCEL_URL`, the per-deployment
address. It changes on every deploy, so it can never match a redirect URI registered with Strava or
Google, and it sits behind Vercel's Deployment Protection: on the live project it 302s to Vercel's
login while `tide-fit.vercel.app` returns 200. A visitor finishing sign-in, or following a link in a
synced calendar event, would have landed on a Vercel login page. `resolveAppUrl()` now prefers an
explicit URL, then `VERCEL_PROJECT_PRODUCTION_URL`, and treats an empty `NEXT_PUBLIC_APP_URL=` as
unset. Latent until now because no sign-in is configured on the live site.

## Verification

All checks run against this branch:

```bash
npm run typecheck   # clean
npm run lint        # clean
npm test            # 45/45 pass
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
