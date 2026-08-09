"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

export function CalendarSyncButton({
  tripId,
  configured,
}: {
  tripId: string;
  configured: boolean;
}) {
  const pathname = usePathname();
  const [state, setState] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function sync() {
    setState("syncing");
    setMessage(null);

    try {
      const response = await fetch("/api/calendar/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripId }),
      });
      const payload = (await response.json()) as {
        created?: number;
        failed?: number;
        error?: string;
        needsAuth?: boolean;
      };

      if (payload.needsAuth) {
        window.location.href = `/api/calendar/authorize?returnTo=${encodeURIComponent(pathname)}`;
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Calendar sync failed.");

      setState("done");
      setMessage(
        `Added ${payload.created} day${payload.created === 1 ? "" : "s"} to your calendar${
          payload.failed ? ` (${payload.failed} failed)` : ""
        }.`,
      );
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Calendar sync failed.");
    }
  }

  if (!configured) {
    return (
      <span
        className="btn-ghost cursor-not-allowed opacity-50"
        title="Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable calendar sync"
      >
        Sync to Google Calendar
      </span>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" onClick={sync} className="btn-ghost" disabled={state === "syncing"}>
        {state === "syncing"
          ? "Syncing…"
          : state === "done"
            ? "Synced to Calendar"
            : "Sync to Google Calendar"}
      </button>
      {message ? (
        <span
          className={state === "error" ? "text-xs text-rose-300" : "text-xs text-emerald-300"}
          role="status"
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
