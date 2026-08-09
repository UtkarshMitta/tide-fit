import { cookies } from "next/headers";

import { requireEnv, serverEnv } from "@/lib/env";
import { buildUrl, fetchJson } from "@/lib/http";
import { SPORT_LABELS, type DayPlan, type Trip } from "@/lib/types";

/**
 * Minimal Google Calendar integration over REST — one all-day event per trip
 * day carrying the itinerary text and a link back to the voice briefing.
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

const ACCESS_COOKIE = "tidefit_google_access";
const EXPIRY_COOKIE = "tidefit_google_expiry";

export function googleRedirectUri(): string {
  return `${serverEnv.appUrl}/api/calendar/callback`;
}

export function getGoogleAuthUrl(state: string): string {
  return buildUrl(GOOGLE_AUTH_URL, {
    client_id: requireEnv(serverEnv.googleClientId, "GOOGLE_CLIENT_ID"),
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: CALENDAR_SCOPE,
    access_type: "online",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
}

export async function exchangeGoogleCode(code: string): Promise<GoogleTokenResponse> {
  return fetchJson<GoogleTokenResponse>(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requireEnv(serverEnv.googleClientId, "GOOGLE_CLIENT_ID"),
      client_secret: requireEnv(serverEnv.googleClientSecret, "GOOGLE_CLIENT_SECRET"),
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
}

export function persistGoogleToken(token: GoogleTokenResponse): void {
  const cookieStore = cookies();
  const shared = {
    httpOnly: true,
    secure: serverEnv.appUrl.startsWith("https"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: token.expires_in,
  };
  cookieStore.set(ACCESS_COOKIE, token.access_token, shared);
  cookieStore.set(EXPIRY_COOKIE, String(Date.now() + token.expires_in * 1000), shared);
}

export function getGoogleAccessToken(): string | null {
  const cookieStore = cookies();
  const access = cookieStore.get(ACCESS_COOKIE)?.value;
  const expiry = Number(cookieStore.get(EXPIRY_COOKIE)?.value ?? 0);
  if (!access || expiry < Date.now() + 30_000) return null;
  return access;
}

function eventDescription(trip: Trip, plan: DayPlan): string {
  const day = trip.conditions.find((entry) => entry.date === plan.date);
  const conditionLines =
    day?.bySport.map(
      (sport) => `${SPORT_LABELS[sport.sport]}: ${sport.risk.toUpperCase()} — ${sport.headline}`,
    ) ?? [];

  return [
    `Morning: ${plan.morning}`,
    `Midday: ${plan.midday}`,
    `Evening: ${plan.evening}`,
    plan.safetyNote ? `Safety: ${plan.safetyNote}` : "",
    "",
    conditionLines.join("\n"),
    "",
    `Voice briefing: ${serverEnv.appUrl}/trip/${trip.id}#day-${plan.date}`,
    `Full plan: ${serverEnv.appUrl}/trip/${trip.id}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface CalendarSyncResult {
  created: number;
  failed: number;
  firstEventUrl?: string;
}

export async function syncTripToCalendar(
  trip: Trip,
  accessToken: string,
): Promise<CalendarSyncResult> {
  let created = 0;
  let failed = 0;
  let firstEventUrl: string | undefined;

  for (const plan of trip.plans) {
    try {
      const event = await fetchJson<{ htmlLink?: string }>(CALENDAR_EVENTS_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          summary: `TideFit — ${plan.title}`,
          description: eventDescription(trip, plan),
          location: `${trip.place.name}, ${trip.place.country}`,
          start: { date: plan.date },
          end: { date: plan.date },
          transparency: "transparent",
        }),
      });
      created += 1;
      firstEventUrl ??= event.htmlLink;
    } catch (error) {
      failed += 1;
      console.warn(
        `[tidefit] calendar event for ${plan.date} failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return { created, failed, firstEventUrl };
}
