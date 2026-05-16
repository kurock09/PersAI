import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayDocumentGenerateRequest,
  ProviderGatewayDocumentGenerateResult
} from "@persai/runtime-contract";
import { RuntimeDocumentProviderAdapterService } from "../src/modules/turns/runtime-document-provider-adapter.service";

function createBundle() {
  return {
    metadata: {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      timezone: "UTC"
    },
    runtime: {
      runtimeProviderRouting: {
        primaryPath: {
          active: true,
          providerKey: "openai",
          modelKey: "gpt-4.1-mini"
        },
        modelSlots: {
          premiumReply: {
            providerKey: "openai",
            modelKey: "gpt-4.1-mini"
          },
          normalReply: {
            providerKey: "openai",
            modelKey: "gpt-4.1-mini"
          }
        }
      },
      workerTools: {
        tools: [
          {
            toolCode: "document",
            timeoutMs: 240000
          }
        ]
      }
    },
    governance: {
      toolCredentialRefs: {
        document: {
          refKey: "persai:persai-runtime:tool/document/pdfmonkey/api-key",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: "tool/document/pdfmonkey/api-key"
          },
          configured: true,
          providerId: "pdfmonkey",
          fallbacks: [
            {
              refKey: "persai:persai-runtime:tool/document/gamma/api-key",
              secretRef: {
                source: "persai",
                provider: "persai-runtime",
                id: "tool/document/gamma/api-key"
              },
              configured: true,
              providerId: "gamma"
            }
          ]
        }
      },
      documentProviderConfig: {
        pdfmonkeyTemplateId: "template-123"
      }
    },
    promptConstructor: {
      ordinary: {
        systemPrompt: "You are PersAI.",
        sections: {
          heartbeat: "Stay grounded."
        }
      }
    },
    persona: {
      displayName: "PersAI"
    },
    userContext: {
      locale: "en",
      timezone: "UTC"
    }
  } as never;
}

