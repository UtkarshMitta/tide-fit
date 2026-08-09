/**
 * Manual check for the lodging pipeline against live APIs.
 * Run with: npm run check:lodging
 *
 * This runs the real sequence — conditions, grounding, training anchor (named
 * spot when one geocodes, otherwise centre), then lodging — because the whole
 * point is that stays are found near where the training happens. Denver is in
 * the list on purpose: it is the no-open-water edge case, where the anchor must
 * fall back to the city centre and say so.
 */
import { resolveTrainingAnchor } from "@/lib/anchor";
import { getTripConditions } from "@/lib/conditions";
import { getLodgingOptions } from "@/lib/lodging";
import { getLocalGrounding, trainingSpotNames } from "@/lib/search";
import type { GeocodedPlace, Sport } from "@/lib/types";
import { formatDistance, travelEstimate } from "@/lib/utils";

const START_DATE = "2026-08-11";
const DAYS = 3;

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
      name: "Denver",
      country: "United States",
      countryCode: "US",
      latitude: 39.73915,
      longitude: -104.9847,
      timezone: "America/Denver",
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
    const [{ marineSource }, grounding] = await Promise.all([
      getTripConditions(place, START_DATE, DAYS, sports),
      getLocalGrounding(place.name, START_DATE, sports),
    ]);

    const spotNames = trainingSpotNames(grounding.spots, sports);

    const anchor = await resolveTrainingAnchor({
      place,
      sports,
      marineSource,
      spotNames,
    });

    const { options, aid } = await getLodgingOptions({
      destination: place.name,
      place,
      anchor,
      startDate: START_DATE,
      days: DAYS,
      sports,
    });

    console.log(`\n### ${place.name} (${sports.join(", ")}) — ${options.length} stays, aid=${aid ?? "n/a"}`);
    console.log(`    spot names tried: ${spotNames.slice(0, 4).join(", ") || "(none)"}`);
    console.log(`    anchor: ${anchor.kind} "${anchor.label}" @ ${anchor.latitude.toFixed(4)},${anchor.longitude.toFixed(4)}`);
    console.log(`    ${anchor.note}`);

    for (const option of options) {
      const price = option.price
        ? `${option.price.total} ${option.price.currency} / ${option.price.nights}n`
        : "no price";
      const distance =
        option.distanceMeters === undefined
          ? "distance unknown"
          : `${formatDistance(option.distanceMeters)} from ${anchor.label} · ${travelEstimate(option.distanceMeters)}`;
      console.log(`- ${option.name} [${option.provider}] ${price} · ${distance}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
