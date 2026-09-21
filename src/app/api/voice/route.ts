import { NextResponse } from "next/server";

import { briefingScript } from "@/lib/itinerary";
import { VOICE_RATE_LIMIT, checkRateLimit, clientKey, tooManyRequests } from "@/lib/rate-limit";
import { getTrip } from "@/lib/store";
import { AUDIO_CONTENT_TYPE, VoiceUnavailableError, synthesizeBriefing } from "@/lib/voice";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Narration is addressed by trip and date rather than by raw text so the
 * endpoint cannot be used as an open text-to-speech proxy.
 */
export async function POST(request: Request) {
  // ElevenLabs bills per character; the in-process cache only helps on repeats.
  const limit = checkRateLimit(clientKey(request), VOICE_RATE_LIMIT);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let tripId: string;
  let date: string;

  try {
    const body = (await request.json()) as { tripId?: string; date?: string };
    tripId = String(body.tripId ?? "");
    date = String(body.date ?? "");
    if (!tripId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("bad request");
  } catch {
    return NextResponse.json({ error: "Provide a tripId and an ISO date." }, { status: 400 });
  }

  const trip = await getTrip(tripId);
  if (!trip) return NextResponse.json({ error: "Trip not found." }, { status: 404 });

  const plan = trip.plans.find((entry) => entry.date === date);
  if (!plan) return NextResponse.json({ error: "No plan for that date." }, { status: 404 });

  try {
    const audio = await synthesizeBriefing(briefingScript(plan, trip.place));
    return new NextResponse(audio as unknown as BodyInit, {
      headers: {
        "content-type": AUDIO_CONTENT_TYPE,
        "content-length": String(audio.byteLength),
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (error) {
    if (error instanceof VoiceUnavailableError) {
      return NextResponse.json(
        { error: "Voice briefing is not configured.", reason: error.message },
        { status: 503 },
      );
    }
    console.error("[tidefit] voice synthesis failed:", error);
    return NextResponse.json({ error: "Could not generate the briefing audio." }, { status: 502 });
  }
}
