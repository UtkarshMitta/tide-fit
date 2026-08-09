import { NextResponse } from "next/server";

import { exchangeGoogleCode, persistGoogleToken } from "@/lib/calendar";
import { serverEnv } from "@/lib/env";

function safeReturnPath(state: string | null): string {
  return state && state.startsWith("/") && !state.startsWith("//") ? state : "/";
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const returnTo = safeReturnPath(params.get("state"));

  if (!code) {
    return NextResponse.redirect(`${serverEnv.appUrl}${returnTo}?calendar=denied`);
  }

  try {
    persistGoogleToken(await exchangeGoogleCode(code));
    return NextResponse.redirect(`${serverEnv.appUrl}${returnTo}?calendar=connected`);
  } catch (error) {
    console.error("[tidefit] Google OAuth failed:", error);
    return NextResponse.redirect(`${serverEnv.appUrl}${returnTo}?calendar=error`);
  }
}
