import { NextResponse } from "next/server";

import { clearStravaConnection } from "@/lib/strava";

export async function POST() {
  clearStravaConnection();
  return NextResponse.json({ ok: true });
}
