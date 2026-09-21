import { NextResponse } from "next/server";

import { PlanningError, parseTripInput, planTrip } from "@/lib/planner";
import { TRIP_RATE_LIMIT, checkRateLimit, clientKey, tooManyRequests } from "@/lib/rate-limit";
import { saveTrip } from "@/lib/store";

export const runtime = "nodejs";
/** Trip building fans out to several upstream APIs plus an LLM call. */
export const maxDuration = 60;

export async function POST(request: Request) {
  // Every trip build costs upstream API calls, so cap it before doing any work.
  const limit = checkRateLimit(clientKey(request), TRIP_RATE_LIMIT);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let input;
  try {
    input = parseTripInput(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof PlanningError ? error.message : "Invalid request body." },
      { status: 400 },
    );
  }

  try {
    const trip = await planTrip(input);
    await saveTrip(trip);
    return NextResponse.json({ id: trip.id, isDemo: Boolean(trip.isDemo) });
  } catch (error) {
    if (error instanceof PlanningError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error("[tidefit] trip planning failed:", error);
    return NextResponse.json(
      { error: "Could not build that trip. Please try again." },
      { status: 500 },
    );
  }
}
