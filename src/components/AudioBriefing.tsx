"use client";

import { useEffect, useRef, useState } from "react";

type Status = "idle" | "loading" | "ready" | "device-voice" | "error";

/**
 * Plays the ElevenLabs briefing for one day. Order of preference:
 * 1. a pre-rendered clip bundled with the demo trip,
 * 2. a live ElevenLabs synthesis via /api/voice,
 * 3. the browser's own speech synthesis, so the demo still has audio when no
 *    ElevenLabs key is configured.
 */
export function AudioBriefing({
  tripId,
  date,
  script,
  prerenderedUrl,
}: {
  tripId: string;
  date: string;
  script: string;
  prerenderedUrl?: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [devicePaused, setDevicePaused] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, []);

  function speakOnDevice() {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      setStatus("error");
      setMessage("Voice briefing needs an ElevenLabs API key.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(script);
    utterance.rate = 1.02;
    utterance.pitch = 1;
    utterance.onend = () => {
      setStatus("idle");
      setDevicePaused(false);
      setMessage(null);
    };
    window.speechSynthesis.speak(utterance);
    setDevicePaused(false);
    setStatus("device-voice");
    setMessage("Using your device voice — add ELEVENLABS_API_KEY for the studio narration.");
  }

  /** The device voice has no player chrome of its own, so we supply the controls. */
  function toggleDeviceVoice() {
    const synth = window.speechSynthesis;
    if (synth.paused) {
      synth.resume();
      setDevicePaused(false);
    } else {
      synth.pause();
      setDevicePaused(true);
    }
  }

  function stopDeviceVoice() {
    window.speechSynthesis.cancel();
    setDevicePaused(false);
    setStatus("idle");
    setMessage(null);
  }

  async function loadBriefing() {
    setStatus("loading");
    setMessage(null);

    if (prerenderedUrl) {
      const bundled = await fetch(prerenderedUrl, { method: "HEAD" }).catch(() => null);
      if (bundled?.ok) {
        setAudioUrl(prerenderedUrl);
        setStatus("ready");
        return;
      }
    }

    try {
      const response = await fetch("/api/voice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripId, date }),
      });

      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { error?: string };
        if (response.status === 503) {
          speakOnDevice();
          return;
        }
        throw new Error(detail.error ?? "Could not load the briefing.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      setAudioUrl(url);
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Could not load the briefing.");
    }
  }

  return (
    <div className="rounded-xl border border-tide-400/20 bg-tide-500/[0.07] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-tide-100">Morning voice briefing</p>
          <p className="text-xs text-slate-400">
            {status === "ready"
              ? "Narrated by ElevenLabs — pause any time"
              : status === "device-voice"
                ? devicePaused
                  ? "Paused"
                  : "Reading your day aloud"
                : "Hear the day read out before you head out"}
          </p>
        </div>

        {status === "device-voice" ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleDeviceVoice}
              className="btn-ghost border-tide-400/40 text-tide-100 hover:border-tide-300"
            >
              {devicePaused ? (
                <>
                  <span aria-hidden>▶</span> Resume
                </>
              ) : (
                <>
                  <span aria-hidden>❙❙</span> Pause
                </>
              )}
            </button>
            <button
              type="button"
              onClick={stopDeviceVoice}
              className="btn-ghost border-white/15 text-slate-300 hover:border-white/30"
            >
              <span aria-hidden>■</span> Stop
            </button>
          </div>
        ) : status !== "ready" ? (
          <button
            type="button"
            onClick={loadBriefing}
            disabled={status === "loading"}
            className="btn-ghost border-tide-400/40 text-tide-100 hover:border-tide-300"
          >
            {status === "loading" ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-tide-200 border-t-transparent" />
                Generating…
              </>
            ) : (
              <>
                <span aria-hidden>▶</span> Play briefing
              </>
            )}
          </button>
        ) : null}
      </div>

      {audioUrl ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- the same script is rendered as text on the card
        <audio className="mt-3 w-full" src={audioUrl} controls autoPlay preload="none" />
      ) : null}

      {message ? <p className="mt-3 text-xs text-slate-400">{message}</p> : null}
    </div>
  );
}
