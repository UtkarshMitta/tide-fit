import { requireEnv, serverEnv } from "@/lib/env";
import { buildUrl, fetchJson } from "@/lib/http";
import type { GeocodedPlace, LodgingOption, TrainingAnchor } from "@/lib/types";
import { haversineKm } from "@/lib/utils";

/**
 * Stay22 Accommodations API — the primary lodging source. Unlike scraping OTA
 * pages out of a web search, this returns live inventory with prices, ratings
 * and per-supplier Allez deeplinks that already carry the account's affiliate
 * id, so a booking is attributed without us assembling links by hand.
 */

const ACCOMMODATIONS_URL = "https://api.stay22.com/v2/accommodations";

/** Prices read better in the currency the traveller will actually be charged. */
const CURRENCY_BY_COUNTRY: Record<string, string> = {
  GB: "GBP",
  US: "USD",
  CA: "CAD",
  AU: "AUD",
  NZ: "NZD",
  JP: "JPY",
  CH: "CHF",
  IN: "INR",
  BR: "BRL",
  MX: "MXN",
  ZA: "ZAR",
  AE: "AED",
  SG: "SGD",
  TH: "THB",
  NO: "NOK",
  SE: "SEK",
  DK: "DKK",
  PL: "PLN",
  CZ: "CZK",
  TR: "TRY",
  MA: "MAD",
  IS: "ISK",
};

const EUROZONE = new Set([
  "PT", "ES", "FR", "IT", "DE", "NL", "BE", "AT", "IE", "GR", "FI", "LU",
  "SK", "SI", "EE", "LV", "LT", "CY", "MT", "HR",
]);

export function currencyForPlace(place: GeocodedPlace): string {
  const code = place.countryCode;
  if (!code) return "USD";
  if (EUROZONE.has(code)) return "EUR";
  return CURRENCY_BY_COUNTRY[code] ?? "USD";
}

interface Stay22Supplier {
  id?: string;
  link?: string;
  price?: { total?: number | null };
}

interface Stay22Result {
  id?: string;
  url?: string;
  name?: string;
  type?: string;
  suppliers?: Record<string, Stay22Supplier>;
  location?: {
    address?: string;
    coordinates?: { lat?: number; lng?: number };
    distanceInMeters?: number | null;
  };
  rating?: { value?: number | null; hotelStars?: number | null; count?: number | null };
  media?: { thumbnail?: string };
}

interface Stay22Response {
  meta?: { nights?: number; currency?: string; total?: number };
  results?: Stay22Result[];
}

const SUPPLIER_LABELS: Record<string, string> = {
  booking: "Booking.com",
  expedia: "Expedia",
  hotelscom: "Hotels.com",
  agoda: "Agoda",
  vrbo: "Vrbo",
  tripadvisor: "Tripadvisor",
  roam: "Stay22",
};

/** Picks the cheapest supplier that actually quoted a price. */
function bestSupplier(result: Stay22Result): { key: string; link: string; total?: number } | null {
  const priced = Object.entries(result.suppliers ?? {})
    .filter(([, supplier]) => supplier.link)
    .map(([key, supplier]) => ({
      key,
      link: supplier.link as string,
      total: typeof supplier.price?.total === "number" ? supplier.price.total : undefined,
    }));

  const quoted = priced.filter((supplier) => supplier.total !== undefined);
  if (quoted.length > 0) {
    return quoted.reduce((cheapest, next) =>
      (next.total ?? Infinity) < (cheapest.total ?? Infinity) ? next : cheapest,
    );
  }
  if (priced.length > 0) return priced[0];

  // No supplier links: fall back to the roam URL, which Stay22 routes itself.
  return result.url ? { key: "roam", link: result.url } : null;
}

/**
 * Junk inventory (single fake review, 1.0 rating) does exist in the feed and
 * would undermine trust in the whole list, so it is filtered out.
 */
function looksCredible(result: Stay22Result): boolean {
  if (!result.name) return false;
  const value = result.rating?.value;
  const count = result.rating?.count ?? 0;
  if (typeof value === "number" && count > 0 && value < 6) return false;
  return true;
}

function hasQuotedPrice(result: Stay22Result): boolean {
  return Object.values(result.suppliers ?? {}).some(
    (supplier) => typeof supplier.price?.total === "number",
  );
}

/**
 * The feed comes back ordered by distance, which at a city centroid means the
 * first page is mostly one-review studios — but the best-reviewed properties
 * deeper in the pool often have no price quoted for these dates. Neither axis
 * alone gives a good list, so the tiers demand both review credibility and a
 * live price, and only drop those requirements to fill remaining slots.
 */
