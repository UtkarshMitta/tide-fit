const DEFAULT_TIMEOUT_MS = 12_000;

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: { accept: "application/json", ...rest.headers },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new UpstreamError(
        `${new URL(url).host} responded ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
        response.status,
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new UpstreamError(`${new URL(url).host} timed out after ${timeoutMs}ms`);
    }
    throw new UpstreamError(
      error instanceof Error ? error.message : `Unknown error calling ${url}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs a task and swallows failures into `null` so one dead upstream feed
 * degrades a single badge instead of failing the whole trip build.
 */
export async function softFetch<T>(label: string, task: () => Promise<T>): Promise<T | null> {
  try {
    return await task();
  } catch (error) {
    console.warn(`[tidefit] ${label} unavailable:`, error instanceof Error ? error.message : error);
    return null;
  }
}

export function buildUrl(base: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}
