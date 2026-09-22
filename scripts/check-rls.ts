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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

type Status = "pass" | "fail" | "inconclusive";
type Check = { label: string; status: Status; detail: string };

/**
 * A transport failure is not a passing result. Supabase surfaces a policy
 * refusal as a PostgREST error carrying a code; an unreachable host arrives as
 * a bare TypeError with none. Reporting the latter as "refused" would hand back
 * a false all-clear, which is worse than running no check at all.
 */
function isTransportFailure(error: { code?: string; message: string }): boolean {
  return !error.code && /fetch failed|network|ENOTFOUND|ECONNREFUSED|timeout/i.test(error.message);
}

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

  if (readError && isTransportFailure(readError)) {
    checks.push({
      label: "Anonymous SELECT on trips is refused",
      status: "inconclusive",
      detail: `Could not reach the project (${readError.message}). Nothing was verified — check NEXT_PUBLIC_SUPABASE_URL and your network, then re-run.`,
    });
  } else if (readError) {
    checks.push({
      label: "Anonymous SELECT on trips is refused",
      status: "pass",
      detail: `PostgREST refused the read: ${readError.message}`,
    });
  } else {
    const count = rows?.length ?? 0;
    checks.push({
      label: "Anonymous SELECT on trips is refused",
      status: count === 0 ? "inconclusive" : "fail",
      detail:
        count === 0
          ? "The query was allowed but returned no rows. Either the table is empty or RLS is filtering correctly — save a trip and re-run to tell those apart."
          : `EXPOSED — read back ${count} row(s) with only the public key. ` +
            `Example: ${JSON.stringify(rows?.[0])}. Apply supabase/002_tighten_rls.sql.`,
    });
  }

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
