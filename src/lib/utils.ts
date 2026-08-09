import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** `yyyy-MM-dd` for today in the runtime's local zone. */
export function todayIso(): string {
  return toIsoDate(new Date());
}

export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Date maths on plain `yyyy-MM-dd` strings, parsed at UTC noon so daylight
 * saving shifts can never roll a trip day backwards.
 */
export function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dateRange(startIso: string, days: number): string[] {
  return Array.from({ length: days }, (_, index) => addDaysIso(startIso, index));
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T12:00:00Z`);
  const to = Date.parse(`${toIso}T12:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

export function formatDayLabel(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function mean(values: number[]): number | null {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length === 0) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

export function round(value: number | null, decimals = 1): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];

/** Rough compass direction, so "18 km west of Lisbon" beats "18 km away". */
export function compassDirection(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): string {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const degrees = (Math.atan2(y, x) * 180) / Math.PI;
  return COMPASS[Math.round(((degrees + 360) % 360) / 45) % 8];
}

/** Open-Meteo rejects bursts of parallel requests, so probe batches stay small. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function formatDistance(meters: number): string {
  return meters < 950 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Rough door-to-door estimate from straight-line distance: walking pace for
 * anything close, otherwise urban driving. Deliberately approximate — it exists
 * to answer "can I walk to the start of my session?" not to route a journey.
 */
export function travelEstimate(meters: number): string {
  const km = meters / 1000;
  if (km <= 2.5) {
    return `~${Math.max(1, Math.round((km / 4.8) * 60))} min walk`;
  }
  return `~${Math.max(5, Math.round((km / 28) * 60))} min drive`;
}

/** Degrees and percentages sit tight against the number; word units read better spaced. */
const TIGHT_UNITS = new Set(["°C", "°F", "%"]);

export function formatMeasure(value: number | string, unit: string): string {
  return TIGHT_UNITS.has(unit) ? `${value}${unit}` : `${value} ${unit}`;
}

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
