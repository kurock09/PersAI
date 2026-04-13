import {
  PERSAI_RUNTIME_OPENAI_TTS_VOICES,
  PERSAI_RUNTIME_TTS_DEFAULT_LOCALE,
  PERSAI_RUNTIME_TTS_DELIVERY_KINDS,
  PERSAI_RUNTIME_YANDEX_TTS_ROLES,
  PERSAI_RUNTIME_YANDEX_TTS_VOICES,
  type PersaiRuntimeOpenAITtsVoice,
  type PersaiRuntimeTtsDeliveryKind,
  type PersaiRuntimeYandexTtsVoice,
  type RuntimeAssistantVoiceProfile
} from "@persai/runtime-contract";

const ASSISTANT_VOICE_PROFILE_SCHEMA = "persai.assistantVoiceProfile.v1" as const;
const DEFAULT_DELIVERY_KIND: PersaiRuntimeTtsDeliveryKind = "voice_note";
const MAX_VOICE_ID_LENGTH = 128;
const MAX_LOCALE_LENGTH = 32;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalNonEmptyString(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    return null;
  }
  return trimmed;
}

function parseEnumOrNull<T extends string>(
  value: unknown,
  allowed: readonly T[],
  maxLength = 64
): T | null {
  const normalized = normalizeOptionalNonEmptyString(value, maxLength);
  if (normalized === null) {
    return null;
  }
  return allowed.includes(normalized as T) ? (normalized as T) : null;
}

export function createDefaultAssistantVoiceProfile(): RuntimeAssistantVoiceProfile {
  return {
    schema: ASSISTANT_VOICE_PROFILE_SCHEMA,
    defaultLocale: PERSAI_RUNTIME_TTS_DEFAULT_LOCALE,
    deliveryKind: DEFAULT_DELIVERY_KIND,
    elevenlabs: {
      voiceId: null
    },
    yandex: {
      voice: null,
      role: null
    },
    openai: {
      voice: null
    }
  };
}

export function normalizeAssistantVoiceProfile(value: unknown): RuntimeAssistantVoiceProfile {
  const fallback = createDefaultAssistantVoiceProfile();
  if (!isPlainObject(value)) {
    return fallback;
  }

  const elevenlabs = isPlainObject(value.elevenlabs) ? value.elevenlabs : {};
  const yandex = isPlainObject(value.yandex) ? value.yandex : {};
  const openai = isPlainObject(value.openai) ? value.openai : {};

  return {
    schema: ASSISTANT_VOICE_PROFILE_SCHEMA,
    defaultLocale:
      normalizeOptionalNonEmptyString(value.defaultLocale, MAX_LOCALE_LENGTH) ??
      fallback.defaultLocale,
    deliveryKind:
      parseEnumOrNull(value.deliveryKind, PERSAI_RUNTIME_TTS_DELIVERY_KINDS) ??
      fallback.deliveryKind,
    elevenlabs: {
      voiceId: normalizeOptionalNonEmptyString(elevenlabs.voiceId, MAX_VOICE_ID_LENGTH)
    },
    yandex: {
      voice: parseEnumOrNull(yandex.voice, PERSAI_RUNTIME_YANDEX_TTS_VOICES),
      role: parseEnumOrNull(yandex.role, PERSAI_RUNTIME_YANDEX_TTS_ROLES)
    },
    openai: {
      voice: parseEnumOrNull(openai.voice, PERSAI_RUNTIME_OPENAI_TTS_VOICES)
    }
  };
}