describe("RuntimeDocumentProviderAdapterService", () => {
  test("generates and persists a PDFMonkey document artifact", async () => {
    const gatewayCalls: ProviderGatewayDocumentGenerateRequest[] = [];
    const savedObjects: Array<{ objectKey: string; mimeType: string; bytes: Buffer }> = [];

    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { outputSchema?: { name?: string } }) {
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text:
              input.outputSchema?.name === "document_job_completion"
                ? JSON.stringify({
                    assistantText: "Your document draft is ready for review."
                  })
                : JSON.stringify({
                    htmlContent:
                      "<!DOCTYPE html><html><body><h1>Business Brief</h1><p>Create a concise business brief with customer-ready content and actionable recommendations for leadership.</p></body></html>"
                  }),
            respondedAt: "2026-05-15T18:29:00.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: null
          };
        },
        async generateDocumentOutcome(
          input: ProviderGatewayDocumentGenerateRequest
        ): Promise<{ ok: true; result: ProviderGatewayDocumentGenerateResult }> {
          gatewayCalls.push(input);
          return {
            ok: true,
            result: {
              provider: "pdfmonkey",
              outputFormat: "pdf",
              documentId: "doc-provider-1",
              templateId:
                input.providerOptions.outputFormat === "pdf"
                  ? input.providerOptions.pdfmonkeyTemplateId
                  : "template-123",
              filename: input.filename,
              bytesBase64: Buffer.from("%PDF-test").toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-15T18:30:00.000Z",
              warning: null,
              providerStatus: {
                provider: "pdfmonkey",
                state: "success",
                documentId: "doc-provider-1",
                documentTemplateId:
                  input.providerOptions.outputFormat === "pdf"
                    ? input.providerOptions.pdfmonkeyTemplateId
                    : "template-123",
                downloadUrl: "https://example.com/document.pdf",
                previewUrl: "https://example.com/preview",
                failureCause: null,
                filename: input.filename,
                outputType: "pdf",
                status: "success",
                updatedAt: "2026-05-15T18:30:00.000Z"
              }
            }
          };
        }
      } as never,
      {
        buildRuntimeOutputObjectKey(input: { artifactId?: string; extension: string | null }) {
          return `assistant-media/${input.artifactId}.${input.extension}`;
        },
        async saveObject(input: { objectKey: string; buffer: Buffer; mimeType: string }) {
          savedObjects.push({
            objectKey: input.objectKey,
            mimeType: input.mimeType,
            bytes: input.buffer
          });
          return {
            objectKey: input.objectKey,
            sizeBytes: input.buffer.length,
            mimeType: input.mimeType
          };
        }
      } as never,
      {
        async ensureAttachmentBackedFile(input: {
          referenceId: string;
          objectKey: string;
          filename: string | null;
          mimeType: string;
          sizeBytes: number;
        }) {
          return {
            fileRef: `file-${input.referenceId}`,
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            sandboxJobId: null,
            origin: "runtime_output",
            sourceToolCode: "document",
            objectKey: input.objectKey,
            relativePath: `artifacts/${input.filename}`,
            displayName: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            logicalSizeBytes: input.sizeBytes,
            sha256: null,
            metadata: null,
            createdAt: new Date()
          };
        },
        toRuntimeFileRef(record: {
          fileRef: string;
          origin: "runtime_output";
          sourceToolCode: string | null;
          objectKey: string;
          relativePath: string;
          displayName: string | null;
          mimeType: string;
          sizeBytes: number;
          logicalSizeBytes: number | null;
        }) {
          return {
            fileRef: record.fileRef,
            origin: record.origin,
            sourceToolCode: record.sourceToolCode,
            objectKey: record.objectKey,
            relativePath: record.relativePath,
            displayName: record.displayName,
            mimeType: record.mimeType,
            sizeBytes: record.sizeBytes,
            logicalSizeBytes: record.logicalSizeBytes
          };
        }
      } as never
    );

    const result = await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: "{}",
        job: {
          id: "job-1",
          docId: "doc-1",
          versionId: "version-1",
          surface: "web",
          chatId: "chat-1",
          provider: "pdfmonkey",
          outputFormat: "pdf",
          sourceUserMessageId: "message-1",
          sourceUserMessageText: "Create a PDF brief",
          sourceUserMessageCreatedAt: "2026-05-15T12:00:00.000Z"
        },
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_pdf_document",
          request: {
            prompt: "Create a concise business brief",
            instructions: "Use a crisp executive tone.",
            requestedName: "Business Brief"
          }
        }
      }
    });

    assert.equal(gatewayCalls.length, 1);
    assert.match(gatewayCalls[0]!.htmlContent, /Create a concise business brief/);
    assert.equal(
      gatewayCalls[0]!.providerOptions.outputFormat === "pdf"
        ? gatewayCalls[0]!.providerOptions.pdfmonkeyTemplateId
        : null,
      "template-123"
    );
    assert.equal(savedObjects.length, 1);
    assert.equal(savedObjects[0]!.mimeType, "application/pdf");
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0]!.kind, "file");
    assert.equal(result.artifacts[0]!.mimeType, "application/pdf");
    assert.equal(result.assistantText, "Your document draft is ready for review.");
    assert.equal(result.providerStatus?.state, "success");
  });

  test("recovers htmlContent when model wraps or truncates schema JSON around a valid HTML document", async () => {
    const gatewayCalls: ProviderGatewayDocumentGenerateRequest[] = [];

    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { outputSchema?: { name?: string } }) {
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text:
              input.outputSchema?.name === "document_job_completion"
                ? JSON.stringify({
                    assistantText: null
                  })
                : '```json\n{"htmlContent":"<!DOCTYPE html><html><body><h1>Recovered Brief</h1><p>Customer-ready PDF content that should still render even if the model leaves trailing JSON noise.</p></body></html>\n```',
            respondedAt: "2026-05-16T17:25:00.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: null
          };
        },
        async generateDocumentOutcome(
          input: ProviderGatewayDocumentGenerateRequest
        ): Promise<{ ok: true; result: ProviderGatewayDocumentGenerateResult }> {
          gatewayCalls.push(input);
          return {
            ok: true,
            result: {
              provider: "pdfmonkey",
              outputFormat: "pdf",
              documentId: "doc-provider-2",
              templateId:
                input.providerOptions.outputFormat === "pdf"
                  ? input.providerOptions.pdfmonkeyTemplateId
                  : "template-123",
              filename: input.filename,
              bytesBase64: Buffer.from("%PDF-test").toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-16T17:25:02.000Z",
              warning: null,
              providerStatus: {
                provider: "pdfmonkey",
                state: "success",
                documentId: "doc-provider-2",
                documentTemplateId:
                  input.providerOptions.outputFormat === "pdf"
                    ? input.providerOptions.pdfmonkeyTemplateId
                    : "template-123",
                downloadUrl: "https://example.com/document-2.pdf",
                previewUrl: "https://example.com/preview-2",
                failureCause: null,
                filename: input.filename,
                outputType: "pdf",
                status: "success",
                updatedAt: "2026-05-16T17:25:02.000Z"
              }
            }
          };
        }
      } as never,
      {
        buildRuntimeOutputObjectKey(input: { artifactId?: string; extension: string | null }) {
          return `assistant-media/${input.artifactId}.${input.extension}`;
        },
        async saveObject(input: { objectKey: string; buffer: Buffer; mimeType: string }) {
          return {
            objectKey: input.objectKey,
            sizeBytes: input.buffer.length,
            mimeType: input.mimeType
          };
        }
      } as never,
      {
        async ensureAttachmentBackedFile(input: {
          referenceId: string;
          objectKey: string;
          filename: string | null;
          mimeType: string;
          sizeBytes: number;
        }) {
          return {
            fileRef: `file-${input.referenceId}`,
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            sandboxJobId: null,
            origin: "runtime_output",
            sourceToolCode: "document",
            objectKey: input.objectKey,
            relativePath: `artifacts/${input.filename}`,
            displayName: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            logicalSizeBytes: input.sizeBytes,
            sha256: null,
            metadata: null,
            createdAt: new Date()
          };
        },
        toRuntimeFileRef(record: {
          fileRef: string;
          origin: "runtime_output";
          sourceToolCode: string | null;
          objectKey: string;
          relativePath: string;
          displayName: string | null;
          mimeType: string;
          sizeBytes: number;
          logicalSizeBytes: number | null;
        }) {
          return {
            fileRef: record.fileRef,
            origin: record.origin,
            sourceToolCode: record.sourceToolCode,
            objectKey: record.objectKey,
            relativePath: record.relativePath,
            displayName: record.displayName,
            mimeType: record.mimeType,
            sizeBytes: record.sizeBytes,
            logicalSizeBytes: record.logicalSizeBytes
          };
        }
      } as never
    );

    const result = await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: "{}",
        job: {
          id: "job-2",
          docId: "doc-2",
          versionId: "version-2",
          surface: "web",
          chatId: "chat-1",
          provider: "pdfmonkey",
          outputFormat: "pdf",
          sourceUserMessageId: "message-2",
          sourceUserMessageText: "Create a recovered PDF brief",
          sourceUserMessageCreatedAt: "2026-05-16T17:24:00.000Z"
        },
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_pdf_document",
          request: {
            prompt: "Create a concise recovered business brief",
            requestedName: "Recovered Brief"
          }
        }
      }
    });

    assert.equal(gatewayCalls.length, 1);
    assert.match(gatewayCalls[0]!.htmlContent, /Recovered Brief/);
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.providerStatus?.state, "success");
  });

  test("returns honest template_not_configured status when materialized PDFMonkey template is missing", async () => {
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText() {
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: JSON.stringify({
              htmlContent:
                "<!DOCTYPE html><html><body><h1>Business Brief</h1><p>Quarterly update with customer-ready content.</p></body></html>"
            }),
            respondedAt: "2026-05-15T18:29:00.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: null
          };
        }
      } as never,
      {} as never,
      {
        toRuntimeFileRef() {
          return {
            fileRef: "file-1",
            origin: "runtime_output",
            sourceToolCode: "document",
            objectKey: "assistant-media/test.pdf",
            relativePath: "artifacts/test.pdf",
            displayName: "test.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1,
            logicalSizeBytes: 1
          };
        }
      } as never
    );

    const result = await service.run({
      bundle: {
        ...(createBundle() as AssistantRuntimeBundle),
        governance: {
          ...(createBundle() as AssistantRuntimeBundle).governance,
          documentProviderConfig: {
            pdfmonkeyTemplateId: null
          }
        }
      },
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: "{}",
        job: {
          id: "job-1",
          docId: "doc-1",
          versionId: "version-1",
          surface: "web",
          chatId: "chat-1",
          provider: "pdfmonkey",
          outputFormat: "pdf",
          sourceUserMessageId: "message-1",
          sourceUserMessageText: "Create a PDF brief",
          sourceUserMessageCreatedAt: "2026-05-15T12:00:00.000Z"
        },
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_pdf_document",
          request: {
            prompt: "Create a concise business brief"
          }
        }
      }
    });

    assert.deepEqual(result.artifacts, []);
    assert.equal(result.providerStatus?.state, "template_not_configured");
  });

  test("maps deterministic provider failures into terminal non-retryable provider status", async () => {
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText() {
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: JSON.stringify({
              htmlContent:
                "<!DOCTYPE html><html><body><h1>Business Brief</h1><p>Quarterly update with customer-ready content.</p></body></html>"
            }),
            respondedAt: "2026-05-15T18:29:00.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: null
          };
        },
        async generateDocumentOutcome() {
          return {
            ok: false as const,
            status: 401,
            code: "pdfmonkey_auth_failed",
            message: "PDFMonkey rejected the configured credential.",
            retryable: false,
            providerStatus: {
              provider: "pdfmonkey",
              state: "failed",
              status: "http_401",
              httpStatus: 401,
              retryable: false
            }
          };
        }
      } as never,
      {} as never,
      {
        toRuntimeFileRef() {
          return {
            fileRef: "file-1",
            origin: "runtime_output",
            sourceToolCode: "document",
            objectKey: "assistant-media/test.pdf",
            relativePath: "artifacts/test.pdf",
            displayName: "test.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1,
            logicalSizeBytes: 1
          };
        }
      } as never
    );

    const result = await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: "{}",
        job: {
          id: "job-1",
          docId: "doc-1",
          versionId: "version-1",
          surface: "web",
          chatId: "chat-1",
          provider: "pdfmonkey",
          outputFormat: "pdf",
          sourceUserMessageId: "message-1",
          sourceUserMessageText: "Create a PDF brief",
          sourceUserMessageCreatedAt: "2026-05-15T12:00:00.000Z"
        },
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_pdf_document",
          request: {
            prompt: "Create a concise business brief",
            requestedName: "Business Brief"
          }
        }
      }
    });

    assert.deepEqual(result.artifacts, []);
    assert.equal(result.providerStatus?.state, "failed");
    assert.equal(result.providerStatus?.retryable, false);
    assert.equal(result.providerStatus?.httpStatus, 401);
    assert.equal(result.providerStatus?.errorCode, "pdfmonkey_auth_failed");
    assert.equal(
      (result.providerStatus?.providerFailure as { status?: string } | undefined)?.status,
      "http_401"
    );
  });

  test("generates and persists a Gamma presentation artifact", async () => {
    const gatewayCalls: ProviderGatewayDocumentGenerateRequest[] = [];
    const savedObjects: Array<{ objectKey: string; mimeType: string; bytes: Buffer }> = [];
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { outputSchema?: { name?: string } }) {
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text:
              input.outputSchema?.name === "document_job_completion"
                ? JSON.stringify({
                    assistantText: "Your document draft is ready for review."
                  })
                : JSON.stringify({
                    htmlContent:
                      "<!DOCTYPE html><html><body><h1>PersAI Deck</h1><p>Create an investor presentation about PersAI with traction, product vision, and funding needs.</p></body></html>"
                  }),
            respondedAt: "2026-05-15T18:39:00.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: null
          };
        },
        async generateDocumentOutcome(
          input: ProviderGatewayDocumentGenerateRequest
        ): Promise<{ ok: true; result: ProviderGatewayDocumentGenerateResult }> {
          gatewayCalls.push(input);
          return {
            ok: true,
            result: {
              provider: "gamma",
              outputFormat: "pptx",
              documentId: "gamma-file-1",
              templateId: null,
              filename: input.filename,
              bytesBase64: Buffer.from("pptx-test").toString("base64"),
              mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              respondedAt: "2026-05-15T18:40:00.000Z",
              warning: null,
              providerStatus: {
                provider: "gamma",
                state: "success",
                generationId: "gen-1",
                gammaId: "g_123",
                gammaUrl: "https://gamma.app/docs/g_123",
                exportUrl: "https://gamma.app/export/g_123.pptx",
                filename: input.filename,
                outputType: "pptx",
                status: "completed",
                updatedAt: "2026-05-15T18:40:00.000Z"
              }
            }
          };
        }
      } as never,
      {
        buildRuntimeOutputObjectKey(input: { artifactId?: string; extension: string | null }) {
          return `assistant-media/${input.artifactId}.${input.extension}`;
        },
        async saveObject(input: { objectKey: string; buffer: Buffer; mimeType: string }) {
          savedObjects.push({
            objectKey: input.objectKey,
            mimeType: input.mimeType,
            bytes: input.buffer
          });
          return {
            objectKey: input.objectKey,
            sizeBytes: input.buffer.length,
            mimeType: input.mimeType
          };
        }
      } as never,
      {
        async ensureAttachmentBackedFile(input: {
          referenceId: string;
          objectKey: string;
          filename: string | null;
          mimeType: string;
          sizeBytes: number;
        }) {
          return {
            fileRef: `file-${input.referenceId}`,
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            sandboxJobId: null,
            origin: "runtime_output",
            sourceToolCode: "document",
            objectKey: input.objectKey,
            relativePath: `artifacts/${input.filename}`,
            displayName: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            logicalSizeBytes: input.sizeBytes,
            sha256: null,
            metadata: null,
            createdAt: new Date()
          };
        },
        toRuntimeFileRef(record: {
          fileRef: string;
          origin: "runtime_output";
          sourceToolCode: string | null;
          objectKey: string;
          relativePath: string;
          displayName: string | null;
          mimeType: string;
          sizeBytes: number;
          logicalSizeBytes: number | null;
        }) {
          return {
            fileRef: record.fileRef,
            origin: record.origin,
            sourceToolCode: record.sourceToolCode,
            objectKey: record.objectKey,
            relativePath: record.relativePath,
            displayName: record.displayName,
            mimeType: record.mimeType,
            sizeBytes: record.sizeBytes,
            logicalSizeBytes: record.logicalSizeBytes
          };
        }
      } as never
    );

    const result = await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: "{}",
        job: {
          id: "job-2",
          docId: "doc-2",
          versionId: "version-2",
          surface: "web",
          chatId: "chat-2",
          provider: "gamma",
          outputFormat: "pptx",
          sourceUserMessageId: "message-2",
          sourceUserMessageText: "Create a pitch deck",
          sourceUserMessageCreatedAt: "2026-05-15T12:10:00.000Z"
        },
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_presentation",
          request: {
            prompt: "Create an investor presentation about PersAI",
            instructions: "Focus on traction and product vision.",
            requestedName: "PersAI Deck"
          }
        }
      }
    });

    assert.equal(gatewayCalls.length, 1);
    assert.equal(gatewayCalls[0]!.credential.providerId, "gamma");
    assert.equal(gatewayCalls[0]!.providerOptions.outputFormat, "pptx");
    assert.equal(savedObjects.length, 1);
    assert.equal(
      savedObjects[0]!.mimeType,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
    assert.match(savedObjects[0]!.objectKey, /\.pptx$/);
    assert.equal(result.artifacts.length, 1);
    assert.equal(
      result.artifacts[0]!.mimeType,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
    assert.equal(result.assistantText, "Your document draft is ready for review.");
    assert.equal(result.providerStatus?.state, "success");
  });
});
