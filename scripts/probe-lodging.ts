/**
 * Manual check for the lodging pipeline against live APIs.
 * Run with: npm run check:lodging
 *
 * With STAY22_API_KEY set this exercises the Accommodations API (prices,
 * ratings, distance); without it, the Tavily booking-site fallback.
 */
import { getLodgingOptions } from "@/lib/lodging";
import type { GeocodedPlace, Sport } from "@/lib/types";

const PLACES: { place: GeocodedPlace; sports: Sport[] }[] = [
  {
    place: {
      name: "Lisbon",
      country: "Portugal",
      countryCode: "PT",
      latitude: 38.72509,
      longitude: -9.1498,
      timezone: "Europe/Lisbon",
    },
    sports: ["swimming", "running"],
  },
  {
    place: {
      name: "Chamonix",
      country: "France",
      countryCode: "FR",
      latitude: 45.9237,
      longitude: 6.8694,
      timezone: "Europe/Paris",
    },
    sports: ["hiking"],
  },
];

async function main() {
  for (const { place, sports } of PLACES) {
    const { options, aid } = await getLodgingOptions(place.name, place, "2026-08-11", 3, sports);
    console.log(
      `\n### ${place.name} (${sports.join(", ")}) — ${options.length} properties, aid=${aid ?? "n/a"}`,
    );
    for (const option of options) {
      const price = option.price
        ? `${option.price.total} ${option.price.currency} / ${option.price.nights}n`
        : "no price";
      const rating = option.rating ? `${option.rating.value} (${option.rating.count ?? 0})` : "—";
      console.log(
        `- ${option.name} [${option.source} → ${option.provider}] ${price} · rating ${rating} · ${option.distanceMeters ?? "?"}m`,
      );
      console.log(`    ${option.bookingUrl.slice(0, 120)}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
