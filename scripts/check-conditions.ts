/**
 * Manual smoke test for the condition engine against the live free feeds.
 * Run with: npx tsx scripts/check-conditions.ts "Lisbon" "Denver"
 */
import { geocodeDestination, getTripConditions, placeLabel } from "@/lib/conditions";
import { SPORTS } from "@/lib/types";
import { todayIso } from "@/lib/utils";

async function main() {
  const destinations = process.argv.slice(2);
  const queries = destinations.length > 0 ? destinations : ["Lisbon", "Denver"];

  for (const query of queries) {
    const place = await geocodeDestination(query);
    if (!place) {
      console.log(`\n${query}: no geocoding match`);
      continue;
    }

    const { conditions, marineSource, airQualityProvider } = await getTripConditions(
      place,
      todayIso(),
      3,
      [...SPORTS],
    );

    console.log(`\n=== ${placeLabel(place)} (${place.latitude}, ${place.longitude}) ===`);
    console.log(
      `marine source: ${marineSource ? `${marineSource.distanceKm} km away` : "none"} | air quality: ${airQualityProvider}`,
    );
    for (const day of conditions) {
      console.log(`\n${day.date} overall=${day.overallRisk}`);
      for (const sport of day.bySport) {
        console.log(`  ${sport.sport.padEnd(9)} ${sport.risk.padEnd(8)} ${sport.headline}`);
        for (const metric of sport.metrics) {
          console.log(`      · ${metric.note}`);
        }
        if (sport.dataGap) console.log(`      ! ${sport.dataGap}`);
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
