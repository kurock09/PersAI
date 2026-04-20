import type {
  PersonaArchetype,
  PersonaArchetypeLocale,
  PersonaArchetypePace,
  PersonaArchetypeSentenceLength,
  PersonaArchetypeTraitKey
} from "../domain/persona-archetype.entity";

/**
 * ADR-074 V1 — Voice DNA modulator.
 *
 * Pure function. Given an archetype card, the user's trait sliders, and a
 * locale, produce a fully-resolved Voice DNA payload ready to interpolate
 * into the Soul prompt. Sliders only *adjust* the archetype — they never
 * replace its identity. A `warmth=0` slider on the "Warm & Quiet" archetype
 * still produces a quiet voice, just less actively warm.
 */

export type VoiceDnaTraits = Partial<Record<PersonaArchetypeTraitKey, number>>;

export interface VoiceDnaResolved {
  archetypeKey: string;
  archetypeLabel: string;
  archetypeDescription: string;
  voice: {
    sentenceLength: PersonaArchetypeSentenceLength;
    pace: PersonaArchetypePace;
    irony: number;
  };
  openingsAllowed: string[];
  openingsForbidden: string[];
  behaviors: {
    whenUserUpset: string;
    whenUserExcited: string;
    whenUserTired: string;
    whenUserAngry: string;
  };
  silenceRule: string;
  examples: Array<{ context: string; reply: string }>;
  /** Resolved traits (after slider × archetype default merge). */
  traits: Record<PersonaArchetypeTraitKey, number>;
}

/**
 * Universal forbidden phrases applied across every archetype, on every locale.
 * These are AI-tells the founder never wants the assistant to ship with.
 * Mirrors `UNIVERSAL_FORBIDDEN_OPENINGS` in `prisma/persona-archetype-data.ts`.
 */
const UNIVERSAL_FORBIDDEN_BY_LOCALE: Record<PersonaArchetypeLocale, string[]> = {
  ru: [
    "Конечно!",
    "Конечно,",
    "Безусловно,",
    "Я как ИИ",
    "Как языковая модель",
    "Я понимаю ваше беспокойство",
    "Отличный вопрос!",
    "Замечательный вопрос!",
    "С удовольствием помогу"
  ],
  en: [
    "Certainly!",
    "Of course!",
    "Absolutely,",
    "As an AI",
    "As a language model",
    "I understand your concern",
    "Great question!",
    "Excellent question!",
    "I'd be happy to help"
  ]
};

const TRAIT_NEUTRAL = 50;
const SHORT_ORDER: PersonaArchetypeSentenceLength[] = ["short", "medium", "long"];
const PACE_ORDER: PersonaArchetypePace[] = ["slow", "normal", "quick"];

export function resolveVoiceDnaLocale(locale: string | null | undefined): PersonaArchetypeLocale {
  if (typeof locale === "string" && locale.toLowerCase().startsWith("ru")) {
    return "ru";
  }
  return "en";
}

/**
 * Apply trait sliders to a base archetype Voice DNA. Sliders are normalized
 * around 50 (neutral); values significantly off neutral nudge the archetype's
 * `voice` parameters and the universal "AI-tells" forbidden list.
 *
 * Modulation rules (kept intentionally conservative — sliders are *nudges*,
 * not overrides):
 *   - `verbosity` <30  → bump sentence length one step *shorter* (clamped).
 *   - `verbosity` >70  → bump sentence length one step *longer* (clamped).
 *   - `playfulness` <30 → cut irony in half.
 *   - `playfulness` >70 → boost irony toward 90, but not above the
 *                          archetype's max-by-design (`Warm & Quiet` stays
 *                          quiet even with playfulness=100).
 *   - `initiative` >70  → pace one step quicker (clamped).
 *   - `formality`  >70  → forbid casual interjections in addition to the
 *                          universal forbidden list. (Future hook; for now we
 *                          only attach the universal list to keep behavior
 *                          deterministic.)
 *   - `warmth`     <30  → halves the irony floor (cold can't bite further).
 */
