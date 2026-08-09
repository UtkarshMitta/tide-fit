import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/env";
import { exchangeStravaCode, persistStravaTokens } from "@/lib/strava";

/** `state` carries the in-app path to return to, so it must stay relative. */
function safeReturnPath(state: string | null): string {
  return state && state.startsWith("/") && !state.startsWith("//") ? state : "/";
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const returnTo = safeReturnPath(params.get("state"));

  if (!code) {
    return NextResponse.redirect(`${serverEnv.appUrl}${returnTo}?strava=denied`);
  }

  try {
    persistStravaTokens(await exchangeStravaCode(code));
    return NextResponse.redirect(`${serverEnv.appUrl}${returnTo}?strava=connected`);
  } catch (error) {
    console.error("[tidefit] Strava OAuth failed:", error);
    return NextResponse.redirect(`${serverEnv.appUrl}${returnTo}?strava=error`);
  }
}
