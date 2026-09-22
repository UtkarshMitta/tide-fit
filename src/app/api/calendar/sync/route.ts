import { NextResponse } from "next/server";

import { getGoogleAccessToken, syncTripToCalendar } from "@/lib/calendar";
import { getTrip } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const { tripId } = (await request.json().catch(() => ({}))) as { tripId?: string };
  if (!tripId) return NextResponse.json({ error: "Provide a tripId." }, { status: 400 });

  const accessToken = await getGoogleAccessToken();
  if (!accessToken) {
    return NextResponse.json(
      { error: "Connect Google Calendar first.", needsAuth: true },
      { status: 401 },
    );
  }

  const trip = await getTrip(tripId);
  if (!trip) return NextResponse.json({ error: "Trip not found." }, { status: 404 });

  const result = await syncTripToCalendar(trip, accessToken);
  if (result.created === 0) {
    return NextResponse.json(
      { error: "Google rejected every event. Reconnect and try again." },
      { status: 502 },
    );
  }

  return NextResponse.json(result);
}
