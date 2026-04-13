import type {
  PersaiRuntimeTtsProviderId,
  RuntimeAssistantVoiceProfile
} from "@persai/runtime-contract";

const TTS_FALLBACKS_BY_PRIMARY: Record<PersaiRuntimeTtsProviderId, PersaiRuntimeTtsProviderId[]> = {
  elevenlabs: ["yandex", "openai"],
  yandex: ["openai"],
  openai: ["yandex"]
};

export function isTtsProviderVoiceCompatible(params: {
  providerId: PersaiRuntimeTtsProviderId;
  voiceProfile: RuntimeAssistantVoiceProfile;
}): boolean {
  switch (params.providerId) {
    case "elevenlabs":
      return (params.voiceProfile.elevenlabs.voiceId?.trim().length ?? 0) > 0;
    case "yandex":
      return params.voiceProfile.yandex.voice !== null;
    case "openai":
      return params.voiceProfile.openai.voice !== null;
  }
}

export function resolveStableTtsProviderChain(params: {
  primaryProviderId: PersaiRuntimeTtsProviderId;
  credentialConfiguredByProvider: Record<PersaiRuntimeTtsProviderId, boolean>;
  voiceProfile: RuntimeAssistantVoiceProfile;
}): PersaiRuntimeTtsProviderId[] {
  const orderedCandidates: PersaiRuntimeTtsProviderId[] = [
    params.primaryProviderId,
    ...TTS_FALLBACKS_BY_PRIMARY[params.primaryProviderId]
  ];

  return orderedCandidates.filter(
    (providerId) =>
      params.credentialConfiguredByProvider[providerId] === true &&
      isTtsProviderVoiceCompatible({
        providerId,
        voiceProfile: params.voiceProfile
      })
  );
}
