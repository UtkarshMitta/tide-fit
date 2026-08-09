export const SPORTS = ["swimming", "running", "cycling", "hiking"] as const;

export type Sport = (typeof SPORTS)[number];

export const SPORT_LABELS: Record<Sport, string> = {
  swimming: "Open-water swimming",
  running: "Running",
  cycling: "Cycling",
  hiking: "Hiking",
};

export const RISK_LEVELS = ["safe", "caution", "unsafe", "unknown"] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

export interface GeocodedPlace {
  name: string;
  country: string;
  /** ISO 3166-1 alpha-2, used to price lodging in the local currency. */
  countryCode?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

/**
 * A single measured value that fed into a risk classification. Kept alongside
 * the verdict so the UI and the LLM prompt can both explain *why* a day was
 * flagged instead of asserting an unexplained badge.
 */
export interface ConditionMetric {
  key: string;
  label: string;
  /** Lowercase-safe variant of `label` for use inside sentences. */
  proseLabel: string;
  value: number | null;
  unit: string;
  risk: RiskLevel;
  note: string;
}

export interface SportConditions {
  sport: Sport;
  risk: RiskLevel;
  headline: string;
  metrics: ConditionMetric[];
  /** Set when the upstream feed could not answer for this place (e.g. marine data inland). */
  dataGap?: string;
}

export interface DayConditions {
  /** ISO date, `yyyy-MM-dd`. */
  date: string;
  bySport: SportConditions[];
  /** Worst risk across the traveler's selected sports. */
  overallRisk: RiskLevel;
}

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface LocalGrounding {
  /** Tavily's own synthesized answer, when available. */
  answer?: string;
  spots: SearchResult[];
  events: SearchResult[];
  /** How to get around locally, so travel advice cites real lines and services. */
  transport: SearchResult[];
  queries: string[];
  source: "tavily" | "fallback";
}

/**
 * The point a trip is organised around: where the training actually happens.
 *
 * Lodging is searched and measured from here, not the city centroid. A
 * `training-spot` is a real session location (named beach, trailhead, or the
 * nearest modelled open water). `centre` is the honest fallback when no fixed
 * spot can be resolved — inland swimming with no open water, or land sports
 * whose routes start from wherever you sleep.
 */
export interface TrainingAnchor {
  latitude: number;
  longitude: number;
  kind: "training-spot" | "centre";
  /** Short phrase for column labels: "Praia de Carcavelos", "Lisbon centre". */
  label: string;
  /** Full explanation of why distances are measured from here. */
  note: string;
  distanceFromCentreKm: number;
}

export interface LodgingOption {
  id: string;
  name: string;
  /** Stay22 Allez link, so a booking is attributed to our affiliate id. */
  bookingUrl: string;
  /** The OTA the booking link routes to, or the host a fallback result came from. */
  provider: string;
  /**
   * `stay22` results carry live prices and ratings from the Accommodations API.
   * `tavily` results are the keyless fallback: a real property page, no pricing.
   */
  source: "stay22" | "tavily";
  address?: string;
  thumbnail?: string;
  rating?: { value: number; count?: number; stars?: number };
  price?: { total: number; currency: string; nights: number };
  distanceMeters?: number;
  snippet?: string;
  sourceUrl?: string;
}

export interface DayPlan {
  date: string;
  title: string;
  morning: string;
  midday: string;
  evening: string;
  safetyNote: string;
  /**
   * Getting to the session: mode of transport, rough duration, and what to
   * leave with. Optional so trips saved before this existed still load.
   */
  travel?: string;
  /** Places the model pulled from grounded search results, for citation in the UI. */
  citedPlaces: string[];
}

export interface TrainingLoad {
  source: "strava" | "none";
  weeklyDistanceKm: number;
  weeklyMovingHours: number;
  activityCount: number;
  hardDays: number;
  summary: string;
}

export interface TripInput {
  destination: string;
  startDate: string;
  days: number;
  sports: Sport[];
}

export interface Trip {
  id: string;
  createdAt: string;
  input: TripInput;
  place: GeocodedPlace;
  conditions: DayConditions[];
  grounding: LocalGrounding;
  plans: DayPlan[];
  /** Optional so trips saved before lodging search existed still load. */
  lodging?: LodgingOption[];
  /** The point lodging distances are measured from. */
  anchor?: TrainingAnchor;
  /** Affiliate id read back from Stay22's API, so the map widget matches the booking links. */
  stay22Aid?: string;
  trainingLoad?: TrainingLoad;
  /** Present for the canned demo trip so the stage demo never depends on live APIs. */
  isDemo?: boolean;
  /** Static audio path used by the demo trip instead of a live ElevenLabs call. */
  demoAudioByDate?: Record<string, string>;
  itinerarySource: "llm" | "fallback";
}

export const RISK_ORDER: Record<RiskLevel, number> = {
  safe: 0,
  unknown: 1,
  caution: 2,
  unsafe: 3,
};

export function worstRisk(risks: RiskLevel[]): RiskLevel {
  if (risks.length === 0) return "unknown";
  return risks.reduce((worst, next) =>
    RISK_ORDER[next] > RISK_ORDER[worst] ? next : worst,
  );
}
