import Link from "next/link";

/**
 * Connecting Strava lets the itinerary prompt see the athlete's last seven days,
 * so a heavy block earns real recovery instead of another hard session.
 */
export function StravaConnect({
  configured,
  connected,
}: {
  configured: boolean;
  connected: boolean;
}) {
  if (!configured) return null;

  if (connected) {
    return (
      <p className="inline-flex items-center gap-2 rounded-full border border-orange-400/30 bg-orange-500/10 px-3 py-1.5 text-xs text-orange-200">
        <span className="h-1.5 w-1.5 rounded-full bg-orange-400" aria-hidden />
        Strava connected — your recent training load will shape the plan
      </p>
    );
  }

  return (
    <Link
      href="/api/strava/authorize?returnTo=/"
      className="btn-ghost border-orange-400/30 py-2 text-xs text-orange-200 hover:border-orange-300/60"
    >
      Connect Strava to auto-adjust intensity
    </Link>
  );
}
