import Link from "next/link";
import { notFound } from "next/navigation";

import { CalendarSyncButton } from "@/components/CalendarSyncButton";
import { DayCard } from "@/components/DayCard";
import { LodgingList } from "@/components/LodgingList";
import { LodgingMap } from "@/components/LodgingMap";
import { RiskBadge } from "@/components/RiskBadge";
import { placeLabel } from "@/lib/conditions";
import { integrationStatus } from "@/lib/env";
import { getTrip } from "@/lib/store";
import { SPORT_LABELS, worstRisk } from "@/lib/types";
import { formatDayLabel } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function TripPage({ params }: { params: { id: string } }) {
  const trip = await getTrip(params.id);
  if (!trip) notFound();

  const tripRisk = worstRisk(trip.conditions.map((day) => day.overallRisk));
  const lastDate = trip.conditions[trip.conditions.length - 1]?.date ?? trip.input.startDate;

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="text-lg font-semibold tracking-tight text-slate-50">
          Tide<span className="text-tide-400">Fit</span>
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <CalendarSyncButton tripId={trip.id} configured={integrationStatus.googleCalendar} />
          <Link href="/" className="btn-ghost">
            Plan another trip
          </Link>
        </div>
      </header>

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-tide-300">
              {trip.input.days}-day training trip
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">
              {placeLabel(trip.place)}
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              {formatDayLabel(trip.input.startDate)} → {formatDayLabel(lastDate)} ·{" "}
              {trip.input.sports.map((sport) => SPORT_LABELS[sport]).join(", ")}
            </p>
          </div>
          <RiskBadge risk={tripRisk} label={`Worst day: ${tripRisk}`} />
        </div>

        <div className="mt-5 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-slate-400">
            Conditions: Open-Meteo marine, weather + air quality
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-slate-400">
            Local grounding:{" "}
            {trip.grounding.source === "tavily"
              ? `Tavily (${trip.grounding.spots.length + trip.grounding.events.length} live results)`
              : "unavailable — venues left generic"}
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-slate-400">
            Itinerary: {trip.itinerarySource === "llm" ? "LLM, grounded" : "rule-based fallback"}
          </span>
          {trip.trainingLoad?.source === "strava" ? (
            <span className="rounded-full border border-orange-400/30 bg-orange-500/10 px-3 py-1 text-orange-200">
              Strava load: {trip.trainingLoad.weeklyDistanceKm} km / {trip.trainingLoad.hardDays}{" "}
              hard days
            </span>
          ) : null}
          {trip.isDemo ? (
            <span className="rounded-full border border-tide-400/30 bg-tide-500/10 px-3 py-1 text-tide-200">
              Sample trip — canned data, live threshold engine
            </span>
          ) : null}
        </div>
      </section>

      <section className="mt-8 space-y-5">
        {trip.plans.map((plan, index) => {
          const conditions = trip.conditions.find((day) => day.date === plan.date);
          if (!conditions) return null;
          return (
            <DayCard
              key={plan.date}
              index={index}
              plan={plan}
              conditions={conditions}
              place={trip.place}
              tripId={trip.id}
              prerenderedAudioUrl={trip.demoAudioByDate?.[plan.date]}
            />
          );
        })}
      </section>

      <section className="mt-8">
        <LodgingList
          options={trip.lodging ?? []}
          destination={trip.place.name}
          checkIn={trip.input.startDate}
          nights={trip.input.days}
          anchor={trip.anchor}
        />
      </section>

      <section className="mt-8">
        <LodgingMap
          latitude={trip.anchor?.latitude ?? trip.place.latitude}
          longitude={trip.anchor?.longitude ?? trip.place.longitude}
          destination={trip.place.name}
          checkIn={trip.input.startDate}
          nights={trip.input.days}
          affiliateId={trip.stay22Aid}
          anchorLabel={trip.anchor?.kind === "swim-spot" ? "your swim spot" : undefined}
        />
      </section>

      <footer className="mt-12 border-t border-white/10 pt-6">
        <p className="max-w-3xl text-xs leading-relaxed text-slate-500">
          Safety classifications come from forecast models and TideFit&apos;s threshold config. They
          are a planning aid, not a guarantee — always defer to local lifeguards, trail authorities
          and how you actually feel on the day.
        </p>
      </footer>
    </main>
  );
}
