import OpenAI from "openai";
import { z } from "zod";

import { summariseDayForPrompt } from "@/lib/conditions";
import { serverEnv } from "@/lib/env";
import { groundingForPrompt, placeNameFromResult } from "@/lib/search";
import {
  SPORT_LABELS,
  type DayConditions,
  type DayPlan,
  type GeocodedPlace,
  type LocalGrounding,
  type Sport,
  type TrainingAnchor,
  type TrainingLoad,
} from "@/lib/types";
import { formatDayLabel, titleCase, travelEstimate } from "@/lib/utils";

const SYSTEM_PROMPT = `You are a multi-sport trip planner for travelling athletes (swimmers, runners, cyclists, hikers).

For each day you are given: classified safety conditions per sport (SAFE / CAUTION / UNSAFE with the measured values behind the verdict), live web search results about the destination including local transport, where the training actually happens, and optionally the traveller's recent training load.

Rules you must follow:
1. Only name venues, routes, beaches, trails, businesses or events that appear in the provided search results. If the results do not cover something, describe the session generically ("a flat riverside loop") rather than inventing a name.
2. Respect the safety classification. Never program an outdoor session for a sport marked UNSAFE that day: move it indoors, swap the sport, or make it a recovery day, and say why using the measured value.
3. For CAUTION days, keep the session but adapt it (shorter, earlier, sheltered, lower intensity) and state the specific adaptation.
4. Reference the actual numbers you were given (wave height, AQI, gusts, feels-like temperature) rather than vague claims about the weather.
5. If training load is provided, respect it: insert genuine recovery after a heavy block, and do not stack hard days.
6. Name the place, never the source. Do not mention websites, publications, forums, subreddits, blogs or "according to" attributions — the traveller wants the beach, not the page it was found on.
7. Every day needs concrete travel logistics in the "travel" field: the mode of transport (walk, metro, suburban train, bus, tram, ferry, bike, taxi or car), a realistic door-to-door duration, and what time to leave to make the session. Name specific lines, stations or stops ONLY when they appear in the LOCAL TRANSPORT results; otherwise say "a local train" or "a 15 minute taxi" rather than inventing a line. If the session is walkable, say so and give the walking time. Mention the return leg when it is awkward (last service, one-way wind, a climb home).
8. Write for an athlete: concrete, warm, and practical. No hype, no emoji, no markdown formatting.

Return JSON only, matching this shape exactly:
{"days":[{"date":"YYYY-MM-DD","title":"short evocative day title","morning":"2-3 sentences: the training session, where, and the safety-driven adjustment","travel":"1-2 sentences: mode of transport, door-to-door duration, and when to leave","midday":"2-3 sentences: recovery plus a real local experience from the search results","evening":"1-2 sentences: food, recovery, and what to prep for tomorrow","safetyNote":"one sentence citing the limiting measurement","citedPlaces":["names of real places you used from the search results"]}]}`;

const DayPlanSchema = z.object({
  date: z.string(),
  title: z.string(),
  morning: z.string(),
  midday: z.string(),
  evening: z.string(),
  travel: z.string().optional().default(""),
  safetyNote: z.string().optional().default(""),
  citedPlaces: z.array(z.string()).optional().default([]),
});

const ItinerarySchema = z.object({ days: z.array(DayPlanSchema).min(1) });

export interface ItineraryRequest {
  place: GeocodedPlace;
  destinationLabel: string;
  sports: Sport[];
  /** Where the training happens, which is what the travel advice has to solve. */
  anchor: TrainingAnchor;
  conditions: DayConditions[];
  grounding: LocalGrounding;
  trainingLoad?: TrainingLoad;
}

export interface ItineraryResult {
  plans: DayPlan[];
  source: "llm" | "fallback";
}

export function buildUserPrompt(request: ItineraryRequest): string {
  const { destinationLabel, sports, anchor, conditions, grounding, trainingLoad } = request;

  return [
    `Destination: ${destinationLabel}`,
    `Sports in focus: ${sports.map((sport) => SPORT_LABELS[sport]).join(", ")}`,
    anchor.kind === "swim-spot"
      ? `Where the swim happens: open water roughly ${anchor.distanceFromCentreKm} km from ${destinationLabel} centre, so the day involves getting out there and back.`
      : `No single fixed training location — sessions start from wherever the traveller is staying in ${destinationLabel}.`,
    `Trip dates: ${conditions[0]?.date} to ${conditions[conditions.length - 1]?.date} (${conditions.length} days)`,
    trainingLoad && trainingLoad.source === "strava"
      ? `Recent training load (last 7 days, from Strava): ${trainingLoad.summary}`
      : "Recent training load: unknown, assume a moderately trained recreational athlete.",
    "",
    "DAILY CONDITIONS (classified by TideFit's threshold config):",
    conditions.map(summariseDayForPrompt).join("\n"),
    "",
    groundingForPrompt(grounding, sports),
    "",
    `Write one entry per day, in order, for all ${conditions.length} days.`,
  ].join("\n");
}

