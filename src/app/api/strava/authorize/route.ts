import { NextResponse } from "next/server";

import { createOAuthState } from "@/lib/oauth-state";
import { getStravaAuthUrl, getStravaCredentials } from "@/lib/strava";

export async function GET(request: Request) {
  const credentials = await getStravaCredentials();
  if (!credentials) {
    return NextResponse.json(
      {
        error:
          "Add your Strava Client ID and Client Secret first (create a free app at strava.com/settings/api).",
      },
      { status: 503 },
    );
  }

  const returnTo = new URL(request.url).searchParams.get("returnTo") ?? "/";
  return NextResponse.redirect(
    getStravaAuthUrl(await createOAuthState("strava", returnTo), credentials),
  );
}
