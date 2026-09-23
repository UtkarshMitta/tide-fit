import { NextResponse } from "next/server";

import { exchangeGoogleCode, persistGoogleToken } from "@/lib/calendar";
import { serverEnv } from "@/lib/env";
import { consumeOAuthState } from "@/lib/oauth-state";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const { valid, returnTo } = await consumeOAuthState("google", params.get("state"));

  if (!valid) {
    return NextResponse.redirect(`${serverEnv.appUrl}${returnTo}?calendar=error`);
  }

  if (!code) {
    return NextResponse.redirect(`${serverEnv.appUrl}${returnTo}?calendar=denied`);
  }

  try {
    await persistGoogleToken(await exchangeGoogleCode(code));
    return NextResponse.redirect(`${serverEnv.appUrl}${returnTo}?calendar=connected`);
  } catch (error) {
    console.error("[tidefit] Google OAuth failed:", error);
    return NextResponse.redirect(`${serverEnv.appUrl}${returnTo}?calendar=error`);
  }
}
