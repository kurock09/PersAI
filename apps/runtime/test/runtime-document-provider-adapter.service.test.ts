import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException } from "@nestjs/common";
import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import type { RuntimeDocumentJobRunRequest, RuntimeOutputArtifact } from "@persai/runtime-contract";
import { RuntimeDocumentProviderAdapterService } from "../src/modules/turns/runtime-document-provider-adapter.service";
import {
  createFakeMediaObjectStorageForOutboundWrite,
  createOutboundManifestApiStub
} from "./helpers/runtime-outbound-test-doubles";

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
    runtimeSessionId: "runtime-session-1",
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
      {} as never,
      createOutboundManifestApiStub() as never
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
        /document\.inspect \/ document\.render \/ document\.convert/.test(error.message) &&
        /files\.attach/.test(error.message)
    );
  });

  await test("rejects when gamma credential is missing", async () => {
    const service = new RuntimeDocumentProviderAdapterService(
      { generateDocumentOutcome: async () => ({ ok: true, result: {} as never }) } as never,
      {} as never,
      createOutboundManifestApiStub() as never
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
      {} as never,
      createOutboundManifestApiStub() as never
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
    let savedObjectKey: string | null = null;
    const mediaStorageStub = createFakeMediaObjectStorageForOutboundWrite(
      "/workspace/assistants/00000000-0000-0000-0000-000000000001/sessions/runtime-session-1/deck.pptx"
    );
    const originalSaveObject = mediaStorageStub.saveObject.bind(mediaStorageStub);
    mediaStorageStub.saveObject = async (input) => {
      savedObjectKey = input.objectKey;
      return originalSaveObject(input);
    };
    const service = new RuntimeDocumentProviderAdapterService(
      providerGatewayStub as never,
      mediaStorageStub as never,
      createOutboundManifestApiStub() as never
    );

    const result = await service.run({
      bundle: buildBundle({ configuredGamma: true }),
      request: buildRequest({ outputFormat: "pptx" })
    });

    assert.equal(receivedFilename.endsWith(".pptx"), true);
    assert.ok(savedObjectKey !== null);
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0]?.sourceToolCode, "document");
    assert.equal(
      result.artifacts[0]?.storagePath.startsWith(
        "/workspace/assistants/00000000-0000-0000-0000-000000000001/sessions/runtime-session-1/"
      ),
      true
    );
    assert.equal(result.toolInvocations[0]?.ok, true);
    assert.equal(result.toolInvocations[0]?.executionMode, "worker");
  });

  await test("persistGeneratedArtifact writes presentation bytes via GCS saveObject", async () => {
    let savedMimeType: string | null = null;
    const mediaStorageStub = createFakeMediaObjectStorageForOutboundWrite();
    const originalSaveObject = mediaStorageStub.saveObject.bind(mediaStorageStub);
    mediaStorageStub.saveObject = async (input) => {
      savedMimeType = input.mimeType;
      return originalSaveObject(input);
    };
    const service = new RuntimeDocumentProviderAdapterService(
      {} as never,
      mediaStorageStub as never,
      createOutboundManifestApiStub() as never
    );
    const artifact = await (
      service as unknown as {
        persistGeneratedArtifact(input: {
          assistantId: string;
          workspaceId: string;
          sessionId: string;
          filename: string;
          requestPrompt: string;
          requestedName: string | null;
          buffer: Buffer;
          mimeType: string;
          chatId: string;
          sourceUserMessageText: string;
          sourceUserMessageCreatedAt: string;
          workspaceQuotaBytes: number | null;
          sharedQuotaBytes: number | null;
        }): Promise<RuntimeOutputArtifact>;
      }
    ).persistGeneratedArtifact({
      assistantId: "00000000-0000-0000-0000-000000000001",
      workspaceId: "00000000-0000-0000-0000-000000000002",
      sessionId: "runtime-session-1",
      filename: "deck.pdf",
      requestPrompt: "Investor deck",
      requestedName: null,
      buffer: Buffer.from("pdf-bytes"),
      mimeType: "application/pdf",
      chatId: "chat-1",
      sourceUserMessageText: "make a deck",
      sourceUserMessageCreatedAt: "2026-07-05T00:00:00.000Z",
      workspaceQuotaBytes: null,
      sharedQuotaBytes: null
    });

    assert.equal(savedMimeType, "application/pdf");
    assert.equal(artifact.sourceToolCode, "document");
    assert.equal(artifact.sizeBytes, Buffer.from("pdf-bytes").length);
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
      {} as never,
      createOutboundManifestApiStub() as never
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
