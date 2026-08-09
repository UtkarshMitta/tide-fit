import { cookies } from "next/headers";

import { serverEnv } from "@/lib/env";
import { buildUrl, fetchJson, softFetch } from "@/lib/http";
import type { TrainingLoad } from "@/lib/types";
import { round } from "@/lib/utils";

/**
 * Strava is optional. Credentials can come from the server env (one shared app)
 * or from the visitor — they create a free API application at
 * strava.com/settings/api and paste Client ID + Client Secret into TideFit.
 * Either way the athlete then OAuth-connects their own account so the last
 * seven days of training can shape the itinerary.
 */

const STRAVA_AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities";

const ACCESS_COOKIE = "tidefit_strava_access";
const REFRESH_COOKIE = "tidefit_strava_refresh";
const EXPIRY_COOKIE = "tidefit_strava_expiry";
/** Visitor-supplied API application credentials (when server env is empty). */
const CLIENT_ID_COOKIE = "tidefit_strava_client_id";
const CLIENT_SECRET_COOKIE = "tidefit_strava_client_secret";

export function stravaRedirectUri(): string {
  return `${serverEnv.appUrl}/api/strava/callback`;
}

function cookieOptions(maxAge: number) {
  const secure = serverEnv.appUrl.startsWith("https");
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge };
}

export interface StravaAppCredentials {
  clientId: string;
  clientSecret: string;
  /** True when the visitor pasted their own app credentials. */
  source: "env" | "user";
}

/** Env credentials win; otherwise use whatever the visitor pasted. */
export function getStravaCredentials(): StravaAppCredentials | null {
  if (serverEnv.stravaClientId && serverEnv.stravaClientSecret) {
    return {
      clientId: serverEnv.stravaClientId,
      clientSecret: serverEnv.stravaClientSecret,
      source: "env",
    };
  }

  const cookieStore = cookies();
  const clientId = cookieStore.get(CLIENT_ID_COOKIE)?.value?.trim();
  const clientSecret = cookieStore.get(CLIENT_SECRET_COOKIE)?.value?.trim();
  if (clientId && clientSecret) {
    return { clientId, clientSecret, source: "user" };
  }

  return null;
}

export function hasStravaCredentials(): boolean {
  return getStravaCredentials() !== null;
}

export function persistStravaAppCredentials(clientId: string, clientSecret: string): void {
  const cookieStore = cookies();
  // 30 days — long enough for a hackathon weekend without re-pasting.
  const options = cookieOptions(60 * 60 * 24 * 30);
  cookieStore.set(CLIENT_ID_COOKIE, clientId.trim(), options);
  cookieStore.set(CLIENT_SECRET_COOKIE, clientSecret.trim(), options);
}

export function getStravaAuthUrl(state: string, credentials: StravaAppCredentials): string {
  return buildUrl(STRAVA_AUTHORIZE_URL, {
    client_id: credentials.clientId,
    redirect_uri: stravaRedirectUri(),
    response_type: "code",
    approval_prompt: "auto",
    scope: "activity:read",
    state,
  });
}

interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

async function requestToken(
  credentials: StravaAppCredentials,
  params: Record<string, string>,
): Promise<StravaTokenResponse> {
  return fetchJson<StravaTokenResponse>(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      ...params,
    }),
  });
}

export async function exchangeStravaCode(code: string): Promise<StravaTokenResponse> {
  const credentials = getStravaCredentials();
  if (!credentials) throw new Error("Strava credentials are missing.");
  return requestToken(credentials, { code, grant_type: "authorization_code" });
}

export function persistStravaTokens(tokens: StravaTokenResponse): void {
  const cookieStore = cookies();
  cookieStore.set(ACCESS_COOKIE, tokens.access_token, cookieOptions(60 * 60 * 6));
  cookieStore.set(REFRESH_COOKIE, tokens.refresh_token, cookieOptions(60 * 60 * 24 * 30));
  cookieStore.set(EXPIRY_COOKIE, String(tokens.expires_at), cookieOptions(60 * 60 * 24 * 30));
}

