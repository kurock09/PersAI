import type { RuntimeAssistantVoiceProfile } from "@persai/runtime-contract";

/**
 * ADR-074 V1 — frozen archetype card stored at publish time. Locale-agnostic
 * raw card from `persona_archetypes`; the materializer modulates it with
 * `snapshotTraits` and the user locale on each materialization. Used as a
 * defensive fallback when the live archetype row has been deleted; for
 * normal operation the runtime always reads the live row by `snapshotArchetypeKey`.
 */
export interface AssistantPublishedVersionSnapshotVoiceDna {
  key: string;
  displayOrder: number;
  label: { ru: string; en: string };
  description: { ru: string; en: string };
  voice: {
    sentenceLength: "short" | "medium" | "long";
    pace: "slow" | "normal" | "quick";
    irony: number;
  };
  openingsAllowed: { ru: string[]; en: string[] };
  openingsForbidden: { ru: string[]; en: string[] };
  behaviors: {
    whenUserUpset: { ru: string; en: string };
    whenUserExcited: { ru: string; en: string };
    whenUserTired: { ru: string; en: string };
    whenUserAngry: { ru: string; en: string };
  };
  silenceRule: { ru: string; en: string };
  examples: Array<{
    context: { ru: string; en: string };
    reply: { ru: string; en: string };
  }>;
  defaultTraits: Record<string, number>;
}

export type AssistantPublishedVersion = {
  id: string;
  assistantId: string;
  version: number;
  snapshotDisplayName: string | null;
  snapshotInstructions: string | null;
  snapshotTraits: Record<string, number> | null;
  snapshotAvatarEmoji: string | null;
  snapshotAvatarUrl: string | null;
  snapshotAssistantGender: string | null;
  snapshotVoiceProfile: RuntimeAssistantVoiceProfile | null;
  snapshotArchetypeKey: string | null;
  snapshotVoiceDna: AssistantPublishedVersionSnapshotVoiceDna | null;
  publishedByUserId: string;
  createdAt: Date;
};
