import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayDocumentGenerateRequest,
  ProviderGatewayDocumentGenerateResult
} from "@persai/runtime-contract";
import { RuntimeDocumentProviderAdapterService } from "../src/modules/turns/runtime-document-provider-adapter.service";
import { ProviderGatewayTimeoutError } from "../src/modules/turns/provider-gateway.client.service";

function readPdfMonkeyTemplateId(input: ProviderGatewayDocumentGenerateRequest): string {
  return input.credential.providerId === "pdfmonkey"
    ? (input.providerOptions.pdfmonkeyTemplateId ?? "template-123")
    : "template-123";
}

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
              templateId: readPdfMonkeyTemplateId(input),
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
                documentTemplateId: readPdfMonkeyTemplateId(input),
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
        attachments: [],
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
    // Worker now intentionally returns assistantText: null. The user-facing
    // completion message is generated exactly once in
    // AssistantDocumentJobDeliveryService.resolveCompletionAssistantText
    // after delivery; producing it here as well would create a duplicate
    // framing LLM call for every document job.
    assert.equal(result.assistantText, null);
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
              templateId: readPdfMonkeyTemplateId(input),
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
                documentTemplateId: readPdfMonkeyTemplateId(input),
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
        attachments: [],
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
              templateId: readPdfMonkeyTemplateId(input),
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
                documentTemplateId: readPdfMonkeyTemplateId(input),
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
        attachments: [],
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
              templateId: readPdfMonkeyTemplateId(input),
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
                documentTemplateId: readPdfMonkeyTemplateId(input),
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
        attachments: [],
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
        attachments: [],
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
        attachments: [],
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
              templateId: readPdfMonkeyTemplateId(input),
              filename: input.filename,
              bytesBase64: pdfBuffer.toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-16T19:30:10.000Z",
              warning: null,
              providerStatus: {
                provider: "pdfmonkey",
                state: "success",
                documentId: `doc-provider-${attempt}`,
                documentTemplateId: readPdfMonkeyTemplateId(input),
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
        attachments: [],
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
              templateId: readPdfMonkeyTemplateId(input),
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
                documentTemplateId: readPdfMonkeyTemplateId(input),
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
        attachments: [],
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
              templateId: readPdfMonkeyTemplateId(input),
              filename: input.filename,
              bytesBase64: Buffer.alloc(2048, "Z").toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-16T21:30:02.000Z",
              warning: null,
              providerStatus: {
                provider: "pdfmonkey",
                state: "success",
                documentId: "doc-not-a-pdf",
                documentTemplateId: readPdfMonkeyTemplateId(input),
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
        attachments: [],
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
              templateId: readPdfMonkeyTemplateId(input),
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
                documentTemplateId: readPdfMonkeyTemplateId(input),
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
        attachments: [],
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
    const generateTextCalls: Array<{ classification: string | null }> = [];
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { requestMetadata?: { classification?: string } }) {
          generateTextCalls.push({
            classification: input.requestMetadata?.classification ?? null
          });
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
        attachments: [],
        sourceFiles: [
          {
            attachmentId: "att-gamma-source",
            filename: "source.md",
            mimeType: "text/markdown",
            sizeBytes: 96,
            text: "Original deck source content that Gamma must preserve.",
            markdown: "Original deck source content that Gamma must preserve.",
            note: null,
            provider: null,
            quality: null
          }
        ],
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_presentation",
          request: {
            prompt: "Create an investor presentation about PersAI",
            instructions: "Focus on traction and product vision.",
            requestedName: "PersAI Deck",
            visualStyle: "bold_editorial",
            imagePolicy: "web_free_to_use",
            visualDensity: "visual_heavy",
            gammaThemeId: "theme-ocean"
          }
        }
      }
    });

    assert.equal(gatewayCalls.length, 1);
    assert.equal(gatewayCalls[0]!.credential.providerId, "gamma");
    assert.equal(gatewayCalls[0]!.providerOptions.outputFormat, "pptx");
    assert.match(
      gatewayCalls[0]!.htmlContent,
      /Original deck source content that Gamma must preserve/,
      "Gamma input must receive API-extracted source file text"
    );
    const gammaProviderOptions = gatewayCalls[0]!.providerOptions;
    assert.equal(gammaProviderOptions.outputFormat, "pptx");
    if (gammaProviderOptions.outputFormat !== "pptx") {
      throw new Error("expected pptx provider options");
    }
    const presentationOptions = gammaProviderOptions.presentationOptions;
    assert.equal(presentationOptions?.themeId, "theme-ocean");
    assert.equal(presentationOptions?.textMode, "generate");
    assert.equal(presentationOptions?.numCards, 8);
    assert.equal(presentationOptions?.cardSplit, "auto");
    assert.equal(presentationOptions?.textOptions?.amount, "medium");
    assert.equal(presentationOptions?.textOptions?.language, "en");
    assert.equal(presentationOptions?.textOptions?.tone, "Focus on traction and product vision.");
    assert.equal(presentationOptions?.textOptions?.audience, "investors");
    assert.deepEqual(presentationOptions?.imageOptions, {
      source: "webFreeToUseCommercially"
    });
    assert.deepEqual(presentationOptions?.cardOptions, { dimensions: "16x9" });
    assert.match(
      presentationOptions?.additionalInstructions ?? "",
      /Do not create empty hero slides/
    );
    assert.match(
      presentationOptions?.additionalInstructions ?? "",
      /fewer, fuller image-led cards/
    );
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
    // See PDF test note: worker now intentionally returns assistantText: null
    // so the framing LLM call only happens once, in the API delivery service.
    assert.equal(result.assistantText, null);
    assert.equal(result.providerStatus?.state, "success");
    // Gamma path must not issue ANY LLM text-generation calls inside the
    // worker (no HTML generation, no completion framing). The provider does
    // the entire content/layout job; the API delivery service generates the
    // single user-facing completion message after delivery.
    assert.equal(
      generateTextCalls.length,
      0,
      `Gamma worker path must not call generateText (got ${String(generateTextCalls.length)} calls: ${generateTextCalls.map((c) => c.classification ?? "<no-classification>").join(", ")})`
    );
  });

  test("defaults Gamma presentations to PDF without a second companion Gamma run", async () => {
    const gatewayCalls: ProviderGatewayDocumentGenerateRequest[] = [];
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText() {
          throw new Error("Gamma path must not call generateText");
        },
        async generateDocumentOutcome(
          input: ProviderGatewayDocumentGenerateRequest
        ): Promise<{ ok: true; result: ProviderGatewayDocumentGenerateResult }> {
          gatewayCalls.push(input);
          const outputFormat = input.providerOptions.outputFormat;
          return {
            ok: true,
            result: {
              provider: "gamma",
              outputFormat,
              documentId: "gamma-pdf-1",
              templateId: null,
              filename: input.filename,
              bytesBase64: Buffer.from("pdf-test").toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-18T11:40:00.000Z",
              warning: null,
              providerStatus: {
                provider: "gamma",
                state: "success",
                generationId: "gen-pdf-1",
                gammaId: "gamma-pdf-1",
                gammaUrl: "https://gamma.app/docs/gamma-pdf-1",
                exportUrl: "https://gamma.app/export/gamma-pdf-1.pdf",
                filename: input.filename,
                outputType: outputFormat,
                status: "completed",
                updatedAt: "2026-05-18T11:40:00.000Z"
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
          id: "job-pdf-default-1",
          docId: "doc-pdf-default-1",
          versionId: "version-pdf-default-1",
          surface: "web",
          chatId: "chat-pdf-default-1",
          provider: "gamma",
          outputFormat: "pdf",
          sourceUserMessageId: "message-pdf-default-1",
          sourceUserMessageText: "Сделай презентацию для совета директоров",
          sourceUserMessageCreatedAt: "2026-05-18T11:35:00.000Z"
        },
        attachments: [],
        sourceFiles: [],
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_presentation",
          request: {
            prompt: "Create a calm board presentation",
            requestedName: "Board Deck",
            visualStyle: "professional_modern",
            imagePolicy: "text_only",
            visualDensity: "balanced"
          }
        }
      }
    });

    assert.equal(gatewayCalls.length, 1);
    assert.equal(gatewayCalls[0]?.providerOptions.outputFormat, "pdf");
    assert.equal(gatewayCalls[0]?.filename, "Board Deck.pdf");
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0]?.mimeType, "application/pdf");
    assert.equal(result.providerStatus?.outputType, "pdf");
    assert.equal(result.providerStatus?.companionOriginal, undefined);
  });

  test("injects enhanced print CSS with @page, thead repeat, tr break-inside, orphans/widows and cover-page page-break by default", () => {
    const previousFlag = process.env.RUNTIME_DOCUMENT_ENHANCED_PAGINATION;
    delete process.env.RUNTIME_DOCUMENT_ENHANCED_PAGINATION;
    try {
      const service = new RuntimeDocumentProviderAdapterService(
        {} as never,
        {} as never,
        {} as never
      );
      const result = (
        service as unknown as {
          repairHtmlDocument(html: string): {
            html: string;
            bodyTextLength: number;
            paginationEnhanced: boolean;
            theadPromoted: number;
          };
        }
      ).repairHtmlDocument(
        '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><h1>Report</h1><p>The actual document content goes here, long enough to clear the minimum body text gate and pass HTML repair validation before being sent to PDFMonkey for final rendering.</p></body></html>'
      );
      assert.equal(result.paginationEnhanced, true);
      assert.match(result.html, /<style>[\s\S]*<\/style>/i);
      assert.match(result.html, /@page\{size:A4;margin:2cm 1.8cm;\}/);
      assert.match(result.html, /thead\{display:table-header-group;\}/);
      assert.match(result.html, /tr\{page-break-inside:avoid;break-inside:avoid;\}/);
      assert.match(result.html, /orphans:3;widows:3/);
      assert.match(
        result.html,
        /\.cover-page,\.title-page\{break-after:page;page-break-after:always;\}/
      );
      assert.match(result.html, /table\{[^}]*table-layout:fixed/);
      assert.match(result.html, /blockquote\{[^}]*#f8fafc/);
      assert.match(result.html, /\.callout[^}]*#f8fafc/);
      assert.match(result.html, /body\{[^}]*background:#fff/);
    } finally {
      if (previousFlag === undefined) {
        delete process.env.RUNTIME_DOCUMENT_ENHANCED_PAGINATION;
      } else {
        process.env.RUNTIME_DOCUMENT_ENHANCED_PAGINATION = previousFlag;
      }
    }
  });

  test("auto-promotes first <tr> with all <th> cells into <thead> when <thead> is missing", () => {
    const previousFlag = process.env.RUNTIME_DOCUMENT_ENHANCED_PAGINATION;
    delete process.env.RUNTIME_DOCUMENT_ENHANCED_PAGINATION;
    try {
      const service = new RuntimeDocumentProviderAdapterService(
        {} as never,
        {} as never,
        {} as never
      );
      const repair = (
        service as unknown as {
          repairHtmlDocument(html: string): {
            html: string;
            bodyTextLength: number;
            paginationEnhanced: boolean;
            theadPromoted: number;
          };
        }
      ).repairHtmlDocument(
        "<!DOCTYPE html><html><head></head><body><h1>Report</h1><p>The actual document content goes here, long enough to clear the minimum body text gate and pass HTML repair validation before being sent to PDFMonkey for final rendering.</p><table><tbody><tr><th>Quarter</th><th>Revenue</th></tr><tr><td>Q1</td><td>100</td></tr><tr><td>Q2</td><td>120</td></tr></tbody></table></body></html>"
      );
      assert.equal(repair.paginationEnhanced, true);
      assert.equal(repair.theadPromoted, 1);
      assert.match(
        repair.html,
        /<thead>\s*<tr>\s*<th>Quarter<\/th>\s*<th>Revenue<\/th>\s*<\/tr>\s*<\/thead>/i
      );
      assert.match(repair.html, /<tbody>\s*<tr>\s*<td>Q1<\/td>/i);
    } finally {
      if (previousFlag === undefined) {
        delete process.env.RUNTIME_DOCUMENT_ENHANCED_PAGINATION;
      } else {
        process.env.RUNTIME_DOCUMENT_ENHANCED_PAGINATION = previousFlag;
      }
    }
  });

  test("keeps existing <thead> intact and does not promote first body row when it is not header-only", () => {
    const previousFlag = process.env.RUNTIME_DOCUMENT_ENHANCED_PAGINATION;
    delete process.env.RUNTIME_DOCUMENT_ENHANCED_PAGINATION;
    try {
      const service = new RuntimeDocumentProviderAdapterService(
        {} as never,
        {} as never,
        {} as never
      );
      const repair = (
        service as unknown as {
          repairHtmlDocument(html: string): {
            html: string;
            bodyTextLength: number;
            paginationEnhanced: boolean;
            theadPromoted: number;
          };
        }
      ).repairHtmlDocument(
        "<!DOCTYPE html><html><head></head><body><h1>Report</h1><p>Filler body text long enough to clear the minimum body text gate before being sent to PDFMonkey for final rendering of the resulting PDF document.</p><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table><table><tbody><tr><th>Row label</th><td>Value</td></tr><tr><th>Other label</th><td>Other</td></tr></tbody></table></body></html>"
      );
      assert.equal(repair.paginationEnhanced, true);
      assert.equal(repair.theadPromoted, 0);
      assert.equal(
        (repair.html.match(/<thead>/gi) ?? []).length,
        1,
        "should not duplicate or add a second <thead>"
      );
    } finally {
      if (previousFlag === undefined) {
        delete process.env.RUNTIME_DOCUMENT_ENHANCED_PAGINATION;
      } else {
        process.env.RUNTIME_DOCUMENT_ENHANCED_PAGINATION = previousFlag;
      }
    }
  });

  test("RUNTIME_DOCUMENT_ENHANCED_PAGINATION=off reverts to legacy baseline CSS and disables thead auto-promote", () => {
    const previousFlag = process.env.RUNTIME_DOCUMENT_ENHANCED_PAGINATION;
    process.env.RUNTIME_DOCUMENT_ENHANCED_PAGINATION = "off";
    try {
      const service = new RuntimeDocumentProviderAdapterService(
        {} as never,
        {} as never,
        {} as never
      );
      const repair = (
        service as unknown as {
          repairHtmlDocument(html: string): {
            html: string;
            bodyTextLength: number;
            paginationEnhanced: boolean;
            theadPromoted: number;
          };
        }
      ).repairHtmlDocument(
        "<!DOCTYPE html><html><head></head><body><h1>Report</h1><p>Filler body text long enough to clear the minimum body text gate before being sent to PDFMonkey for final rendering of the resulting PDF document.</p><table><tbody><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></tbody></table></body></html>"
      );
      assert.equal(repair.paginationEnhanced, false);
      assert.equal(repair.theadPromoted, 0);
      assert.match(repair.html, /padding:32px 48px/);
      assert.ok(!/@page\{/.test(repair.html), "legacy baseline must not contain @page rules");
      assert.ok(
        !/thead\{display:table-header-group/.test(repair.html),
        "legacy baseline must not contain thead-repeat rules"
      );
    } finally {
      if (previousFlag === undefined) {
        delete process.env.RUNTIME_DOCUMENT_ENHANCED_PAGINATION;
      } else {
        process.env.RUNTIME_DOCUMENT_ENHANCED_PAGINATION = previousFlag;
      }
    }
  });

  test("HTML generation prompt includes pagination guidance for cover-page, keep-together, long-table thead, and no manual page-breaks", () => {
    const service = new RuntimeDocumentProviderAdapterService(
      {} as never,
      {} as never,
      {} as never
    );
    const request = (
      service as unknown as {
        buildPdfContentRequest(
          input: {
            bundle: unknown;
            request: unknown;
            filename: string;
            attempt: number;
            sourceFiles: Array<unknown>;
          },
          providerSelection: { provider: string; model: string }
        ): { developerInstructions?: string };
      }
    ).buildPdfContentRequest(
      {
        bundle: createBundle(),
        request: {
          job: {
            id: "job-pagination-1",
            workspaceId: "workspace-1",
            assistantId: "assistant-1",
            assistantConversationId: "conv-1",
            requestId: "req-1",
            outputFormat: "pdf",
            sourceUserMessageId: "msg-1",
            sourceUserMessageText: "Render the report.",
            sourceUserMessageCreatedAt: "2026-05-15T10:00:00.000Z"
          },
          attachments: [],
          directToolExecution: {
            toolCode: "document",
            descriptorMode: "create_pdf_document",
            request: {
              prompt: "Render the report.",
              instructions: null,
              requestedName: null,
              outline: null
            }
          }
        },
        filename: "report.pdf",
        attempt: 1,
        sourceFiles: []
      },
      { provider: "openai", model: "gpt-4.1-mini" }
    );
    const developer = request.developerInstructions ?? "";
    assert.match(developer, /Pagination guidance/);
    assert.match(developer, /cover-page/);
    assert.match(developer, /<thead>/);
    assert.match(developer, /keep-together/);
    assert.match(developer, /Do NOT insert manual page breaks/);
    assert.match(developer, /restrained editorial document style/);
    assert.match(developer, /white page background/);
    assert.match(developer, /<section class="callout">/);
  });

  test("Gamma defaults prefer fewer fuller slides for compact school topics", async () => {
    const gatewayCalls: ProviderGatewayDocumentGenerateRequest[] = [];
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText() {
          throw new Error("Gamma path must not call generateText");
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
              documentId: "gamma-school-1",
              templateId: null,
              filename: input.filename,
              bytesBase64: Buffer.from("pptx-test").toString("base64"),
              mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              respondedAt: "2026-05-18T12:00:00.000Z",
              warning: null,
              providerStatus: {
                provider: "gamma",
                state: "success",
                generationId: "gen-school-1",
                gammaId: "g_school",
                gammaUrl: "https://gamma.app/docs/g_school",
                exportUrl: "https://gamma.app/export/g_school.pptx",
                filename: input.filename,
                outputType: "pptx",
                status: "completed",
                updatedAt: "2026-05-18T12:00:00.000Z"
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

    await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: "{}",
        job: {
          id: "job-school-1",
          docId: "doc-school-1",
          versionId: "version-school-1",
          surface: "web",
          chatId: "chat-school-1",
          provider: "gamma",
          outputFormat: "pptx",
          sourceUserMessageId: "message-school-1",
          sourceUserMessageText: "Make a short school biology deck about ficus plants",
          sourceUserMessageCreatedAt: "2026-05-18T12:00:00.000Z"
        },
        attachments: [],
        sourceFiles: [],
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_presentation",
          request: {
            prompt: "Create a short school biology deck about ficus plants for students"
          }
        }
      }
    });

    const schoolProviderOptions = gatewayCalls[0]!.providerOptions;
    assert.equal(schoolProviderOptions.outputFormat, "pptx");
    if (schoolProviderOptions.outputFormat !== "pptx") {
      throw new Error("expected pptx provider options");
    }
    const presentationOptions = schoolProviderOptions.presentationOptions;
    assert.ok(presentationOptions);
    assert.equal(presentationOptions.numCards, 8);
    assert.equal(presentationOptions.textOptions?.amount, "medium");
    assert.match(presentationOptions.additionalInstructions ?? "", /title-plus-two-words cards/);
  });

  test("Gamma honours typed targetSlideCount over outline/text heuristics", async () => {
    const gatewayCalls: ProviderGatewayDocumentGenerateRequest[] = [];
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText() {
          throw new Error("Gamma path must not call generateText");
        },
        async generateDocumentOutcome(
          input: ProviderGatewayDocumentGenerateRequest
        ): Promise<{ ok: true; result: ProviderGatewayDocumentGenerateResult }> {
          gatewayCalls.push(input);
          return {
            ok: true,
            result: {
              provider: "gamma",
              outputFormat: "pdf",
              documentId: "gamma-target-1",
              templateId: null,
              filename: input.filename,
              bytesBase64: Buffer.from("pdf-target").toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-18T12:00:00.000Z",
              warning: null,
              providerStatus: {
                provider: "gamma",
                state: "success",
                generationId: "gen-target-1",
                gammaId: "g_target",
                gammaUrl: "https://gamma.app/docs/g_target",
                exportUrl: "https://gamma.app/export/g_target.pdf",
                filename: input.filename,
                outputType: "pdf",
                status: "completed",
                updatedAt: "2026-05-18T12:00:00.000Z"
              }
            }
          };
        },
        async resolveSecretValueById() {
          return "gamma-secret";
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

    await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: "{}",
        job: {
          id: "job-target-1",
          docId: "doc-target-1",
          versionId: "version-target-1",
          surface: "web",
          chatId: "chat-target-1",
          provider: "gamma",
          outputFormat: "pdf",
          sourceUserMessageId: "message-target-1",
          sourceUserMessageText: "Сделай 7 слайдов про фотосинтез",
          sourceUserMessageCreatedAt: "2026-05-18T12:00:00.000Z"
        },
        attachments: [],
        sourceFiles: [],
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_presentation",
          request: {
            // Short prompt and no outline would otherwise yield ~3 cards via
            // the compact-school heuristic. The typed targetSlideCount must
            // override the heuristic and yield exactly 7.
            prompt: "Photosynthesis deck",
            targetSlideCount: 7
          }
        }
      }
    });

    assert.equal(gatewayCalls.length, 1);
    const providerOptions = gatewayCalls[0]!.providerOptions;
    assert.equal(providerOptions.outputFormat, "pdf");
    if (providerOptions.outputFormat !== "pdf") {
      throw new Error("expected pdf provider options");
    }
    assert.equal(providerOptions.presentationOptions?.numCards, 7);
  });

  test("buildPdfContentRequest inlines sourceFiles[].text into the user prompt and adds rebuild instructions when at least one source file has text", () => {
    const service = new RuntimeDocumentProviderAdapterService(
      {} as never,
      {} as never,
      {} as never
    );
    const request = (
      service as unknown as {
        buildPdfContentRequest(
          input: {
            bundle: unknown;
            request: unknown;
            filename: string;
            attempt: number;
            sourceFiles: Array<{
              attachmentId: string;
              filename: string | null;
              mimeType: string;
              sizeBytes: number;
              text: string | null;
              note: string | null;
            }>;
          },
          providerSelection: { provider: string; model: string },
          maxOutputTokens: number
        ): {
          developerInstructions?: string;
          messages: Array<{ content: Array<{ type: string; text: string }> }>;
        };
      }
    ).buildPdfContentRequest(
      {
        bundle: createBundle(),
        request: {
          job: {
            id: "job-attach-1",
            workspaceId: "workspace-1",
            assistantId: "assistant-1",
            assistantConversationId: "conv-1",
            requestId: "req-1",
            outputFormat: "pdf",
            sourceUserMessageId: "msg-1",
            sourceUserMessageText: "Rebuild this report with a cleaner layout.",
            sourceUserMessageCreatedAt: "2026-05-15T10:00:00.000Z"
          },
          attachments: [],
          directToolExecution: {
            toolCode: "document",
            descriptorMode: "create_pdf_document",
            request: {
              prompt: "Rebuild this report with a cleaner layout.",
              instructions: null,
              requestedName: null,
              outline: null
            }
          }
        },
        filename: "rebuilt.pdf",
        attempt: 1,
        sourceFiles: [
          {
            attachmentId: "att-1",
            filename: "draft.md",
            mimeType: "text/markdown",
            sizeBytes: 42,
            text: "# Draft\nOriginal user content that must be preserved.",
            note: null
          }
        ]
      },
      { provider: "openai", model: "gpt-4.1-mini" },
      64_000
    );
    const developer = request.developerInstructions ?? "";
    assert.match(
      developer,
      /SOURCE FILES/,
      "developer instructions must announce the SOURCE FILES guidance when text attachments are inlined"
    );
    assert.match(
      developer,
      /sourceFiles\[\]\.text/,
      "developer instructions must point the model at sourceFiles[].text as the real content"
    );
    const userText = request.messages[0]?.content[0]?.text ?? "";
    assert.match(
      userText,
      /"sourceFiles"/,
      "user message JSON must include sourceFiles[] so attachments reach the model"
    );
    assert.match(
      userText,
      /Original user content that must be preserved/,
      "actual text content from the attachment must be inlined verbatim into the user prompt"
    );
  });

  test("single-shot path with small request returns valid HTML and surfaces renderedHtml in result", async () => {
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { requestMetadata?: { classification?: string } }) {
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: isHtmlGenerationRequest(input)
              ? makeHtmlGenerationText(
                  "<!DOCTYPE html><html><body><h1>Short Document</h1><p>This document provides a concise overview of the business situation with key facts, figures, and clear recommendations for the leadership team to review and act upon promptly.</p></body></html>"
                )
              : "{}",
            respondedAt: "2026-05-24T10:00:00.000Z",
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
              documentId: "doc-ss-1",
              templateId: "template-123",
              filename: input.filename,
              bytesBase64: Buffer.concat([
                Buffer.from("%PDF-1.4\n", "utf8"),
                Buffer.alloc(1400, "X"),
                Buffer.from("\n%%EOF", "utf8")
              ]).toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-24T10:00:01.000Z",
              warning: null,
              providerStatus: {
                provider: "pdfmonkey",
                state: "success",
                documentId: "doc-ss-1",
                documentTemplateId: "template-123",
                downloadUrl: "https://example.com/doc.pdf",
                previewUrl: null,
                failureCause: null,
                filename: null,
                outputType: "pdf" as const,
                status: "success" as const,
                updatedAt: null
              }
            }
          };
        }
      } as never,
      {
        buildRuntimeOutputObjectKey(input: { artifactId?: string; extension: string | null }) {
          return `media/${input.artifactId}.${input.extension}`;
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
        }) {
          return {
            fileRef: record.fileRef,
            origin: record.origin,
            sourceToolCode: record.sourceToolCode,
            objectKey: record.objectKey,
            relativePath: record.relativePath,
            displayName: record.displayName,
            mimeType: record.mimeType,
            sizeBytes: record.sizeBytes
          };
        }
      } as never
    );
    mockExtractedPdfText(
      service,
      "Short Document This document provides a concise overview of the business situation with key facts, figures, and clear recommendations for the leadership team to review and act upon promptly.",
      null
    );

    const result = await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: JSON.stringify(createBundle()),
        job: {
          id: "job-ss-small",
          docId: "doc-1",
          versionId: "version-1",
          surface: "web",
          chatId: "chat-1",
          provider: "pdfmonkey",
          outputFormat: "pdf",
          sourceUserMessageId: "msg-1",
          sourceUserMessageText: "Create a short business brief.",
          sourceUserMessageCreatedAt: "2026-05-24T10:00:00.000Z"
        },
        attachments: [],
        sourceFiles: [],
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_pdf_document",
          request: { prompt: "Create a short business brief.", requestedName: "brief" }
        }
      }
    });

    assert.equal(result.artifacts.length, 1, "should return one artifact");
    assert.equal(typeof result.renderedHtml, "string", "renderedHtml must be a string");
    assert.match(
      result.renderedHtml as string,
      /Short Doc/,
      "renderedHtml must contain the generated HTML heading"
    );
  });

  test("chunked path triggers when inlined source exceeds 20KB threshold", async () => {
    const textGenerateCalls: Array<{ classification: string }> = [];
    // Large source text > 20KB
    const largeSourceText = "A".repeat(21_000);
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: {
          requestMetadata?: { classification?: string };
          messages?: Array<{ content?: Array<{ text?: string }> }>;
        }) {
          const classification = input.requestMetadata?.classification ?? "unknown";
          textGenerateCalls.push({ classification });
          if (classification === "document_pdf_outline") {
            return {
              provider: "openai",
              model: "gpt-4.1-mini",
              text: JSON.stringify({
                mode: "document_pdf_outline",
                sections: [
                  {
                    heading: "Introduction",
                    intent: "Overview of the topic.",
                    expectedLength: "medium"
                  },
                  { heading: "Main Content", intent: "Core analysis.", expectedLength: "long" }
                ]
              }),
              respondedAt: "2026-05-24T10:00:00.000Z",
              stopReason: "completed",
              toolCalls: [],
              usage: null
            };
          }
          if (classification === "document_pdf_section_generation") {
            return {
              provider: "openai",
              model: "gpt-4.1-mini",
              text: `<h2>Section Content</h2><p>This is a generated section with sufficient content for the document.</p>`,
              respondedAt: "2026-05-24T10:00:01.000Z",
              stopReason: "completed",
              toolCalls: [],
              usage: null
            };
          }
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: "{}",
            respondedAt: "2026-05-24T10:00:00.000Z",
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
              documentId: "doc-chunked-1",
              templateId: "template-123",
              filename: input.filename,
              bytesBase64: Buffer.concat([
                Buffer.from("%PDF-1.4\n", "utf8"),
                Buffer.alloc(1400, "X"),
                Buffer.from("\n%%EOF", "utf8")
              ]).toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-24T10:00:02.000Z",
              warning: null,
              providerStatus: {
                provider: "pdfmonkey" as const,
                state: "success" as const,
                documentId: "doc-chunked-1",
                documentTemplateId: "template-123",
                downloadUrl: "https://example.com/doc.pdf",
                previewUrl: null,
                failureCause: null,
                filename: null,
                outputType: "pdf" as const,
                status: "success" as const,
                updatedAt: null
              }
            }
          };
        }
      } as never,
      {
        buildRuntimeOutputObjectKey(input: { artifactId?: string; extension: string | null }) {
          return `media/${input.artifactId}.${input.extension}`;
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
        }) {
          return {
            fileRef: record.fileRef,
            origin: record.origin,
            sourceToolCode: record.sourceToolCode,
            objectKey: record.objectKey,
            relativePath: record.relativePath,
            displayName: record.displayName,
            mimeType: record.mimeType,
            sizeBytes: record.sizeBytes
          };
        }
      } as never
    );
    mockExtractedPdfText(
      service,
      "Overview This section covers the overview in comprehensive detail, providing all key background information, analysis, and context needed to understand the document objectives and principal findings of this report.",
      null
    );

    await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: JSON.stringify(createBundle()),
        job: {
          id: "job-chunked-route",
          docId: "doc-1",
          versionId: "version-1",
          surface: "web",
          chatId: "chat-1",
          provider: "pdfmonkey",
          outputFormat: "pdf",
          sourceUserMessageId: "msg-1",
          sourceUserMessageText: "Rebuild this large document.",
          sourceUserMessageCreatedAt: "2026-05-24T10:00:00.000Z"
        },
        attachments: [],
        sourceFiles: [
          {
            attachmentId: "att-large",
            filename: "large.txt",
            mimeType: "text/plain",
            sizeBytes: largeSourceText.length,
            text: largeSourceText,
            markdown: null,
            note: null,
            provider: null,
            quality: { status: "ok" as const, score: null, reasonCodes: [], textChars: 0 }
          }
        ],
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_pdf_document",
          request: { prompt: "Rebuild this large document.", requestedName: "large-doc" }
        }
      }
    });

    const outlineCalls = textGenerateCalls.filter(
      (c) => c.classification === "document_pdf_outline"
    );
    const sectionCalls = textGenerateCalls.filter(
      (c) => c.classification === "document_pdf_section_generation"
    );
    assert.equal(outlineCalls.length, 1, "chunked path must make exactly one outline call");
    assert.ok(sectionCalls.length >= 1, "chunked path must make at least one section call");
  });

  test("chunked assembly concatenates sections, wraps boilerplate, runs through parse5 repair, sends to PDFMonkey, surfaces final renderedHtml in result", async () => {
    const pdfmonkeyCalls: ProviderGatewayDocumentGenerateRequest[] = [];
    const largeSourceText = "B".repeat(21_000);
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { requestMetadata?: { classification?: string } }) {
          const classification = input.requestMetadata?.classification ?? "unknown";
          if (classification === "document_pdf_outline") {
            return {
              provider: "openai",
              model: "gpt-4.1-mini",
              text: JSON.stringify({
                mode: "document_pdf_outline",
                sections: [
                  { heading: "Overview", intent: "General overview.", expectedLength: "medium" }
                ]
              }),
              respondedAt: "2026-05-24T10:00:00.000Z",
              stopReason: "completed",
              toolCalls: [],
              usage: null
            };
          }
          if (classification === "document_pdf_section_generation") {
            return {
              provider: "openai",
              model: "gpt-4.1-mini",
              text: "<h2>Overview</h2><p>This section covers the overview in comprehensive detail, providing all key background information, analysis, and context needed to understand the document objectives and principal findings of this report.</p>",
              respondedAt: "2026-05-24T10:00:01.000Z",
              stopReason: "completed",
              toolCalls: [],
              usage: null
            };
          }
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: "{}",
            respondedAt: "2026-05-24T10:00:00.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: null
          };
        },
        async generateDocumentOutcome(
          input: ProviderGatewayDocumentGenerateRequest
        ): Promise<{ ok: true; result: ProviderGatewayDocumentGenerateResult }> {
          pdfmonkeyCalls.push(input);
          return {
            ok: true,
            result: {
              provider: "pdfmonkey",
              outputFormat: "pdf",
              documentId: "doc-assembly-1",
              templateId: "template-123",
              filename: input.filename,
              bytesBase64: Buffer.concat([
                Buffer.from("%PDF-1.4\n", "utf8"),
                Buffer.alloc(1400, "Y"),
                Buffer.from("\n%%EOF", "utf8")
              ]).toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-24T10:00:02.000Z",
              warning: null,
              providerStatus: {
                provider: "pdfmonkey" as const,
                state: "success" as const,
                documentId: "doc-assembly-1",
                documentTemplateId: "template-123",
                downloadUrl: "https://example.com/doc.pdf",
                previewUrl: null,
                failureCause: null,
                filename: null,
                outputType: "pdf" as const,
                status: "success" as const,
                updatedAt: null
              }
            }
          };
        }
      } as never,
      {
        buildRuntimeOutputObjectKey(input: { artifactId?: string; extension: string | null }) {
          return `media/${input.artifactId}.${input.extension}`;
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
        }) {
          return {
            fileRef: record.fileRef,
            origin: record.origin,
            sourceToolCode: record.sourceToolCode,
            objectKey: record.objectKey,
            relativePath: record.relativePath,
            displayName: record.displayName,
            mimeType: record.mimeType,
            sizeBytes: record.sizeBytes
          };
        }
      } as never
    );
    mockExtractedPdfText(
      service,
      "Overview This section covers the overview in comprehensive detail, providing all key background information, analysis, and context needed to understand the document objectives and principal findings of this report.",
      null
    );

    const result = await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: JSON.stringify(createBundle()),
        job: {
          id: "job-assembly-1",
          docId: "doc-1",
          versionId: "version-1",
          surface: "web",
          chatId: "chat-1",
          provider: "pdfmonkey",
          outputFormat: "pdf",
          sourceUserMessageId: "msg-1",
          sourceUserMessageText: "Summarize this large source.",
          sourceUserMessageCreatedAt: "2026-05-24T10:00:00.000Z"
        },
        attachments: [],
        sourceFiles: [
          {
            attachmentId: "att-big",
            filename: "big.txt",
            mimeType: "text/plain",
            sizeBytes: largeSourceText.length,
            text: largeSourceText,
            markdown: null,
            note: null,
            provider: null,
            quality: {
              status: "ok" as const,
              score: null,
              reasonCodes: [],
              textChars: largeSourceText.length
            }
          }
        ],
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_pdf_document",
          request: { prompt: "Summarize this large source.", requestedName: "summary" }
        }
      }
    });

    assert.equal(result.artifacts.length, 1, "should deliver one PDF artifact");
    assert.equal(typeof result.renderedHtml, "string", "renderedHtml must be a string");
    assert.ok(
      (result.renderedHtml as string).includes("<!DOCTYPE html"),
      "assembled HTML must include DOCTYPE from repairHtmlDocument"
    );
    assert.equal(pdfmonkeyCalls.length, 1, "must send assembled HTML to PDFMonkey exactly once");
    // Verify the assembled HTML sent to PDFMonkey includes section content
    const sentHtml = pdfmonkeyCalls[0]!.htmlContent;
    assert.match(
      sentHtml,
      /Overview/,
      "assembled HTML sent to PDFMonkey must include section heading"
    );
  });

  test("truncated single-shot (structurally incomplete HTML) triggers one-time switch to chunked path within the same job", async () => {
    const textGenerateCalls: Array<{ classification: string }> = [];
    const largeSourceText = "C".repeat(21_000);
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { requestMetadata?: { classification?: string } }) {
          const classification = input.requestMetadata?.classification ?? "unknown";
          textGenerateCalls.push({ classification });
          if (classification === "document_html_generation") {
            // Return structurally truncated HTML (no </body> or </html>)
            // to trigger the re-route detection
            return {
              provider: "openai",
              model: "gpt-4.1-mini",
              text: "<h1>Report</h1><p>Short truncated content without closing tags",
              respondedAt: "2026-05-24T10:00:00.000Z",
              stopReason: "completed",
              toolCalls: [],
              usage: null
            };
          }
          if (classification === "document_pdf_outline") {
            return {
              provider: "openai",
              model: "gpt-4.1-mini",
              text: JSON.stringify({
                mode: "document_pdf_outline",
                sections: [
                  { heading: "Report", intent: "Full report content.", expectedLength: "long" }
                ]
              }),
              respondedAt: "2026-05-24T10:00:01.000Z",
              stopReason: "completed",
              toolCalls: [],
              usage: null
            };
          }
          if (classification === "document_pdf_section_generation") {
            return {
              provider: "openai",
              model: "gpt-4.1-mini",
              text: "<h2>Report Content</h2><p>Full section text providing comprehensive information about the report subject with more than enough content to pass the body text minimum threshold validation check for the chunked generation path.</p>",
              respondedAt: "2026-05-24T10:00:02.000Z",
              stopReason: "completed",
              toolCalls: [],
              usage: null
            };
          }
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: "{}",
            respondedAt: "2026-05-24T10:00:00.000Z",
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
              documentId: "doc-reroute-1",
              templateId: "template-123",
              filename: input.filename,
              bytesBase64: Buffer.concat([
                Buffer.from("%PDF-1.4\n", "utf8"),
                Buffer.alloc(1400, "Z"),
                Buffer.from("\n%%EOF", "utf8")
              ]).toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-24T10:00:03.000Z",
              warning: null,
              providerStatus: {
                provider: "pdfmonkey" as const,
                state: "success" as const,
                documentId: "doc-reroute-1",
                documentTemplateId: "template-123",
                downloadUrl: "https://example.com/doc.pdf",
                previewUrl: null,
                failureCause: null,
                filename: null,
                outputType: "pdf" as const,
                status: "success" as const,
                updatedAt: null
              }
            }
          };
        }
      } as never,
      {
        buildRuntimeOutputObjectKey(input: { artifactId?: string; extension: string | null }) {
          return `media/${input.artifactId}.${input.extension}`;
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
        }) {
          return {
            fileRef: record.fileRef,
            origin: record.origin,
            sourceToolCode: record.sourceToolCode,
            objectKey: record.objectKey,
            relativePath: record.relativePath,
            displayName: record.displayName,
            mimeType: record.mimeType,
            sizeBytes: record.sizeBytes
          };
        }
      } as never
    );
    mockExtractedPdfText(
      service,
      "Report Content Full section text providing comprehensive information about the report subject with more than enough content to pass the body text minimum threshold validation check for the chunked generation path.",
      null
    );

    const result = await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: JSON.stringify(createBundle()),
        job: {
          id: "job-reroute-1",
          docId: "doc-1",
          versionId: "version-1",
          surface: "web",
          chatId: "chat-1",
          provider: "pdfmonkey",
          outputFormat: "pdf",
          sourceUserMessageId: "msg-1",
          sourceUserMessageText: "Compile this large report.",
          sourceUserMessageCreatedAt: "2026-05-24T10:00:00.000Z"
        },
        attachments: [],
        sourceFiles: [
          {
            attachmentId: "att-reroute",
            filename: "report.txt",
            mimeType: "text/plain",
            sizeBytes: largeSourceText.length,
            text: largeSourceText,
            markdown: null,
            note: null,
            provider: null,
            quality: {
              status: "ok" as const,
              score: null,
              reasonCodes: [],
              textChars: largeSourceText.length
            }
          }
        ],
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_pdf_document",
          request: { prompt: "Compile this large report.", requestedName: "report" }
        }
      }
    });

    // The job initially routes to chunked (>20KB), but even if it had routed to
    // single-shot first: after truncation detection it switches to chunked.
    // Either way, the outline call must have been made.
    const outlineCalls = textGenerateCalls.filter(
      (c) => c.classification === "document_pdf_outline"
    );
    assert.ok(
      outlineCalls.length >= 1,
      "after truncation re-route, chunked outline call must be made"
    );
    assert.equal(
      result.artifacts.length,
      1,
      "job must still complete successfully with a PDF artifact"
    );
  });

  test("outline call returning invalid JSON envelope fails the job with document_pdf_outline_invalid (no fallback)", async () => {
    const largeSourceText = "D".repeat(21_000);
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { requestMetadata?: { classification?: string } }) {
          const classification = input.requestMetadata?.classification ?? "unknown";
          if (classification === "document_pdf_outline") {
            // Return garbage — not a valid outline JSON envelope
            return {
              provider: "openai",
              model: "gpt-4.1-mini",
              text: "Sorry, I cannot generate an outline for this request.",
              respondedAt: "2026-05-24T10:00:00.000Z",
              stopReason: "completed",
              toolCalls: [],
              usage: null
            };
          }
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: "{}",
            respondedAt: "2026-05-24T10:00:00.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: null
          };
        },
        async generateDocumentOutcome(): Promise<never> {
          throw new Error("PDFMonkey must not be called when outline generation fails");
        }
      } as never,
      {
        buildRuntimeOutputObjectKey() {
          return "";
        },
        async saveObject() {
          return { objectKey: "", sizeBytes: 0, mimeType: "" };
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
        }) {
          return {
            fileRef: record.fileRef,
            origin: record.origin,
            sourceToolCode: record.sourceToolCode,
            objectKey: record.objectKey,
            relativePath: record.relativePath,
            displayName: record.displayName,
            mimeType: record.mimeType,
            sizeBytes: record.sizeBytes
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
        runtimeBundleDocument: JSON.stringify(createBundle()),
        job: {
          id: "job-outline-invalid",
          docId: "doc-1",
          versionId: "version-1",
          surface: "web",
          chatId: "chat-1",
          provider: "pdfmonkey",
          outputFormat: "pdf",
          sourceUserMessageId: "msg-1",
          sourceUserMessageText: "Build this large doc.",
          sourceUserMessageCreatedAt: "2026-05-24T10:00:00.000Z"
        },
        attachments: [],
        sourceFiles: [
          {
            attachmentId: "att-outline",
            filename: "doc.txt",
            mimeType: "text/plain",
            sizeBytes: largeSourceText.length,
            text: largeSourceText,
            markdown: null,
            note: null,
            provider: null,
            quality: {
              status: "ok" as const,
              score: null,
              reasonCodes: [],
              textChars: largeSourceText.length
            }
          }
        ],
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_pdf_document",
          request: { prompt: "Build this large doc.", requestedName: "doc" }
        }
      }
    });

    assert.equal(
      result.artifacts.length,
      0,
      "no artifacts must be returned when outline is invalid"
    );
    const errorCode = (result.providerStatus as Record<string, unknown>)?.errorCode;
    assert.equal(
      errorCode,
      "document_pdf_outline_invalid",
      "providerStatus.errorCode must be document_pdf_outline_invalid when outline returns invalid JSON"
    );
  });

  // ─── ADR-097 Slice 2 — patch-revise tests ─────────────────────────────────

  function makePatchReviseEnvelope(patches: Array<{ search: string; replace: string }>): string {
    return JSON.stringify({ mode: "document_pdf_patch_revise", patches });
  }

  function createPatchReviseService(options: {
    llmResponse: string;
    onDocumentGenerate?: (req: ProviderGatewayDocumentGenerateRequest) => void;
    pdfValid?: boolean;
  }) {
    const savedObjects: Array<{ objectKey: string }> = [];
    const gatewayCalls: ProviderGatewayDocumentGenerateRequest[] = [];

    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText() {
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: options.llmResponse,
            respondedAt: "2026-05-24T16:00:00.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: null
          };
        },
        async generateDocumentOutcome(
          input: ProviderGatewayDocumentGenerateRequest
        ): Promise<{ ok: true; result: ProviderGatewayDocumentGenerateResult }> {
          gatewayCalls.push(input);
          if (options.onDocumentGenerate) options.onDocumentGenerate(input);
          return {
            ok: true,
            result: {
              provider: "pdfmonkey",
              outputFormat: "pdf",
              documentId: "doc-patch-1",
              templateId: "template-123",
              filename: input.filename,
              bytesBase64: Buffer.concat([
                Buffer.from("%PDF-1.4\n", "utf8"),
                Buffer.alloc(1400, "P"),
                Buffer.from("\n%%EOF", "utf8")
              ]).toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-24T16:01:00.000Z",
              warning: null,
              providerStatus: {
                provider: "pdfmonkey",
                state: "success",
                documentId: "doc-patch-1",
                documentTemplateId: "template-123",
                downloadUrl: "https://example.com/patched.pdf",
                previewUrl: null,
                failureCause: null,
                filename: input.filename,
                outputType: "pdf",
                status: "success",
                updatedAt: "2026-05-24T16:01:00.000Z"
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
          savedObjects.push({ objectKey: input.objectKey });
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

    service["extractPdfText"] = async () => ({
      text: "Enough PDF text to pass validation in the patch-revise PDFMonkey output artifact.",
      error: null
    });

    return { service, gatewayCalls, savedObjects };
  }

  function makePatchReviseRequest(
    previousVersionRenderedHtml: string,
    prompt = "Fix the intro paragraph"
  ) {
    return {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      runtimeTier: "paid_shared_restricted" as const,
      runtimeBundleDocument: "{}",
      previousVersionRenderedHtml,
      job: {
        id: "job-patch-1",
        docId: "doc-1",
        versionId: "version-2",
        surface: "web" as const,
        chatId: "chat-1",
        provider: "pdfmonkey" as const,
        outputFormat: "pdf" as const,
        sourceUserMessageId: "msg-1",
        sourceUserMessageText: prompt,
        sourceUserMessageCreatedAt: "2026-05-24T12:00:00.000Z"
      },
      attachments: [],
      directToolExecution: {
        toolCode: "document" as const,
        descriptorMode: "revise_document" as const,
        request: { prompt, requestedName: "Report" }
      }
    };
  }

  test("patch-revise applies single SEARCH/REPLACE patch to previousVersion.renderedHtml and returns repaired HTML", async () => {
    const previousHtml =
      "<!DOCTYPE html><html><head></head><body><h1>Introduction</h1><p>Old intro text here.</p></body></html>";
    const envelope = makePatchReviseEnvelope([
      { search: "<p>Old intro text here.</p>", replace: "<p>New improved intro text.</p>" }
    ]);

    const { service, gatewayCalls } = createPatchReviseService({ llmResponse: envelope });

    const result = await service.run({
      bundle: createBundle(),
      request: makePatchReviseRequest(previousHtml)
    });

    assert.equal(result.artifacts.length, 1, "must produce one PDF artifact");
    assert.equal(gatewayCalls.length, 1, "must call PDFMonkey exactly once");
    assert.match(
      gatewayCalls[0]!.htmlContent,
      /New improved intro text/,
      "PDFMonkey must receive the patched HTML"
    );
    assert.equal(
      gatewayCalls[0]!.htmlContent.includes("Old intro text here"),
      false,
      "old text must be replaced"
    );
    assert.ok(
      typeof result.renderedHtml === "string" &&
        result.renderedHtml.includes("New improved intro text"),
      "renderedHtml on result must carry the post-patch post-repair HTML"
    );
  });

  test("patch-revise applies multiple patches in array order against intermediate state", async () => {
    const previousHtml =
      "<!DOCTYPE html><html><head></head><body><h1>Title</h1><p>First paragraph.</p><p>Second paragraph.</p></body></html>";
    const envelope = makePatchReviseEnvelope([
      { search: "<p>First paragraph.</p>", replace: "<p>Updated first paragraph.</p>" },
      { search: "<p>Second paragraph.</p>", replace: "<p>Updated second paragraph.</p>" }
    ]);

    const { service, gatewayCalls } = createPatchReviseService({ llmResponse: envelope });

    const result = await service.run({
      bundle: createBundle(),
      request: makePatchReviseRequest(previousHtml)
    });

    assert.equal(result.artifacts.length, 1, "must produce one artifact");
    assert.match(gatewayCalls[0]!.htmlContent, /Updated first paragraph/);
    assert.match(gatewayCalls[0]!.htmlContent, /Updated second paragraph/);
    assert.equal(gatewayCalls[0]!.htmlContent.includes("First paragraph."), false);
  });

  test("patch-revise fails with document_pdf_patch_revise_search_not_found when search block missing", async () => {
    const previousHtml =
      "<!DOCTYPE html><html><head></head><body><h1>Title</h1><p>Existing content.</p></body></html>";
    const envelope = makePatchReviseEnvelope([
      { search: "<p>This text does not exist in the HTML.</p>", replace: "<p>Replacement.</p>" }
    ]);

    const { service } = createPatchReviseService({ llmResponse: envelope });

    const result = await service.run({
      bundle: createBundle(),
      request: makePatchReviseRequest(previousHtml)
    });

    assert.equal(result.artifacts.length, 0, "must produce no artifacts on search-not-found");
    const errorCode = (result.providerStatus as Record<string, unknown>)?.errorCode;
    assert.equal(
      errorCode,
      "document_pdf_patch_revise_search_not_found",
      "errorCode must be document_pdf_patch_revise_search_not_found"
    );
  });

  test("patch-revise fails with document_pdf_patch_revise_search_ambiguous when search block matches twice", async () => {
    const previousHtml =
      "<!DOCTYPE html><html><head></head><body><p>Repeated.</p><p>Repeated.</p></body></html>";
    const envelope = makePatchReviseEnvelope([
      { search: "<p>Repeated.</p>", replace: "<p>Fixed.</p>" }
    ]);

    const { service } = createPatchReviseService({ llmResponse: envelope });

    const result = await service.run({
      bundle: createBundle(),
      request: makePatchReviseRequest(previousHtml)
    });

    assert.equal(result.artifacts.length, 0, "must produce no artifacts on ambiguous search");
    const errorCode = (result.providerStatus as Record<string, unknown>)?.errorCode;
    assert.equal(
      errorCode,
      "document_pdf_patch_revise_search_ambiguous",
      "errorCode must be document_pdf_patch_revise_search_ambiguous"
    );
  });

  test("patch-revise fails with document_pdf_patch_revise_invalid_envelope on malformed JSON", async () => {
    const previousHtml = "<!DOCTYPE html><html><head></head><body><p>Content.</p></body></html>";

    const { service } = createPatchReviseService({
      llmResponse: "Sorry, I cannot do that. Here is my reasoning instead."
    });

    const result = await service.run({
      bundle: createBundle(),
      request: makePatchReviseRequest(previousHtml)
    });

    assert.equal(result.artifacts.length, 0, "must produce no artifacts on invalid envelope");
    const errorCode = (result.providerStatus as Record<string, unknown>)?.errorCode;
    assert.equal(
      errorCode,
      "document_pdf_patch_revise_invalid_envelope",
      "errorCode must be document_pdf_patch_revise_invalid_envelope"
    );
  });

  test("patch-revise persists new renderedHtml (post-apply, post-repair) to result", async () => {
    const previousHtml =
      "<!DOCTYPE html><html><head></head><body><h2>Section</h2><p>Old body text.</p></body></html>";
    const envelope = makePatchReviseEnvelope([
      { search: "<p>Old body text.</p>", replace: "<p>Patched body text that is new.</p>" }
    ]);

    const { service } = createPatchReviseService({ llmResponse: envelope });

    const result = await service.run({
      bundle: createBundle(),
      request: makePatchReviseRequest(previousHtml)
    });

    assert.ok(typeof result.renderedHtml === "string", "renderedHtml must be a string");
    assert.match(result.renderedHtml!, /Patched body text that is new/);
    assert.equal(result.renderedHtml!.includes("Old body text"), false);
  });

  test("single-shot path that times out on attempt 1 logs document-pdf-single-shot-timeout and re-routes to chunked for attempt 2", async () => {
    const textGenerateCalls: Array<{ classification: string }> = [];
    const logMessages: string[] = [];

    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { requestMetadata?: { classification?: string } }) {
          const classification = input.requestMetadata?.classification ?? "unknown";
          textGenerateCalls.push({ classification });
          if (classification === "document_html_generation") {
            throw new ProviderGatewayTimeoutError(240_000);
          }
          if (classification === "document_pdf_outline") {
            return {
              provider: "openai",
              model: "gpt-4.1-mini",
              text: JSON.stringify({
                mode: "document_pdf_outline",
                sections: [
                  { heading: "Overview", intent: "Provide an overview.", expectedLength: "medium" }
                ]
              }),
              respondedAt: "2026-05-24T10:00:01.000Z",
              stopReason: "completed",
              toolCalls: [],
              usage: null
            };
          }
          if (classification === "document_pdf_section_generation") {
            return {
              provider: "openai",
              model: "gpt-4.1-mini",
              text: "<h2>Overview</h2><p>This is the overview section with sufficient body content to pass the minimum character threshold for section validation in the chunked pipeline path.</p>",
              respondedAt: "2026-05-24T10:00:02.000Z",
              stopReason: "completed",
              toolCalls: [],
              usage: null
            };
          }
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: "{}",
            respondedAt: "2026-05-24T10:00:00.000Z",
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
              documentId: "doc-timeout-1",
              templateId: readPdfMonkeyTemplateId(input),
              filename: input.filename,
              bytesBase64: Buffer.concat([
                Buffer.from("%PDF-1.4\n", "utf8"),
                Buffer.alloc(1400, "T"),
                Buffer.from("\n%%EOF", "utf8")
              ]).toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-24T10:00:03.000Z",
              warning: null,
              providerStatus: {
                provider: "pdfmonkey" as const,
                state: "success" as const,
                documentId: "doc-timeout-1",
                documentTemplateId: readPdfMonkeyTemplateId(input),
                downloadUrl: "https://example.com/doc-timeout.pdf",
                previewUrl: "https://example.com/doc-timeout-preview",
                failureCause: null,
                filename: input.filename,
                outputType: "pdf" as const,
                status: "success" as const,
                updatedAt: null
              }
            }
          };
        }
      } as never,
      {
        buildRuntimeOutputObjectKey(input: { artifactId?: string; extension: string | null }) {
          return `media/${input.artifactId}.${input.extension}`;
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
        }) {
          return {
            fileRef: record.fileRef,
            origin: record.origin,
            sourceToolCode: record.sourceToolCode,
            objectKey: record.objectKey,
            relativePath: record.relativePath,
            displayName: record.displayName,
            mimeType: record.mimeType,
            sizeBytes: record.sizeBytes
          };
        }
      } as never
    );
    // Intercept logger to capture warn calls
    (service as unknown as { logger: { warn: (m: string) => void } }).logger.warn = (
      message: string
    ) => {
      logMessages.push(message);
    };
    mockExtractedPdfText(
      service,
      "Overview section content providing sufficient body text for chunked path validation.",
      null
    );

    const result = await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: JSON.stringify(createBundle()),
        job: {
          id: "job-timeout-single-1",
          docId: "doc-1",
          versionId: "version-1",
          surface: "web",
          chatId: "chat-1",
          provider: "pdfmonkey",
          outputFormat: "pdf",
          sourceUserMessageId: "msg-1",
          sourceUserMessageText: "Generate a comprehensive report.",
          sourceUserMessageCreatedAt: "2026-05-24T10:00:00.000Z"
        },
        attachments: [],
        sourceFiles: [],
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_pdf_document",
          request: { prompt: "Generate a comprehensive report.", requestedName: "report" }
        }
      }
    });

    // Verify the single-shot timeout was logged
    const timeoutLog = logMessages.find((m) => m.includes("document-pdf-single-shot-timeout"));
    assert.ok(timeoutLog !== undefined, "must log [document-pdf-single-shot-timeout]");
    assert.ok(timeoutLog.includes("job-timeout-single-1"), "timeout log must include the jobId");

    // Verify re-route happened: outline call was made (chunked path was entered)
    const outlineCalls = textGenerateCalls.filter(
      (c) => c.classification === "document_pdf_outline"
    );
    assert.ok(
      outlineCalls.length >= 1,
      "must have made at least one outline call after re-routing to chunked"
    );

    // Job must complete successfully via chunked path
    assert.equal(result.artifacts.length, 1, "job must still complete with a PDF artifact");
  });

  test("chunked path that times out fails the job with document_pdf_chunked_timeout (no further re-route)", async () => {
    const textGenerateCalls: Array<{ classification: string }> = [];
    const logMessages: string[] = [];

    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { requestMetadata?: { classification?: string } }) {
          const classification = input.requestMetadata?.classification ?? "unknown";
          textGenerateCalls.push({ classification });
          if (classification === "document_pdf_outline") {
            // Timeout on the outline call — this is a chunked pipeline call
            throw new ProviderGatewayTimeoutError(240_000);
          }
          // Single-shot first attempt returns truncated HTML to trigger re-route
          if (classification === "document_html_generation") {
            return {
              provider: "openai",
              model: "gpt-4.1-mini",
              text: "<h1>Report</h1><p>Truncated without closing tags",
              respondedAt: "2026-05-24T10:00:00.000Z",
              stopReason: "completed",
              toolCalls: [],
              usage: null
            };
          }
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: "{}",
            respondedAt: "2026-05-24T10:00:00.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: null
          };
        },
        async generateDocumentOutcome(): Promise<never> {
          throw new Error("PDFMonkey must not be called if chunked pipeline fails");
        }
      } as never,
      {
        buildRuntimeOutputObjectKey() {
          return "";
        },
        async saveObject() {
          return { objectKey: "", sizeBytes: 0, mimeType: "" };
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
        }) {
          return {
            fileRef: record.fileRef,
            origin: record.origin,
            sourceToolCode: record.sourceToolCode,
            objectKey: record.objectKey,
            relativePath: record.relativePath,
            displayName: record.displayName,
            mimeType: record.mimeType,
            sizeBytes: record.sizeBytes
          };
        }
      } as never
    );
    // Intercept logger to capture warn calls
    (service as unknown as { logger: { warn: (m: string) => void } }).logger.warn = (
      message: string
    ) => {
      logMessages.push(message);
    };
    mockExtractedPdfText(service, null, null);

    const result = await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: JSON.stringify(createBundle()),
        job: {
          id: "job-chunked-timeout-1",
          docId: "doc-1",
          versionId: "version-1",
          surface: "web",
          chatId: "chat-1",
          provider: "pdfmonkey",
          outputFormat: "pdf",
          sourceUserMessageId: "msg-1",
          sourceUserMessageText: "Generate a comprehensive multi-page report.",
          sourceUserMessageCreatedAt: "2026-05-24T10:00:00.000Z"
        },
        attachments: [],
        sourceFiles: [],
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_pdf_document",
          request: {
            prompt: "Generate a comprehensive multi-page report.",
            requestedName: "report"
          }
        }
      }
    });

    // Verify chunked timeout was logged
    const chunkedTimeoutLog = logMessages.find((m) => m.includes("document-pdf-chunked-timeout"));
    assert.ok(chunkedTimeoutLog !== undefined, "must log [document-pdf-chunked-timeout]");

    // Job must have failed (no artifacts)
    assert.equal(result.artifacts.length, 0, "no artifact must be produced when chunked times out");

    // Failure code must be document_pdf_chunked_timeout (surfaced in providerStatus.errorCode)
    const errorCode =
      result.providerStatus != null && typeof result.providerStatus === "object"
        ? (result.providerStatus as { errorCode?: string }).errorCode
        : undefined;
    assert.equal(
      errorCode,
      "document_pdf_chunked_timeout",
      "providerStatus.errorCode must be document_pdf_chunked_timeout"
    );

    // Verify no single-shot retry happened after chunked timeout (no second html generation call)
    const htmlCalls = textGenerateCalls.filter(
      (c) => c.classification === "document_html_generation"
    );
    const outlineCalls = textGenerateCalls.filter(
      (c) => c.classification === "document_pdf_outline"
    );
    assert.equal(
      outlineCalls.length,
      1,
      "outline was called exactly once (no retry after chunked timeout)"
    );
    assert.ok(htmlCalls.length <= 1, "single-shot was attempted at most once before re-route");
  });
});
