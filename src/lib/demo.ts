import { classifyDay, type MarineSource } from "@/lib/conditions";
import { buildAllezLink } from "@/lib/lodging";
import { sortByPrice } from "@/lib/stay22";
import type {
  DayPlan,
  GeocodedPlace,
  LocalGrounding,
  LodgingOption,
  Sport,
  TrainingAnchor,
  Trip,
} from "@/lib/types";
import { addDaysIso, haversineKm, todayIso } from "@/lib/utils";

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
  transport: [
    {
      title: "Cascais line: Cais do Sodré to Carcavelos",
      url: "https://www.cp.pt/passageiros/en/train-times/urban/lisbon/cascais",
      content:
        "Trains run from Cais do Sodré along the coast to Cascais every 12–20 minutes from around 05:30 to 01:30, reaching Carcavelos in roughly 25 minutes. The station is a 700 m walk from the beach. A Viva Viagem card covers the fare and can be topped up at any station machine.",
      score: 0.93,
    },
    {
      title: "Getting around Lisbon: metro, tram and bike hire",
      url: "https://www.visitlisboa.com/en/practical-information/getting-around",
      content:
        "The metro covers the city centre and connects to the Cais do Sodré and Santa Apolónia rail terminals. GIRA docked bikes are widely available along the riverside, with docking stations at Cais do Sodré, Doca de Santo Amaro and Belém, which makes the flat riverside path easy to reach without a car.",
      score: 0.87,
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
    "local events and things to do in Lisbon",
    "Lisbon public transport getting around: metro, train, bus, bike hire",
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
    travel:
      "Cascais-line train from Cais do Sodré to Carcavelos: about 25 minutes, every 12–20 minutes, then a 700 m walk to the sand. Top up a Viva Viagem card at the station machine and leave by 07:30 to be in the water before the wind builds. Same line back, running until well after midnight, so the return is never tight.",
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
    travel:
      "No coast trip today — stay in the city. Metro to Alto da Serafina or a 20 minute taxi gets you to the Monsanto entrance; on the way home the metro connects straight back to the centre for Alfama in the evening. Nothing today needs the train.",
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
    travel:
      "Ride out from the door if you are staying on the coast; otherwise take the first Cascais-line train to Oeiras with the bike and start there, about 20 minutes. Trains take bikes outside peak hours, so be on one before 07:00 or after 09:30 — and if the nortada beats you home, the train back from Cascais is the honest option.",
    safetyNote:
      "AQI 112 is over the 100 safe limit for running, so hard efforts move indoors; the ride stays on because gusts are back to 31 km/h.",
    citedPlaces: ["Estoril coastal cycleway", "Cascais", "Praia de Carcavelos", "Belém"],
  },
];

/**
 * Canned accommodation for the sample trip. These are real properties, but the
 * booking links go through Allez `roam`, which resolves them by name — so the
 * demo never navigates to a hand-written OTA URL that might have rotted.
 */
const DEMO_LODGING: {
  name: string;
  search: string;
  provider: string;
  address: string;
  snippet: string;
  rating: { value: number; count: number; stars: number };
  nightlyTotal: number;
  /** Distances are measured from the swim spot, exactly as the live path does. */
  latitude: number;
  longitude: number;
}[] = [
  {
    name: "Hotel Praia Mar",
    search: "Hotel Praia Mar Carcavelos",
    provider: "Booking.com",
    address: "Rua do Gurué 16, Carcavelos, Portugal",
    snippet:
      "Beachfront in Carcavelos with a rooftop pool, two minutes to the sand and ten from the Cascais-line station — the shortest possible commute to the swim.",
    rating: { value: 8.4, count: 1863, stars: 4 },
    nightlyTotal: 402,
    latitude: 38.6805,
    longitude: -9.3378,
  },
  {
    name: "Riviera Hotel",
    search: "Riviera Hotel Carcavelos Portugal",
    provider: "Expedia",
    address: "Rua Bartolomeu Dias 22, Carcavelos, Portugal",
    snippet:
      "Quiet Carcavelos hotel a short walk from the sheltered eastern end of the beach, with secure parking and somewhere to rinse and dry a wetsuit.",
    rating: { value: 8.0, count: 942, stars: 4 },
    nightlyTotal: 351,
    latitude: 38.6795,
    longitude: -9.3323,
  },
  {
    name: "Vila Galé Estoril",
    search: "Vila Gale Estoril hotel",
    provider: "Hotels.com",
    address: "Avenida Marginal, Estoril, Portugal",
    snippet:
      "On the Estoril seafront beside the Marginal cycleway, which turns the 20 km coastal ride to Cascais into a ride-out-the-door affair.",
    rating: { value: 8.6, count: 2571, stars: 4 },
    nightlyTotal: 528,
    latitude: 38.7053,
    longitude: -9.396,
  },
  {
    name: "Pestana Palace Lisboa",
    search: "Pestana Palace Lisboa",
    provider: "Booking.com",
    address: "Rua Jau 54, Lisbon, Portugal",
    snippet:
      "Garden hotel in Alcântara, close to both the Tagus riverside running path and the Monsanto trail entrances, with a 25 m outdoor pool.",
    rating: { value: 9.1, count: 3104, stars: 5 },
    nightlyTotal: 861,
    latitude: 38.705,
    longitude: -9.1834,
  },
  {
    name: "Lisboa Central Hostel",
    search: "Lisboa Central Hostel",
    provider: "Expedia",
    address: "Rua Rodrigues Sampaio 160, Lisbon, Portugal",
    snippet:
      "Cheapest bed of the five and walking distance to the riverside running path, but the furthest from the water — the swim becomes a train ride each way.",
    rating: { value: 9.2, count: 2273, stars: 0 },
    nightlyTotal: 84,
    latitude: 38.723,
    longitude: -9.147,
  },
];

