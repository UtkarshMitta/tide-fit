"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { SPORT_EMOJI } from "@/lib/risk-ui";
import { SPORTS, SPORT_LABELS, type Sport } from "@/lib/types";
import { cn, todayIso } from "@/lib/utils";

const TRIP_LENGTHS = [1, 2, 3, 4, 5, 6, 7];

const STAGE_MESSAGES = [
  "Geocoding your destination…",
  "Pulling sea state, air quality and wind…",
  "Classifying each day per sport…",
  "Searching the web for real local spots…",
  "Writing your day-by-day plan…",
];

/** "Today" never changes identity within a day, so there is nothing to subscribe to. */
const subscribeNever = () => () => {};

/**
 * The visitor's local date, or "" while rendering on the server.
 *
 * The server runs in UTC, so from 8 pm US Eastern (5 pm Pacific) it is already
 * tomorrow there. Rendering the server's "today" as the input's `min` made
 * React keep that attribute through hydration ("this won't be patched up"),
 * leaving a form whose default date was below its own minimum: the browser
 * refused to submit it. useSyncExternalStore hydrates with the server snapshot
 * and then switches to the browser's date, with no mismatch in between.
 */
function useLocalToday(): string {
  return useSyncExternalStore(subscribeNever, todayIso, () => "");
}

export function TripForm({ demoTripId }: { demoTripId: string }) {
  const router = useRouter();
  const [destination, setDestination] = useState("Lisbon");
  const today = useLocalToday();
  // Only a date the visitor picked is stored; until then the default follows today.
  const [chosenStartDate, setChosenStartDate] = useState<string | null>(null);
  const startDate = chosenStartDate ?? today;
  const [days, setDays] = useState(3);
  const [sports, setSports] = useState<Sport[]>(["swimming", "running"]);
  const [stage, setStage] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = stage !== null;

  function toggleSport(sport: Sport) {
    setSports((current) =>
      current.includes(sport) ? current.filter((entry) => entry !== sport) : [...current, sport],
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (sports.length === 0) {
      setError("Pick at least one sport so we know what to plan around.");
      return;
    }

    // Advance the progress copy on a timer: the API is one long call, and a
    // silent 20-second wait reads as a broken button.
    setStage(0);
    const ticker = setInterval(() => {
      setStage((current) =>
        current === null ? null : Math.min(current + 1, STAGE_MESSAGES.length - 1),
      );
    }, 3500);

    try {
      const response = await fetch("/api/trips", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destination, startDate, days, sports }),
      });
      const payload = (await response.json()) as { id?: string; error?: string };

      if (!response.ok || !payload.id) {
        throw new Error(payload.error ?? "Could not build that trip.");
      }
      router.push(`/trip/${payload.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
      setStage(null);
    } finally {
      clearInterval(ticker);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card p-6 sm:p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-2 block text-sm font-medium text-slate-300">Destination</span>
          <input
            className="field"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            placeholder="Lisbon, Bali, Boulder…"
            required
            maxLength={80}
          />
        </label>

        <label>
          <span className="mb-2 block text-sm font-medium text-slate-300">Start date</span>
          <input
            className="field"
            type="date"
            value={startDate}
            min={today || undefined}
            onChange={(event) => setChosenStartDate(event.target.value)}
            required
          />
        </label>

        <label>
          <span className="mb-2 block text-sm font-medium text-slate-300">Trip length</span>
          <select
            className="field"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            {TRIP_LENGTHS.map((length) => (
              <option key={length} value={length}>
                {length} {length === 1 ? "day" : "days"}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="mt-6">
        <legend className="mb-3 text-sm font-medium text-slate-300">
          Sport focus <span className="text-slate-500">(pick one or more)</span>
        </legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SPORTS.map((sport) => {
            const selected = sports.includes(sport);
            return (
              <button
                key={sport}
                type="button"
                onClick={() => toggleSport(sport)}
                aria-pressed={selected}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border px-4 py-3 text-left transition",
                  selected
                    ? "border-tide-400/60 bg-tide-500/15 text-tide-100"
                    : "border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/25 hover:text-slate-200",
                )}
              >
                <span aria-hidden className="text-lg">
                  {SPORT_EMOJI[sport]}
                </span>
                <span className="text-sm font-medium leading-tight">{SPORT_LABELS[sport]}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {error ? (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button type="submit" className="btn-primary sm:w-auto" disabled={isSubmitting}>
          {isSubmitting ? "Building your plan…" : "Plan my training trip"}
        </button>
        <a href={`/trip/${demoTripId}`} className="btn-ghost">
          See the Lisbon sample trip
        </a>
      </div>

      {isSubmitting ? (
        <p aria-live="polite" className="mt-4 flex items-center gap-2 text-sm text-tide-200">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-tide-300 border-t-transparent" />
          {STAGE_MESSAGES[stage ?? 0]}
        </p>
      ) : null}
    </form>
  );
}
