/**
 * Bakes the sample trip's voice briefings into public/audio so the on-stage
 * demo plays instantly and never depends on a live ElevenLabs call.
 *
 * Usage: npm run demo:audio   (requires ELEVENLABS_API_KEY)
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildDemoTrip } from "@/lib/demo";
import { serverEnv } from "@/lib/env";
import { briefingScript } from "@/lib/itinerary";
import { synthesizeBriefing } from "@/lib/voice";

async function main() {
  if (!serverEnv.elevenLabsApiKey) {
    console.error("ELEVENLABS_API_KEY is not set — nothing to pre-render.");
    process.exit(1);
  }

  const trip = buildDemoTrip();
  const outputDir = path.join(process.cwd(), "public", "audio");
  await mkdir(outputDir, { recursive: true });

  for (const [index, plan] of trip.plans.entries()) {
    const audio = await synthesizeBriefing(briefingScript(plan, trip.place));
    const file = path.join(outputDir, `demo-lisbon-day-${index + 1}.mp3`);
    await writeFile(file, audio);
    console.log(`wrote ${path.relative(process.cwd(), file)} (${Math.round(audio.length / 1024)} KB)`);
  }

  console.log("\nDemo audio is baked in. The sample trip will now play instantly.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
