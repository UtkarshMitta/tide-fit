import { createHash } from "node:crypto";

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

import { serverEnv } from "@/lib/env";

const OUTPUT_FORMAT = "mp3_44100_128";
export const AUDIO_CONTENT_TYPE = "audio/mpeg";

/** ElevenLabs bills per character, so identical briefings are only synthesised once. */
const CACHE_LIMIT = 64;
const cache = new Map<string, Buffer>();

function cacheKey(text: string): string {
  return createHash("sha256")
    .update(`${serverEnv.elevenLabsVoiceId}:${serverEnv.elevenLabsModelId}:${text}`)
    .digest("hex");
}

function remember(key: string, audio: Buffer): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, audio);
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export class VoiceUnavailableError extends Error {}

/**
 * ElevenLabs charges per character and long briefings read poorly, so the
 * script is trimmed at a sentence boundary before synthesis.
 */
export function trimForNarration(text: string, maxChars = 900): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  const clipped = collapsed.slice(0, maxChars);
  const lastStop = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("! "));
  return lastStop > maxChars * 0.5 ? clipped.slice(0, lastStop + 1) : `${clipped.trim()}…`;
}

export async function synthesizeBriefing(text: string): Promise<Buffer> {
  if (!serverEnv.elevenLabsApiKey) {
    throw new VoiceUnavailableError("ELEVENLABS_API_KEY is not configured");
  }

  const script = trimForNarration(text);
  const key = cacheKey(script);
  const cached = cache.get(key);
  if (cached) return cached;

  const client = new ElevenLabsClient({ apiKey: serverEnv.elevenLabsApiKey });
  const stream = await client.textToSpeech.convert(serverEnv.elevenLabsVoiceId, {
    text: script,
    modelId: serverEnv.elevenLabsModelId,
    outputFormat: OUTPUT_FORMAT,
    voiceSettings: {
      stability: 0.45,
      similarityBoost: 0.75,
      // A touch of style keeps the "good morning" briefing sounding like a coach.
      style: 0.15,
      useSpeakerBoost: true,
    },
  });

  const audio = await streamToBuffer(stream);
  if (audio.length === 0) throw new VoiceUnavailableError("ElevenLabs returned empty audio");

  remember(key, audio);
  return audio;
}
