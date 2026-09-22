import { NextResponse } from "next/server";

import { safeReturnPath } from "@/lib/oauth-state";
import { createServerSupabase } from "@/lib/supabase";

/** Completes the Supabase magic-link flow and drops the user back on the home page. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeReturnPath(searchParams.get("next"));

  if (code) {
    const supabase = await createServerSupabase();
    const { error } = (await supabase?.auth.exchangeCodeForSession(code)) ?? {
      error: new Error("Supabase is not configured"),
    };
    if (error) {
      return NextResponse.redirect(`${origin}/?auth=error`);
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
