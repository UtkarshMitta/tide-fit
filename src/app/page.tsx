import Link from "next/link";

import { AuthPanel } from "@/components/AuthPanel";
import { StravaConnect } from "@/components/StravaConnect";
import { TripForm } from "@/components/TripForm";
import { DEMO_TRIP_ID } from "@/lib/demo";
import { integrationStatus } from "@/lib/env";
import { SPORT_EMOJI } from "@/lib/risk-ui";
import { isStravaConnected } from "@/lib/strava";
import { listTripsForCurrentUser } from "@/lib/store";
import { getCurrentUser } from "@/lib/supabase";
import { SPORTS, SPORT_LABELS } from "@/lib/types";
import { formatDayLabel } from "@/lib/utils";

export const dynamic = "force-dynamic";

const HOW_IT_WORKS = [
  {
    title: "Real conditions, per sport",
    body: "Marine sea state for swimmers, air quality for runners, wind and heat for cyclists and hikers — every day classified safe, caution or unsafe against thresholds you can tune.",
  },
  {
    title: "Grounded in live local search",
    body: "Tavily pulls current results for your destination, so the plan sends you to beaches, trails and events that actually exist this week.",
  },
  {
    title: "Briefed out loud",
    body: "Each day is narrated by ElevenLabs as a short morning briefing you can play before you head out the door.",
  },
];

function IntegrationPill({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
        active
          ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
          : "border-white/10 bg-white/[0.03] text-slate-500"
      }`}
      title={active ? `${label} is configured` : `${label} is not configured — add its API key`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-400" : "bg-slate-600"}`} />
      {label}
    </span>
  );
}

export default async function HomePage() {
  const user = await getCurrentUser();
  const savedTrips = await listTripsForCurrentUser();
  // The footer pill tracked STRAVA_* env only, so on a deployment using the
  // paste-your-own-credentials path it read "not configured" even while a
  // visitor was connected — which reads as an unimplemented feature.
  const stravaConnected = isStravaConnected();

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-16">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="text-lg font-semibold tracking-tight text-slate-50">
          Tide<span className="text-tide-400">Fit</span>
        </Link>
        {integrationStatus.supabase ? <AuthPanel email={user?.email ?? null} /> : null}
      </header>

      <section className="mt-12 sm:mt-16">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-tide-300">
          Training trips, planned around reality
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight text-slate-50 sm:text-5xl">
          Every travel planner tells you the weather. TideFit tells you whether you can train.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-400">
          Enter a destination and your sports. TideFit checks the sea state, air quality, wind and
          heat for each day, classifies it against real safety thresholds, then writes a day-by-day
          plan around genuine local places — narrated as a morning voice briefing.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {SPORTS.map((sport) => (
            <span
              key={sport}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-sm text-slate-300"
            >
              <span aria-hidden>{SPORT_EMOJI[sport]}</span>
              {SPORT_LABELS[sport]}
            </span>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <TripForm demoTripId={DEMO_TRIP_ID} />
        <div className="mt-4">
          <StravaConnect hostConfigured={integrationStatus.strava} connected={stravaConnected} />
        </div>
      </section>

      {savedTrips.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-500">
            Your saved trips
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {savedTrips.map((trip) => (
              <li key={trip.id}>
                <Link
                  href={`/trip/${trip.id}`}
                  className="card flex items-center justify-between gap-3 px-4 py-3 transition hover:border-white/20 hover:bg-white/[0.06]"
                >
                  <span>
                    <span className="font-medium text-slate-100">{trip.destination}</span>
                    <span className="block text-xs text-slate-500">
                      {formatDayLabel(trip.startDate)} · {trip.days} days ·{" "}
                      {trip.sports.join(", ")}
                    </span>
                  </span>
                  <span aria-hidden className="text-slate-500">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-14 grid gap-4 sm:grid-cols-3">
        {HOW_IT_WORKS.map((item) => (
          <div key={item.title} className="card p-5">
            <h2 className="text-base font-semibold text-slate-100">{item.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.body}</p>
          </div>
        ))}
      </section>

      <footer className="mt-14 border-t border-white/10 pt-6">
        <p className="text-xs uppercase tracking-widest text-slate-500">Live integrations</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <IntegrationPill label="Open-Meteo (marine + weather)" active />
          <IntegrationPill label="Tavily search" active={integrationStatus.tavily} />
          <IntegrationPill label="ElevenLabs voice" active={integrationStatus.elevenLabs} />
          <IntegrationPill label="LLM itinerary" active={integrationStatus.llm} />
          <IntegrationPill label="Stay22 lodging map" active />
          <IntegrationPill label="Stay22 live prices" active={integrationStatus.stay22Api} />
          <IntegrationPill label="Supabase" active={integrationStatus.supabase} />
          <IntegrationPill label="Google Calendar" active={integrationStatus.googleCalendar} />
          <IntegrationPill
            label="Strava (optional)"
            active={integrationStatus.strava || stravaConnected}
          />
        </div>
        <p className="mt-4 max-w-2xl text-xs leading-relaxed text-slate-500">
          Condition thresholds are a planning aid, not a substitute for local lifeguards, park
          authorities or your own judgement on the day.
        </p>
      </footer>
    </main>
  );
}
