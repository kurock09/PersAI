export const VALID_ASSISTANT_GENDERS = ["male", "female", "neutral"] as const;

export type AssistantGender = (typeof VALID_ASSISTANT_GENDERS)[number];

export function normalizeAssistantGender(value: string | null | undefined): AssistantGender | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return VALID_ASSISTANT_GENDERS.includes(normalized as AssistantGender)
    ? (normalized as AssistantGender)
    : null;
}
