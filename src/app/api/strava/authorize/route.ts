import { NextResponse } from "next/server";

import { integrationStatus } from "@/lib/env";
import { getStravaAuthUrl } from "@/lib/strava";

export async function GET(request: Request) {
  if (!integrationStatus.strava) {
    return NextResponse.json({ error: "Strava is not configured." }, { status: 503 });
  }
  const returnTo = new URL(request.url).searchParams.get("returnTo") ?? "/";
  return NextResponse.redirect(getStravaAuthUrl(returnTo));
}