const QUALITY_TIERS: { minReviews: number; minRating: number; requirePrice: boolean }[] = [
  { minReviews: 50, minRating: 7.5, requirePrice: true },
  { minReviews: 10, minRating: 7, requirePrice: true },
  { minReviews: 0, minRating: 0, requirePrice: true },
  { minReviews: 0, minRating: 0, requirePrice: false },
];

function rankByQuality(results: Stay22Result[], limit: number): Stay22Result[] {
  const chosen: Stay22Result[] = [];
  const taken = new Set<Stay22Result>();

  for (const tier of QUALITY_TIERS) {
    for (const result of results) {
      if (taken.has(result)) continue;

      const value = result.rating?.value ?? 0;
      const count = result.rating?.count ?? 0;
      if (count < tier.minReviews || value < tier.minRating) continue;
      if (tier.requirePrice && !hasQuotedPrice(result)) continue;

      chosen.push(result);
      taken.add(result);
      if (chosen.length >= limit) return chosen;
    }
  }

  return chosen;
}

/** Quality decides *which* stays make the list; price decides the order shown. */
export function sortByPrice(options: LodgingOption[]): LodgingOption[] {
  return options
    .slice()
    .sort((a, b) => (a.price?.total ?? Infinity) - (b.price?.total ?? Infinity));
}

/**
 * Always measure against the training anchor ourselves. The API's
 * `distanceInMeters` is usually relative to the search lat/lng (which is the
 * anchor), but we prefer haversine so a missing or oddly-referenced API value
 * can never quietly report distance from the city centre instead.
 */
function distanceFromAnchor(anchor: TrainingAnchor, result: Stay22Result): number | undefined {
  const { lat, lng } = result.location?.coordinates ?? {};
  if (typeof lat === "number" && typeof lng === "number") {
    return Math.round(haversineKm(anchor, { latitude: lat, longitude: lng }) * 1000);
  }

  if (typeof result.location?.distanceInMeters === "number") {
    return result.location.distanceInMeters;
  }

  return undefined;
}

export function extractAid(link: string): string | undefined {
  try {
    return new URL(link).searchParams.get("aid") ?? undefined;
  } catch {
    return undefined;
  }
}

export interface Stay22LodgingResult {
  options: LodgingOption[];
  /** The affiliate id Stay22 attached to the booking links. */
  aid?: string;
}

export async function fetchStay22Accommodations(options: {
  place: GeocodedPlace;
  /** Where the training happens — the search centre, not the city centroid. */
  anchor: TrainingAnchor;
  checkIn: string;
  checkOut: string;
  limit?: number;
}): Promise<Stay22LodgingResult> {
  const { place, anchor, checkIn, checkOut, limit = 5 } = options;
  const currency = currencyForPlace(place);

  const response = await fetchJson<Stay22Response>(
    buildUrl(ACCOMMODATIONS_URL, {
      lat: anchor.latitude,
      lng: anchor.longitude,
      checkin: checkIn,
      checkout: checkOut,
      adults: 1,
      rooms: 1,
      currency,
      lang: "en",
      cluster: "false",
      // Deliberately modest: asking for 20 pads the response with duplicate
      // listings and rows that carry no price, while ~12 comes back unique and
      // fully priced. Enough of a pool to rank, without the padding.
      pageSize: Math.min(Math.max(limit + 6, 8), 12),
    }),
    {
      headers: { "X-API-KEY": requireEnv(serverEnv.stay22ApiKey, "STAY22_API_KEY") },
      timeoutMs: 15_000,
    },
  );

  const nights = response.meta?.nights ?? 1;
  const credible = (response.results ?? []).filter(looksCredible);
  const results = rankByQuality(credible, limit);

  const mapped: LodgingOption[] = [];
  const seenNames = new Set<string>();

  for (const result of results) {
    const supplier = bestSupplier(result);
    if (!supplier) continue;

    // The same property can appear more than once across suppliers.
    const nameKey = (result.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seenNames.has(nameKey)) continue;
    seenNames.add(nameKey);

    mapped.push({
      id: result.id ?? supplier.link,
      name: result.name as string,
      bookingUrl: supplier.link,
      provider: SUPPLIER_LABELS[supplier.key] ?? supplier.key,
      source: "stay22",
      address: result.location?.address,
      thumbnail: result.media?.thumbnail,
      rating:
        typeof result.rating?.value === "number"
          ? {
              value: result.rating.value,
              count: result.rating.count ?? undefined,
              stars: result.rating.hotelStars ?? undefined,
            }
          : undefined,
      price:
        supplier.total !== undefined
          ? { total: supplier.total, currency: response.meta?.currency ?? currency, nights }
          : undefined,
      distanceMeters: distanceFromAnchor(anchor, result),
    });

    if (mapped.length >= limit) break;
  }

  const aid = mapped[0] ? extractAid(mapped[0].bookingUrl) : undefined;
  return { options: sortByPrice(mapped), aid };
}
