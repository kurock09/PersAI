import assert from "node:assert/strict";
import {
  applyAssistantGenderVoiceDefaults,
  createDefaultAssistantVoiceProfile
} from "../src/modules/workspace-management/application/assistant-voice-profile";
import { resolveStableTtsProviderChain } from "../src/modules/workspace-management/application/tts-provider-selection";

export async function runAssistantVoiceProfileTest(): Promise<void> {
  const femaleDefaults = applyAssistantGenderVoiceDefaults({
    assistantGender: "female",
    voiceProfile: {
      ...createDefaultAssistantVoiceProfile(),
      yandex: {
        voice: "ermil",
        role: "friendly"
      },
      openai: {
        voice: "cedar"
      }
    }
  });
  assert.equal(femaleDefaults.yandex.voice, "jane");
  assert.equal(femaleDefaults.yandex.role, null);
  assert.equal(femaleDefaults.openai.voice, "marin");

  const neutralSupportedRole = applyAssistantGenderVoiceDefaults({
    assistantGender: "neutral",
    voiceProfile: {
      ...createDefaultAssistantVoiceProfile(),
      yandex: {
        voice: "marina",
        role: "friendly"
      }
    }
  });
  assert.equal(neutralSupportedRole.yandex.voice, "marina");
  assert.equal(neutralSupportedRole.yandex.role, "friendly");

  const stablePrimary = resolveStableTtsProviderChain({
    primaryProviderId: "elevenlabs",
    credentialConfiguredByProvider: {
      elevenlabs: true,
      yandex: true,
      openai: true
    },
    voiceProfile: applyAssistantGenderVoiceDefaults({
      assistantGender: "neutral",
      voiceProfile: {
        ...createDefaultAssistantVoiceProfile(),
        elevenlabs: {
          voiceId: "voice-eleven"
        }
      }
    })
  });
  assert.deepEqual(stablePrimary, ["elevenlabs", "yandex", "openai"]);

  const missingPrimaryVoice = resolveStableTtsProviderChain({
    primaryProviderId: "elevenlabs",
    credentialConfiguredByProvider: {
      elevenlabs: true,
      yandex: true,
      openai: true
    },
    voiceProfile: applyAssistantGenderVoiceDefaults({
      assistantGender: "female",
      voiceProfile: createDefaultAssistantVoiceProfile()
    })
  });
  assert.deepEqual(missingPrimaryVoice, ["yandex", "openai"]);

  const missingPrimaryCredential = resolveStableTtsProviderChain({
    primaryProviderId: "openai",
    credentialConfiguredByProvider: {
      elevenlabs: true,
      yandex: true,
      openai: false
    },
    voiceProfile: applyAssistantGenderVoiceDefaults({
      assistantGender: "neutral",
      voiceProfile: createDefaultAssistantVoiceProfile()
    })
  });
  assert.deepEqual(missingPrimaryCredential, ["yandex"]);
}

void runAssistantVoiceProfileTest();
