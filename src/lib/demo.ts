import { classifyDay } from "@/lib/conditions";
import type { DayPlan, GeocodedPlace, LocalGrounding, Sport, Trip } from "@/lib/types";
import { addDaysIso, todayIso } from "@/lib/utils";

export const DEMO_TRIP_ID = "demo-lisbon";

/**
 * The stage-safe trip. Measurements, search results and itinerary text are all
 * canned, but the safety verdicts still come from `classifyDay`, so the demo
 * cannot drift away from the live threshold config.
 *
 * Day 2 is deliberately a big-swell day: it shows the planner refusing to
 * program an open-water swim and rerouting the athlete instead.
 */

const DEMO_PLACE: GeocodedPlace = {
  name: "Lisbon",
  admin1: "Lisbon District",
  country: "Portugal",
  latitude: 38.72509,
  longitude: -9.1498,
  timezone: "Europe/Lisbon",
};

const DEMO_SPORTS: Sport[] = ["swimming", "running", "cycling"];

const DEMO_MEASUREMENTS = [
  {
    weatherCode: 1,
    values: {
      waveHeightMax: 0.42,
      wavePeriodMax: 8.4,
      seaSurfaceTemperature: 20.1,
      windSpeedMax: 16.2,
      windGustsMax: 28.4,
      airQualityIndex: 38,
      temperatureMax: 26.4,
      apparentTemperatureMax: 25.8,
      precipitationSum: 0,
      uvIndexMax: 7.2,
    },
  },
  {
    weatherCode: 3,
    values: {
      waveHeightMax: 1.9,
      wavePeriodMax: 5.1,
      seaSurfaceTemperature: 19.4,
      windSpeedMax: 34.5,
      windGustsMax: 58.1,
      airQualityIndex: 61,
      temperatureMax: 23.1,
      apparentTemperatureMax: 22.6,
      precipitationSum: 1.2,
      uvIndexMax: 5.8,
    },
  },
  {
    weatherCode: 2,
    values: {
      waveHeightMax: 0.61,
      wavePeriodMax: 9.2,
      seaSurfaceTemperature: 20.6,
      windSpeedMax: 18.9,
      windGustsMax: 31.0,
      airQualityIndex: 112,
      temperatureMax: 29.7,
      apparentTemperatureMax: 30.4,
      precipitationSum: 0,
      uvIndexMax: 8.1,
    },
  },
];

const DEMO_GROUNDING: LocalGrounding = {
  answer:
    "Carcavelos and Praia de Carcavelos are the most accessible Atlantic beaches from central Lisbon by train, with lifeguard cover through summer. Runners use the Tagus riverside path from Cais do Sodré to Belém for flat, traffic-free kilometres, while Monsanto Forest Park offers shaded trails and climbs. Cyclists head west along the Estoril coastal cycleway toward Cascais.",
  spots: [
    {
      title: "Praia de Carcavelos — Lisbon's most accessible Atlantic beach",
      url: "https://www.visitlisboa.com/en/places/praia-de-carcavelos",
      content:
        "Carcavelos is the largest beach on the Lisbon coast, roughly 25 minutes by train from Cais do Sodré on the Cascais line. Lifeguards are on duty through the summer season and the eastern end near the fort is the most sheltered from prevailing northwesterly swell, which makes it the usual choice for open-water swim groups.",
      score: 0.94,
    },
    {
      title: "Running the Tagus riverside: Cais do Sodré to Belém",
      url: "https://www.timeout.com/lisbon/things-to-do/running-in-lisbon",
      content:
        "The riverside path from Cais do Sodré past Doca de Santo Amaro to the Belém Tower is flat, car-free and about 6 km one way, making a natural 12 km out-and-back. There is little shade, so locals run it early. Water fountains are limited — carry your own.",
      score: 0.91,
    },
    {
      title: "Monsanto Forest Park trails",
      url: "https://www.lisboa.pt/en/city/environment/monsanto-forest-park",
      content:
        "Monsanto is Lisbon's largest green space, with shaded singletrack and fire roads and around 200 m of elevation. The Alto da Serafina and Montes Claros entrances connect to loops of 5–12 km, and the tree cover keeps it noticeably cooler than the riverside on hot days.",
      score: 0.88,
    },
    {
      title: "Estoril coastal cycleway to Cascais",
      url: "https://www.cascais.pt/en/mobility/cycling",
      content:
        "The Marginal cycleway runs largely traffic-separated from Oeiras through Estoril to Cascais, about 20 km of flat coastal riding with rental stations at both ends. Exposed to the afternoon nortada wind, so most riders go out west in the morning and return with a tailwind.",
      score: 0.86,
    },
  ],
  events: [
    {
      title: "Time Out Market late-night tastings return this week",
      url: "https://www.timeout.com/lisbon/news/time-out-market-lisboa",
      content:
        "Time Out Market in Cais do Sodré is running extended evening hours with chef tasting counters, a five-minute walk from the riverside running path — a practical post-session refuel stop.",
      score: 0.79,
    },
    {
      title: "Sunset sardine festival in Alfama this weekend",
      url: "https://www.visitlisboa.com/en/events/alfama-festival",
      content:
        "Alfama's neighbourhood squares host grilled sardines, live fado and street decorations from early evening. Streets are steep and cobbled, so it doubles as a gentle active-recovery walk.",
      score: 0.74,
    },
  ],
  queries: [
    "best open water swimming spots and beaches in Lisbon this week",
    "best running routes and trails in Lisbon this week",
    "best road cycling routes and bike rental in Lisbon this week",
    "local events, races and things to do near Lisbon",
  ],
  source: "tavily",
};

