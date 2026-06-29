import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException } from "@nestjs/common";
import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import type { RuntimeDocumentJobRunRequest, RuntimeOutputArtifact } from "@persai/runtime-contract";
import { RuntimeDocumentProviderAdapterService } from "../src/modules/turns/runtime-document-provider-adapter.service";

const stubArtifact: RuntimeOutputArtifact = {
  artifactId: "artifact-1",
  kind: "file",
  storagePath: "/workspace/deck.pptx",
  mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  sizeBytes: 1024,
  filename: "deck.pptx",
  voiceNote: false,
  sourceToolCode: "document",
  billingFacts: null
};

function buildBundle(options: {
  configuredGamma: boolean;
  includeDocumentCredentialChain?: boolean;
}): AssistantRuntimeBundle {
  const gammaCredential: AssistantRuntimeBundleToolCredentialRef = {
    refKey: "document:gamma",
    providerId: "gamma",
    configured: options.configuredGamma,
    secretRef: { source: "admin", provider: "gamma", id: "secret-gamma" },
    fallbacks: []
  };
  return {
    metadata: {
      assistantId: "00000000-0000-0000-0000-000000000001",
      workspaceId: "00000000-0000-0000-0000-000000000002",
      assistantHandle: "alice",
      siblingAssistantHandles: []
    },
    runtime: {
      workerTools: {
        tools: [{ toolCode: "document", timeoutMs: 5000 }]
      }
    },
    governance: {
      toolCredentialRefs:
        options.includeDocumentCredentialChain === false
          ? { document: null }
          : { document: gammaCredential },
      quota: {
        workspaceQuotaBytes: 10_000_000,
        sharedQuotaBytes: 10_000_000
      }
    },
    promptConstructor: {}
  } as unknown as AssistantRuntimeBundle;
}

function buildRequest(overrides?: {
  provider?: string;
  outputFormat?: "pdf" | "pptx";
  descriptorMode?: "create_presentation" | "revise_document" | "export_or_redeliver";
}): RuntimeDocumentJobRunRequest {
  return {
    assistantId: "00000000-0000-0000-0000-000000000001",
    workspaceId: "00000000-0000-0000-0000-000000000002",
    runtimeTier: "paid_shared_restricted",
    runtimeBundleDocument: '{"metadata":{"locale":"en"}}',
    job: {
      id: "job-1",
      docId: "doc-1",
      versionId: "ver-1",
      surface: "web",
      chatId: "chat-1",
      provider: (overrides?.provider ?? "gamma") as "gamma",
      outputFormat: overrides?.outputFormat ?? "pptx",
      sourceUserMessageId: "msg-1",
      sourceUserMessageText: "Make a startup investor deck.",
      sourceUserMessageCreatedAt: new Date().toISOString()
    },
    attachments: [],
    directToolExecution: {
      toolCode: "document",
      descriptorMode: overrides?.descriptorMode ?? "create_presentation",
      request: {
        prompt: "Make a deck about our startup."
      }
    }
  };
}

export async function runRuntimeDocumentProviderAdapterServiceTest(): Promise<void> {
  await test("rejects non-gamma providers with a workspace-workflow guidance", async () => {
    const service = new RuntimeDocumentProviderAdapterService(
      { generateDocumentOutcome: async () => ({ ok: true, result: {} as never }) } as never,
      {} as never
    );
    await assert.rejects(
      () =>
        service.run({
          bundle: buildBundle({ configuredGamma: true }),
          request: buildRequest({ provider: "sandbox" })
        }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /no longer supported by the worker/.test(error.message) &&
        /visible workspace/.test(error.message)
    );
  });

  await test("rejects when gamma credential is missing", async () => {
    const service = new RuntimeDocumentProviderAdapterService(
      { generateDocumentOutcome: async () => ({ ok: true, result: {} as never }) } as never,
      {} as never
    );
    await assert.rejects(
      () =>
        service.run({
          bundle: buildBundle({ configuredGamma: true, includeDocumentCredentialChain: false }),
          request: buildRequest()
        }),
      (error: unknown) =>
        error instanceof BadRequestException && /not configured/.test(error.message)
    );
  });

  await test("rejects when gamma credential is not active", async () => {
    const service = new RuntimeDocumentProviderAdapterService(
      { generateDocumentOutcome: async () => ({ ok: true, result: {} as never }) } as never,
      {} as never
    );
    await assert.rejects(
      () =>
        service.run({
          bundle: buildBundle({ configuredGamma: false }),
          request: buildRequest()
        }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /not configured with an active admin credential/.test(error.message)
    );
  });

  await test("forwards a successful gamma outcome as a presentation artifact", async () => {
    let receivedFilename = "";
    const providerGatewayStub = {
      generateDocumentOutcome: async (input: {
        filename: string;
        providerOptions: { outputFormat: "pdf" | "pptx" };
      }): Promise<{
        ok: true;
        result: {
          bytesBase64: string;
          mimeType: string;
          providerStatus: Record<string, unknown>;
          billingFacts: null;
        };
      }> => {
        receivedFilename = input.filename;
        return {
          ok: true,
          result: {
            bytesBase64: Buffer.from("hello").toString("base64"),
            mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            providerStatus: { provider: "gamma", state: "success" },
            billingFacts: null
          }
        };
      }
    };
    const sandboxStub = {} as never;
    const service = new RuntimeDocumentProviderAdapterService(
      providerGatewayStub as never,
      sandboxStub
    );
    const persistedArtifacts: RuntimeOutputArtifact[] = [];
    (service as unknown as { persistGeneratedArtifact: () => Promise<RuntimeOutputArtifact> })[
      "persistGeneratedArtifact"
    ] = async () => {
      persistedArtifacts.push(stubArtifact);
      return stubArtifact;
    };

    const result = await service.run({
      bundle: buildBundle({ configuredGamma: true }),
      request: buildRequest({ outputFormat: "pptx" })
    });

    assert.equal(persistedArtifacts.length, 1);
    assert.equal(receivedFilename.endsWith(".pptx"), true);
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.toolInvocations[0]?.ok, true);
    assert.equal(result.toolInvocations[0]?.executionMode, "worker");
  });

  await test("propagates gamma provider failures", async () => {
    const providerGatewayStub = {
      generateDocumentOutcome: async (): Promise<{
        ok: false;
        code: string;
        retryable: boolean;
        status: number | null;
        message: string;
        providerStatus: Record<string, unknown> | null;
      }> => ({
        ok: false,
        code: "gamma_timeout",
        retryable: true,
        status: 504,
        message: "Gamma upstream timeout",
        providerStatus: { provider: "gamma", state: "failed" }
      })
    };
    const service = new RuntimeDocumentProviderAdapterService(
      providerGatewayStub as never,
      {} as never
    );

    const result = await service.run({
      bundle: buildBundle({ configuredGamma: true }),
      request: buildRequest()
    });

    assert.equal(result.artifacts.length, 0);
    assert.equal(result.toolInvocations[0]?.ok, false);
    const providerStatus = result.providerStatus as Record<string, unknown> | null | undefined;
    assert.ok(providerStatus !== null && providerStatus !== undefined);
    assert.equal(providerStatus.errorCode, "gamma_timeout");
    assert.equal(providerStatus.retryable, true);
  });
}
