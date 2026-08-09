import { tavily } from "@tavily/core";

import { publicEnv } from "@/lib/env.public";
import { serverEnv } from "@/lib/env";
import { softFetch } from "@/lib/http";
import { fetchStay22Accommodations } from "@/lib/stay22";
import type { GeocodedPlace, LodgingOption, Sport, TrainingAnchor } from "@/lib/types";
import { addDaysIso } from "@/lib/utils";

/**
 * Accommodation discovery, in two tiers.
 *
 * With `STAY22_API_KEY` set, listings come from Stay22's Accommodations API:
 * live inventory with prices, ratings and ready-made affiliate deeplinks.
 *
 * Without it, this falls back to a Tavily search scoped to booking sites.
 * Searching the open web for "best hotels in X" returns listicles rather than
 * places, so the query is domain-scoped and then filtered to URL shapes that
 * are a single property page, and each is wrapped in a Stay22 Allez link by
 * hand. No prices, but the names are real and the links still convert.
 */

const ALLEZ_BASE = "https://www.stay22.com/allez";

/** Stay22 has a dedicated Allez endpoint per OTA; anything else routes through roam. */
const PROVIDER_BY_HOST: { match: RegExp; provider: string; label: string }[] = [
  { match: /(^|\.)booking\.com$/i, provider: "booking", label: "Booking.com" },
  { match: /(^|\.)hotels\.com$/i, provider: "hotelscom", label: "Hotels.com" },
  { match: /(^|\.)expedia\.[a-z.]+$/i, provider: "expedia", label: "Expedia" },
  { match: /(^|\.)agoda\.com$/i, provider: "agoda", label: "Agoda" },
  { match: /(^|\.)vrbo\.com$/i, provider: "vrbo", label: "Vrbo" },
  { match: /(^|\.)tripadvisor\.[a-z.]+$/i, provider: "tripadvisor", label: "Tripadvisor" },
];

const LODGING_DOMAINS = [
  "booking.com",
  "hotels.com",
  "expedia.com",
  "agoda.com",
  "vrbo.com",
  "tripadvisor.com",
];

/**
 * Scoping the search to booking sites is not enough on its own: most hits are
 * category pages ("The 10 best beach hotels in Lisbon") or forum threads. Only
 * these URL shapes are a single bookable property.
 */
