import { tavily } from "@tavily/core";

import { serverEnv } from "@/lib/env";
import { softFetch } from "@/lib/http";
import { SPORT_LABELS, type LocalGrounding, type SearchResult, type Sport } from "@/lib/types";
import { formatDayLabel } from "@/lib/utils";

/**
 * Tavily gives the itinerary model real, current places to work with. Without
 * it the LLM invents plausible-sounding beaches and running loops, which is the
 * exact failure mode this app exists to avoid.
 */

const MAX_RESULTS_PER_QUERY = 4;
/** Keeps prompt size predictable while still naming enough real venues to use. */
const SNIPPET_CHARS = 700;

/**
 * Forums and social threads do describe good local spots, but the venue names
 * arrive tangled up with the thread they came from, and the model then writes
 * things like "a spot recommended on r/OpenWaterSwimming". We want the place,
 * not the conversation about the place.
 */
const EXCLUDED_DOMAINS = [
  "reddit.com",
  "quora.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "pinterest.com",
  "youtube.com",
];

function toSearchResult(result: {
  title: string;
  url: string;
  content: string;
  score?: number;
}): SearchResult {
  return {
    title: result.title,
    url: result.url,
    content: result.content.slice(0, SNIPPET_CHARS),
    score: result.score,
  };
}

function dedupeByUrl(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    if (seen.has(result.url)) return false;
    seen.add(result.url);
    return true;
  });
}

export function buildSpotQuery(sport: Sport, destination: string): string {
  const phrasing: Record<Sport, string> = {
    swimming: `best open water swimming spots and beaches in ${destination}`,
    running: `best running routes and trails in ${destination}`,
    cycling: `best road cycling routes and bike rental in ${destination}`,
    hiking: `best hiking trails and day hikes near ${destination}`,
  };
  return `${phrasing[sport]} this week`;
}

export function buildEventsQuery(destination: string, startDate: string): string {
  return `local events and things to do in ${destination} on ${formatDayLabel(startDate)}`;
}

/**
 * Transport is the difference between "swim at Carcavelos" and a plan you can
 * follow. Without grounding the model invents plausible train lines, so the
 * named services have to come from somewhere real.
 */
export function buildTransportQuery(destination: string, anchorLabel?: string): string {
  const target = anchorLabel ? ` and how to reach ${anchorLabel}` : "";
  return `${destination} public transport getting around: metro, train, bus, bike hire${target}`;
}

