import assert from "node:assert/strict";
import { GenerateSkillAuthoringDraftService } from "../src/modules/workspace-management/application/generate-skill-authoring-draft.service";

async function run(): Promise<void> {
  const previousEnv = {
    APP_ENV: process.env.APP_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    PERSAI_INTERNAL_API_TOKEN: process.env.PERSAI_INTERNAL_API_TOKEN,
    PERSAI_PROVIDER_GATEWAY_BASE_URL: process.env.PERSAI_PROVIDER_GATEWAY_BASE_URL
  };
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL = "postgresql://persai:persai@localhost:5432/persai";
  process.env.CLERK_SECRET_KEY = "test-clerk-secret";
  process.env.PERSAI_INTERNAL_API_TOKEN = "test-internal-token";
  process.env.PERSAI_PROVIDER_GATEWAY_BASE_URL = "http://provider-gateway.test";

  const capturedRequests: unknown[] = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedRequests.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(
      JSON.stringify({
        provider: "openai",
        model: "gpt-5.1",
        text: JSON.stringify({
          skillDraft: {
            name: { en: "Electronics Engineer", ru: "Инженер-схемотехник" },
            description: { en: "Circuit and PCB design support." },
            category: "engineering",
            tags: ["electronics", "pcb"],
            instructionCard: {
              title: "Electronics engineering mode",
              body: "Help with circuits, component choices, PCB planning, and bring-up while stating assumptions and uncertainty.",
              guardrails: ["Do not certify safety-critical designs."],
              examples: ["Review a schematic checklist."]
            },
            iconEmoji: "⚡",
            color: "amber"
          },
          knowledgeCards: [
            {
              title: "Bring-up checklist",
              body: "Start board bring-up with visual inspection, current-limited power, rail checks, and staged subsystem validation.",
              locale: "en",
              tags: ["bring-up"]
            }
          ],
          warnings: ["Verify domain-specific safety requirements before activation."]
        }),
        respondedAt: "2026-05-01T12:00:00.000Z",
        usage: null,
        stopReason: "completed",
        toolCalls: []
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const service = new GenerateSkillAuthoringDraftService(
      {
        skill: {
          findFirst: async () => ({
            id: "skill-1",
            workspaceId: "ws-1",
            status: "draft",
            name: { en: "Electronics" },
            description: {},
            category: "engineering",
            tags: [],
            instructionCard: { title: "Draft", body: "Draft", guardrails: [], examples: [] },
            iconEmoji: null,
            color: null,
            documents: [
              {
                displayName: "Board notes",
                description: "Initial PCB notes",
                status: "ready",
                originalFilename: "board.pdf",
                mimeType: "application/pdf"
              }
            ],
            knowledgeCards: []
          })
        }
      } as never,
      {
        assertCanWriteGlobalKnowledge: async () => ({ userId: "admin-1", workspaceId: "ws-1" })
      } as never,
      {
        resolveAdminKnowledgeAuthoringModelKey: async () => "gpt-5.1"
      } as never,
      {
        execute: async () => ({
          schema: "persai.adminRuntimeProviderSettings.v1",
          mode: "global_settings",
          primary: { provider: "openai", model: "gpt-4o-mini" },
          fallback: null,
          routingFastModelKey: null,
          routerPolicy: {
            enabled: false,
            mode: "shadow",
            classifierFailureFallbackMode: "normal",
            clarifyOnMissingContext: true,
            precheckRuleOverrides: null
          },
          availableModelsByProvider: { openai: ["gpt-5.1"], anthropic: [] },
          availableModelCatalogByProvider: {
            openai: { chat: ["gpt-5.1"], image: [], video: [] },
            anthropic: { chat: [], image: [], video: [] }
          },
          providerKeys: {
            openai: { configured: true, lastFour: "1234", updatedAt: null },
            anthropic: { configured: false, lastFour: null, updatedAt: null }
          },
          notes: []
        })
      } as never
    );

    const proposal = await service.execute({
      userId: "admin-1",
      skillId: "skill-1",
      request: service.parseInput({
        prompt: "Make it production-quality.",
        currentDraft: { name: { en: "Electronics" } }
      })
    });

    assert.equal(proposal.schema, "persai.skillAuthoringDraftProposal.v1");
    assert.equal(proposal.providerKey, "openai");
    assert.equal(proposal.modelKey, "gpt-5.1");
    assert.equal(proposal.skillDraft.name?.ru, "Инженер-схемотехник");
    assert.equal(proposal.knowledgeCards[0]?.lifecycleStatus, "draft");
    assert.equal(proposal.knowledgeCards[0]?.provenanceKind, "assistant_generated");

    const providerRequest = capturedRequests[0] as {
      model?: string;
      provider?: string;
      requestMetadata?: {
        classification?: string;
        runtimeSessionId?: string | null;
        toolLoopIteration?: number | null;
      };
    };
    assert.equal(providerRequest.provider, "openai");
    assert.equal(providerRequest.model, "gpt-5.1");
    assert.equal(providerRequest.requestMetadata?.classification, "admin_authoring");
    assert.equal(providerRequest.requestMetadata?.runtimeSessionId, null);
    assert.equal(providerRequest.requestMetadata?.toolLoopIteration, null);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

void run();
