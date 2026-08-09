import type { LodgingOption } from "@/lib/types";
import { addDaysIso, formatDayLabel } from "@/lib/utils";

/**
 * Live inventory from Stay22's Accommodations API when a key is configured,
 * otherwise real property pages found via Tavily. Either way every link is an
 * Allez deeplink, so the click is bookable and attributed.
 */

function formatPrice(total: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(total);
  } catch {
    return `${Math.round(total)} ${currency}`;
  }
}

function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m from centre` : `${(meters / 1000).toFixed(1)} km from centre`;
}

function Rating({ rating }: { rating: NonNullable<LodgingOption["rating"]> }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="rounded-md bg-tide-500/20 px-1.5 py-0.5 font-mono text-xs font-semibold text-tide-200">
        {rating.value.toFixed(1)}
      </span>
      {rating.count ? (
        <span className="text-[11px] text-slate-500">
          {rating.count.toLocaleString("en-US")} reviews
        </span>
      ) : null}
    </span>
  );
}

export function LodgingList({
  options,
  destination,
  checkIn,
  nights,
}: {
  options: LodgingOption[];
  destination: string;
  checkIn: string;
  nights: number;
}) {
  if (options.length === 0) return null;

  const checkOut = addDaysIso(checkIn, Math.max(nights, 1));
  const isLive = options.some((option) => option.source === "stay22");

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 bg-white/[0.02] px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-50">Where to stay in {destination}</h2>
          <p className="text-sm text-slate-400">
            {formatDayLabel(checkIn)} → {formatDayLabel(checkOut)} · {nights}{" "}
            {nights === 1 ? "night" : "nights"} · {options.length} options
          </p>
        </div>
        <span className="text-xs text-slate-500">
          {isLive ? "Live prices from Stay22" : "Found via Tavily · booked via Stay22"}
        </span>
      </div>

      <ul className="divide-y divide-white/5">
        {options.map((option) => (
          <li key={option.id} className="flex gap-4 px-5 py-4 transition hover:bg-white/[0.03]">
            {option.thumbnail ? (
              // Thumbnails come from whichever OTA CDN supplied the listing, so a
              // remote-pattern allowlist for next/image would be a maintenance trap.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={option.thumbnail}
                alt=""
                loading="lazy"
                className="hidden h-20 w-28 shrink-0 rounded-lg object-cover sm:block"
              />
            ) : null}

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className="text-sm font-semibold text-slate-100">{option.name}</h3>
                {option.rating?.stars ? (
                  <span className="text-xs text-amber-300" aria-label={`${option.rating.stars} star`}>
                    {"★".repeat(option.rating.stars)}
                  </span>
                ) : null}
                {option.rating ? <Rating rating={option.rating} /> : null}
              </div>

              <p className="mt-1 truncate text-xs text-slate-500">
                {option.address ?? option.snippet}
                {option.distanceMeters !== undefined
                  ? ` · ${formatDistance(option.distanceMeters)}`
                  : ""}
              </p>

              {option.address && option.snippet ? (
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-400">
                  {option.snippet}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-col items-end justify-between gap-2">
              {option.price ? (
                <div className="text-right">
                  <p className="font-mono text-sm font-semibold text-slate-100">
                    {formatPrice(option.price.total, option.price.currency)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    total · {option.price.nights} {option.price.nights === 1 ? "night" : "nights"}
                  </p>
                </div>
              ) : null}

              <a
                href={option.bookingUrl}
                target="_blank"
                rel="noopener noreferrer sponsored"
                className="btn-ghost border-tide-400/40 py-2 text-xs text-tide-100 hover:border-tide-300"
              >
                Book on {option.provider}
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
