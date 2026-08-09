"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createBrowserSupabase } from "@/lib/supabase-browser";

/**
 * Magic-link sign in. Signing in is optional — it only exists so trips can be
 * saved to an account instead of living in the current session.
 */
export function AuthPanel({ email }: { email: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    const supabase = createBrowserSupabase();
    if (!supabase) return;

    setState("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email: value,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      setState("error");
      setMessage(error.message);
      return;
    }
    setState("sent");
    setMessage("Check your inbox for the sign-in link.");
  }

  async function signOut() {
    const supabase = createBrowserSupabase();
    if (!supabase) return;
    await supabase.auth.signOut();
    router.refresh();
  }

  if (email) {
    return (
      <div className="flex items-center gap-3 text-sm text-slate-400">
        <span className="hidden sm:inline">{email}</span>
        <button type="button" onClick={signOut} className="btn-ghost py-1.5 text-xs">
          Sign out
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={signIn} className="flex items-center gap-2">
      <input
        type="email"
        required
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="you@example.com"
        aria-label="Email address for sign-in link"
        className="field w-44 py-2 text-sm sm:w-56"
      />
      <button type="submit" className="btn-ghost py-2 text-xs" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : state === "sent" ? "Link sent" : "Save my trips"}
      </button>
      {message ? (
        <span
          role="status"
          className={state === "error" ? "text-xs text-rose-300" : "text-xs text-emerald-300"}
        >
          {message}
        </span>
      ) : null}
    </form>
  );
}
