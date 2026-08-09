import { DEMO_TRIP_ID, buildDemoTrip } from "@/lib/demo";
import { createServerSupabase } from "@/lib/supabase";
import type { Trip } from "@/lib/types";

/**
 * Trips live in Supabase when it is configured. Without it they are kept in a
 * process-local cache, which is enough for local development and a single-box
 * demo but will not survive across serverless instances.
 */
const MEMORY_LIMIT = 50;
const memory = new Map<string, Trip>();

function rememberInMemory(trip: Trip): void {
  if (memory.size >= MEMORY_LIMIT) {
    const oldest = memory.keys().next().value;
    if (oldest) memory.delete(oldest);
  }
  memory.set(trip.id, trip);
}

export async function saveTrip(trip: Trip): Promise<Trip> {
  rememberInMemory(trip);

  const supabase = createServerSupabase();
  if (!supabase) return trip;

  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from("trips").upsert({
    id: trip.id,
    user_id: userData.user?.id ?? null,
    destination: trip.input.destination,
    start_date: trip.input.startDate,
    days: trip.input.days,
    sports: trip.input.sports,
    payload: trip,
  });

  if (error) {
    console.warn("[tidefit] could not persist trip to Supabase:", error.message);
  }
  return trip;
}

export async function getTrip(id: string): Promise<Trip | null> {
  if (id === DEMO_TRIP_ID) return buildDemoTrip();

  const cached = memory.get(id);
  if (cached) return cached;

  const supabase = createServerSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase.from("trips").select("payload").eq("id", id).maybeSingle();
  if (error) {
    console.warn("[tidefit] could not load trip from Supabase:", error.message);
    return null;
  }
  if (!data?.payload) return null;

  const trip = data.payload as Trip;
  rememberInMemory(trip);
  return trip;
}

export interface TripSummary {
  id: string;
  destination: string;
  startDate: string;
  days: number;
  sports: string[];
  createdAt: string;
}

export async function listTripsForCurrentUser(): Promise<TripSummary[]> {
  const supabase = createServerSupabase();
  if (!supabase) return [];

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];

  const { data, error } = await supabase
    .from("trips")
    .select("id, destination, start_date, days, sports, created_at")
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id as string,
    destination: row.destination as string,
    startDate: row.start_date as string,
    days: row.days as number,
    sports: (row.sports as string[]) ?? [],
    createdAt: row.created_at as string,
  }));
}
