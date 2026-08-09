import Link from "next/link";

import { DEMO_TRIP_ID } from "@/lib/demo";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-start justify-center gap-4 px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-tide-300">404</p>
      <h1 className="text-3xl font-semibold tracking-tight text-slate-50">
        That trip isn&apos;t here
      </h1>
      <p className="text-slate-400">
        Trips created without Supabase configured live only in the server that built them, so a
        restart or a different instance can lose them. Plan a fresh one, or open the sample trip.
      </p>
      <div className="mt-2 flex flex-wrap gap-3">
        <Link href="/" className="btn-primary">
          Plan a trip
        </Link>
        <Link href={`/trip/${DEMO_TRIP_ID}`} className="btn-ghost">
          Open the Lisbon sample
        </Link>
      </div>
    </main>
  );
}
