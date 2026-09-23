import { get, put } from "@vercel/blob";

import type { Trip } from "@/lib/types";

/**
 * Trip persistence on Vercel Blob, for deployments without Supabase.
 *
 * On a serverless host the in-memory and temp-dir caches are per instance, so a
 * shared trip link opened on a different instance used to 404. The Deploy
 * button in the README provisions a private Blob store alongside the project,
 * which gives every copy durable, cross-instance storage with no setup.
 *
 * Trips are stored as private blobs: they are not reachable at a public storage
 * URL, only through this server. Access still follows the app's existing model
 * — holding a trip's unguessable id is what lets you view it.
 */

/**
 * A store connected to a Vercel project authenticates with `BLOB_STORE_ID` plus
 * a rotating OIDC token, and does not set `BLOB_READ_WRITE_TOKEN` at all. A
 * store created on its own sets only the token. Either means Blob is available;
 * the SDK resolves which credentials to use.
 */
export function blobAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.BLOB_READ_WRITE_TOKEN || env.BLOB_STORE_ID);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Trip ids are server-minted randomUUIDs. Anything else arriving from a URL is
 * rejected before it reaches the store, so a crafted id cannot name some other
 * key.
 */
export function tripBlobPath(id: string): string | null {
  return UUID.test(id) ? `trips/${id.toLowerCase()}.json` : null;
}

/** The two SDK calls this module needs, narrowed so tests can supply a fake. */
export interface BlobClient {
  put(pathname: string, body: string): Promise<unknown>;
  get(pathname: string): Promise<{ stream: ReadableStream<Uint8Array> | null } | null>;
}

const vercelBlob: BlobClient = {
  put: (pathname, body) =>
    put(pathname, body, {
      access: "private",
      // The pathname is derived from the trip id, so it must stay predictable,
      // and a re-save of the same trip should replace it rather than fail.
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    }),
  get: (pathname) => get(pathname, { access: "private" }),
};

/** Best effort: a Blob outage costs the shared link, not the trip build. */
export async function saveTripBlob(trip: Trip, client: BlobClient = vercelBlob): Promise<void> {
  const pathname = tripBlobPath(trip.id);
  if (!pathname) return;
  try {
    await client.put(pathname, JSON.stringify(trip));
  } catch (error) {
    console.warn(
      "[tidefit] could not persist trip to Vercel Blob:",
      error instanceof Error ? error.message : error,
    );
  }
}

export async function loadTripBlob(id: string, client: BlobClient = vercelBlob): Promise<Trip | null> {
  const pathname = tripBlobPath(id);
  if (!pathname) return null;
  try {
    const result = await client.get(pathname);
    if (!result?.stream) return null;
    return JSON.parse(await new Response(result.stream).text()) as Trip;
  } catch (error) {
    console.warn(
      "[tidefit] could not load trip from Vercel Blob:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
