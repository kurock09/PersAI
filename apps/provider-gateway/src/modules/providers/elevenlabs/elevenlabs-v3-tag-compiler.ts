import type { RuntimeTtsDeliveryIntent } from "@persai/runtime-contract";

/**
 * ADR-113 TTS 2.0 safe compiler.
 *
 * Converts a structured expressive delivery intent into a small, conservative
 * set of ElevenLabs `eleven_v3` audio tags. The model never writes raw tags; it
 * only chooses structured enums, and this pure function owns the translation.
 *
 * Guardrails:
 * - conflict avoidance (whisper suppresses excited/dramatic and caps intensity);
 * - a hard tag budget so output stays natural;
 * - deterministic priority ordering (delivery > emotion > nonVerbal > pause).
 */

export const MAX_ELEVEN_V3_TAGS = 3 as const;

export interface ElevenV3CompiledDelivery {
  /** Ordered audio tags selected for this generation (already budget-capped). */
  tags: string[];
  /** Spoken text with model-authored tags stripped and compiled tags prepended. */
  text: string;
  /** Discrete v3 stability preset (0.0 creative, 0.5 natural, 1.0 robust). */
  stability: number;
}

// Matches ElevenLabs-style inline audio tags, e.g. "[whispers]", "[clears throat]".
// Conservative: only bracketed short alphabetic phrases are treated as tags.
const AUDIO_TAG_LIKE_PATTERN = /\[[A-Za-z][A-Za-z \-']{0,30}\]/g;

interface CandidateTag {
  priority: number;
  tag: string;
}

export function stripModelAuthoredAudioTags(text: string): string {
  return text
    .replace(AUDIO_TAG_LIKE_PATTERN, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function compileElevenV3Delivery(params: {
  text: string;
  delivery: RuntimeTtsDeliveryIntent;
}): ElevenV3CompiledDelivery {
  const { delivery } = params;
  const isWhisper = delivery.delivery === "whisper";

  const candidates: CandidateTag[] = [];

  // Priority 1: overall delivery style.
  if (isWhisper) {
    candidates.push({ priority: 1, tag: "[whispers]" });
  } else if (delivery.delivery === "dramatic") {
    candidates.push({ priority: 1, tag: "[dramatic]" });
  }

  // Priority 2: emotion. Whisper suppresses loud/energetic emotion tags.
  if (!isWhisper) {
    if (delivery.emotion === "excited") {
      candidates.push({ priority: 2, tag: "[excited]" });
    } else if (delivery.emotion === "sad") {
      candidates.push({ priority: 2, tag: "[sad]" });
    } else if (delivery.emotion === "curious") {
      candidates.push({ priority: 2, tag: "[curious]" });
    }
  } else if (delivery.emotion === "sad" || delivery.emotion === "curious") {
    // Quiet, non-energetic emotions remain compatible with whispering.
    candidates.push({ priority: 2, tag: delivery.emotion === "sad" ? "[sad]" : "[curious]" });
  }

  // Priority 3: non-verbal sound.
  const nonVerbalTag = resolveNonVerbalTag(delivery.nonVerbal);
  if (nonVerbalTag !== null) {
    candidates.push({ priority: 3, tag: nonVerbalTag });
  }

  // Priority 4: pause.
  if (delivery.pause === "short") {
    candidates.push({ priority: 4, tag: "[short pause]" });
  } else if (delivery.pause === "long") {
    candidates.push({ priority: 4, tag: "[long pause]" });
  }

  const tags = candidates
    .sort((left, right) => left.priority - right.priority)
    .map((candidate) => candidate.tag)
    .slice(0, MAX_ELEVEN_V3_TAGS);

  const sanitizedText = stripModelAuthoredAudioTags(params.text);
  const prefix = tags.length > 0 ? `${tags.join(" ")} ` : "";

  return {
    tags,
    text: `${prefix}${sanitizedText}`.trim(),
    stability: resolveStability(delivery)
  };
}

function resolveNonVerbalTag(nonVerbal: RuntimeTtsDeliveryIntent["nonVerbal"]): string | null {
  switch (nonVerbal) {
    case "laugh":
      return "[laughs]";
    case "chuckle":
      return "[chuckles]";
    case "sigh":
      return "[sighs]";
    case "clear_throat":
      return "[clears throat]";
    case "none":
    default:
      return null;
  }
}

function resolveStability(delivery: RuntimeTtsDeliveryIntent): number {
  // Whisper/narrator stay steady (robust). Expressive styles relax stability.
  if (delivery.delivery === "whisper" || delivery.delivery === "narrator") {
    return 0.5;
  }
  if (delivery.delivery === "dramatic" || delivery.delivery === "playful") {
    return 0;
  }
  // Intensity caps how creative we let the voice be for ordinary styles. Whisper
  // already returned above, so a high-intensity escalation cannot apply to it.
  if (delivery.intensity === "high" || delivery.emotion === "excited") {
    return 0;
  }
  if (delivery.intensity === "low") {
    return 1;
  }
  return 0.5;
}