const DEMO_PLAN_TEXT: Omit<DayPlan, "date">[] = [
  {
    title: "Atlantic reset at Carcavelos",
    morning:
      "Take the Cascais-line train from Cais do Sodré out to Praia de Carcavelos for a 35–40 minute open-water swim at the sheltered eastern end near the fort. At 0.42 m of swell with an 8.4 second period the water is about as organised as the Atlantic gets here, so this is the day to do your longest continuous swim of the trip. Sight every six strokes and stay inside the lifeguarded flags.",
    midday:
      "Train back and eat properly at Time Out Market in Cais do Sodré, five minutes from the riverside path. Then keep it genuinely easy — legs up, rehydrate, and save the walking for tomorrow when the water is off the table.",
    evening:
      "Short shakeout on the riverside promenade toward Doca de Santo Amaro, then an early night: tomorrow's swell arrives before dawn and you'll want the morning for a run instead.",
    safetyNote:
      "Wave height 0.42 m and sea temperature 20.1 °C both sit inside the safe band — the best swim window of your three days.",
    citedPlaces: ["Praia de Carcavelos", "Time Out Market", "Doca de Santo Amaro"],
  },
  {
    title: "Swell day — Monsanto instead of the sea",
    morning:
      "The swim is off: 1.9 m waves on a 5.1 second period is disorganised, dumping shorebreak, and gusts to 58 km/h make the coast road a bad place to ride too. Head inland to Monsanto Forest Park instead and run 50 minutes on the shaded fire roads from the Alto da Serafina entrance, where the tree cover blocks most of the wind.",
    midday:
      "If you need water work, swap to a pool session — 8 × 100 m holding an even effort keeps your feel for the water without fighting the shorebreak. Otherwise eat, then wander Alfama's cobbled squares, where the sardine festival is setting up for the evening.",
    evening:
      "Stay for the grilled sardines and fado in Alfama. The climbs back up through the neighbourhood count as active recovery, and the swell should drop overnight.",
    safetyNote:
      "Wave height 1.9 m is past the 1.2 m hard stop and gusts of 58 km/h exceed the 55 km/h cycling limit — both outdoor water and road sessions are off.",
    citedPlaces: ["Monsanto Forest Park", "Alto da Serafina", "Alfama"],
  },
  {
    title: "Early coast ride before the air turns",
    morning:
      "Start at first light and ride the Marginal cycleway west from Oeiras through Estoril to Cascais, roughly 20 km each way on traffic-separated road. Go out early: the nortada builds through the afternoon, so you want the tailwind on the way home. Swell is back down to 0.61 m if you'd rather finish with a short swim at Carcavelos on the way past.",
    midday:
      "Air quality peaks at 112 AQI today, which is the day's real limiter, so skip the planned riverside tempo run and keep any second session indoors and easy. Refuel and spend the hot hours somewhere air-conditioned rather than on the exposed Belém path.",
    evening:
      "Last night — eat well near Cais do Sodré and pack wet kit last so it has the longest possible time to dry.",
    safetyNote:
      "AQI 112 is over the 100 safe limit for running, so hard efforts move indoors; the ride stays on because gusts are back to 31 km/h.",
    citedPlaces: ["Estoril coastal cycleway", "Cascais", "Praia de Carcavelos", "Belém"],
  },
];

/**
 * Pre-rendered narration, if it has been baked in with `npm run demo:audio`.
 * The audio route falls back to a live ElevenLabs call when these are absent.
 */
const DEMO_AUDIO_FILES = ["/audio/demo-lisbon-day-1.mp3", "/audio/demo-lisbon-day-2.mp3", "/audio/demo-lisbon-day-3.mp3"];

export function buildDemoTrip(startDate = todayIso()): Trip {
  const dates = DEMO_MEASUREMENTS.map((_, index) => addDaysIso(startDate, index));

  const conditions = DEMO_MEASUREMENTS.map((measurement, index) =>
    classifyDay({
      date: dates[index],
      sports: DEMO_SPORTS,
      values: measurement.values,
      weatherCode: measurement.weatherCode,
      marineSource: { latitude: 38.68, longitude: -9.34, distanceKm: 18 },
      airQualityProvider: "open-meteo",
    }),
  );

  const plans: DayPlan[] = DEMO_PLAN_TEXT.map((plan, index) => ({
    ...plan,
    date: dates[index],
  }));

  const demoAudioByDate = Object.fromEntries(
    dates.map((date, index) => [date, DEMO_AUDIO_FILES[index]]),
  );

  return {
    id: DEMO_TRIP_ID,
    createdAt: new Date().toISOString(),
    input: {
      destination: "Lisbon",
      startDate: dates[0],
      days: dates.length,
      sports: DEMO_SPORTS,
    },
    place: DEMO_PLACE,
    conditions,
    grounding: DEMO_GROUNDING,
    plans,
    isDemo: true,
    demoAudioByDate,
    itinerarySource: "llm",
  };
}
