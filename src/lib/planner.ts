import { randomUUID } from "node:crypto";

import { resolveTrainingAnchor } from "@/lib/anchor";
import { geocodeDestination, getTripConditions, placeLabel } from "@/lib/conditions";
import { buildDemoTrip } from "@/lib/demo";
import { serverEnv } from "@/lib/env";
import { generateItinerary } from "@/lib/itinerary";
import { getLodgingOptions, type LodgingResult } from "@/lib/lodging";
import { getLocalGrounding } from "@/lib/search";
import { getTrainingLoad } from "@/lib/strava";
import { SPORTS, type Sport, type Trip, type TripInput } from "@/lib/types";
import { todayIso } from "@/lib/utils";

export const MAX_TRIP_DAYS = 7;

export class PlanningError extends Error {}

export function parseTripInput(raw: unknown): TripInput {
  const body = (raw ?? {}) as Record<string, unknown>;

  const destination = String(body.destination ?? "").trim();
  if (destination.length < 2) throw new PlanningError("Enter a destination.");
  if (destination.length > 80) throw new PlanningError("That destination name is too long.");

  const startDate = String(body.startDate ?? "").trim() || todayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new PlanningError("Pick a valid start date.");

  const days = Number(body.days ?? 3);
  if (!Number.isInteger(days) || days < 1 || days > MAX_TRIP_DAYS) {
    throw new PlanningError(`Trip length must be between 1 and ${MAX_TRIP_DAYS} days.`);
  }

  const requested = Array.isArray(body.sports) ? body.sports : [];
  const sports = requested.filter((sport): sport is Sport =>
    SPORTS.includes(sport as Sport),
  );
  if (sports.length === 0) throw new PlanningError("Choose at least one sport.");

  return { destination, startDate, days, sports };
}

/**
 * The full pipeline: geocode, fetch and classify conditions per sport, ground
 * the plan in live web search, then write the itinerary. Every stage degrades
 * on its own — a dead sponsor API costs you that feature, not the trip.
 */
export async function planTrip(input: TripInput): Promise<Trip> {
  if (serverEnv.demoMode) return buildDemoTrip(input.startDate);

  const place = await geocodeDestination(input.destination).catch(() => null);
  if (!place) {
    throw new PlanningError(
      `Could not find "${input.destination}". Try a nearby city or add the country.`,
    );
  }

  const [conditionsBundle, grounding, trainingLoad] = await Promise.all([
    getTripConditions(place, input.startDate, input.days, input.sports),
    getLocalGrounding(input.destination, input.startDate, input.sports),
    getTrainingLoad().catch(() => undefined),
  ]);

  // Lodging waits on conditions because the marine probe is what tells us where
  // the swim actually happens, and that is the point stays are searched around.
  const anchor = resolveTrainingAnchor(place, input.sports, conditionsBundle.marineSource);

  const [{ plans, source }, lodging] = await Promise.all([
    generateItinerary({
      place,
      destinationLabel: placeLabel(place),
      sports: input.sports,
      anchor,
      conditions: conditionsBundle.conditions,
      grounding,
      trainingLoad,
    }),
    getLodgingOptions({
      destination: input.destination,
      place,
      anchor,
      startDate: input.startDate,
      days: input.days,
      sports: input.sports,
    }).catch((): LodgingResult => ({ options: [] })),
  ]);

  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    input,
    place,
    conditions: conditionsBundle.conditions,
    grounding,
    plans,
    lodging: lodging.options,
    anchor,
    stay22Aid: lodging.aid,
    trainingLoad,
    itinerarySource: source,
  };
}
