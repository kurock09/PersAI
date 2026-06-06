import assert from "node:assert/strict";
import { KnowledgeRetrievalHelperService } from "../src/modules/workspace-management/application/knowledge-retrieval-helper.service";
import type { KnowledgeModelPolicyService } from "../src/modules/workspace-management/application/knowledge-model-policy.service";
import type { ResolvePlatformRuntimeProviderSettingsService } from "../src/modules/workspace-management/application/resolve-platform-runtime-provider-settings.service";

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

  const previousFetch = globalThis.fetch;
  const capturedRequests: Array<Record<string, unknown>> = [];

  const knowledgeModelPolicyService = {
    resolveAssistantRetrievalPolicy: async () => ({
      defaultMaxResults: 6,
      maxMaxResults: 10,
      lexicalCandidateLimit: 60,
      vectorCandidateLimit: 240,
      knowledgeFetchWindowRadius: 3,
      chatFetchWindowRadius: 10,
      fetchMaxChars: 8000,
      helperEnabled: true,
      helperCandidateLimit: 6,
      helperMaxOutputTokens: 220,
      embeddingSearchEnabled: true,
      smartSearchShortDocChars: 2000,
      smartSearchMediumDocChars: 8000,
      chatSectionDefaultRadius: 15,
      fetchFullModeMaxChars: 25000,
      fetchFullModeMaxChatMessages: 150
    }),
    resolveAssistantRetrievalModelKey: async () => "gpt-5.4-nano"
  } as KnowledgeModelPolicyService;

  const resolvePlatformRuntimeProviderSettingsService = {
    execute: async () => ({
      schema: "persai.adminRuntimeProviderSettings.v2",
      mode: "global_settings",
      primary: { provider: "openai", model: "gpt-5.4" },
      fallback: { provider: "anthropic", model: "claude-sonnet-4-5" },
      routingFastModelKey: null,
      routerPolicy: {
        enabled: false,
        mode: "shadow",
        classifierFailureFallbackMode: "normal",
        clarifyOnMissingContext: true,
        analyzeUploadsOnB2cUpload: false,
        precheckRuleOverrides: null
      },
      skillRoutingPolicy: {
        initialCheckUserMessageIndex: 3,
        backgroundRecheckIntervalMessages: 5
      },
      availableModelsByProvider: { openai: ["gpt-5.4"], anthropic: ["claude-sonnet-4-5"] },
      availableModelCatalogByProvider: { openai: { models: [] }, anthropic: { models: [] } },
      providerKeys: {
        openai: { configured: true, lastFour: "1234", updatedAt: null },
        anthropic: { configured: true, lastFour: "5678", updatedAt: null }
      },
      vcoinExchangeRate: 20,
      heygenPersonaWorkspaceLimit: 10,
      heygenPersonaCreationVcoin: 20,
      notes: []
    })
  } as ResolvePlatformRuntimeProviderSettingsService;

  const service = new KnowledgeRetrievalHelperService(
    knowledgeModelPolicyService,
    resolvePlatformRuntimeProviderSettingsService
  );

  try {
    let fetchStep = 0;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedRequests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      fetchStep += 1;
      if (fetchStep === 1) {
        return new Response("upstream unavailable", { status: 503 });
      }
      return new Response(
        JSON.stringify({
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          text: JSON.stringify({ rankedReferenceIds: ["ref-2", "ref-1"] }),
          respondedAt: "2026-06-06T20:00:00.000Z",
          usage: null,
          stopReason: "completed",
          toolCalls: []
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;

    const fallbackResult = await service.rerankCandidates({
      assistantId: "assistant-1",
      query: "best answer",
      candidates: [
        { referenceId: "ref-1", title: "One", locator: null, snippet: "A" },
        { referenceId: "ref-2", title: "Two", locator: null, snippet: "B" }
      ]
    });
    assert.deepEqual(fallbackResult?.rankedReferenceIds, ["ref-2", "ref-1"]);
    assert.equal(fallbackResult?.providerKey, "anthropic");
    assert.equal(fallbackResult?.modelKey, "claude-sonnet-4-5");
    assert.equal(capturedRequests.length, 2);
    assert.equal(capturedRequests[0]?.provider, "openai");
    assert.equal(capturedRequests[1]?.provider, "anthropic");

    capturedRequests.length = 0;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedRequests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          provider: "openai",
          model: "gpt-5.4-nano",
          text: JSON.stringify({ rankedReferenceIds: ["ref-1", "ref-2"] }),
          respondedAt: "2026-06-06T20:01:00.000Z",
          usage: null,
          stopReason: "completed",
          toolCalls: []
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;
    const primaryResult = await service.rerankCandidates({
      assistantId: "assistant-1",
      query: "primary answer",
      candidates: [
        { referenceId: "ref-1", title: "One", locator: null, snippet: "A" },
        { referenceId: "ref-2", title: "Two", locator: null, snippet: "B" }
      ]
    });
    assert.deepEqual(primaryResult?.rankedReferenceIds, ["ref-1", "ref-2"]);
    assert.equal(primaryResult?.providerKey, "openai");
    assert.equal(primaryResult?.modelKey, "gpt-5.4-nano");
    assert.equal(capturedRequests.length, 1);
    assert.equal(capturedRequests[0]?.provider, "openai");
    assert.equal(capturedRequests[0]?.model, "gpt-5.4-nano");

    capturedRequests.length = 0;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedRequests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response("bad request", { status: 400 });
    }) as typeof fetch;
    const invalidResult = await service.rerankCandidates({
      assistantId: "assistant-1",
      query: "bad input",
      candidates: [
        { referenceId: "ref-1", title: "One", locator: null, snippet: "A" },
        { referenceId: "ref-2", title: "Two", locator: null, snippet: "B" }
      ]
    });
    assert.equal(invalidResult, null);
    assert.equal(capturedRequests.length, 1, "non-retryable helper failure must not fallback");

    const helperOffService = new KnowledgeRetrievalHelperService(
      {
        ...knowledgeModelPolicyService,
        resolveAssistantRetrievalModelKey: async () => null
      } as KnowledgeModelPolicyService,
      resolvePlatformRuntimeProviderSettingsService
    );
    capturedRequests.length = 0;
    const helperOffResult = await helperOffService.rerankCandidates({
      assistantId: "assistant-1",
      query: "disabled helper",
      candidates: [
        { referenceId: "ref-1", title: "One", locator: null, snippet: "A" },
        { referenceId: "ref-2", title: "Two", locator: null, snippet: "B" }
      ]
    });
    assert.equal(helperOffResult, null);
    assert.equal(capturedRequests.length, 0, "unset helper model must remain graceful-off");
  } finally {
    globalThis.fetch = previousFetch;
    process.env.APP_ENV = previousEnv.APP_ENV;
    process.env.DATABASE_URL = previousEnv.DATABASE_URL;
    process.env.CLERK_SECRET_KEY = previousEnv.CLERK_SECRET_KEY;
    process.env.PERSAI_INTERNAL_API_TOKEN = previousEnv.PERSAI_INTERNAL_API_TOKEN;
    process.env.PERSAI_PROVIDER_GATEWAY_BASE_URL = previousEnv.PERSAI_PROVIDER_GATEWAY_BASE_URL;
  }
}

void run();
