import { serverEnv } from "@/lib/env";
import { buildUrl, fetchJson, softFetch } from "@/lib/http";
import {
  MARINE_SPORTS,
  SEVERE_WEATHER_CODES,
  SPORT_THRESHOLDS,
  WAVE_PERIOD_MIN_HEIGHT_M,
  aqiLabel,
  type ThresholdRule,
} from "@/lib/thresholds";
import {
  type ConditionMetric,
  type DayConditions,
  type GeocodedPlace,
  type RiskLevel,
  type Sport,
  type SportConditions,
  worstRisk,
} from "@/lib/types";
import {
  dateRange,
  daysBetween,
  formatMeasure,
  haversineKm,
  mapWithConcurrency,
  mean,
  round,
  todayIso,
} from "@/lib/utils";

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
const OPEN_METEO_AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const OPENWEATHER_AIR_URL = "https://api.openweathermap.org/data/2.5/air_pollution/forecast";

/** Open-Meteo publishes 16 days of land forecast and ~5 days of air quality. */
const FORECAST_HORIZON_DAYS = 15;
const AIR_QUALITY_HORIZON_DAYS = 4;

/** Beyond this the nearest modelled water is too far to call it a local swim. */
const MARINE_SEARCH_MAX_KM = 60;

// ---------------------------------------------------------------------------
// Geocoding
// ---------------------------------------------------------------------------

interface GeocodingResponse {
  results?: {
    name: string;
    latitude: number;
    longitude: number;
    country?: string;
    admin1?: string;
    timezone?: string;
    population?: number;
  }[];
}

export async function geocodeDestination(query: string): Promise<GeocodedPlace | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const data = await fetchJson<GeocodingResponse>(
    buildUrl(GEOCODING_URL, { name: trimmed, count: 5, language: "en", format: "json" }),
  );

  const best = (data.results ?? [])
    .slice()
    .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0];
  if (!best) return null;

  return {
    name: best.name,
    country: best.country ?? "",
    admin1: best.admin1,
    latitude: best.latitude,
    longitude: best.longitude,
    timezone: best.timezone ?? "auto",
  };
}

