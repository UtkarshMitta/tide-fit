import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/env";
import { consumeOAuthState } from "@/lib/oauth-state";
import { exchangeStravaCode, persistStravaTokens } from "@/lib/strava";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const { valid, returnTo } = await consumeOAuthState("strava", params.get("state"));

  // An unrecognised state means this callback did not originate from a flow
  // this browser started — never exchange the code.
  if (!valid) {
    return NextResponse.redirect(`${serverEnv.appUrl}${returnTo}?strava=error`);
  }

  if (!code) {
    return NextResponse.redirect(`${serverEnv.appUrl}${returnTo}?strava=denied`);
  }

  try {
    await persistStravaTokens(await exchangeStravaCode(code));
    return NextResponse.redirect(`${serverEnv.appUrl}${returnTo}?strava=connected`);
  } catch (error) {
    console.error("[tidefit] Strava OAuth failed:", error);
    return NextResponse.redirect(`${serverEnv.appUrl}${returnTo}?strava=error`);
  }
}
