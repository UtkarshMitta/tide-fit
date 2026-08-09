import type { RiskLevel, Sport } from "@/lib/types";

/**
 * Every safety number TideFit uses lives in this file so thresholds can be
 * retuned without touching fetch or classification logic.
 *
 * `ceiling`  — bigger is worse (wave height, AQI, wind).
 * `floor`    — smaller is worse (wave period: short chop is harder to swim).
 * `window`   — comfortable band, both extremes are worse (air/sea temperature).
 *
 * `maxRisk` caps how bad a single metric is allowed to make a day. Sea state
 * period, rain and UV degrade a session but shouldn't on their own declare it
 * unsafe, so they cap at `caution`.
 */
export type ThresholdRule = {
  key: string;
  label: string;
  unit: string;
  /** Used mid-sentence, where lowercasing an acronym label would read as "us aqi". */
  proseLabel?: string;
  maxRisk?: RiskLevel;
} & (
  | { kind: "ceiling"; safeUpTo: number; cautionUpTo: number }
  | { kind: "floor"; safeFrom: number; cautionFrom: number }
  | { kind: "window"; safe: [number, number]; caution: [number, number] }
);

export const SPORT_THRESHOLDS: Record<Sport, ThresholdRule[]> = {
  swimming: [
    {
      kind: "ceiling",
      key: "waveHeightMax",
      label: "Wave height",
      unit: "m",
      safeUpTo: 0.5,
      cautionUpTo: 1.2,
    },
    {
      kind: "floor",
      key: "wavePeriodMax",
      label: "Wave period",
      unit: "s",
      safeFrom: 7,
      cautionFrom: 4,
      maxRisk: "caution",
    },
    {
      kind: "window",
      key: "seaSurfaceTemperature",
      label: "Sea temperature",
      unit: "°C",
      safe: [18, 28],
      caution: [14, 31],
    },
    {
      kind: "ceiling",
      key: "windSpeedMax",
      label: "Wind",
      unit: "km/h",
      safeUpTo: 20,
      cautionUpTo: 32,
    },
  ],
  running: [
    {
      kind: "ceiling",
      key: "airQualityIndex",
      label: "Air quality (US AQI)",
      proseLabel: "air quality",
      unit: "AQI",
      safeUpTo: 100,
      cautionUpTo: 150,
    },
    {
      kind: "ceiling",
      key: "apparentTemperatureMax",
      label: "Feels-like high",
      unit: "°C",
      safeUpTo: 27,
      cautionUpTo: 32,
    },
    {
      kind: "ceiling",
      key: "precipitationSum",
      label: "Rainfall",
      unit: "mm",
      safeUpTo: 5,
      cautionUpTo: 20,
      maxRisk: "caution",
    },
    {
      // Strong gusts make a run unpleasant and unsafe near traffic, but they
      // are never on their own a reason to cancel it.
      kind: "ceiling",
      key: "windGustsMax",
      label: "Wind gusts",
      unit: "km/h",
      safeUpTo: 40,
      cautionUpTo: 60,
      maxRisk: "caution",
    },
  ],
  cycling: [
    {
      kind: "ceiling",
      key: "windGustsMax",
      label: "Wind gusts",
      unit: "km/h",
      safeUpTo: 35,
      cautionUpTo: 55,
    },
    {
      kind: "ceiling",
      key: "precipitationSum",
      label: "Rainfall",
      unit: "mm",
      safeUpTo: 2,
      cautionUpTo: 10,
    },
    {
      kind: "window",
      key: "temperatureMax",
      label: "Daytime high",
      unit: "°C",
      safe: [5, 30],
      caution: [0, 35],
    },
  ],
  hiking: [
    {
      kind: "ceiling",
      key: "precipitationSum",
      label: "Rainfall",
      unit: "mm",
      safeUpTo: 5,
      cautionUpTo: 25,
    },
    {
      kind: "window",
      key: "apparentTemperatureMax",
      label: "Feels-like high",
      unit: "°C",
      safe: [2, 28],
      caution: [-5, 34],
    },
    {
      kind: "ceiling",
      key: "windSpeedMax",
      label: "Wind",
      unit: "km/h",
      safeUpTo: 30,
      cautionUpTo: 50,
    },
    {
      kind: "ceiling",
      key: "uvIndexMax",
      label: "UV index",
      proseLabel: "UV index",
      unit: "UVI",
      safeUpTo: 7,
      cautionUpTo: 10,
      maxRisk: "caution",
    },
  ],
};

/** WMO weather codes that override any metric-level verdict. */
export const SEVERE_WEATHER_CODES = {
  /** Thunderstorms and heavy freezing rain: call it off. */
  unsafe: [65, 67, 75, 82, 86, 95, 96, 99],
  /** Heavy-ish rain, snow, freezing drizzle: proceed with care. */
  caution: [55, 57, 63, 66, 73, 81, 85],
};

/**
 * Wave period only matters once there is meaningful swell. Below this height
 * the water is flat enough that a short period is irrelevant.
 */
export const WAVE_PERIOD_MIN_HEIGHT_M = 0.3;

export const AQI_BANDS: { max: number; label: string }[] = [
  { max: 50, label: "Good" },
  { max: 100, label: "Moderate" },
  { max: 150, label: "Unhealthy for sensitive groups" },
  { max: 200, label: "Unhealthy" },
  { max: 300, label: "Very unhealthy" },
  { max: Number.POSITIVE_INFINITY, label: "Hazardous" },
];

export function aqiLabel(aqi: number): string {
  return AQI_BANDS.find((band) => aqi <= band.max)?.label ?? "Unknown";
}

/** Sports whose data comes from the marine feed rather than the land forecast. */
export const MARINE_SPORTS: Sport[] = ["swimming"];