export function isStravaConnected(): boolean {
  return Boolean(cookies().get(REFRESH_COOKIE)?.value || cookies().get(ACCESS_COOKIE)?.value);
}

/** Drops the athlete session and any visitor-pasted app credentials. */
export function clearStravaConnection(): void {
  const cookieStore = cookies();
  for (const name of [
    ACCESS_COOKIE,
    REFRESH_COOKIE,
    EXPIRY_COOKIE,
    CLIENT_ID_COOKIE,
    CLIENT_SECRET_COOKIE,
  ]) {
    cookieStore.delete(name);
  }
}

/** Returns a usable access token, refreshing it when the stored one has expired. */
async function getStravaAccessToken(): Promise<string | null> {
  const cookieStore = cookies();
  const access = cookieStore.get(ACCESS_COOKIE)?.value;
  const expiry = Number(cookieStore.get(EXPIRY_COOKIE)?.value ?? 0);
  const stillValid = access && expiry * 1000 > Date.now() + 60_000;
  if (stillValid) return access;

  const refresh = cookieStore.get(REFRESH_COOKIE)?.value;
  const credentials = getStravaCredentials();
  if (!refresh || !credentials) return access ?? null;

  const refreshed = await softFetch("Strava token refresh", () =>
    requestToken(credentials, { refresh_token: refresh, grant_type: "refresh_token" }),
  );
  if (!refreshed) return access ?? null;

  try {
    persistStravaTokens(refreshed);
  } catch {
    // Refresh triggered from a Server Component, where cookies are read-only.
  }
  return refreshed.access_token;
}

interface StravaActivity {
  name: string;
  type: string;
  sport_type?: string;
  distance: number;
  moving_time: number;
  start_date_local: string;
  suffer_score?: number;
  average_heartrate?: number;
}

/** Pulls the last seven days of activities and turns them into a load summary. */
export async function getTrainingLoad(): Promise<TrainingLoad | undefined> {
  const token = await getStravaAccessToken();
  if (!token) return undefined;

  const after = Math.floor((Date.now() - 7 * 86_400_000) / 1000);
  const activities = await softFetch("Strava activities", () =>
    fetchJson<StravaActivity[]>(buildUrl(STRAVA_ACTIVITIES_URL, { after, per_page: 50 }), {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  if (!activities) return undefined;

  return summariseTrainingLoad(activities);
}

export function summariseTrainingLoad(activities: StravaActivity[]): TrainingLoad {
  const weeklyDistanceKm = round(
    activities.reduce((total, activity) => total + (activity.distance ?? 0), 0) / 1000,
  ) ?? 0;
  const weeklyMovingHours =
    round(activities.reduce((total, activity) => total + (activity.moving_time ?? 0), 0) / 3600) ?? 0;

  // A "hard day" is either a long session or one Strava scored as high effort.
  const hardDays = new Set(
    activities
      .filter(
        (activity) => (activity.suffer_score ?? 0) >= 80 || (activity.moving_time ?? 0) >= 5400,
      )
      .map((activity) => activity.start_date_local.slice(0, 10)),
  ).size;

  const byType = activities.reduce<Record<string, number>>((counts, activity) => {
    const key = activity.sport_type ?? activity.type ?? "Other";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const mix = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${count}× ${type}`)
    .join(", ");

  const intensity =
    hardDays >= 3
      ? "heavy block — schedule real recovery early in the trip"
      : hardDays === 0
        ? "light week — there is room to build"
        : "moderate week";

  return {
    source: "strava",
    weeklyDistanceKm,
    weeklyMovingHours,
    activityCount: activities.length,
    hardDays,
    summary: `${activities.length} activities, ${weeklyDistanceKm} km and ${weeklyMovingHours} h moving time, ${hardDays} hard day(s) (${mix || "no sessions"}). Assessment: ${intensity}.`,
  };
}
