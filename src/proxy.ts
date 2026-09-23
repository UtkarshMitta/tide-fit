import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { publicEnv } from "@/lib/env.public";

/**
 * Server Components cannot write cookies, so the Supabase session is refreshed
 * here instead. Without Supabase configured this is a pass-through.
 *
 * This is the `proxy` convention Next 16 replaced `middleware` with. It does no
 * authorization — route protection lives in the route handlers and Supabase
 * RLS, deliberately, so that a bypass here cannot become an auth bypass.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!publicEnv.supabaseUrl || !publicEnv.supabaseAnonKey) return response;

  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|audio|.*\\.(?:svg|png|jpg|mp3)$).*)"],
};