export function modulateVoiceDna(params: {
  archetype: PersonaArchetype;
  traits: VoiceDnaTraits | null | undefined;
  locale: PersonaArchetypeLocale;
}): VoiceDnaResolved {
  const { archetype, locale } = params;
  const traits = mergeTraits(archetype.defaultTraits, params.traits);

  const verbosity = traits.verbosity;
  const playfulness = traits.playfulness;
  const initiative = traits.initiative;
  const warmth = traits.warmth;

  let sentenceLength = archetype.voice.sentenceLength;
  if (verbosity < 30) sentenceLength = stepLength(sentenceLength, -1);
  else if (verbosity > 70) sentenceLength = stepLength(sentenceLength, +1);

  let pace = archetype.voice.pace;
  if (initiative > 70) pace = stepPace(pace, +1);

  let irony = archetype.voice.irony;
  if (playfulness < 30) irony = Math.round(irony * 0.5);
  else if (playfulness > 70) irony = Math.min(90, Math.round(irony * 1.4 + 5));
  if (warmth < 30) irony = Math.max(irony, Math.round(irony * 0.75));

  const archetypeForbidden = archetype.openingsForbidden[locale] ?? [];
  const universalForbidden = UNIVERSAL_FORBIDDEN_BY_LOCALE[locale] ?? [];
  const openingsForbidden = dedupePreserveOrder([...archetypeForbidden, ...universalForbidden]);

  return {
    archetypeKey: archetype.key,
    archetypeLabel: archetype.label[locale] ?? archetype.label.en,
    archetypeDescription: archetype.description[locale] ?? archetype.description.en,
    voice: {
      sentenceLength,
      pace,
      irony
    },
    openingsAllowed: archetype.openingsAllowed[locale] ?? archetype.openingsAllowed.en,
    openingsForbidden,
    behaviors: {
      whenUserUpset:
        archetype.behaviors.whenUserUpset[locale] ?? archetype.behaviors.whenUserUpset.en,
      whenUserExcited:
        archetype.behaviors.whenUserExcited[locale] ?? archetype.behaviors.whenUserExcited.en,
      whenUserTired:
        archetype.behaviors.whenUserTired[locale] ?? archetype.behaviors.whenUserTired.en,
      whenUserAngry:
        archetype.behaviors.whenUserAngry[locale] ?? archetype.behaviors.whenUserAngry.en
    },
    silenceRule: archetype.silenceRule[locale] ?? archetype.silenceRule.en,
    examples: archetype.examples.map((example) => ({
      context: example.context[locale] ?? example.context.en,
      reply: example.reply[locale] ?? example.reply.en
    })),
    traits
  };
}

function mergeTraits(
  defaults: Record<PersonaArchetypeTraitKey, number>,
  override: VoiceDnaTraits | null | undefined
): Record<PersonaArchetypeTraitKey, number> {
  const out: Record<PersonaArchetypeTraitKey, number> = {
    formality: clampTrait(override?.formality ?? defaults.formality ?? TRAIT_NEUTRAL),
    verbosity: clampTrait(override?.verbosity ?? defaults.verbosity ?? TRAIT_NEUTRAL),
    playfulness: clampTrait(override?.playfulness ?? defaults.playfulness ?? TRAIT_NEUTRAL),
    initiative: clampTrait(override?.initiative ?? defaults.initiative ?? TRAIT_NEUTRAL),
    warmth: clampTrait(override?.warmth ?? defaults.warmth ?? TRAIT_NEUTRAL)
  };
  return out;
}

function clampTrait(value: number): number {
  if (Number.isNaN(value)) return TRAIT_NEUTRAL;
  return Math.max(0, Math.min(100, value));
}

function stepLength(
  value: PersonaArchetypeSentenceLength,
  delta: number
): PersonaArchetypeSentenceLength {
  return stepClamped(SHORT_ORDER, value, delta);
}

function stepPace(value: PersonaArchetypePace, delta: number): PersonaArchetypePace {
  return stepClamped(PACE_ORDER, value, delta);
}

function stepClamped<T>(order: T[], value: T, delta: number): T {
  const idx = order.indexOf(value);
  if (idx === -1) return value;
  const next = Math.min(order.length - 1, Math.max(0, idx + delta));
  return order[next] ?? value;
}

function dedupePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
