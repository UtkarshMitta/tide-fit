"use client";

import { useMemo, useState } from "react";

import { publicEnv } from "@/lib/env.public";
import { addDaysIso } from "@/lib/utils";

/**
 * Stay22's map widget. It is a plain iframe with our affiliate id, so booking
 * clicks are attributed without any backend work on our side.
 */
export function LodgingMap({
  latitude,
  longitude,
  destination,
  checkIn,
  nights,
  affiliateId,
}: {
  latitude: number;
  longitude: number;
  destination: string;
  checkIn: string;
  nights: number;
  /** Read back from Stay22's API so the map matches the booking links. */
  affiliateId?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const checkOut = addDaysIso(checkIn, Math.max(nights, 1));
  const aid = affiliateId ?? publicEnv.stay22AffiliateId;

  const src = useMemo(() => {
    const url = new URL("https://www.stay22.com/embed/gm");
    url.searchParams.set("aid", aid);
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lng", String(longitude));
    url.searchParams.set("venue", destination);
    url.searchParams.set("checkin", checkIn);
    url.searchParams.set("checkout", checkOut);
    url.searchParams.set("viewmode", "all");
    url.searchParams.set("maincolor", "1eaab3");
    url.searchParams.set("campaign", "tidefit-trip");
    return url.toString();
  }, [aid, latitude, longitude, destination, checkIn, checkOut]);

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 bg-white/[0.02] px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-50">Where to stay</h2>
          <p className="text-sm text-slate-400">
            Stays near your training spots in {destination} · {checkIn} → {checkOut}
          </p>
        </div>
        <span className="text-xs text-slate-500">Powered by Stay22</span>
      </div>

      <div className="relative">
        {!loaded ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 text-sm text-slate-400">
            Loading lodging map…
          </div>
        ) : null}
        <iframe
          src={src}
          title={`Accommodation near ${destination}`}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className="h-[460px] w-full border-0"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>

      {aid === "tidefit" ? (
        <p className="border-t border-white/10 px-5 py-3 text-xs text-slate-500">
          Using a placeholder Stay22 affiliate id — set{" "}
          <code className="font-mono text-slate-400">NEXT_PUBLIC_STAY22_AID</code> to load live
          listings and earn booking commissions.
        </p>
      ) : null}
    </section>
  );
}