/**
 * Pre-rendered narration, if it has been baked in with `npm run demo:audio`.
 * The audio route falls back to a live ElevenLabs call when these are absent.
 */
const DEMO_AUDIO_FILES = ["/audio/demo-lisbon-day-1.mp3", "/audio/demo-lisbon-day-2.mp3", "/audio/demo-lisbon-day-3.mp3"];

/** Carcavelos, where a Lisbon open-water swim actually happens. */
const DEMO_MARINE_SOURCE: MarineSource = { latitude: 38.68, longitude: -9.34, distanceKm: 18 };

/**
 * Canned training anchor matching what the live resolver produces for Lisbon
 * swimming: the named beach, not the city centroid. Kept sync so the demo trip
 * never depends on a geocoding round-trip.
 */
const DEMO_ANCHOR: TrainingAnchor = {
  latitude: DEMO_MARINE_SOURCE.latitude,
  longitude: DEMO_MARINE_SOURCE.longitude,
  kind: "training-spot",
  label: "Praia de Carcavelos",
  note: "Your main training spot is Praia de Carcavelos, about 18 km west of Lisbon centre — stays are searched and measured from there, not from the city centre.",
  distanceFromCentreKm: 18,
};

export function buildDemoTrip(startDate = todayIso()): Trip {
  const dates = DEMO_MEASUREMENTS.map((_, index) => addDaysIso(startDate, index));

  const conditions = DEMO_MEASUREMENTS.map((measurement, index) =>
    classifyDay({
      date: dates[index],
      sports: DEMO_SPORTS,
      values: measurement.values,
      weatherCode: measurement.weatherCode,
      marineSource: DEMO_MARINE_SOURCE,
      airQualityProvider: "open-meteo",
    }),
  );

  const anchor = DEMO_ANCHOR;

  const plans: DayPlan[] = DEMO_PLAN_TEXT.map((plan, index) => ({
    ...plan,
    date: dates[index],
  }));

  const demoAudioByDate = Object.fromEntries(
    dates.map((date, index) => [date, DEMO_AUDIO_FILES[index]]),
  );

  const checkOut = addDaysIso(dates[0], dates.length);
  const lodging: LodgingOption[] = sortByPrice(
    DEMO_LODGING.map((entry) => ({
      id: entry.search,
      name: entry.name,
      provider: entry.provider,
      source: "stay22" as const,
      address: entry.address,
      snippet: entry.snippet,
      rating: entry.rating,
      price: { total: entry.nightlyTotal, currency: "EUR", nights: dates.length },
      distanceMeters: Math.round(haversineKm(anchor, entry) * 1000),
      // Resolved by name through Allez roam, so no hand-written OTA URL can rot.
      bookingUrl: buildAllezLink({
        name: entry.search,
        sourceUrl: "",
        provider: "roam",
        origin: anchor,
        checkIn: dates[0],
        checkOut,
      }),
    })),
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
    lodging,
    anchor,
    isDemo: true,
    demoAudioByDate,
    itinerarySource: "llm",
  };
}
