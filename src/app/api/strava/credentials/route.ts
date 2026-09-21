import { NextResponse } from "next/server";

import { createOAuthState, safeReturnPath } from "@/lib/oauth-state";
import { getStravaAuthUrl, persistStravaAppCredentials } from "@/lib/strava";
import { serverEnv } from "@/lib/env";

/**
 * Saves visitor-supplied Strava API application credentials, then sends them
 * into the OAuth authorize step. Server env credentials are never overwritten
 * here — this route only matters when the host did not configure Strava.
 */
export async function POST(request: Request) {
  let body: { clientId?: string; clientSecret?: string; returnTo?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const clientId = String(body.clientId ?? "").trim();
  const clientSecret = String(body.clientSecret ?? "").trim();
  const returnTo = safeReturnPath(body.returnTo);

  if (!/^\d{3,12}$/.test(clientId)) {
    return NextResponse.json(
      { error: "Client ID should be the numeric ID from your Strava API application." },
      { status: 400 },
    );
  }
  if (clientSecret.length < 20 || clientSecret.length > 120) {
    return NextResponse.json(
      { error: "Client Secret looks wrong — paste it from strava.com/settings/api." },
      { status: 400 },
    );
  }

  // When the host already configured Strava, ignore pasted secrets and just
  // authorize with the shared app — avoids storing unused credentials.
  if (serverEnv.stravaClientId && serverEnv.stravaClientSecret) {
    return NextResponse.json({
      authorizeUrl: getStravaAuthUrl(createOAuthState("strava", returnTo), {
        clientId: serverEnv.stravaClientId,
        clientSecret: serverEnv.stravaClientSecret,
        source: "env",
      }),
    });
  }

  persistStravaAppCredentials(clientId, clientSecret);

  return NextResponse.json({
    authorizeUrl: getStravaAuthUrl(createOAuthState("strava", returnTo), {
      clientId,
      clientSecret,
      source: "user",
    }),
  });
}
