/**
 * Verdict logic for `npm run check:rls`, kept pure so it can be tested without
 * a Supabase project.
 */

export type RlsStatus = "pass" | "fail" | "inconclusive";

export interface RlsVerdict {
  status: RlsStatus;
  detail: string;
}

/**
 * A transport failure is not a passing result. Supabase surfaces a policy
 * refusal as a PostgREST error carrying a code; an unreachable host arrives as
 * a bare TypeError with none. Reporting the latter as "refused" would hand back
 * a false all-clear, which is worse than running no check at all.
 */
export function isTransportFailure(error: { code?: string; message: string }): boolean {
  return !error.code && /fetch failed|network|ENOTFOUND|ECONNREFUSED|timeout/i.test(error.message);
}

export interface SelectProbe {
  /** Rows the public anon key could read, or null if the read errored. */
  anonRows: number | null;
  anonError?: { code?: string; message: string } | null;
  /**
   * Rows that actually exist, counted with the service role. Null when the key
   * is absent or the count failed.
   */
  actualRows: number | null;
}

/**
 * Decides whether anonymous reads of `trips` are blocked.
 *
 * Row-level security does not refuse a SELECT — it filters. A correctly locked
 * table answers an anonymous read with an empty list and no error, exactly as an
 * empty table does. The anon key alone cannot tell those apart, so the service
 * role supplies the real row count: rows exist but the anon key sees none means
 * the policies are working.
 */
export function selectVerdict({ anonRows, anonError, actualRows }: SelectProbe): RlsVerdict {
  if (anonError && isTransportFailure(anonError)) {
    return {
      status: "inconclusive",
      detail: `Could not reach the project (${anonError.message}). Nothing was verified — check NEXT_PUBLIC_SUPABASE_URL and your network, then re-run.`,
    };
  }
  if (anonError) {
    return { status: "pass", detail: `PostgREST refused the read: ${anonError.message}` };
  }

  const visible = anonRows ?? 0;
  if (visible > 0) {
    return {
      status: "fail",
      detail: `EXPOSED — read back ${visible} row(s) with only the public key. Apply supabase/002_tighten_rls.sql.`,
    };
  }

  if (actualRows === null) {
    return {
      status: "inconclusive",
      detail:
        "The public key read no rows, but without SUPABASE_SERVICE_ROLE_KEY there is no way to tell an empty table from a protected one. Set it and re-run.",
    };
  }
  if (actualRows === 0) {
    return {
      status: "inconclusive",
      detail:
        "The table is empty, so there was nothing for the policies to hide. Plan and save one trip in the app, then re-run.",
    };
  }
  return {
    status: "pass",
    detail: `The table holds ${actualRows} trip(s) and the public key could read none of them.`,
  };
}
