import { NextResponse } from "next/server";

import { integrationStatus } from "@/lib/env";
import { getGoogleAuthUrl } from "@/lib/calendar";

export async function GET(request: Request) {
  if (!integrationStatus.googleCalendar) {
    return NextResponse.json({ error: "Google Calendar is not configured." }, { status: 503 });
  }
  const returnTo = new URL(request.url).searchParams.get("returnTo") ?? "/";
  return NextResponse.redirect(getGoogleAuthUrl(returnTo));
}
