/**
 * Verifies whether the trips table is exposed to anyone holding the anon key.
 *
 * The anon key ships to the browser by design, so this script does exactly what
 * an attacker would: takes the public key and asks PostgREST for the table. If
 * rows come back, the original `select using (true)` policy is still in force
 * and every saved trip is readable by the public.
 *
 * Run with: npm run check:rls
 * Needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in
 * .env.local. SUPABASE_SERVICE_ROLE_KEY is checked for presence only — its
 * value is never printed.
 */
import { createClient } from "@supabase/supabase-js";

import { isTransportFailure, selectVerdict, type RlsStatus } from "@/lib/rls-verdict";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasServiceRole = Boolean(serviceRoleKey);

type Status = RlsStatus;
type Check = { label: string; status: Status; detail: string };

const LABELS: Record<Status, string> = { pass: "PASS", fail: "FAIL", inconclusive: "????" };

function report(checks: Check[]): void {
  console.log("");
  for (const check of checks) {
    console.log(`  ${LABELS[check.status]}  ${check.label}`);
    console.log(`        ${check.detail}`);
  }
  console.log("");
}

async function main() {
  if (!url || !anonKey) {
    console.log(
      "\nSupabase is not configured, so there is nothing to check.\n" +
        "Trips are kept in server memory and a temp-dir cache — no table is exposed.\n" +
        "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to audit a project.\n",
    );
    return;
  }

  console.log(`\nProbing ${url} with the public anon key, the way any visitor could.`);

  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const checks: Check[] = [];

  // 1. Can an unauthenticated client read rows it does not own?
  const { data: rows, error: readError } = await anon
    .from("trips")
    .select("id, destination, start_date, user_id")
    .limit(5);

  // RLS filters rather than refuses, so an empty anon result proves nothing on
  // its own. The service role counts what is really there. Only the count is
  // used; no row contents and never the key itself are printed.
  let actualRows: number | null = null;
  if (serviceRoleKey) {
    const service = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
    const { count, error } = await service
      .from("trips")
      .select("id", { count: "exact", head: true });
    if (!error) actualRows = count ?? 0;
  }

  checks.push({
    label: "Anonymous SELECT on trips is refused",
    ...selectVerdict({
      anonRows: readError ? null : (rows?.length ?? 0),
      anonError: readError,
      actualRows,
    }),
  });

  // 2. Can an unauthenticated client write a row?
  const probeId = "00000000-0000-4000-8000-0000000000ff";
  const { error: writeError } = await anon.from("trips").insert({
    id: probeId,
    destination: "rls-probe",
    start_date: "2000-01-01",
    days: 1,
    sports: [],
    payload: {},
    user_id: null,
  });

  if (writeError && isTransportFailure(writeError)) {
    checks.push({
      label: "Anonymous INSERT into trips is refused",
      status: "inconclusive",
      detail: `Could not reach the project (${writeError.message}). Nothing was verified.`,
    });
  } else if (writeError) {
    checks.push({
      label: "Anonymous INSERT into trips is refused",
      status: "pass",
      detail: `PostgREST refused the write: ${writeError.message}`,
    });
  } else {
    checks.push({
      label: "Anonymous INSERT into trips is refused",
      status: "fail",
      detail:
        "EXPOSED — wrote a row with only the public key. Anyone can fill this table. " +
        "Apply supabase/002_tighten_rls.sql.",
    });
    // Best effort: the same open policy that let us write may not let us clean up.
    await anon.from("trips").delete().eq("id", probeId);
  }

  // 3. Is the server able to serve shared links after the migration?
  checks.push({
    label: "SUPABASE_SERVICE_ROLE_KEY is set",
    status: hasServiceRole ? "pass" : "fail",
    detail: hasServiceRole
      ? "Present, so trip reads and writes go through the service role and shared links keep working."
      : "Missing. Set it BEFORE applying supabase/002_tighten_rls.sql, or the app will not be able to read any trip.",
  });

  report(checks);

  const failed = checks.filter((check) => check.status === "fail");
  const unknown = checks.filter((check) => check.status === "inconclusive");

  if (failed.length > 0) {
    console.log(`${failed.length} check(s) FAILED. See the Deploying section of the README.\n`);
    process.exitCode = 1;
  } else if (unknown.length > 0) {
    console.log(
      `${unknown.length} check(s) could not be determined — this is not an all-clear.\n`,
    );
    process.exitCode = 2;
  } else {
    console.log("Trips are not publicly readable or writable.\n");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