export function placeLabel(place: GeocodedPlace): string {
  return [place.name, place.admin1 !== place.name ? place.admin1 : undefined, place.country]
    .filter(Boolean)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Upstream feeds
// ---------------------------------------------------------------------------

interface DailySeries {
  time: string[];
  [key: string]: (number | null)[] | string[];
}

interface OpenMeteoDailyResponse {
  daily?: DailySeries;
}

interface OpenMeteoHourlyResponse {
  hourly?: { time: string[]; [key: string]: (number | null)[] | string[] };
}

type LandDaily = {
  weatherCode: number | null;
  temperatureMax: number | null;
  temperatureMin: number | null;
  apparentTemperatureMax: number | null;
  precipitationSum: number | null;
  precipitationProbability: number | null;
  windSpeedMax: number | null;
  windGustsMax: number | null;
  uvIndexMax: number | null;
};

type MarineDaily = {
  waveHeightMax: number | null;
  wavePeriodMax: number | null;
  seaSurfaceTemperature: number | null;
};

export interface MarineSource {
  latitude: number;
  longitude: number;
  distanceKm: number;
}

/** Clamps a requested window to what the upstream model actually publishes. */
function clampWindow(dates: string[], horizonDays: number): string[] {
  const today = todayIso();
  return dates.filter((date) => {
    const offset = daysBetween(today, date);
    return offset >= -30 && offset <= horizonDays;
  });
}

function numberSeries(series: DailySeries | undefined, key: string): (number | null)[] {
  const values = series?.[key];
  if (!Array.isArray(values)) return [];
  return values.map((value) => (typeof value === "number" ? value : null));
}

async function fetchLandForecast(
  place: GeocodedPlace,
  dates: string[],
): Promise<Record<string, LandDaily>> {
  const window = clampWindow(dates, FORECAST_HORIZON_DAYS);
  if (window.length === 0) return {};

  const data = await fetchJson<OpenMeteoDailyResponse>(
    buildUrl(FORECAST_URL, {
      latitude: place.latitude,
      longitude: place.longitude,
      daily: [
        "weather_code",
        "temperature_2m_max",
        "temperature_2m_min",
        "apparent_temperature_max",
        "precipitation_sum",
        "precipitation_probability_max",
        "wind_speed_10m_max",
        "wind_gusts_10m_max",
        "uv_index_max",
      ].join(","),
      timezone: place.timezone,
      start_date: window[0],
      end_date: window[window.length - 1],
    }),
  );

  const daily = data.daily;
  const times = daily?.time ?? [];
  const columns = {
    weatherCode: numberSeries(daily, "weather_code"),
    temperatureMax: numberSeries(daily, "temperature_2m_max"),
    temperatureMin: numberSeries(daily, "temperature_2m_min"),
    apparentTemperatureMax: numberSeries(daily, "apparent_temperature_max"),
    precipitationSum: numberSeries(daily, "precipitation_sum"),
    precipitationProbability: numberSeries(daily, "precipitation_probability_max"),
    windSpeedMax: numberSeries(daily, "wind_speed_10m_max"),
    windGustsMax: numberSeries(daily, "wind_gusts_10m_max"),
    uvIndexMax: numberSeries(daily, "uv_index_max"),
  };

  const byDate: Record<string, LandDaily> = {};
  times.forEach((date, index) => {
    byDate[date] = {
      weatherCode: columns.weatherCode[index] ?? null,
      temperatureMax: columns.temperatureMax[index] ?? null,
      temperatureMin: columns.temperatureMin[index] ?? null,
      apparentTemperatureMax: columns.apparentTemperatureMax[index] ?? null,
      precipitationSum: columns.precipitationSum[index] ?? null,
      precipitationProbability: columns.precipitationProbability[index] ?? null,
      windSpeedMax: columns.windSpeedMax[index] ?? null,
      windGustsMax: columns.windGustsMax[index] ?? null,
      uvIndexMax: columns.uvIndexMax[index] ?? null,
    };
  });
  return byDate;
}

async function fetchMarineAt(
  coords: { latitude: number; longitude: number },
  timezone: string,
  window: string[],
): Promise<Record<string, MarineDaily>> {
  const response = await fetchJson<OpenMeteoDailyResponse & OpenMeteoHourlyResponse>(
    buildUrl(MARINE_URL, {
      latitude: coords.latitude,
      longitude: coords.longitude,
      daily: "wave_height_max,wave_period_max,wave_direction_dominant",
      hourly: "sea_surface_temperature",
      timezone,
      start_date: window[0],
      end_date: window[window.length - 1],
    }),
  );
  const daily = response;
  const hourly = response;

  const sstByDate = new Map<string, number[]>();
  const hourlyTimes = hourly.hourly?.time ?? [];
  const sstValues = Array.isArray(hourly.hourly?.sea_surface_temperature)
    ? (hourly.hourly?.sea_surface_temperature as (number | null)[])
    : [];
  hourlyTimes.forEach((timestamp, index) => {
    const value = sstValues[index];
    if (typeof value !== "number") return;
    const date = timestamp.slice(0, 10);
    sstByDate.set(date, [...(sstByDate.get(date) ?? []), value]);
  });

  const times = daily.daily?.time ?? [];
  const heights = numberSeries(daily.daily, "wave_height_max");
  const periods = numberSeries(daily.daily, "wave_period_max");

  const byDate: Record<string, MarineDaily> = {};
  times.forEach((date, index) => {
    byDate[date] = {
      waveHeightMax: heights[index] ?? null,
      wavePeriodMax: periods[index] ?? null,
      seaSurfaceTemperature: round(mean(sstByDate.get(date) ?? [])),
    };
  });
  return byDate;
}

function hasMarineData(byDate: Record<string, MarineDaily>): boolean {
  return Object.values(byDate).some((day) => day.waveHeightMax !== null);
}

/**
 * Marine models only cover water cells, so a city centroid a few km inland
 * returns nulls. When that happens we probe outward in eight directions and
 * use the nearest cell that actually has a sea state, reporting how far away
 * it is so the plan can name a realistic swim spot.
 */
async function fetchMarineForecast(
  place: GeocodedPlace,
  dates: string[],
): Promise<{ byDate: Record<string, MarineDaily>; source: MarineSource } | null> {
  const window = clampWindow(dates, FORECAST_HORIZON_DAYS);
  if (window.length === 0) return null;

  const direct = await softFetch("marine forecast", () =>
    fetchMarineAt(place, place.timezone, window),
  );
  if (direct && hasMarineData(direct)) {
    return {
      byDate: direct,
      source: { latitude: place.latitude, longitude: place.longitude, distanceKm: 0 },
    };
  }

  const bearings = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  for (const offset of [0.2, 0.45]) {
    const candidates = bearings
      .map(([dLat, dLon]) => ({
        latitude: place.latitude + dLat * offset,
        longitude: place.longitude + dLon * offset,
      }))
      .map((coords) => ({ coords, distanceKm: haversineKm(place, coords) }))
      .filter((candidate) => candidate.distanceKm <= MARINE_SEARCH_MAX_KM)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    const probes = await mapWithConcurrency(candidates, 3, async (candidate) => ({
      ...candidate,
      hasWater: await probeMarineCell(candidate.coords, place.timezone, window[0]),
    }));

    const nearest = probes.find((probe) => probe.hasWater);
    if (!nearest) continue;

    const byDate = await softFetch("marine forecast (offset)", () =>
      fetchMarineAt(nearest.coords, place.timezone, window),
    );
    if (byDate && hasMarineData(byDate)) {
      return {
        byDate,
        source: {
          latitude: nearest.coords.latitude,
          longitude: nearest.coords.longitude,
          distanceKm: round(nearest.distanceKm, 0) ?? 0,
        },
      };
    }
  }

  return null;
}

/** Single-day, single-field request just to learn whether a grid cell is water. */
async function probeMarineCell(
  coords: { latitude: number; longitude: number },
  timezone: string,
  date: string,
): Promise<boolean> {
  const response = await softFetch("marine probe", () =>
    fetchJson<OpenMeteoDailyResponse>(
      buildUrl(MARINE_URL, {
        latitude: coords.latitude,
        longitude: coords.longitude,
        daily: "wave_height_max",
        timezone,
        start_date: date,
        end_date: date,
      }),
      { timeoutMs: 6_000 },
    ),
  );
  return numberSeries(response?.daily, "wave_height_max").some((value) => value !== null);
}

// ---------------------------------------------------------------------------
// Air quality — OpenWeatherMap when a key exists, Open-Meteo otherwise
// ---------------------------------------------------------------------------

/** EPA 2024 PM2.5 and PM10 breakpoints, used to express OpenWeatherMap data as US AQI. */
const AQI_BREAKPOINTS: Record<"pm25" | "pm10", [number, number, number, number][]> = {
  pm25: [
    [0, 9, 0, 50],
    [9.1, 35.4, 51, 100],
    [35.5, 55.4, 101, 150],
    [55.5, 125.4, 151, 200],
    [125.5, 225.4, 201, 300],
    [225.5, 500, 301, 500],
  ],
  pm10: [
    [0, 54, 0, 50],
    [55, 154, 51, 100],
    [155, 254, 101, 150],
    [255, 354, 151, 200],
    [355, 424, 201, 300],
    [425, 604, 301, 500],
  ],
};

function toUsAqi(pollutant: "pm25" | "pm10", concentration: number): number | null {
  if (!Number.isFinite(concentration) || concentration < 0) return null;
  for (const [cLow, cHigh, aqiLow, aqiHigh] of AQI_BREAKPOINTS[pollutant]) {
    if (concentration <= cHigh) {
      const ratio = (concentration - cLow) / (cHigh - cLow);
      return Math.round(aqiLow + ratio * (aqiHigh - aqiLow));
    }
  }
  return 500;
}

interface OpenWeatherAirResponse {
  list?: { dt: number; components?: { pm2_5?: number; pm10?: number } }[];
}

async function fetchOpenWeatherAqi(
  place: GeocodedPlace,
  dates: Set<string>,
): Promise<Record<string, number>> {
  const data = await fetchJson<OpenWeatherAirResponse>(
    buildUrl(OPENWEATHER_AIR_URL, {
      lat: place.latitude,
      lon: place.longitude,
      appid: serverEnv.openWeatherApiKey,
    }),
  );

  const peaks: Record<string, number> = {};
  for (const entry of data.list ?? []) {
    const date = new Date(entry.dt * 1000).toISOString().slice(0, 10);
    if (!dates.has(date)) continue;
    const pm25 = entry.components?.pm2_5;
    const pm10 = entry.components?.pm10;
    const aqi = Math.max(
      typeof pm25 === "number" ? (toUsAqi("pm25", pm25) ?? 0) : 0,
      typeof pm10 === "number" ? (toUsAqi("pm10", pm10) ?? 0) : 0,
    );
    if (aqi > 0) peaks[date] = Math.max(peaks[date] ?? 0, aqi);
  }
  return peaks;
}

async function fetchOpenMeteoAqi(
  place: GeocodedPlace,
  dates: string[],
): Promise<Record<string, number>> {
  const window = clampWindow(dates, AIR_QUALITY_HORIZON_DAYS);
  if (window.length === 0) return {};

  const data = await fetchJson<OpenMeteoHourlyResponse>(
    buildUrl(OPEN_METEO_AIR_URL, {
      latitude: place.latitude,
      longitude: place.longitude,
      hourly: "us_aqi",
      timezone: place.timezone,
      start_date: window[0],
      end_date: window[window.length - 1],
    }),
  );

  const values = Array.isArray(data.hourly?.us_aqi)
    ? (data.hourly?.us_aqi as (number | null)[])
    : [];
  const peaks: Record<string, number> = {};
  (data.hourly?.time ?? []).forEach((timestamp, index) => {
    const value = values[index];
    if (typeof value !== "number") return;
    const date = timestamp.slice(0, 10);
    peaks[date] = Math.max(peaks[date] ?? 0, value);
  });
  return peaks;
}

export interface AirQualityResult {
  byDate: Record<string, number>;
  provider: "openweathermap" | "open-meteo" | "none";
}

async function fetchAirQuality(
  place: GeocodedPlace,
  dates: string[],
): Promise<AirQualityResult> {
  if (serverEnv.openWeatherApiKey) {
    const owm = await softFetch("OpenWeatherMap air pollution", () =>
      fetchOpenWeatherAqi(place, new Set(dates)),
    );
    if (owm && Object.keys(owm).length > 0) {
      return { byDate: owm, provider: "openweathermap" };
    }
  }

  const openMeteo = await softFetch("Open-Meteo air quality", () =>
    fetchOpenMeteoAqi(place, dates),
  );
  if (openMeteo && Object.keys(openMeteo).length > 0) {
    return { byDate: openMeteo, provider: "open-meteo" };
  }

  return { byDate: {}, provider: "none" };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function capRisk(risk: RiskLevel, maxRisk?: RiskLevel): RiskLevel {
  if (!maxRisk || risk === "unknown") return risk;
  const order: RiskLevel[] = ["safe", "caution", "unsafe"];
  return order.indexOf(risk) > order.indexOf(maxRisk) ? maxRisk : risk;
}

export function classifyMetric(rule: ThresholdRule, value: number | null): ConditionMetric {
  const base = {
    key: rule.key,
    label: rule.label,
    proseLabel: rule.proseLabel ?? rule.label.toLowerCase(),
    unit: rule.unit,
  };

  if (value === null) {
    return { ...base, value: null, risk: "unknown", note: "No forecast data for this day." };
  }

  const shown = round(value, rule.unit === "m" || rule.unit === "s" ? 2 : 1) ?? value;
  const measure = (amount: number | string) => formatMeasure(amount, rule.unit);
  let risk: RiskLevel;
  let note: string;

  if (rule.kind === "ceiling") {
    if (value <= rule.safeUpTo) {
      risk = "safe";
      note = `${measure(shown)} — inside the ${measure(rule.safeUpTo)} safe limit.`;
    } else if (value <= rule.cautionUpTo) {
      risk = "caution";
      note = `${measure(shown)} — over the ${measure(rule.safeUpTo)} safe limit but under the ${measure(rule.cautionUpTo)} hard stop.`;
    } else {
      risk = "unsafe";
      note = `${measure(shown)} — past the ${measure(rule.cautionUpTo)} hard stop.`;
    }
  } else if (rule.kind === "floor") {
    if (value >= rule.safeFrom) {
      risk = "safe";
      note = `${measure(shown)} — at or above the ${measure(rule.safeFrom)} comfortable minimum.`;
    } else if (value >= rule.cautionFrom) {
      risk = "caution";
      note = `${measure(shown)} — below the ${measure(rule.safeFrom)} comfortable minimum, expect choppy water.`;
    } else {
      risk = "unsafe";
      note = `${measure(shown)} — under the ${measure(rule.cautionFrom)} floor, short and disorganised.`;
    }
  } else {
    const [safeLow, safeHigh] = rule.safe;
    const [cautionLow, cautionHigh] = rule.caution;
    if (value >= safeLow && value <= safeHigh) {
      risk = "safe";
      note = `${measure(shown)} — inside the ${measure(`${safeLow}–${safeHigh}`)} comfort band.`;
    } else if (value >= cautionLow && value <= cautionHigh) {
      risk = "caution";
      note =
        value < safeLow
          ? `${measure(shown)} — colder than the ${measure(safeLow)} comfort floor.`
          : `${measure(shown)} — hotter than the ${measure(safeHigh)} comfort ceiling.`;
    } else {
      risk = "unsafe";
      note =
        value < cautionLow
          ? `${measure(shown)} — below the ${measure(cautionLow)} tolerable minimum.`
          : `${measure(shown)} — above the ${measure(cautionHigh)} tolerable maximum.`;
    }
  }

  if (rule.key === "airQualityIndex") {
    note = `${shown} AQI (${aqiLabel(value)}) — ${note.slice(note.indexOf("—") + 2)}`;
  }

  return { ...base, value: shown, risk: capRisk(risk, rule.maxRisk), note };
}

function severeWeatherRisk(weatherCode: number | null): {
  risk: RiskLevel;
  note?: string;
} {
  if (weatherCode === null) return { risk: "safe" };
  if (SEVERE_WEATHER_CODES.unsafe.includes(weatherCode)) {
    return {
      risk: "unsafe",
      note: "Thunderstorms or heavy freezing precipitation in the forecast — move the session indoors.",
    };
  }
  if (SEVERE_WEATHER_CODES.caution.includes(weatherCode)) {
    return { risk: "caution", note: "Persistent rain or snow expected — plan for reduced grip and visibility." };
  }
  return { risk: "safe" };
}

function headlineFor(sport: Sport, risk: RiskLevel, metrics: ConditionMetric[]): string {
  const driver = metrics.find((metric) => metric.risk === risk);

  if (risk === "unknown") return "Not enough forecast data yet for a verdict.";
  if (risk === "safe") {
    const wording: Record<Sport, string> = {
      swimming: "Good open-water window",
      running: "Clean air and comfortable running conditions",
      cycling: "Settled riding conditions",
      hiking: "Solid day on the trails",
    };
    return wording[sport];
  }
  const prefix = risk === "unsafe" ? "Skip or replace this session" : "Trainable with adjustments";
  return driver ? `${prefix} — limited by ${driver.proseLabel}.` : prefix;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface ClassifyDayInput {
  date: string;
  sports: Sport[];
  values: Record<string, number | null>;
  weatherCode: number | null;
  marineSource: MarineSource | null;
  airQualityProvider: AirQualityResult["provider"];
}

/**
 * Pure classification step: measurements in, verdicts out. Shared by the live
 * pipeline and the canned demo trip so both obey the same threshold config.
 */
export function classifyDay(input: ClassifyDayInput): DayConditions {
  const { date, sports, values, weatherCode, marineSource, airQualityProvider } = input;
  const severe = severeWeatherRisk(weatherCode);

  const bySport: SportConditions[] = sports.map((sport) => {
    const metrics = SPORT_THRESHOLDS[sport]
      .filter((rule) => {
        // A short wave period is only a hazard once there is swell to speak of.
        if (rule.key !== "wavePeriodMax") return true;
        const height = values.waveHeightMax;
        return height !== null && height >= WAVE_PERIOD_MIN_HEIGHT_M;
      })
      .map((rule) => classifyMetric(rule, values[rule.key] ?? null));

    const dataGap = resolveDataGap(sport, values, marineSource, airQualityProvider);

    // Without a sea state there is no open-water verdict to give, and grading
    // the swim on wind alone would be misleading.
    if (sport === "swimming" && values.waveHeightMax === null) {
      return {
        sport,
        risk: "unknown" as RiskLevel,
        headline: "No open-water sea state available — plan pool or indoor sessions.",
        metrics,
        dataGap,
      };
    }

    const risk = worstRisk([...metrics.map((metric) => metric.risk), severe.risk]);
    const headline =
      severe.note && severe.risk !== "safe" ? severe.note : headlineFor(sport, risk, metrics);

    return { sport, risk, headline, metrics, dataGap };
  });

  return { date, bySport, overallRisk: worstRisk(bySport.map((entry) => entry.risk)) };
}

export interface ConditionsBundle {
  conditions: DayConditions[];
  marineSource: MarineSource | null;
  airQualityProvider: AirQualityResult["provider"];
}

export async function getTripConditions(
  place: GeocodedPlace,
  startDate: string,
  days: number,
  sports: Sport[],
): Promise<ConditionsBundle> {
  const dates = dateRange(startDate, days);
  const needsMarine = sports.some((sport) => MARINE_SPORTS.includes(sport));
  const needsAir = sports.includes("running");

  const [land, marine, air] = await Promise.all([
    softFetch("Open-Meteo forecast", () => fetchLandForecast(place, dates)).then(
      (result) => result ?? {},
    ),
    needsMarine ? fetchMarineForecast(place, dates) : Promise.resolve(null),
    needsAir
      ? fetchAirQuality(place, dates)
      : Promise.resolve<AirQualityResult>({ byDate: {}, provider: "none" }),
  ]);

  const conditions: DayConditions[] = dates.map((date) => {
    const landDay = land[date];
    const marineDay = marine?.byDate[date];

    return classifyDay({
      date,
      sports,
      weatherCode: landDay?.weatherCode ?? null,
      marineSource: marine?.source ?? null,
      airQualityProvider: air.provider,
      values: {
        temperatureMax: landDay?.temperatureMax ?? null,
        apparentTemperatureMax: landDay?.apparentTemperatureMax ?? null,
        precipitationSum: landDay?.precipitationSum ?? null,
        windSpeedMax: landDay?.windSpeedMax ?? null,
        windGustsMax: landDay?.windGustsMax ?? null,
        uvIndexMax: landDay?.uvIndexMax ?? null,
        airQualityIndex: air.byDate[date] ?? null,
        waveHeightMax: marineDay?.waveHeightMax ?? null,
        wavePeriodMax: marineDay?.wavePeriodMax ?? null,
        seaSurfaceTemperature: marineDay?.seaSurfaceTemperature ?? null,
      },
    });
  });

  return {
    conditions,
    marineSource: marine?.source ?? null,
    airQualityProvider: air.provider,
  };
}

function resolveDataGap(
  sport: Sport,
  values: Record<string, number | null>,
  marineSource: MarineSource | null,
  airProvider: AirQualityResult["provider"],
): string | undefined {
  if (sport === "swimming") {
    if (values.waveHeightMax === null) {
      return marineSource
        ? "Marine model has no sea state for this date — treat the swim plan as provisional."
        : "No modelled open water within 60 km, so this is a pool-based plan.";
    }
    if (marineSource && marineSource.distanceKm > 5) {
      return `Sea state sampled from the nearest modelled water ~${marineSource.distanceKm} km away.`;
    }
  }

  if (sport === "running" && values.airQualityIndex === null) {
    return airProvider === "none"
      ? "Air-quality feed unavailable — verify local AQI before hard efforts."
      : "Beyond the air-quality forecast horizon — recheck closer to the date.";
  }

  if (values.temperatureMax === null && values.apparentTemperatureMax === null) {
    return "Beyond the 16-day weather forecast horizon.";
  }

  return undefined;
}

/** Compact, token-cheap conditions digest for the itinerary prompt. */
export function summariseDayForPrompt(day: DayConditions): string {
  const lines = day.bySport.map((sport) => {
    const metrics = sport.metrics
      .filter((metric) => metric.value !== null)
      .map((metric) => `${metric.label} ${formatMeasure(metric.value as number, metric.unit)}`)
      .join(", ");
    const gap = sport.dataGap ? ` [${sport.dataGap}]` : "";
    return `  - ${sport.sport}: ${sport.risk.toUpperCase()} (${metrics || "no data"})${gap}`;
  });
  return `${day.date} — overall ${day.overallRisk.toUpperCase()}\n${lines.join("\n")}`;
}
