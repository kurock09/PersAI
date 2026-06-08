import assert from "node:assert/strict";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayTextGenerateRequest,
  RuntimeTurnRequest
} from "@persai/runtime-contract";
import { SkillStateRoutingService } from "../src/modules/turns/skill-state-routing.service";
import type { ProviderGatewayClientService } from "../src/modules/turns/provider-gateway.client.service";

class FakeProviderGatewayClientService {
  requests: ProviderGatewayTextGenerateRequest[] = [];

  isConfigured(): boolean {
    return true;
  }

  async generateText(request: ProviderGatewayTextGenerateRequest) {
    this.requests.push(request);
    return {
      provider: request.provider,
      model: request.model,
      text: JSON.stringify({
        decision: "no_change",
        skillId: null,
        topicSummary: null,
        confidence: "medium",
        reasonCode: "unchanged"
      }),
      usage: null,
      respondedAt: "2026-06-09T00:00:00.000Z",
      stopReason: "completed",
      toolCalls: []
    };
  }
}

function createBundle(): AssistantRuntimeBundle {
  return {
    metadata: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      publishedVersionId: "published-1"
    },
    persona: { displayName: "PersAI" },
    userContext: { locale: "en", timezone: "UTC" },
    runtime: {
      routingFastModelKey: "fast-model",
      runtimeProviderRouting: {
        primaryPath: { providerKey: "openai", modelKey: "main-model", active: true },
        modelSlots: {
          classifier: { providerKey: "openai", modelKey: "fast-model" }
        }
      }
    },
    skills: {
      enabled: [
        {
          id: "skill-1",
          name: "Launch Coach",
          shortDescription: "Helps with launches",
          category: "business",
          tags: ["launch"],
          routingExamples: ["plan launch"]
        }
      ]
    },
    promptDocuments: {
      soul: "",
      user: "",
      identity: "",
      tools: "",
      agents: "",
      heartbeat: "",
      skillStateClassifier: "Return skill state JSON.",
      preview: "",
      welcome: ""
    },
    promptConstructor: {
      ordinary: {
        stablePrefix: { text: null, hash: null },
        sections: {
          assistantIdentity: null,
          userIdentity: null,
          locale: "User locale: en",
          timezone: "User timezone: UTC",
          personaInstructions: null,
          soul: "",
          user: "",
          identity: "",
          enabledSkills: "",
          tools: "",
          agents: "",
          heartbeat: ""
        },
        systemPrompt: null
      },
      onboarding: {
        previewTurnPrompt: "",
        welcomeTurnPrompt: "",
        firstTurnPrompt: ""
      }
    },
    governance: { toolPolicies: [] },
    channels: {}
  } as unknown as AssistantRuntimeBundle;
}

function createRequest(): RuntimeTurnRequest {
  return {
    requestId: "request-1",
    idempotencyKey: "request-1",
    runtimeTier: "paid_shared_restricted",
    bundle: {
      bundleId: "bundle-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      publishedVersionId: "published-1",
      bundleHash: "hash-1",
      compiledAt: "2026-06-09T00:00:00.000Z"
    },
    conversation: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "thread-1",
      externalUserKey: "user-1",
      mode: "direct"
    },
    message: {
      text: "keep going",
      attachments: [],
      locale: "en",
      timezone: "UTC",
      receivedAt: "2026-06-09T00:00:00.000Z"
    },
    skillStateContext: {
      decision: null,
      cadence: null,
      currentUserMessageIndex: 7,
      recentMessages: [{ role: "user", text: "can you help plan the launch?" }],
      forceCheck: true,
      checkReason: "background_cadence"
    }
  };
}

async function run(): Promise<void> {
  const providerGateway = new FakeProviderGatewayClientService();
  const service = new SkillStateRoutingService(
    providerGateway as unknown as ProviderGatewayClientService
  );

  const result = await service.checkSkillState({
    bundle: createBundle(),
    request: createRequest()
  });

  assert.equal(result.skillState?.status, "inactive");
  assert.equal(providerGateway.requests.length, 1);
  const request = providerGateway.requests[0]!;
  assert.equal(request.requestMetadata?.classification, "skill_state_classifier");
  assert.match(String(request.messages[0]?.content ?? ""), /Check reason: background_cadence/);
}

void run();