const PROPERTY_URL_PATTERNS: RegExp[] = [
  /booking\.com\/hotel\/[a-z]{2}\//i,
  /hotels\.com\/ho\d+/i,
  /agoda\.com\/[^/]+\/hotel\//i,
  /expedia\.[a-z.]+\/.*\.h\d+\./i,
  /tripadvisor\.[a-z.]+\/Hotel_Review-/i,
  /vrbo\.com\/\d+[a-z]*(?:$|[?#/])/i,
];

const MAX_OPTIONS = 5;

export function isPropertyPage(url: string): boolean {
  return PROPERTY_URL_PATTERNS.some((pattern) => pattern.test(url));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function resolveProvider(host: string): { provider: string; label: string } {
  const match = PROVIDER_BY_HOST.find((entry) => entry.match.test(host));
  return match
    ? { provider: match.provider, label: match.label }
    : { provider: "roam", label: host || "Stay22" };
}

/**
 * OTA titles wrap the property name in marketing furniture: "RIVIERA HOTEL -
 * Prices & Reviews (Carcavelos, Portugal)", "Best Price on X in Y + Reviews!",
 * "X, Lisbon District: Hotel Reviews, Rooms & Prices | Hotels.com". Peel that
 * away so the card shows something a human would recognise.
 */
export function cleanPropertyName(title: string): string {
  let cleaned = title.trim();

  // Agoda phrases the whole title as a sales pitch around the property name.
  const agodaMatch = cleaned.match(/^best price on (.+?)(?: in .+)?(?:\s*\+ reviews!?)?$/i);
  if (agodaMatch?.[1]) cleaned = agodaMatch[1];

  cleaned = cleaned
    .split(" | ")[0]
    .split(": ")[0]
    .replace(/\s*[-–]\s*(prices?|deals?|reviews?|book now|official site)\b.*$/i, "")
    .replace(/\s*[-–,]\s*(updated\s+)?\d{4}\s*(prices|rates|reviews)?.*$/i, "")
    .replace(/\s*\((?:updated\s+)?\d{4}\)\s*$/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s*[-–]\s*(entire apartment|apartment|hostel)\b.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[,\s]+$/, "")
    .trim();

  // Tripadvisor shouts property names in caps; sentence-case them back.
  if (cleaned.length > 3 && cleaned === cleaned.toUpperCase()) {
    cleaned = cleaned
      .toLowerCase()
      .replace(/\b[a-z]/g, (character) => character.toUpperCase());
  }

  return cleaned.length >= 3 ? cleaned : title.trim();
}

/**
 * Athletes care where they sleep relative to where they train, so the area is
 * biased by the sports in focus rather than defaulting to the city centre.
 *
 * Phrasing matters as much as domain scoping: "hotels near the beach in Lisbon"
 * returns ranked listicles, while naming a property attribute and "reviews"
 * pulls individual property pages.
 */
function lodgingArea(sports: Sport[]): string {
  if (sports.includes("swimming")) return "near the beach";
  if (sports.includes("hiking")) return "near the hiking trails";
  if (sports.includes("cycling")) return "with bike storage";
  return "near the city centre";
}

export function buildLodgingQueries(destination: string, sports: Sport[]): string[] {
  return [
    `best hotel to stay ${lodgingArea(sports)} in ${destination} reviews prices`,
    `${destination} hotel reviews rooms and prices`,
  ];
}

export function buildAllezLink(option: {
  name: string;
  sourceUrl: string;
  provider: string;
  /** Coordinate roam resolves the property against — the training anchor. */
  origin: { latitude: number; longitude: number };
  checkIn: string;
  checkOut: string;
}): string {
  const { name, sourceUrl, provider, origin, checkIn, checkOut } = option;
  const url = new URL(`${ALLEZ_BASE}/${provider}`);
  url.searchParams.set("aid", publicEnv.stay22AffiliateId);

  if (provider === "roam") {
    // Roam resolves a destination itself and cannot take a direct OTA link.
    url.searchParams.set("hotelname", name);
    url.searchParams.set("lat", String(origin.latitude));
    url.searchParams.set("lng", String(origin.longitude));
  } else {
    url.searchParams.set("link", sourceUrl);
  }

  url.searchParams.set("checkin", checkIn);
  url.searchParams.set("checkout", checkOut);
  url.searchParams.set("campaign", "tidefit-lodging");
  return url.toString();
}

export interface LodgingResult {
  options: LodgingOption[];
  /** Present when Stay22's API told us which affiliate id it attached. */
  aid?: string;
}

export async function getLodgingOptions(options: {
  destination: string;
  place: GeocodedPlace;
  /** Stays are found near where the training happens, not the city centroid. */
  anchor: TrainingAnchor;
  startDate: string;
  days: number;
  sports: Sport[];
}): Promise<LodgingResult> {
  const { destination, place, anchor, startDate, days, sports } = options;
  const checkOut = addDaysIso(startDate, Math.max(days, 1));

  if (serverEnv.stay22ApiKey) {
    const live = await softFetch("Stay22 accommodations", () =>
      fetchStay22Accommodations({
        place,
        anchor,
        checkIn: startDate,
        checkOut,
        limit: MAX_OPTIONS,
      }),
    );
    if (live && live.options.length > 0) return live;
  }

  return { options: await searchLodgingViaTavily(destination, anchor, startDate, days, sports) };
}

async function searchLodgingViaTavily(
  destination: string,
  anchor: TrainingAnchor,
  startDate: string,
  days: number,
  sports: Sport[],
): Promise<LodgingOption[]> {
  if (!serverEnv.tavilyApiKey) return [];

  const client = tavily({ apiKey: serverEnv.tavilyApiKey });
  const responses = await Promise.all(
    buildLodgingQueries(destination, sports).map((query) =>
      softFetch(`Tavily lodging search "${query}"`, () =>
        client.search(query, {
          maxResults: 10,
          searchDepth: "basic",
          includeDomains: LODGING_DOMAINS,
        }),
      ),
    ),
  );

  const checkIn = startDate;
  const checkOut = addDaysIso(startDate, Math.max(days, 1));

  const seen = new Set<string>();
  const options: LodgingOption[] = [];

  const results = responses
    .flatMap((response) => response?.results ?? [])
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  for (const result of results) {
    if (!isPropertyPage(result.url)) continue;

    const host = hostOf(result.url);
    if (!host) continue;

    const name = cleanPropertyName(result.title);
    const dedupeKey = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const { provider, label } = resolveProvider(host);
    options.push({
      id: result.url,
      name,
      sourceUrl: result.url,
      provider: label,
      source: "tavily",
      snippet: result.content.slice(0, 220).trim(),
      bookingUrl: buildAllezLink({
        name,
        sourceUrl: result.url,
        provider,
        origin: anchor,
        checkIn,
        checkOut,
      }),
    });

    if (options.length >= MAX_OPTIONS) break;
  }

  return options;
}