export async function getLocalGrounding(
  destination: string,
  startDate: string,
  sports: Sport[],
): Promise<LocalGrounding> {
  const spotQueries = sports.map((sport) => buildSpotQuery(sport, destination));
  const eventsQuery = buildEventsQuery(destination, startDate);
  const transportQuery = buildTransportQuery(destination);
  const queries = [...spotQueries, eventsQuery, transportQuery];

  if (!serverEnv.tavilyApiKey) {
    return { spots: [], events: [], transport: [], queries, source: "fallback" };
  }

  const client = tavily({ apiKey: serverEnv.tavilyApiKey });

  const search = (query: string, options: Parameters<typeof client.search>[1]) =>
    softFetch(`Tavily search "${query}"`, () =>
      client.search(query, {
        maxResults: MAX_RESULTS_PER_QUERY,
        searchDepth: "basic",
        excludeDomains: EXCLUDED_DOMAINS,
        ...options,
      }),
    );

  const [spotResponses, eventsResponse, transportResponse] = await Promise.all([
    Promise.all(spotQueries.map((query) => search(query, { includeAnswer: "basic" }))),
    // Not `topic: "news"`: the word "events" plus a date reads as current
    // affairs to a news index, which returned US election coverage for a query
    // about Lisbon. General search finds the event listings we actually want.
    search(eventsQuery, { includeAnswer: "basic" }),
    search(transportQuery, { includeAnswer: "basic" }),
  ]);

  const spots = dedupeByUrl(
    spotResponses.flatMap((response) => (response?.results ?? []).map(toSearchResult)),
  );
  const events = dedupeByUrl((eventsResponse?.results ?? []).map(toSearchResult));
  const transport = dedupeByUrl((transportResponse?.results ?? []).map(toSearchResult));

  const answer = [
    ...spotResponses.map((response) => response?.answer),
    eventsResponse?.answer,
    transportResponse?.answer,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .slice(0, 1400);

  if (spots.length === 0 && events.length === 0 && transport.length === 0) {
    return { spots: [], events: [], transport: [], queries, source: "fallback" };
  }

  return { answer: answer || undefined, spots, events, transport, queries, source: "tavily" };
}

const SOURCE_SEGMENT =
  /^(r\/|reddit|tripadvisor|komoot|alltrails|strava|wikipedia|time out|lonely planet|the guardian|medium)|\.(com|net|org|io|co|pt|es|fr)\b/i;
/**
 * Headlines and questions describe a place without being one, and so do the
 * aggregator pages a date-scoped search returns — "Lisbon, Portugal Events,
 * Calendar & Tickets" is a directory, not something to go and do.
 */
const NOT_A_PLACE_NAME =
  /^\d|\b(best|top|ultimate|guide|guides|things to do|where to|how to|complete|itinerary|tips|everything|reviews?|events?|calendar|tickets?|listings?|directory|schedule|agenda|what'?s on)\b|\?/i;
/** Untitled pages and site landing pages carry no name worth reading out. */
const PLACEHOLDER_TITLE = /^(untitled|home|homepage|index|welcome|page not found)\b/i;

/**
 * A proper name is short. Past about six words a title is a sentence describing
 * a place rather than the place's name.
 */
const MAX_NAME_WORDS = 6;
/**
 * Function words are the giveaway that a title is prose: "The most beautiful
 * running routes in Lisbon" reads as a headline, "Praia de Carcavelos" as a
 * name. Romance-language particles are excluded because they appear inside
 * genuine place names.
 */
const PROSE_WORDS =
  /\b(the|a|an|and|or|but|in|on|at|to|for|from|with|by|as|of|your|you|our|we|is|are|was|get|gets|go|see|find|visit|know|about|why|what|when|which|how|most|more|than|there|here|near|around|this|that|these|those)\b/i;

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Some titles simply repeat the site name: "Swim Society Swim Society". */
function collapseRepeat(value: string): string {
  return value.replace(/^(.+?)[\s,–—-]+\1$/i, "$1").trim();
}

/** The site's own name, so a title that is just the publisher can be spotted. */
function brandOfHost(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return normalise(host.split(".").slice(0, -1).join(""));
  } catch {
    return "";
  }
}

/**
 * Extracts a place *name* from a search result, or nothing at all.
 *
 * Titles are mostly not names: "Where to swim in Lisbon : r/OpenWaterSwimming",
 * "10 Best Beaches | Time Out", "The most beautiful running routes in Lisbon".
 * A subreddit, a publisher and a headline are all things you cannot go running
 * at, so this is deliberately strict and returns undefined far more often than
 * not — the rule-based itinerary reads better staying generic than naming a
 * headline, and the LLM path names places by reading content rather than titles.
 */
export function placeNameFromResult(result: SearchResult): string | undefined {
  const candidate = collapseRepeat(
    result.title
      .split(/\s+[|:–—-]\s+/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 2 && !SOURCE_SEGMENT.test(segment))
      .sort((a, b) => b.length - a.length)[0] ?? "",
  );

  if (!candidate || PLACEHOLDER_TITLE.test(candidate)) return undefined;
  if (NOT_A_PLACE_NAME.test(candidate) || PROSE_WORDS.test(candidate)) return undefined;
  if (candidate.split(/\s+/).length > MAX_NAME_WORDS) return undefined;

  // A title that is just the site's own name is an organisation, not somewhere
  // you can train — "Outdoor Swimming Society" on outdoorswimmingsociety.com.
  const brand = brandOfHost(result.url);
  const key = normalise(candidate);
  if (brand.length >= 5 && (brand.includes(key) || key.includes(brand))) return undefined;

  return candidate;
}

/** Renders grounding as the citation block handed to the itinerary model. */
export function groundingForPrompt(grounding: LocalGrounding, sports: Sport[]): string {
  if (grounding.source === "fallback") {
    return [
      "NO LIVE SEARCH RESULTS AVAILABLE.",
      "Do not invent named venues, businesses, events, transit lines or stations.",
      "Describe session types, general area guidance and travel in generic terms",
      `(walk, taxi, local train) only for: ${sports.map((sport) => SPORT_LABELS[sport]).join(", ")}.`,
    ].join("\n");
  }

  // URLs are deliberately withheld: the model only needs the facts, and given a
  // link it starts attributing ("a spot recommended on ...") instead of planning.
  const render = (label: string, results: SearchResult[]) =>
    results.length === 0
      ? ""
      : `${label}:\n${results
          .map((result) => `- ${result.title}\n${result.content}`)
          .join("\n\n")}`;

  return [
    grounding.answer ? `Search summary: ${grounding.answer}` : "",
    render("TRAINING SPOTS (live web results)", grounding.spots),
    render("LOCAL EVENTS (live web results)", grounding.events),
    render("LOCAL TRANSPORT (live web results — the only source for line and station names)", grounding.transport),
  ]
    .filter(Boolean)
    .join("\n\n");
}
