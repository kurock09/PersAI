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

function mockExtractedPdfText(
  service: RuntimeDocumentProviderAdapterService,
  text: string | null,
  error: string | null = null
): void {
  (
    service as unknown as {
      extractPdfText: (buffer: Buffer) => Promise<{ text: string | null; error: string | null }>;
    }
  ).extractPdfText = async () => ({ text, error });
}

function makeHtmlGenerationText(html: string): string {
  return html;
}

function isHtmlGenerationRequest(input: {
  requestMetadata?: { classification?: string };
}): boolean {
  return input.requestMetadata?.classification === "document_html_generation";
}

describe("RuntimeDocumentProviderAdapterService", () => {
  test("generates and persists a PDFMonkey document artifact", async () => {
    const gatewayCalls: ProviderGatewayDocumentGenerateRequest[] = [];
    const savedObjects: Array<{ objectKey: string; mimeType: string; bytes: Buffer }> = [];

    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { requestMetadata?: { classification?: string } }) {
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: isHtmlGenerationRequest(input)
              ? makeHtmlGenerationText(
                  "<!DOCTYPE html><html><body><h1>Business Brief</h1><p>Create a concise business brief with customer-ready content and actionable recommendations for leadership across product, growth, and operations teams.</p></body></html>"
                )
              : JSON.stringify({
                  assistantText: "Your document draft is ready for review."
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
              bytesBase64: Buffer.concat([
                Buffer.from("%PDF-1.4\n", "utf8"),
                Buffer.alloc(1400, "A"),
                Buffer.from("\n%%EOF", "utf8")
              ]).toString("base64"),
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
    mockExtractedPdfText(
      service,
      "This PDF contains enough real document text for PersAI validation to trust the generated document output for users."
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
        async generateText(input: { requestMetadata?: { classification?: string } }) {
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: isHtmlGenerationRequest(input)
              ? "```html\n<!DOCTYPE html><html><body><h1>Recovered Brief</h1><p>Customer-ready PDF content that should still render even if the model wraps the HTML in markdown code fences and adds trailing whitespace around the document.</p></body></html>\n```"
              : JSON.stringify({
                  assistantText: null
                }),
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
              bytesBase64: Buffer.concat([
                Buffer.from("%PDF-1.4\n", "utf8"),
                Buffer.alloc(1400, "B"),
                Buffer.from("\n%%EOF", "utf8")
              ]).toString("base64"),
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
    mockExtractedPdfText(
      service,
      "Recovered brief content with enough trustworthy text for PersAI validation to accept the rendered PDF output."
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

  test("normalizes escaped HTML fragments into a renderable document before provider dispatch", async () => {
    const gatewayCalls: ProviderGatewayDocumentGenerateRequest[] = [];

    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { requestMetadata?: { classification?: string } }) {
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: isHtmlGenerationRequest(input)
              ? "<section><h1>Payback Graph</h1>\n<p>Monthly revenue, break-even point, and окупаемость by month with a forecast covering the next twelve months of growth.</p></section>"
              : JSON.stringify({ assistantText: null }),
            respondedAt: "2026-05-16T19:35:00.000Z",
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
              documentId: "doc-provider-fragment",
              templateId:
                input.providerOptions.outputFormat === "pdf"
                  ? input.providerOptions.pdfmonkeyTemplateId
                  : "template-123",
              filename: input.filename,
              bytesBase64: Buffer.concat([
                Buffer.from("%PDF-1.4\n", "utf8"),
                Buffer.from("Monthly revenue break-even окупаемость ".repeat(40), "utf8"),
                Buffer.from("\n%%EOF", "utf8")
              ]).toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-16T19:35:05.000Z",
              warning: null,
              providerStatus: {
                provider: "pdfmonkey",
                state: "success",
                documentId: "doc-provider-fragment",
                documentTemplateId:
                  input.providerOptions.outputFormat === "pdf"
                    ? input.providerOptions.pdfmonkeyTemplateId
                    : "template-123",
                downloadUrl: "https://example.com/document-fragment.pdf",
                previewUrl: "https://example.com/document-fragment/preview",
                failureCause: null,
                filename: input.filename,
                outputType: "pdf",
                status: "success",
                updatedAt: "2026-05-16T19:35:05.000Z"
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
    mockExtractedPdfText(
      service,
      "Monthly revenue break-even окупаемость forecast assumptions table with enough real text for PersAI validation."
    );

    const result = await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: "{}",
        job: {
          id: "job-fragment-1",
          docId: "doc-1",
          versionId: "version-1",
          surface: "web",
          chatId: "chat-1",
          provider: "pdfmonkey",
          outputFormat: "pdf",
          sourceUserMessageId: "message-1",
          sourceUserMessageText: "Create a payback graph document",
          sourceUserMessageCreatedAt: "2026-05-16T19:34:00.000Z"
        },
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_pdf_document",
          request: {
            prompt: "Create a payback graph document with monthly table",
            requestedName: "payback-graph.pdf"
          }
        }
      }
    });

    assert.equal(gatewayCalls.length, 1);
    assert.match(gatewayCalls[0]!.htmlContent, /<!DOCTYPE html>/);
    assert.match(gatewayCalls[0]!.htmlContent, /<section><h1>Payback Graph/);
    assert.equal(result.artifacts.length, 1);
  });

  test("normalizes requested PDF filenames without duplicating the extension", async () => {
    const gatewayCalls: ProviderGatewayDocumentGenerateRequest[] = [];

    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { requestMetadata?: { classification?: string } }) {
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: isHtmlGenerationRequest(input)
              ? "<!DOCTYPE html><html><body><h1>Onboarding Guide</h1><p>This onboarding guide walks new teammates through the first thirty days at the company with concrete actions, owners, and checkpoints they need to follow.</p></body></html>"
              : JSON.stringify({
                  assistantText: null
                }),
            respondedAt: "2026-05-16T18:40:00.000Z",
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
              documentId: "doc-provider-3",
              templateId:
                input.providerOptions.outputFormat === "pdf"
                  ? input.providerOptions.pdfmonkeyTemplateId
                  : "template-123",
              filename: input.filename,
              bytesBase64: Buffer.concat([
                Buffer.from("%PDF-1.4\n", "utf8"),
                Buffer.alloc(1400, "C"),
                Buffer.from("\n%%EOF", "utf8")
              ]).toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-16T18:40:02.000Z",
              warning: null,
              providerStatus: {
                provider: "pdfmonkey",
                state: "success",
                documentId: "doc-provider-3",
                documentTemplateId:
                  input.providerOptions.outputFormat === "pdf"
                    ? input.providerOptions.pdfmonkeyTemplateId
                    : "template-123",
                downloadUrl: "https://example.com/document-3.pdf",
                previewUrl: "https://example.com/preview-3",
                failureCause: null,
                filename: input.filename,
                outputType: "pdf",
                status: "success",
                updatedAt: "2026-05-16T18:40:02.000Z"
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
    mockExtractedPdfText(
      service,
      "Onboarding guide content with enough trustworthy text for PersAI validation to accept the rendered PDF output."
    );

    const result = await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: "{}",
        job: {
          id: "job-3",
          docId: "doc-3",
          versionId: "version-3",
          surface: "web",
          chatId: "chat-1",
          provider: "pdfmonkey",
          outputFormat: "pdf",
          sourceUserMessageId: "message-3",
          sourceUserMessageText: "Create onboarding guide",
          sourceUserMessageCreatedAt: "2026-05-16T18:39:00.000Z"
        },
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_pdf_document",
          request: {
            prompt: "Create an onboarding guide",
            requestedName: "onboarding-guide.pdf"
          }
        }
      }
    });

    assert.equal(gatewayCalls.length, 1);
    assert.equal(gatewayCalls[0]!.filename, "onboarding-guide.pdf");
    assert.equal(result.artifacts[0]!.filename, "onboarding-guide.pdf");
  });

  test("returns honest template_not_configured status when materialized PDFMonkey template is missing", async () => {
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText() {
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: "<!DOCTYPE html><html><body><h1>Business Brief</h1><p>Quarterly update with customer-ready content for leadership review across product, growth, and operations.</p></body></html>",
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
            text: "<!DOCTYPE html><html><body><h1>Business Brief</h1><p>Quarterly update with customer-ready content for leadership review across product, growth, and operations.</p></body></html>",
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
    mockExtractedPdfText(
      service,
      "Monthly revenue break-even payback forecast assumptions table with enough real text for PersAI validation."
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

  test("retries once when the first PDF output is too small", async () => {
    const gatewayCalls: ProviderGatewayDocumentGenerateRequest[] = [];
    let attempt = 0;

    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { requestMetadata?: { classification?: string } }) {
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: isHtmlGenerationRequest(input)
              ? "<!DOCTYPE html><html><body><h1>Payback Plan</h1><p>Monthly revenue, break-even, and forecast table with realistic assumptions for the first twelve months of the launch plan.</p></body></html>"
              : JSON.stringify({ assistantText: "Your document is ready." }),
            respondedAt: "2026-05-16T19:30:00.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: null
          };
        },
        async generateDocumentOutcome(
          input: ProviderGatewayDocumentGenerateRequest
        ): Promise<{ ok: true; result: ProviderGatewayDocumentGenerateResult }> {
          gatewayCalls.push(input);
          attempt += 1;
          const pdfBuffer =
            attempt === 1
              ? Buffer.from("%PDF-1.4\n" + "x".repeat(800) + "\n%%EOF", "utf8")
              : Buffer.concat([
                  Buffer.from("%PDF-1.4\n", "utf8"),
                  Buffer.from(
                    "Monthly revenue break-even payback forecast assumptions table ".repeat(40),
                    "utf8"
                  ),
                  Buffer.from("\n%%EOF", "utf8")
                ]);
          return {
            ok: true,
            result: {
              provider: "pdfmonkey",
              outputFormat: "pdf",
              documentId: `doc-provider-${attempt}`,
              templateId:
                input.providerOptions.outputFormat === "pdf"
                  ? input.providerOptions.pdfmonkeyTemplateId
                  : "template-123",
              filename: input.filename,
              bytesBase64: pdfBuffer.toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-16T19:30:10.000Z",
              warning: null,
              providerStatus: {
                provider: "pdfmonkey",
                state: "success",
                documentId: `doc-provider-${attempt}`,
                documentTemplateId:
                  input.providerOptions.outputFormat === "pdf"
                    ? input.providerOptions.pdfmonkeyTemplateId
                    : "template-123",
                downloadUrl: `https://example.com/document-${attempt}.pdf`,
                previewUrl: `https://example.com/document-${attempt}/preview`,
                failureCause: null,
                filename: input.filename,
                outputType: "pdf",
                status: "success",
                updatedAt: "2026-05-16T19:30:10.000Z"
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
    mockExtractedPdfText(
      service,
      "Monthly revenue break-even payback forecast assumptions table with enough real text for PersAI validation."
    );

    const result = await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: "{}",
        job: {
          id: "job-retry-1",
          docId: "doc-1",
          versionId: "version-1",
          surface: "web",
          chatId: "chat-1",
          provider: "pdfmonkey",
          outputFormat: "pdf",
          sourceUserMessageId: "message-1",
          sourceUserMessageText: "Create a payback graph PDF",
          sourceUserMessageCreatedAt: "2026-05-16T19:29:00.000Z"
        },
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_pdf_document",
          request: {
            prompt: "Create a payback graph and financial plan",
            requestedName: "payback-graph.pdf"
          }
        }
      }
    });

    assert.equal(gatewayCalls.length, 2);
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.providerStatus?.state, "success");
  });

  test("delivers PDF when pdf-parse text extraction is unavailable (soft degrade)", async () => {
    const gatewayCalls: ProviderGatewayDocumentGenerateRequest[] = [];

    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { requestMetadata?: { classification?: string } }) {
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: isHtmlGenerationRequest(input)
              ? "<!DOCTYPE html><html><body><h1>Business Brief</h1><p>Customer-ready PDF content with enough body text to pass HTML repair validation before being sent to PDFMonkey for rendering.</p></body></html>"
              : JSON.stringify({ assistantText: null }),
            respondedAt: "2026-05-16T21:10:00.000Z",
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
              documentId: "doc-provider-uninspectable",
              templateId:
                input.providerOptions.outputFormat === "pdf"
                  ? input.providerOptions.pdfmonkeyTemplateId
                  : "template-123",
              filename: input.filename,
              bytesBase64: Buffer.concat([
                Buffer.from("%PDF-1.4\n", "utf8"),
                Buffer.alloc(1400, "Z"),
                Buffer.from("\n%%EOF", "utf8")
              ]).toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-16T21:10:02.000Z",
              warning: null,
              providerStatus: {
                provider: "pdfmonkey",
                state: "success",
                documentId: "doc-provider-uninspectable",
                documentTemplateId:
                  input.providerOptions.outputFormat === "pdf"
                    ? input.providerOptions.pdfmonkeyTemplateId
                    : "template-123",
                downloadUrl: "https://example.com/document-uninspectable.pdf",
                previewUrl: "https://example.com/preview-uninspectable",
                failureCause: null,
                filename: input.filename,
                outputType: "pdf",
                status: "success",
                updatedAt: "2026-05-16T21:10:02.000Z"
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
    mockExtractedPdfText(service, null, "pdf-parse unavailable");

    const result = await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: "{}",
        job: {
          id: "job-uninspectable-1",
          docId: "doc-1",
          versionId: "version-1",
          surface: "web",
          chatId: "chat-1",
          provider: "pdfmonkey",
          outputFormat: "pdf",
          sourceUserMessageId: "message-1",
          sourceUserMessageText: "Create a PDF brief",
          sourceUserMessageCreatedAt: "2026-05-16T21:09:00.000Z"
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

    assert.equal(gatewayCalls.length, 1);
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0]!.mimeType, "application/pdf");
    assert.equal(result.providerStatus?.state, "success");
  });

  test("rejects PDFMonkey output that is not a real PDF (missing %PDF- magic)", async () => {
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { requestMetadata?: { classification?: string } }) {
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: isHtmlGenerationRequest(input)
              ? "<!DOCTYPE html><html><body><h1>Business Brief</h1><p>Customer-ready PDF content with enough body text to pass HTML repair validation before being sent to PDFMonkey for rendering.</p></body></html>"
              : JSON.stringify({ assistantText: null }),
            respondedAt: "2026-05-16T21:30:00.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: null
          };
        },
        async generateDocumentOutcome(
          input: ProviderGatewayDocumentGenerateRequest
        ): Promise<{ ok: true; result: ProviderGatewayDocumentGenerateResult }> {
          return {
            ok: true,
            result: {
              provider: "pdfmonkey",
              outputFormat: "pdf",
              documentId: "doc-not-a-pdf",
              templateId:
                input.providerOptions.outputFormat === "pdf"
                  ? input.providerOptions.pdfmonkeyTemplateId
                  : "template-123",
              filename: input.filename,
              bytesBase64: Buffer.alloc(2048, "Z").toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-16T21:30:02.000Z",
              warning: null,
              providerStatus: {
                provider: "pdfmonkey",
                state: "success",
                documentId: "doc-not-a-pdf",
                documentTemplateId:
                  input.providerOptions.outputFormat === "pdf"
                    ? input.providerOptions.pdfmonkeyTemplateId
                    : "template-123",
                downloadUrl: "https://example.com/not-a-pdf",
                previewUrl: null,
                failureCause: null,
                filename: input.filename,
                outputType: "pdf",
                status: "success",
                updatedAt: "2026-05-16T21:30:02.000Z"
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
    mockExtractedPdfText(service, "");

    const result = await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: "{}",
        job: {
          id: "job-not-a-pdf",
          docId: "doc-1",
          versionId: "version-1",
          surface: "web",
          chatId: "chat-1",
          provider: "pdfmonkey",
          outputFormat: "pdf",
          sourceUserMessageId: "message-1",
          sourceUserMessageText: "Create a PDF brief",
          sourceUserMessageCreatedAt: "2026-05-16T21:29:00.000Z"
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
    assert.equal(result.providerStatus?.state, "invalid_output");
    assert.equal(result.providerStatus?.errorCode, "document_pdf_missing_magic");
  });

  test("simplified retry prompt activates on attempt >= 2 after the first HTML generation fails", async () => {
    const htmlRequests: Array<{
      attempt: number;
      developerInstructions: string | null;
    }> = [];
    let htmlAttempt = 0;
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: {
          developerInstructions?: string;
          requestMetadata?: { classification?: string; runtimeRequestId?: string };
        }) {
          if (isHtmlGenerationRequest(input)) {
            htmlAttempt += 1;
            const requestId = input.requestMetadata?.runtimeRequestId ?? "";
            const attemptMatch = requestId.match(/attempt-(\d+)/);
            const attempt = attemptMatch ? Number(attemptMatch[1]) : htmlAttempt;
            htmlRequests.push({
              attempt,
              developerInstructions: input.developerInstructions ?? null
            });
            if (htmlAttempt === 1) {
              return {
                provider: "openai",
                model: "gpt-4.1-mini",
                text: "no html here, just an apology preamble",
                respondedAt: "2026-05-16T22:00:00.000Z",
                stopReason: "completed",
                toolCalls: [],
                usage: null
              };
            }
            return {
              provider: "openai",
              model: "gpt-4.1-mini",
              text: "<!DOCTYPE html><html><body><h1>Simplified Brief</h1><p>Compact one-page brief generated on the retry pass after the first attempt produced no recognizable HTML output.</p></body></html>",
              respondedAt: "2026-05-16T22:00:05.000Z",
              stopReason: "completed",
              toolCalls: [],
              usage: null
            };
          }
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: JSON.stringify({ assistantText: null }),
            respondedAt: "2026-05-16T22:00:10.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: null
          };
        },
        async generateDocumentOutcome(
          input: ProviderGatewayDocumentGenerateRequest
        ): Promise<{ ok: true; result: ProviderGatewayDocumentGenerateResult }> {
          return {
            ok: true,
            result: {
              provider: "pdfmonkey",
              outputFormat: "pdf",
              documentId: "doc-retry",
              templateId:
                input.providerOptions.outputFormat === "pdf"
                  ? input.providerOptions.pdfmonkeyTemplateId
                  : "template-123",
              filename: input.filename,
              bytesBase64: Buffer.concat([
                Buffer.from("%PDF-1.4\n", "utf8"),
                Buffer.from(
                  "Simplified brief content with realistic body text ".repeat(60),
                  "utf8"
                ),
                Buffer.from("\n%%EOF", "utf8")
              ]).toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-16T22:00:15.000Z",
              warning: null,
              providerStatus: {
                provider: "pdfmonkey",
                state: "success",
                documentId: "doc-retry",
                documentTemplateId:
                  input.providerOptions.outputFormat === "pdf"
                    ? input.providerOptions.pdfmonkeyTemplateId
                    : "template-123",
                downloadUrl: "https://example.com/retry.pdf",
                previewUrl: null,
                failureCause: null,
                filename: input.filename,
                outputType: "pdf",
                status: "success",
                updatedAt: "2026-05-16T22:00:15.000Z"
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
    mockExtractedPdfText(
      service,
      "Simplified brief content with enough characters to satisfy text inspection and PersAI alphanumeric validation across the rendered PDF body output for the user."
    );

    const result = await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: "{}",
        job: {
          id: "job-retry-prompt",
          docId: "doc-1",
          versionId: "version-1",
          surface: "web",
          chatId: "chat-1",
          provider: "pdfmonkey",
          outputFormat: "pdf",
          sourceUserMessageId: "message-1",
          sourceUserMessageText: "Create a simplified brief",
          sourceUserMessageCreatedAt: "2026-05-16T21:59:00.000Z"
        },
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_pdf_document",
          request: {
            prompt: "Create a concise business brief",
            requestedName: "Simplified Brief"
          }
        }
      }
    });

    assert.equal(htmlRequests.length, 2);
    assert.equal(htmlRequests[0]!.attempt, 1);
    assert.equal(htmlRequests[1]!.attempt, 2);
    assert.ok(
      htmlRequests[1]!.developerInstructions?.includes("RETRY MODE"),
      "second attempt should use simplified RETRY MODE instructions"
    );
    assert.ok(
      !(htmlRequests[0]!.developerInstructions?.includes("RETRY MODE") ?? false),
      "first attempt should not use RETRY MODE instructions"
    );
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.providerStatus?.state, "success");
  });

  test("generates and persists a Gamma presentation artifact", async () => {
    const gatewayCalls: ProviderGatewayDocumentGenerateRequest[] = [];
    const savedObjects: Array<{ objectKey: string; mimeType: string; bytes: Buffer }> = [];
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { requestMetadata?: { classification?: string } }) {
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: isHtmlGenerationRequest(input)
              ? "<!DOCTYPE html><html><body><h1>PersAI Deck</h1><p>Create an investor presentation about PersAI with traction, product vision, and funding needs for the next eighteen months of growth.</p></body></html>"
              : JSON.stringify({
                  assistantText: "Your document draft is ready for review."
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
            requestedName: "PersAI Deck",
            visualStyle: "bold_editorial",
            imagePolicy: "web_free_to_use",
            visualDensity: "visual_heavy"
          }
        }
      }
    });

    assert.equal(gatewayCalls.length, 1);
    assert.equal(gatewayCalls[0]!.credential.providerId, "gamma");
    assert.equal(gatewayCalls[0]!.providerOptions.outputFormat, "pptx");
    assert.deepEqual(gatewayCalls[0]!.providerOptions.presentationOptions, {
      textMode: "generate",
      numCards: 6,
      cardSplit: "auto",
      additionalInstructions:
        "Design this as a polished presentation, not a text memo pasted onto slides. Prefer image-led cards, short copy blocks, clear hierarchy, and strong visual contrast. Use bold editorial layouts, large headlines, dramatic contrast, and dynamic compositions. Use visuals deliberately so the deck feels image-rich and presentation-native rather than document-like. Favor punchy slide titles, comparisons, timelines, grids, callouts, and section-divider cards when helpful. User guidance: Focus on traction and product vision.",
      textOptions: {
        amount: "brief",
        language: "en",
        tone: "Focus on traction and product vision.",
        audience: "investors"
      },
      imageOptions: {
        source: "webFreeToUseCommercially"
      },
      cardOptions: {
        dimensions: "16x9"
      }
    });
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
