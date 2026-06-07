import assert from "node:assert/strict";
import { createDefaultTtsDeliveryIntent } from "@persai/runtime-contract";
import {
  compileElevenV3Delivery,
  MAX_ELEVEN_V3_TAGS,
  stripModelAuthoredAudioTags
} from "../src/modules/providers/elevenlabs/elevenlabs-v3-tag-compiler";

export async function runElevenLabsV3TagCompilerTest(): Promise<void> {
  // Neutral default produces no tags and leaves text untouched.
  const neutral = compileElevenV3Delivery({
    text: "Привет!",
    delivery: createDefaultTtsDeliveryIntent()
  });
  assert.deepEqual(neutral.tags, []);
  assert.equal(neutral.text, "Привет!");

  // Whisper + excited: whisper wins, excited is suppressed (conflict avoidance).
  const whisperExcited = compileElevenV3Delivery({
    text: "Секрет.",
    delivery: {
      ...createDefaultTtsDeliveryIntent(),
      delivery: "whisper",
      emotion: "excited",
      intensity: "high"
    }
  });
  assert.deepEqual(whisperExcited.tags, ["[whispers]"]);
  assert.equal(whisperExcited.text.startsWith("[whispers]"), true);
  assert.equal(whisperExcited.stability, 0.5);

  // Excited emotion alone maps to [excited] and relaxes stability to creative.
  const excited = compileElevenV3Delivery({
    text: "Получилось!",
    delivery: { ...createDefaultTtsDeliveryIntent(), emotion: "excited" }
  });
  assert.deepEqual(excited.tags, ["[excited]"]);
  assert.equal(excited.stability, 0);

  // Sad emotion is allowed even under whisper (quiet, non-energetic).
  const whisperSad = compileElevenV3Delivery({
    text: "Мне жаль.",
    delivery: { ...createDefaultTtsDeliveryIntent(), delivery: "whisper", emotion: "sad" }
  });
  assert.deepEqual(whisperSad.tags, ["[whispers]", "[sad]"]);

  // Non-verbal + pause map to the documented tags.
  const laughPause = compileElevenV3Delivery({
    text: "Это смешно.",
    delivery: { ...createDefaultTtsDeliveryIntent(), nonVerbal: "laugh", pause: "short" }
  });
  assert.deepEqual(laughPause.tags, ["[laughs]", "[short pause]"]);

  const throatLong = compileElevenV3Delivery({
    text: "Итак.",
    delivery: { ...createDefaultTtsDeliveryIntent(), nonVerbal: "clear_throat", pause: "long" }
  });
  assert.deepEqual(throatLong.tags, ["[clears throat]", "[long pause]"]);

  // Tag budget: many candidates are capped to MAX_ELEVEN_V3_TAGS by priority.
  const many = compileElevenV3Delivery({
    text: "Слушай.",
    delivery: {
      delivery: "dramatic",
      emotion: "excited",
      pace: "fast",
      intensity: "high",
      pause: "long",
      nonVerbal: "sigh"
    }
  });
  assert.equal(many.tags.length, MAX_ELEVEN_V3_TAGS);
  // Priority order: delivery > emotion > nonVerbal (pause dropped at the cap).
  assert.deepEqual(many.tags, ["[dramatic]", "[excited]", "[sighs]"]);

  // Model-authored raw tags are stripped before compiled tags are prepended.
  const injected = compileElevenV3Delivery({
    text: "[shouts] Тише [whispers] пожалуйста.",
    delivery: { ...createDefaultTtsDeliveryIntent(), delivery: "whisper" }
  });
  assert.equal(injected.text.includes("[shouts]"), false);
  assert.equal(injected.tags.filter((tag) => tag === "[whispers]").length, 1);
  assert.equal(injected.text.startsWith("[whispers]"), true);
  // The only "[whispers]" left is the compiled prefix, not the injected one.
  assert.equal((injected.text.match(/\[whispers\]/g) ?? []).length, 1);

  // stripModelAuthoredAudioTags is conservative and collapses whitespace.
  assert.equal(stripModelAuthoredAudioTags("a [laughs] b"), "a b");
}
