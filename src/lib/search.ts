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
/** Keeps prompt size predictable while still giving the model enough to cite. */
const SNIPPET_CHARS = 700;

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
  return `local events, races and things to do near ${destination} around ${formatDayLabel(startDate)}`;
}

export async function getLocalGrounding(
  destination: string,
  startDate: string,
  sports: Sport[],
): Promise<LocalGrounding> {
  const spotQueries = sports.map((sport) => buildSpotQuery(sport, destination));
  const eventsQuery = buildEventsQuery(destination, startDate);
  const queries = [...spotQueries, eventsQuery];

  if (!serverEnv.tavilyApiKey) {
    return { spots: [], events: [], queries, source: "fallback" };
  }

  const client = tavily({ apiKey: serverEnv.tavilyApiKey });

  const search = (query: string, options: Parameters<typeof client.search>[1]) =>
    softFetch(`Tavily search "${query}"`, () =>
      client.search(query, {
        maxResults: MAX_RESULTS_PER_QUERY,
        searchDepth: "basic",
        ...options,
      }),
    );

  const [spotResponses, eventsResponse] = await Promise.all([
    Promise.all(spotQueries.map((query) => search(query, { includeAnswer: "basic" }))),
    search(eventsQuery, { topic: "news", days: 14, includeAnswer: "basic" }),
  ]);

  const spots = dedupeByUrl(
    spotResponses.flatMap((response) => (response?.results ?? []).map(toSearchResult)),
  );
  const events = dedupeByUrl((eventsResponse?.results ?? []).map(toSearchResult));

  const answer = [...spotResponses.map((response) => response?.answer), eventsResponse?.answer]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .slice(0, 1200);

  if (spots.length === 0 && events.length === 0) {
    return { spots: [], events: [], queries, source: "fallback" };
  }

  return { answer: answer || undefined, spots, events, queries, source: "tavily" };
}

/** Renders grounding as the citation block handed to the itinerary model. */
export function groundingForPrompt(grounding: LocalGrounding, sports: Sport[]): string {
  if (grounding.source === "fallback") {
    return [
      "NO LIVE SEARCH RESULTS AVAILABLE.",
      "Do not invent named venues, businesses or events. Describe session types and",
      `general area guidance only for: ${sports.map((sport) => SPORT_LABELS[sport]).join(", ")}.`,
    ].join("\n");
  }

  const render = (label: string, results: SearchResult[]) =>
    results.length === 0
      ? ""
      : `${label}:\n${results
          .map((result, index) => `[${index + 1}] ${result.title} (${result.url})\n${result.content}`)
          .join("\n\n")}`;

  return [
    grounding.answer ? `Search summary: ${grounding.answer}` : "",
    render("TRAINING SPOTS (live web results)", grounding.spots),
    render("LOCAL EVENTS (live news results)", grounding.events),
  ]
    .filter(Boolean)
    .join("\n\n");
}
