import { NextResponse } from "next/server";

import { clearStravaConnection } from "@/lib/strava";

export async function POST() {
  await clearStravaConnection();
  return NextResponse.json({ ok: true });
}
