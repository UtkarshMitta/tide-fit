import type { MarineSource } from "@/lib/conditions";
import type { GeocodedPlace, Sport, TrainingAnchor } from "@/lib/types";
import { compassDirection, round } from "@/lib/utils";

/**
 * Picks the point a trip is organised around, and is honest when there isn't a
 * better one than the city centre.
 *
 * A swim is the one session whose location is dictated by geography rather than
 * preference: you go where the water is. When the marine model had to look
 * offshore to find a sea state, that coordinate is where the athlete will
 * actually be at 7am, so it becomes the reference point for lodging.
 */

/**
 * Below this the water is effectively at the centre, and "1.4 km west of the
 * centre" is a distinction without a difference to someone booking a hotel.
 */
const MEANINGFUL_OFFSET_KM = 2;

export function resolveTrainingAnchor(
  place: GeocodedPlace,
  sports: Sport[],
  marineSource: MarineSource | null,
): TrainingAnchor {
  const centre: TrainingAnchor = {
    latitude: place.latitude,
    longitude: place.longitude,
    kind: "centre",
    label: `${place.name} centre`,
    note: noteForCentre(place, sports, marineSource),
    distanceFromCentreKm: 0,
  };

  if (!sports.includes("swimming") || !marineSource) return centre;
  if (marineSource.distanceKm < MEANINGFUL_OFFSET_KM) return centre;

  const distanceKm = round(marineSource.distanceKm, 0) ?? marineSource.distanceKm;
  const direction = compassDirection(place, marineSource);

  return {
    latitude: marineSource.latitude,
    longitude: marineSource.longitude,
    kind: "swim-spot",
    label: "the swim spot",
    note: `Your swim happens at the nearest open water, about ${distanceKm} km ${direction} of ${place.name} centre — so stays are searched and measured from there, not from the city centre.`,
    distanceFromCentreKm: distanceKm,
  };
}

function noteForCentre(
  place: GeocodedPlace,
  sports: Sport[],
  marineSource: MarineSource | null,
): string {
  if (sports.includes("swimming")) {
    if (!marineSource) {
      return `No modelled open water near ${place.name}, so there is no fixed swim spot to measure from — distances are from the city centre, and the swim plan is pool-based.`;
    }
    return `The open water is right at ${place.name} centre, so that is the reference point for distances.`;
  }

  // Running, cycling and hiking happen on routes rather than at one coordinate.
  return `Running, cycling and hiking routes start wherever you are staying rather than at one fixed spot, so distances are measured from ${place.name} centre.`;
}
