import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Authenticated encryption for values that must round-trip through a browser
 * cookie but must not be readable there.
 *
 * The Strava integration lets a visitor paste their own Strava *application*
 * client secret, and that secret has to survive until the OAuth callback comes
 * back so the token exchange can be signed. It was previously stored in the
 * cookie in plaintext: httpOnly and SameSite=lax, but still a long-lived
 * third-party credential sitting in a browser, and readable by anything that
 * reaches the cookie jar or sees the request on a misconfigured http origin.
 *
 * Sealing it means the cookie carries ciphertext that is worthless without
 * TIDEFIT_SECRET_KEY, which never leaves the server. AES-256-GCM so a tampered
 * cookie fails to open rather than decrypting to garbage.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const VERSION = "v1";

/**
 * A fixed salt is acceptable here: the input is a single server-held secret
 * rather than a set of user passwords, so there is no rainbow-table or
 * cross-account-correlation benefit to a per-value salt. scrypt is used anyway
 * so a low-entropy passphrase is not instantly brute-forceable.
 */
const KEY_SALT = "tidefit.seal.v1";

/**
 * Derivation is deliberately slow, so cache it — but cache against the secret
 * that produced it. Caching the key alone would keep using a stale derivation
 * after a key rotation, which fails in the worst way: every existing cookie
 * still opens and new ones are sealed under the old key.
 */
let cached: { secret: string; key: Buffer } | null = null;

function keyFrom(secret: string): Buffer {
  if (cached?.secret !== secret) {
    cached = { secret, key: scryptSync(secret, KEY_SALT, KEY_BYTES) };
  }
  return cached.key;
}

export function sealingAvailable(): boolean {
  return Boolean(process.env.TIDEFIT_SECRET_KEY);
}

export class SealingUnavailableError extends Error {}

/** Returns `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
export function seal(plaintext: string): string {
  const secret = process.env.TIDEFIT_SECRET_KEY;
  if (!secret) {
    throw new SealingUnavailableError("TIDEFIT_SECRET_KEY is not configured");
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyFrom(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Returns null for anything that does not open cleanly — wrong key, tampered
 * cookie, a value written before sealing was enabled, or a future format. The
 * caller treats that as "not connected" rather than surfacing an error, since a
 * stale cookie is an expected condition, not a fault.
 */
export function unseal(sealed: string | undefined): string | null {
  const secret = process.env.TIDEFIT_SECRET_KEY;
  if (!secret || !sealed) return null;

  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;

  try {
    const [, ivPart, tagPart, dataPart] = parts;
    const decipher = createDecipheriv(
      ALGORITHM,
      keyFrom(secret),
      Buffer.from(ivPart!, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagPart!, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataPart!, "base64url")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    return null;
  }
}