export async function generateItinerary(request: ItineraryRequest): Promise<ItineraryResult> {
  if (!serverEnv.openAiApiKey) {
    return { plans: buildFallbackPlans(request), source: "fallback" };
  }

  try {
    const client = new OpenAI({ apiKey: serverEnv.openAiApiKey, timeout: 60_000, maxRetries: 1 });
    const completion = await client.chat.completions.create({
      model: serverEnv.openAiModel,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(request) },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Model returned an empty itinerary");

    const parsed = ItinerarySchema.parse(JSON.parse(raw));
    const byDate = new Map(parsed.days.map((day) => [day.date, day]));

    // Trust our own date sequence over the model's, and backfill any day it skipped.
    const plans = request.conditions.map((day, index) => {
      const generated = byDate.get(day.date) ?? parsed.days[index];
      if (!generated) return buildFallbackPlan(request, day);
      return { ...generated, date: day.date } satisfies DayPlan;
    });

    return { plans, source: "llm" };
  } catch (error) {
    console.warn(
      "[tidefit] itinerary generation fell back to templates:",
      error instanceof Error ? error.message : error,
    );
    return { plans: buildFallbackPlans(request), source: "fallback" };
  }
}

// ---------------------------------------------------------------------------
// Deterministic fallback — keeps the product usable with zero API keys
// ---------------------------------------------------------------------------

const SESSION_BY_SPORT: Record<Sport, { safe: string; caution: string; unsafe: string }> = {
  swimming: {
    safe: "an open-water swim of 30–45 minutes, sighting every six strokes",
    caution: "a shortened swim close to shore, parallel to the beach and inside the flags",
    unsafe: "a pool session — 8 × 100m at a controlled effort instead of open water",
  },
  running: {
    safe: "an easy 45–60 minute run with a few relaxed pick-ups at the end",
    caution: "a shorter 30 minute run at conversational pace, in the shade where possible",
    unsafe: "an indoor treadmill run or a mobility and strength session instead",
  },
  cycling: {
    safe: "a 90 minute steady ride with a longer tempo block on the flatter roads",
    caution: "a 60 minute ride sheltered from the wind, staying off exposed roads",
    unsafe: "an indoor trainer session — 3 × 8 minutes at threshold",
  },
  hiking: {
    safe: "a half-day hike with a solid climb and a summit break",
    caution: "a shorter, lower-elevation walk with an early start to beat the heat",
    unsafe: "a flat urban walk or a full rest day",
  },
};

/**
 * Travel advice without an LLM. It can only use what we measured — the distance
 * to the training anchor — so it gives a mode and a duration and stops there
 * rather than naming a line it cannot verify.
 */
function fallbackTravel(request: ItineraryRequest, day: DayConditions): string {
  const { anchor, place } = request;

  if (anchor.kind !== "swim-spot") {
    return `Everything today starts from where you are staying in ${place.name} — no transport needed beyond a warm-up walk or spin to the start.`;
  }

  const swimIsOff = day.bySport.some(
    (sport) => sport.sport === "swimming" && (sport.risk === "unsafe" || sport.risk === "unknown"),
  );
  if (swimIsOff) {
    return `No trip out to the coast today — the water is off, so stay local in ${place.name} and keep the session on your doorstep.`;
  }

  const meters = anchor.distanceFromCentreKm * 1000;
  return `The water is about ${anchor.distanceFromCentreKm} km from ${place.name} centre — roughly ${travelEstimate(meters).replace("~", "")} each way by road, or a local train if one runs the coast. Leave early enough to be swimming by mid-morning, and plan the return leg before you go.`;
}

function buildFallbackPlan(request: ItineraryRequest, day: DayConditions): DayPlan {
  const label = formatDayLabel(day.date);
  const sessions = day.bySport.map((sport) => {
    const bucket =
      sport.risk === "unsafe" ? "unsafe" : sport.risk === "safe" ? "safe" : "caution";
    return `${titleCase(SPORT_LABELS[sport.sport])}: ${SESSION_BY_SPORT[sport.sport][bucket]}`;
  });

  const limiter = day.bySport
    .flatMap((sport) => sport.metrics)
    .find((metric) => metric.risk === "caution" || metric.risk === "unsafe");

  const spot = request.grounding.spots.map(placeNameFromResult).find(Boolean);
  const event = request.grounding.events.map(placeNameFromResult).find(Boolean);

  return {
    date: day.date,
    title: `${label} in ${request.place.name}`,
    morning: sessions.join(". ") + ".",
    midday: spot
      ? `Refuel, then explore the area around ${spot}.`
      : "Refuel properly, stay on top of hydration, and take a slow walk through the neighbourhood.",
    evening: event
      ? `Easy evening. Worth checking: ${event}.`
      : "Easy evening — stretch, eat well, and lay out kit for tomorrow.",
    travel: fallbackTravel(request, day),
    safetyNote: limiter
      ? `${limiter.label}: ${limiter.note}`
      : `Conditions classified ${day.overallRisk.toUpperCase()} across your selected sports.`,
    citedPlaces: spot ? [spot] : [],
  };
}

export function buildFallbackPlans(request: ItineraryRequest): DayPlan[] {
  return request.conditions.map((day) => buildFallbackPlan(request, day));
}

/** The text ElevenLabs reads aloud for a day. */
export function briefingScript(plan: DayPlan, place: GeocodedPlace): string {
  return [
    `Good morning. Here's your day in ${place.name}.`,
    plan.morning,
    plan.safetyNote,
    // Logistics are the most useful thing to hear while packing a bag.
    plan.travel,
    plan.midday,
    plan.evening,
  ]
    .filter(Boolean)
    .join(" ");
}
