import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { serverEnv } from "@/lib/env";

/**
 * OAuth `state` handling for the Strava and Google Calendar flows.
 *
 * `state` previously carried only the in-app return path, which meant a
 * callback could be replayed by anyone: nothing tied the authorization code
 * coming back to the browser that started the flow. That is the standard
 * account-linking CSRF — an attacker walks their own authorization, then feeds
 * the resulting code to a victim's session so the victim's plans are shaped by
 * the attacker's account.
 *
 * The fix is a double-submit nonce: a random value is stored in a short-lived
 * httpOnly cookie and echoed in `state`. The callback only proceeds when the
 * two match. No shared signing secret is needed, so this keeps working across
 * serverless instances that do not share memory.
 */

export type OAuthProvider = "strava" | "google";

const NONCE_BYTES = 16;
/** Long enough to authorize with a third party, short enough to not linger. */
const STATE_TTL_SECONDS = 600;

function cookieName(provider: OAuthProvider): string {
  return `tidefit_oauth_state_${provider}`;
}

/** `state` must round-trip through a third party, so keep it URL-safe and opaque. */
function encodeState(nonce: string, returnTo: string): string {
  return `${nonce}.${Buffer.from(returnTo, "utf8").toString("base64url")}`;
}

function decodeState(state: string): { nonce: string; returnTo: string } | null {
  const separator = state.indexOf(".");
  if (separator <= 0) return null;
  const nonce = state.slice(0, separator);
  try {
    const returnTo = Buffer.from(state.slice(separator + 1), "base64url").toString("utf8");
    return { nonce, returnTo };
  } catch {
    return null;
  }
}

/**
 * Only in-app paths are acceptable return targets. A protocol-relative path
 * (`//evil.com`) or a backslash variant (`/\evil.com`, which the URL spec
 * normalises to `//`) would otherwise leave the origin.
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value) return "/";
  const normalised = value.replace(/\\/g, "/");
  if (!normalised.startsWith("/") || normalised.startsWith("//")) return "/";
  return normalised;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Mints the `state` for an authorize redirect and remembers its nonce. Returns
 * the opaque string to hand to the provider.
 */
export function createOAuthState(provider: OAuthProvider, returnTo: string): string {
  const nonce = randomBytes(NONCE_BYTES).toString("base64url");
  cookies().set(cookieName(provider), nonce, {
    httpOnly: true,
    secure: serverEnv.appUrl.startsWith("https"),
    sameSite: "lax",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  });
  return encodeState(nonce, safeReturnPath(returnTo));
}

export interface ConsumedState {
  valid: boolean;
  returnTo: string;
}

/**
 * Validates a callback's `state` against the stored nonce and clears it, so a
 * given state is only ever good once. `returnTo` is always safe to redirect to
 * whether or not validation passed.
 */
export function consumeOAuthState(provider: OAuthProvider, state: string | null): ConsumedState {
  const cookieStore = cookies();
  const expected = cookieStore.get(cookieName(provider))?.value;

  // One-shot: drop the nonce whatever the outcome, so a replay cannot match.
  try {
    cookieStore.delete(cookieName(provider));
  } catch {
    // Server Components cannot mutate cookies; callbacks are route handlers, so
    // this only guards against the helper being reused from a render path.
  }

  const decoded = state ? decodeState(state) : null;
  if (!decoded || !expected) return { valid: false, returnTo: "/" };

  return {
    valid: constantTimeEquals(decoded.nonce, expected),
    returnTo: safeReturnPath(decoded.returnTo),
  };
}
