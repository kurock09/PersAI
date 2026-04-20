/**
 * ADR-074 V1 — Voice DNA archetype domain model.
 *
 * Each archetype is a structured "voice card" that the runtime consults when
 * rendering the Soul prompt. Numeric trait sliders modulate the resolved Voice
 * DNA at runtime (`voice-dna-modulator.ts`); they never replace the archetype.
 *
 * Defaults live in `apps/api/prisma/persona-archetype-data.ts` and are seeded
 * into the `persona_archetypes` table on bootstrap. Admins edit them through
 * `/admin/presets`; runtime always reads from the table.
 */

export type PersonaArchetypeLocale = "ru" | "en";

export interface PersonaArchetypeLocalized<T> {
  ru: T;
  en: T;
}

export type PersonaArchetypeSentenceLength = "short" | "medium" | "long";
export type PersonaArchetypePace = "slow" | "normal" | "quick";

export interface PersonaArchetypeVoiceParams {
  sentenceLength: PersonaArchetypeSentenceLength;
  pace: PersonaArchetypePace;
  /** 0 = no irony, 100 = sarcasm-heavy. */
  irony: number;
}

export interface PersonaArchetypeBehaviors {
  whenUserUpset: PersonaArchetypeLocalized<string>;
  whenUserExcited: PersonaArchetypeLocalized<string>;
  whenUserTired: PersonaArchetypeLocalized<string>;
  whenUserAngry: PersonaArchetypeLocalized<string>;
}

export interface PersonaArchetypeExample {
  context: PersonaArchetypeLocalized<string>;
  reply: PersonaArchetypeLocalized<string>;
}

export type PersonaArchetypeTraitKey =
  | "formality"
  | "verbosity"
  | "playfulness"
  | "initiative"
  | "warmth";

export interface PersonaArchetype {
  key: string;
  displayOrder: number;
  label: PersonaArchetypeLocalized<string>;
  description: PersonaArchetypeLocalized<string>;
  voice: PersonaArchetypeVoiceParams;
  openingsAllowed: PersonaArchetypeLocalized<string[]>;
  openingsForbidden: PersonaArchetypeLocalized<string[]>;
  behaviors: PersonaArchetypeBehaviors;
  silenceRule: PersonaArchetypeLocalized<string>;
  examples: PersonaArchetypeExample[];
  defaultTraits: Record<PersonaArchetypeTraitKey, number>;
  createdAt: Date;
  updatedAt: Date;
}

export interface PersonaArchetypeUpsertInput {
  key: string;
  displayOrder: number;
  label: PersonaArchetypeLocalized<string>;
  description: PersonaArchetypeLocalized<string>;
  voice: PersonaArchetypeVoiceParams;
  openingsAllowed: PersonaArchetypeLocalized<string[]>;
  openingsForbidden: PersonaArchetypeLocalized<string[]>;
  behaviors: PersonaArchetypeBehaviors;
  silenceRule: PersonaArchetypeLocalized<string>;
  examples: PersonaArchetypeExample[];
  defaultTraits: Record<PersonaArchetypeTraitKey, number>;
}

export interface PersonaArchetypePatchInput {
  displayOrder?: number;
  label?: PersonaArchetypeLocalized<string>;
  description?: PersonaArchetypeLocalized<string>;
  voice?: PersonaArchetypeVoiceParams;
  openingsAllowed?: PersonaArchetypeLocalized<string[]>;
  openingsForbidden?: PersonaArchetypeLocalized<string[]>;
  behaviors?: PersonaArchetypeBehaviors;
  silenceRule?: PersonaArchetypeLocalized<string>;
  examples?: PersonaArchetypeExample[];
  defaultTraits?: Record<PersonaArchetypeTraitKey, number>;
}
