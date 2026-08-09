import { geocodeNear, type MarineSource } from "@/lib/conditions";
import type { GeocodedPlace, Sport, TrainingAnchor } from "@/lib/types";
import { compassDirection, haversineKm, round } from "@/lib/utils";

/**
 * Picks the point a trip is organised around, and is honest when there isn't a
 * better one than the city centre.
 *
 * Order of preference:
 * 1. A named training spot from live search, geocoded near the destination
 *    (Carcavelos for a Lisbon swim, a trailhead for a Chamonix hike). Named
 *    spots win even when the marine model reports sea state at the city
 *    centroid — the Tagus estuary has waves, but athletes swim at the beach.
 * 2. The nearest modelled open water, when swimming is in focus and the sea
 *    state had to be sampled meaningfully offshore — still a real place to
 *    measure from, even if we never learned its name.
 * 3. The city centre, with a note explaining why. Inland swimming with no open
 *    water, and land sports whose routes start from the hotel door, both land
 *    here. Distances then read "from Lisbon centre" rather than pretending a
 *    spot exists.
 */

/** Below this the water is effectively at the centre. */
const MEANINGFUL_OFFSET_KM = 2;
/** Land-sport and beach spots can be a half-day trip from the city. */
const SPOT_MAX_KM = 45;
/** How many candidate names to try geocoding before giving up. */
const MAX_NAME_ATTEMPTS = 10;

export async function resolveTrainingAnchor(options: {
  place: GeocodedPlace;
  sports: Sport[];
  marineSource: MarineSource | null;
  /** Clean place names extracted from Tavily spot results. */
  spotNames?: string[];
}): Promise<TrainingAnchor> {
  const { place, sports, marineSource, spotNames = [] } = options;

  const centre: TrainingAnchor = {
    latitude: place.latitude,
    longitude: place.longitude,
    kind: "centre",
    label: `${place.name} centre`,
    note: noteForCentre(place, sports, marineSource),
    distanceFromCentreKm: 0,
  };

  // Named venue first — even when marine data is available at the centroid.
  const named = await findNamedSpot(spotNames, place, place, SPOT_MAX_KM);
  if (named) return namedSpotAnchor(place, named);

  const wantsSwim = sports.includes("swimming");
  const offshoreSwim =
    wantsSwim && marineSource !== null && marineSource.distanceKm >= MEANINGFUL_OFFSET_KM;

  if (offshoreSwim && marineSource) {
    const distanceKm = round(marineSource.distanceKm, 0) ?? marineSource.distanceKm;
    const direction = compassDirection(place, marineSource);
    return {
      latitude: marineSource.latitude,
      longitude: marineSource.longitude,
      kind: "training-spot",
      label: "the swim spot",
      note: `Your swim happens at the nearest open water, about ${distanceKm} km ${direction} of ${place.name} centre — stays are searched and measured from there, not from the city centre.`,
      distanceFromCentreKm: distanceKm,
    };
  }

  return centre;
}

function namedSpotAnchor(
  place: GeocodedPlace,
  spot: { name: string; latitude: number; longitude: number; distanceKm: number },
): TrainingAnchor {
  const distanceKm = round(spot.distanceKm, 1) ?? spot.distanceKm;
  const direction = compassDirection(place, spot);

  if (distanceKm < MEANINGFUL_OFFSET_KM) {
    return {
      latitude: spot.latitude,
      longitude: spot.longitude,
      kind: "training-spot",
      label: spot.name,
      note: `Your main training spot is ${spot.name}, near ${place.name} centre — distances are measured from there.`,
      distanceFromCentreKm: distanceKm,
    };
  }

  return {
    latitude: spot.latitude,
    longitude: spot.longitude,
    kind: "training-spot",
    label: spot.name,
    note: `Your main training spot is ${spot.name}, about ${distanceKm} km ${direction} of ${place.name} centre — stays are searched and measured from there, not from the city centre.`,
    distanceFromCentreKm: distanceKm,
  };
}

/**
 * Geocode candidate names, preferring ones that resolve close to the reference
 * point. The destination is appended so "Carcavelos" lands in Portugal rather
 * than somewhere else that shares the name.
 */
async function findNamedSpot(
  names: string[],
  place: GeocodedPlace,
  near: { latitude: number; longitude: number },
  maxKm: number,
): Promise<{ name: string; latitude: number; longitude: number; distanceKm: number } | null> {
  const hits: { name: string; latitude: number; longitude: number; distanceKm: number }[] = [];

  for (const name of names.slice(0, MAX_NAME_ATTEMPTS)) {
    for (const query of geocodeQueriesFor(name, place)) {
      const hit = await geocodeNear(query, near, maxKm);
      if (!hit) continue;

      // Reject a hit that is just the city itself under another label.
      if (haversineKm(place, hit) < 0.4 && namesMatchCity(hit.name, place.name)) continue;

      hits.push({
        name,
        latitude: hit.latitude,
        longitude: hit.longitude,
        distanceKm: haversineKm(place, hit),
      });
      break;
    }
  }

  if (hits.length === 0) return null;

  // A beach 12 km away is a better lodging centre than one 30 km out, even if
  // the farther one appeared first in the search results.
  hits.sort((a, b) => a.distanceKm - b.distanceKm);
  return hits[0];
}

/** A few phrasings — Open-Meteo is picky about "Praia de X" vs just "X". */
function geocodeQueriesFor(name: string, place: GeocodedPlace): string[] {
  const bare = name
    .replace(/^(praia|plage|park|parque)\s+(?:d(?:e|a|o|as|os)\s+)?/i, "")
    .replace(/\s+forest park$/i, "")
    .replace(/\s+(beach|park|trail)$/i, "")
    .trim();

  const queries = [
    `${name}, ${place.name}`,
    `${name}, ${place.country}`,
    name,
  ];
  if (bare && bare.toLowerCase() !== name.toLowerCase()) {
    queries.push(`${bare}, ${place.name}`, `${bare}, ${place.country}`, bare);
  }
  return queries;
}

function namesMatchCity(a: string, b: string): boolean {
  const clean = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const left = clean(a);
  const right = clean(b);
  return left === right || left.includes(right) || right.includes(left);
}

function noteForCentre(
  place: GeocodedPlace,
  sports: Sport[],
  marineSource: MarineSource | null,
): string {
  if (sports.includes("swimming")) {
    if (!marineSource) {
      return `No modelled open water near ${place.name} — this is not an open-water destination. Distances are from the village/centre, and the plan is pool or indoor swimming only (no beaches to invent).`;
    }
    // Marine data at the centroid is usually an estuary/river, not a swim beach.
    return `No named swim beach could be pinned near ${place.name}, so distances are from the centre. Prefer a confirmed local swim spot or a pool over guessing a shoreline.`;
  }

  return `No fixed training spot could be pinned for this trip — running, cycling and hiking routes start wherever you are staying, so distances are measured from ${place.name} centre.`;
}
