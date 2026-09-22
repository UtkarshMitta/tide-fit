"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

/**
 * Optional Strava connect. Visitors can skip it entirely. To connect they
 * paste Client ID + Client Secret from a free Strava API application
 * (strava.com/settings/api), then authorize their athlete account.
 *
 * When the host already configured STRAVA_* in env, the credential form is
 * skipped and Connect goes straight to OAuth.
 */
export function StravaConnect({
  hostConfigured,
  connected,
}: {
  /** True when the server has STRAVA_CLIENT_ID / SECRET in env. */
  hostConfigured: boolean;
  connected: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("strava");
    if (status === "connected") setBanner("Strava connected — your recent training will shape the plan.");
    if (status === "denied") setBanner("Strava authorization was cancelled.");
    if (status === "error") setBanner("Could not connect Strava. Check your Client ID and Secret.");
  }, []);

  async function connectWithHostApp() {
    setBusy(true);
    setError(null);
    window.location.href = "/api/strava/authorize?returnTo=/";
  }

  async function connectWithPastedKeys(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/strava/credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId, clientSecret, returnTo: "/" }),
      });
      const data = (await response.json()) as { authorizeUrl?: string; error?: string };
      if (!response.ok || !data.authorizeUrl) {
        throw new Error(data.error ?? "Could not save those credentials.");
      }
      window.location.href = data.authorizeUrl;
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Could not connect Strava.");
    }
  }

  async function disconnect() {
    setBusy(true);
    await fetch("/api/strava/disconnect", { method: "POST" });
    setBusy(false);
    setBanner(null);
    setOpen(false);
    router.refresh();
  }

  if (connected) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="inline-flex items-center gap-2 rounded-full border border-orange-400/30 bg-orange-500/10 px-3 py-1.5 text-xs text-orange-200">
          <span className="h-1.5 w-1.5 rounded-full bg-orange-400" aria-hidden />
          Strava connected — recent training load will shape the plan
        </p>
        <button
          type="button"
          onClick={disconnect}
          disabled={busy}
          className="text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-200">Strava training load</p>
          <p className="text-xs text-slate-500">
            Optional — paste your free Strava API app credentials to auto-adjust intensity
          </p>
        </div>

        {hostConfigured ? (
          <button
            type="button"
            onClick={connectWithHostApp}
            disabled={busy}
            className="btn-ghost border-orange-400/30 py-2 text-xs text-orange-200 hover:border-orange-300/60"
          >
            {busy ? "Redirecting…" : "Connect Strava"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="btn-ghost border-orange-400/30 py-2 text-xs text-orange-200 hover:border-orange-300/60"
            aria-expanded={open}
          >
            {open ? "Cancel" : "Connect Strava"}
          </button>
        )}
      </div>

      {banner ? <p className="mt-2 text-xs text-slate-400">{banner}</p> : null}

      {open && !hostConfigured ? (
        <form onSubmit={connectWithPastedKeys} className="mt-4 space-y-3 border-t border-white/10 pt-4">
          <p className="text-xs leading-relaxed text-slate-400">
            Create a free API application at{" "}
            <a
              href="https://www.strava.com/settings/api"
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-200 underline-offset-2 hover:underline"
            >
              strava.com/settings/api
            </a>
            . Set the Authorization Callback Domain to{" "}
            <code className="rounded bg-white/5 px-1 py-0.5 text-[11px] text-slate-300">
              {typeof window !== "undefined" ? window.location.hostname : "localhost"}
            </code>
            , then paste Client ID and Client Secret below. Strava does not issue a single
            &quot;API key&quot; — these two values are what TideFit needs.
          </p>

          <p className="text-xs leading-relaxed text-slate-500">
            Your Client Secret is encrypted on the server and stored in a cookie in this browser
            for 7 days. It is never sent anywhere except Strava. Disconnect to erase it.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-slate-400">
              Client ID
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                required
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                placeholder="e.g. 123456"
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-400/50"
              />
            </label>
            <label className="block text-xs text-slate-400">
              Client Secret
              <input
                type="password"
                autoComplete="off"
                required
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                placeholder="from your Strava API app"
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-400/50"
              />
            </label>
          </div>

          {error ? <p className="text-xs text-rose-300">{error}</p> : null}

          <button
            type="submit"
            disabled={busy}
            className="btn-ghost border-orange-400/40 py-2 text-xs text-orange-100 hover:border-orange-300"
          >
            {busy ? "Connecting…" : "Save & authorize with Strava"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