export function parseAssistantVoiceProfileInput(
  value: unknown
): RuntimeAssistantVoiceProfile | null | undefined | Error {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!isPlainObject(value)) {
    return new Error("voiceProfile must be an object, null, or omitted.");
  }

  const unknownKeys = Object.keys(value).filter(
    (key) =>
      key !== "schema" &&
      key !== "defaultLocale" &&
      key !== "deliveryKind" &&
      key !== "elevenlabs" &&
      key !== "yandex" &&
      key !== "openai"
  );
  if (unknownKeys.length > 0) {
    return new Error(`voiceProfile has unknown fields: ${unknownKeys.join(", ")}.`);
  }

  if (value.schema !== undefined && value.schema !== ASSISTANT_VOICE_PROFILE_SCHEMA) {
    return new Error(`voiceProfile.schema must be "${ASSISTANT_VOICE_PROFILE_SCHEMA}".`);
  }

  if (
    value.defaultLocale !== undefined &&
    normalizeOptionalNonEmptyString(value.defaultLocale, MAX_LOCALE_LENGTH) === null
  ) {
    return new Error("voiceProfile.defaultLocale must be a non-empty string when provided.");
  }

  if (
    value.deliveryKind !== undefined &&
    parseEnumOrNull(value.deliveryKind, PERSAI_RUNTIME_TTS_DELIVERY_KINDS) === null
  ) {
    return new Error(
      `voiceProfile.deliveryKind must be one of ${PERSAI_RUNTIME_TTS_DELIVERY_KINDS.join(", ")}.`
    );
  }

  if (
    value.elevenlabs !== undefined &&
    (!isPlainObject(value.elevenlabs) ||
      Object.keys(value.elevenlabs).some((key) => key !== "voiceId"))
  ) {
    return new Error('voiceProfile.elevenlabs must only contain "voiceId".');
  }
  if (
    isPlainObject(value.elevenlabs) &&
    value.elevenlabs.voiceId !== undefined &&
    value.elevenlabs.voiceId !== null &&
    normalizeOptionalNonEmptyString(value.elevenlabs.voiceId, MAX_VOICE_ID_LENGTH) === null
  ) {
    return new Error(
      "voiceProfile.elevenlabs.voiceId must be a non-empty string, null, or omitted."
    );
  }

  if (
    value.yandex !== undefined &&
    (!isPlainObject(value.yandex) ||
      Object.keys(value.yandex).some((key) => key !== "voice" && key !== "role"))
  ) {
    return new Error('voiceProfile.yandex must only contain "voice" and "role".');
  }
  if (
    isPlainObject(value.yandex) &&
    value.yandex.voice !== undefined &&
    value.yandex.voice !== null &&
    parseEnumOrNull(value.yandex.voice, PERSAI_RUNTIME_YANDEX_TTS_VOICES) === null
  ) {
    return new Error(
      `voiceProfile.yandex.voice must be one of ${PERSAI_RUNTIME_YANDEX_TTS_VOICES.join(", ")}.`
    );
  }
  if (
    isPlainObject(value.yandex) &&
    value.yandex.role !== undefined &&
    value.yandex.role !== null &&
    parseEnumOrNull(value.yandex.role, PERSAI_RUNTIME_YANDEX_TTS_ROLES) === null
  ) {
    return new Error(
      `voiceProfile.yandex.role must be one of ${PERSAI_RUNTIME_YANDEX_TTS_ROLES.join(", ")}.`
    );
  }

  if (
    value.openai !== undefined &&
    (!isPlainObject(value.openai) || Object.keys(value.openai).some((key) => key !== "voice"))
  ) {
    return new Error('voiceProfile.openai must only contain "voice".');
  }
  if (
    isPlainObject(value.openai) &&
    value.openai.voice !== undefined &&
    value.openai.voice !== null &&
    parseEnumOrNull(value.openai.voice, PERSAI_RUNTIME_OPENAI_TTS_VOICES) === null
  ) {
    return new Error(
      `voiceProfile.openai.voice must be one of ${PERSAI_RUNTIME_OPENAI_TTS_VOICES.join(", ")}.`
    );
  }

  return normalizeAssistantVoiceProfile(value);
}

export function applyAssistantGenderVoiceDefaults(input: {
  assistantGender: string | null;
  voiceProfile: RuntimeAssistantVoiceProfile;
}): RuntimeAssistantVoiceProfile {
  const gender = input.assistantGender?.trim().toLowerCase() ?? null;
  const yandexVoice = input.voiceProfile.yandex.voice ?? resolveDefaultYandexVoiceForGender(gender);
  const openaiVoice = input.voiceProfile.openai.voice ?? resolveDefaultOpenAIVoiceForGender(gender);

  return {
    ...input.voiceProfile,
    yandex: {
      voice: yandexVoice,
      role: input.voiceProfile.yandex.role
    },
    openai: {
      voice: openaiVoice
    }
  };
}

export function resolveDefaultYandexVoiceForGender(
  assistantGender: string | null
): PersaiRuntimeYandexTtsVoice {
  switch (assistantGender) {
    case "male":
      return "ermil";
    case "female":
      return "jane";
    default:
      return "marina";
  }
}

export function resolveDefaultOpenAIVoiceForGender(
  assistantGender: string | null
): PersaiRuntimeOpenAITtsVoice {
  switch (assistantGender) {
    case "male":
      return "cedar";
    case "female":
      return "marin";
    default:
      return "sage";
  }
}
