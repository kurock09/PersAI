import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type { ProviderGatewayDocumentGenerateRequest } from "@persai/runtime-contract";
import { RuntimeDocumentProviderAdapterService } from "../src/modules/turns/runtime-document-provider-adapter.service";
function makePdfBytes(): Buffer {
  return Buffer.concat([
    Buffer.from("%PDF-1.4\n", "utf8"),
    Buffer.alloc(1400, "A"),
    Buffer.from("\n%%EOF", "utf8")
  ]);
}
function makeSandboxSuccessResult(objectKey = "sandbox-output/render.pdf") {
  const pdfBytes = makePdfBytes();
  return {
    status: "completed",
    exitCode: 0,
    reason: null,
    violationCode: null,
    violationMessage: null,
    stderr: null,
    files: [
      {
        relativePath: "render.pdf",
        displayName: "render.pdf",
        mimeType: "application/pdf",
        sizeBytes: pdfBytes.length,
        logicalSizeBytes: pdfBytes.length,
        storagePath: objectKey
      }
    ]
  } as never;
}
type SandboxTestClient = {
  savedObjects: Array<{ storagePath: string; mimeType: string; bytes: Buffer }>;
  waitForCompletion: () => Promise<unknown>;
  writeWorkspaceOutbound: (input: {
    basename: string;
    contentBase64: string;
    mimeType: string;
    workspaceId?: string;
    assistantId?: string;
    handle?: string;
    workspaceQuotaBytes?: number | null;
    sharedQuotaBytes?: number | null;
  }) => Promise<{ workspaceRelPath: string; sizeBytes: number }>;
};
function makeSandboxMock(overrides?: {
  waitForCompletion?: (...args: unknown[]) => Promise<unknown>;
  writeWorkspaceOutbound?: SandboxTestClient["writeWorkspaceOutbound"];
}): SandboxTestClient {
  const savedObjects: Array<{ storagePath: string; mimeType: string; bytes: Buffer }> = [];
  const mock = {
    savedObjects,
    async waitForCompletion() {
      return makeSandboxSuccessResult();
    },
    async writeWorkspaceOutbound(input: {
      basename: string;
      contentBase64: string;
      mimeType: string;
      workspaceId?: string;
      workspaceQuotaBytes?: number | null;
      sharedQuotaBytes?: number | null;
    }) {
      if (overrides?.writeWorkspaceOutbound) {
        return overrides.writeWorkspaceOutbound(input);
      }
      const bytes = Buffer.from(input.contentBase64, "base64");
      const storagePath = `/workspace/outbound/self/${input.basename}`;
      savedObjects.push({ storagePath, mimeType: input.mimeType, bytes });
      return { workspaceRelPath: storagePath, sizeBytes: bytes.length };
    },
    ...overrides
  };
  return mock;
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
          refKey: "persai:persai-runtime:tool/document/gamma/api-key",
          secretRef: {
            source: "persai",
            provider: "persai-runtime",
            id: "tool/document/gamma/api-key"
          },
          configured: true,
          providerId: "gamma",
          fallbacks: []
        }
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
export async function runRuntimeDocumentProviderAdapterServiceTest(): Promise<void> {
  // Tests are registered at module level via describe(); they run automatically in the child process.
}
describe("RuntimeDocumentProviderAdapterService", () => {
  test("generates and persists a sandbox-rendered document artifact", async () => {
    const gatewayCalls: ProviderGatewayDocumentGenerateRequest[] = [];
    const sandboxClient = makeSandboxMock();
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
        async generateDocumentOutcome(input: ProviderGatewayDocumentGenerateRequest) {
          gatewayCalls.push(input);
          return {
            ok: true,
            result: {
              provider: "sandbox",
              outputFormat: "pdf",
              documentId: "doc-provider-1",
              templateId: "template-1",
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
                provider: "sandbox",
                state: "success",
                documentId: "doc-provider-1",
                documentTemplateId: "template-1",
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
        async downloadObject() {
          return makePdfBytes();
        }
      } as never,
      sandboxClient as never
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
          provider: "sandbox",
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
    // generateDocumentOutcome is no longer called — rendering is now via sandbox WeasyPrint.
    assert.equal(gatewayCalls.length, 0);
    assert.equal(sandboxClient.savedObjects.length, 1);
    assert.equal(sandboxClient.savedObjects[0]!.mimeType, "application/pdf");
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
        async generateDocumentOutcome(input: ProviderGatewayDocumentGenerateRequest) {
          gatewayCalls.push(input);
          return {
            ok: true,
            result: {
              provider: "sandbox",
              outputFormat: "pdf",
              documentId: "doc-provider-2",
              templateId: "template-1",
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
                provider: "sandbox",
                state: "success",
                documentId: "doc-provider-2",
                documentTemplateId: "template-1",
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
        },
        async downloadObject() {
          return makePdfBytes();
        }
      } as never,
      makeSandboxMock() as never
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
          provider: "sandbox",
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
    assert.equal(result.artifacts.length, 1);
    assert.match(result.renderedHtml ?? "", /Recovered Brief/);
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
        async generateDocumentOutcome(input: ProviderGatewayDocumentGenerateRequest) {
          gatewayCalls.push(input);
          return {
            ok: true,
            result: {
              provider: "sandbox",
              outputFormat: "pdf",
              documentId: "doc-provider-fragment",
              templateId: "template-1",
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
                provider: "sandbox",
                state: "success",
                documentId: "doc-provider-fragment",
                documentTemplateId: "template-1",
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
        },
        async downloadObject() {
          return makePdfBytes();
        }
      } as never,
      makeSandboxMock() as never
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
          provider: "sandbox",
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
    assert.match(result.renderedHtml ?? "", /<!DOCTYPE html>/);
    assert.match(result.renderedHtml ?? "", /<section><h1>Payback Graph/);
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
        async generateDocumentOutcome(input: ProviderGatewayDocumentGenerateRequest) {
          gatewayCalls.push(input);
          return {
            ok: true,
            result: {
              provider: "sandbox",
              outputFormat: "pdf",
              documentId: "doc-provider-3",
              templateId: "template-1",
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
                provider: "sandbox",
                state: "success",
                documentId: "doc-provider-3",
                documentTemplateId: "template-1",
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
        },
        async downloadObject() {
          return makePdfBytes();
        }
      } as never,
      makeSandboxMock() as never
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
          provider: "sandbox",
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
    assert.equal(result.artifacts[0]!.filename, "onboarding-guide.pdf");
  });
  test("maps sandbox render violations into terminal non-retryable provider status", async () => {
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
      makeSandboxMock({
        waitForCompletion: async () => ({
          status: "violated",
          exitCode: 1,
          reason: null,
          violationCode: "sandbox_render_failed",
          violationMessage: "WeasyPrint process exceeded CPU budget.",
          stderr: null,
          files: []
        })
      }) as never
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
          provider: "sandbox",
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
    assert.equal(result.providerStatus?.errorCode, "sandbox_render_failed");
  });
  test("retries once when the first PDF output is too small", async () => {
    let downloadAttempt = 0;
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
        },
        async downloadObject() {
          downloadAttempt += 1;
          // Return too-small PDF on first attempt to trigger retry
          if (downloadAttempt === 1) {
            return Buffer.from("%PDF-1.4\n" + "x".repeat(800) + "\n%%EOF", "utf8");
          }
          return Buffer.concat([
            Buffer.from("%PDF-1.4\n", "utf8"),
            Buffer.from(
              "Monthly revenue break-even payback forecast assumptions table ".repeat(40),
              "utf8"
            ),
            Buffer.from("\n%%EOF", "utf8")
          ]);
        }
      } as never,
      makeSandboxMock() as never
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
          provider: "sandbox",
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
    assert.equal(
      downloadAttempt,
      2,
      "sandbox render must be called twice (retry after too-small PDF)"
    );
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
              ? "<!DOCTYPE html><html><body><h1>Business Brief</h1><p>Customer-ready PDF content with enough body text to pass HTML repair validation before sandbox WeasyPrint rendering.</p></body></html>"
              : JSON.stringify({ assistantText: null }),
            respondedAt: "2026-05-16T21:10:00.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: null
          };
        },
        async generateDocumentOutcome(input: ProviderGatewayDocumentGenerateRequest) {
          gatewayCalls.push(input);
          return {
            ok: true,
            result: {
              provider: "sandbox",
              outputFormat: "pdf",
              documentId: "doc-provider-uninspectable",
              templateId: "template-1",
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
                provider: "sandbox",
                state: "success",
                documentId: "doc-provider-uninspectable",
                documentTemplateId: "template-1",
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
        },
        async downloadObject() {
          return makePdfBytes();
        }
      } as never,
      makeSandboxMock() as never
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
          provider: "sandbox",
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
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0]!.mimeType, "application/pdf");
    assert.equal(result.providerStatus?.state, "success");
  });
  test("rejects sandbox-rendered output that is not a real PDF (missing %PDF- magic)", async () => {
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { requestMetadata?: { classification?: string } }) {
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: isHtmlGenerationRequest(input)
              ? "<!DOCTYPE html><html><body><h1>Business Brief</h1><p>Customer-ready PDF content with enough body text to pass HTML repair validation before sandbox WeasyPrint rendering.</p></body></html>"
              : JSON.stringify({ assistantText: null }),
            respondedAt: "2026-05-16T21:30:00.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: null
          };
        },
        async generateDocumentOutcome(input: ProviderGatewayDocumentGenerateRequest) {
          return {
            ok: true,
            result: {
              provider: "sandbox",
              outputFormat: "pdf",
              documentId: "doc-not-a-pdf",
              templateId: "template-1",
              filename: input.filename,
              bytesBase64: Buffer.alloc(2048, "Z").toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-16T21:30:02.000Z",
              warning: null,
              providerStatus: {
                provider: "sandbox",
                state: "success",
                documentId: "doc-not-a-pdf",
                documentTemplateId: "template-1",
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
        },
        async downloadObject() {
          return Buffer.alloc(2048, "Z");
        }
      } as never,
      makeSandboxMock() as never
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
          provider: "sandbox",
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
        async generateDocumentOutcome(input: ProviderGatewayDocumentGenerateRequest) {
          return {
            ok: true,
            result: {
              provider: "sandbox",
              outputFormat: "pdf",
              documentId: "doc-retry",
              templateId: "template-1",
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
                provider: "sandbox",
                state: "success",
                documentId: "doc-retry",
                documentTemplateId: "template-1",
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
        },
        async downloadObject() {
          return makePdfBytes();
        }
      } as never,
      makeSandboxMock() as never
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
          provider: "sandbox",
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
    const sandboxClient = makeSandboxMock();
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
        async generateDocumentOutcome(input: ProviderGatewayDocumentGenerateRequest) {
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
        async downloadObject() {
          return makePdfBytes();
        }
      } as never,
      sandboxClient as never
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
    assert.equal(sandboxClient.savedObjects.length, 1);
    assert.equal(
      sandboxClient.savedObjects[0]!.mimeType,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
    assert.match(sandboxClient.savedObjects[0]!.storagePath, /\.pptx$/);
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
        async generateDocumentOutcome(input: ProviderGatewayDocumentGenerateRequest) {
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
        },
        async downloadObject() {
          return makePdfBytes();
        }
      } as never,
      makeSandboxMock() as never
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
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><h1>Report</h1><p>The actual document content goes here, long enough to clear the minimum body text gate and pass HTML repair validation before sandbox WeasyPrint rendering.</p></body></html>'
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
  });
  test("auto-promotes first <tr> with all <th> cells into <thead> when <thead> is missing", () => {
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
      "<!DOCTYPE html><html><head></head><body><h1>Report</h1><p>The actual document content goes here, long enough to clear the minimum body text gate and pass HTML repair validation before sandbox WeasyPrint rendering.</p><table><tbody><tr><th>Quarter</th><th>Revenue</th></tr><tr><td>Q1</td><td>100</td></tr><tr><td>Q2</td><td>120</td></tr></tbody></table></body></html>"
    );
    assert.equal(repair.paginationEnhanced, true);
    assert.equal(repair.theadPromoted, 1);
    assert.match(
      repair.html,
      /<thead>\s*<tr>\s*<th>Quarter<\/th>\s*<th>Revenue<\/th>\s*<\/tr>\s*<\/thead>/i
    );
    assert.match(repair.html, /<tbody>\s*<tr>\s*<td>Q1<\/td>/i);
  });
  test("keeps existing <thead> intact and does not promote first body row when it is not header-only", () => {
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
      "<!DOCTYPE html><html><head></head><body><h1>Report</h1><p>Filler body text long enough to clear the minimum body text gate before sandbox WeasyPrint rendering of the resulting PDF document.</p><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table><table><tbody><tr><th>Row label</th><td>Value</td></tr><tr><th>Other label</th><td>Other</td></tr></tbody></table></body></html>"
    );
    assert.equal(repair.paginationEnhanced, true);
    assert.equal(repair.theadPromoted, 0);
    assert.equal(
      (repair.html.match(/<thead>/gi) ?? []).length,
      1,
      "should not duplicate or add a second <thead>"
    );
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
        async generateDocumentOutcome(input: ProviderGatewayDocumentGenerateRequest) {
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
        },
        async downloadObject() {
          return makePdfBytes();
        }
      } as never,
      makeSandboxMock() as never
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
        async generateDocumentOutcome(input: ProviderGatewayDocumentGenerateRequest) {
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
        },
        async downloadObject() {
          return makePdfBytes();
        }
      } as never,
      makeSandboxMock() as never
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
  test("explicit word-for-word DOCX rebuild bypasses chunked LLM generation and transfers extracted source text directly", async () => {
    const textGenerateCalls: Array<{ classification: string }> = [];
    const sandboxCalls: Array<{ htmlContent: string; outputFileName: string }> = [];
    const sourceText = `${"ДОГОВОР ПОСТАВКИ\n\n".repeat(20)}${"Пункт 1. Текст должен быть перенесен слово в слово без сокращений и пропусков.\n\n".repeat(400)}`;
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { requestMetadata?: { classification?: string } }) {
          textGenerateCalls.push({
            classification: input.requestMetadata?.classification ?? "unknown"
          });
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: "{}",
            respondedAt: "2026-05-26T01:00:00.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: null
          };
        },
        async generateDocumentOutcome(): Promise<never> {
          throw new Error(
            "generateDocumentOutcome must not be called — PDF rendering is sandbox-only"
          );
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
        },
        async downloadObject() {
          return makePdfBytes();
        }
      } as never,
      makeSandboxMock({
        waitForCompletion: async (...args: unknown[]) => {
          const input = args[0] as { args: { htmlContent: string; outputFileName: string } };
          sandboxCalls.push({
            htmlContent: input.args.htmlContent,
            outputFileName: input.args.outputFileName
          });
          return makeSandboxSuccessResult();
        }
      }) as never
    );
    mockExtractedPdfText(
      service,
      "ДОГОВОР ПОСТАВКИ Пункт 1. Текст должен быть перенесен слово в слово без сокращений и пропусков."
    );
    const result = await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: JSON.stringify(createBundle()),
        job: {
          id: "job-direct-transfer-1",
          docId: "doc-1",
          versionId: "version-1",
          surface: "web",
          chatId: "chat-1",
          provider: "sandbox",
          outputFormat: "pdf",
          sourceUserMessageId: "msg-1",
          sourceUserMessageText: "Create a new PDF from the attached DOCX source file.",
          sourceUserMessageCreatedAt: "2026-05-26T01:00:00.000Z"
        },
        attachments: [],
        sourceFiles: [
          {
            attachmentId: "att-docx-1",
            filename: "contract.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sizeBytes: Buffer.byteLength(sourceText, "utf8"),
            text: sourceText,
            markdown: null,
            note: null,
            provider: null,
            quality: {
              status: "ok" as const,
              score: null,
              reasonCodes: [],
              textChars: sourceText.length
            }
          }
        ],
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_pdf_document",
          request: {
            prompt: "Create a new PDF from the attached DOCX source file.",
            transferMode: "verbatim",
            requestedName: "contract-copy"
          }
        }
      }
    });
    assert.equal(
      textGenerateCalls.length,
      0,
      "verbatim transfer path must not call text generation"
    );
    assert.equal(sandboxCalls.length, 1, "verbatim transfer path must still render one PDF");
    assert.match(
      sandboxCalls[0]!.htmlContent,
      /Текст должен быть перенесен слово в слово без сокращений и пропусков/,
      "rendered HTML must contain the extracted source text"
    );
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.editStrategy, "structured_large");
    assert.ok(result.structureJson !== null && result.structureJson !== undefined);
  });
  test("large verbatim create persists structured snapshot and structured_large editStrategy", async () => {
    const textGenerateCalls: unknown[] = [];
    const sandboxCalls: Array<{ htmlContent: string; outputFileName: string }> = [];
    const largeSourceText = `${"Paragraph body text for structured snapshot. ".repeat(900)}\n\nFINAL SECTION`;
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText() {
          textGenerateCalls.push(true);
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: "",
            respondedAt: "2026-05-26T02:00:00.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: null
          };
        },
        async generateDocumentOutcome(): Promise<never> {
          throw new Error(
            "generateDocumentOutcome must not be called — PDF rendering is sandbox-only (large verbatim)"
          );
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
        },
        async downloadObject() {
          return makePdfBytes();
        }
      } as never,
      makeSandboxMock({
        waitForCompletion: async (...args: unknown[]) => {
          const input = args[0] as { args: { htmlContent: string; outputFileName: string } };
          sandboxCalls.push({
            htmlContent: input.args.htmlContent,
            outputFileName: input.args.outputFileName
          });
          return makeSandboxSuccessResult();
        }
      }) as never
    );
    mockExtractedPdfText(service, largeSourceText);
    const result = await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: JSON.stringify(createBundle()),
        job: {
          id: "job-large-verbatim-1",
          docId: "doc-large-1",
          versionId: "version-large-1",
          surface: "web",
          chatId: "chat-1",
          provider: "sandbox",
          outputFormat: "pdf",
          sourceUserMessageId: "msg-large-1",
          sourceUserMessageText: "Create PDF from attachment",
          sourceUserMessageCreatedAt: "2026-05-26T02:00:00.000Z"
        },
        attachments: [],
        sourceFiles: [
          {
            attachmentId: "att-large-1",
            filename: "thesis.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sizeBytes: Buffer.byteLength(largeSourceText, "utf8"),
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
          request: {
            prompt: "Create PDF from attachment",
            transferMode: "verbatim",
            requestedName: "thesis"
          }
        }
      }
    });
    assert.equal(textGenerateCalls.length, 0);
    assert.equal(result.editStrategy, "structured_large");
    assert.ok(result.structureJson !== null && result.structureJson !== undefined);
    assert.ok(result.styleProfileJson !== null && result.styleProfileJson !== undefined);
    assert.match(sandboxCalls[0]!.htmlContent, /FINAL SECTION/);
  });
  test("document generation prefers systemTool slot and does not forward ordinary chat prompt or heartbeat", async () => {
    const bundle = createBundle() as AssistantRuntimeBundle & {
      runtime: { runtimeProviderRouting: { modelSlots: Record<string, unknown> } };
    };
    bundle.runtime.runtimeProviderRouting.modelSlots.systemTool = {
      providerKey: "openai",
      modelKey: "gpt-5-mini-doc-worker"
    };
    let capturedModel = "";
    let capturedSystemPrompt = "";
    let capturedDeveloperInstructions = "";
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: {
          model?: string;
          systemPrompt?: string | null;
          developerInstructions?: string;
          requestMetadata?: { classification?: string };
        }) {
          if (input.requestMetadata?.classification === "document_html_generation") {
            capturedModel = input.model ?? "";
            capturedSystemPrompt = input.systemPrompt ?? "";
            capturedDeveloperInstructions = input.developerInstructions ?? "";
          }
          return {
            provider: "openai",
            model: input.model ?? "gpt-4.1-mini",
            text: isHtmlGenerationRequest(input)
              ? makeHtmlGenerationText(
                  "<!DOCTYPE html><html><body><h1>Short Document</h1><p>Enough body text to produce a valid rendered document for the focused worker-prompt regression test.</p></body></html>"
                )
              : "{}",
            respondedAt: "2026-05-26T01:00:00.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: null
          };
        },
        async generateDocumentOutcome(input: ProviderGatewayDocumentGenerateRequest) {
          return {
            ok: true,
            result: {
              provider: "sandbox",
              outputFormat: "pdf",
              documentId: "doc-system-tool-1",
              templateId: "template-123",
              filename: input.filename,
              bytesBase64: Buffer.concat([
                Buffer.from("%PDF-1.4\n", "utf8"),
                Buffer.alloc(1400, "S"),
                Buffer.from("\n%%EOF", "utf8")
              ]).toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-26T01:00:01.000Z",
              warning: null,
              providerStatus: {
                provider: "sandbox" as const,
                state: "success" as const,
                documentId: "doc-system-tool-1",
                documentTemplateId: "template-123",
                downloadUrl: "https://example.com/system-tool.pdf",
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
        },
        async downloadObject() {
          return makePdfBytes();
        }
      } as never,
      makeSandboxMock() as never
    );
    mockExtractedPdfText(
      service,
      "Short Document Enough body text to produce a valid rendered document for the focused worker-prompt regression test."
    );
    await service.run({
      bundle,
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: JSON.stringify(bundle),
        job: {
          id: "job-system-tool-1",
          docId: "doc-1",
          versionId: "version-1",
          surface: "web",
          chatId: "chat-1",
          provider: "sandbox",
          outputFormat: "pdf",
          sourceUserMessageId: "msg-1",
          sourceUserMessageText: "Create a short business brief.",
          sourceUserMessageCreatedAt: "2026-05-26T01:00:00.000Z"
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
    assert.equal(capturedModel, "gpt-5-mini-doc-worker");
    assert.match(capturedSystemPrompt, /non-conversational document generation worker/i);
    assert.doesNotMatch(capturedSystemPrompt, /You are PersAI\./);
    assert.doesNotMatch(capturedDeveloperInstructions, /Stay grounded\./);
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
        async generateDocumentOutcome(input: ProviderGatewayDocumentGenerateRequest) {
          return {
            ok: true,
            result: {
              provider: "sandbox",
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
                provider: "sandbox",
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
        },
        async downloadObject() {
          return makePdfBytes();
        }
      } as never,
      makeSandboxMock() as never
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
          provider: "sandbox",
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
  test("large attached source with transferMode=transform preserves full text without chunked LLM generation", async () => {
    const textGenerateCalls: Array<{ classification: string }> = [];
    const contractParagraph = "Договорная статья с обязательным содержанием. ";
    const largeSourceText = contractParagraph.repeat(1_200);
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { requestMetadata?: { classification?: string } }) {
          textGenerateCalls.push({
            classification: input.requestMetadata?.classification ?? "unknown"
          });
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: "{}",
            respondedAt: "2026-05-26T12:00:00.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: null
          };
        },
        async generateDocumentOutcome(input: ProviderGatewayDocumentGenerateRequest) {
          return {
            ok: true,
            result: {
              provider: "sandbox",
              outputFormat: "pdf",
              documentId: "doc-transform-1",
              templateId: "template-123",
              filename: input.filename,
              bytesBase64: Buffer.concat([
                Buffer.from("%PDF-1.4\n", "utf8"),
                Buffer.alloc(1400, "P"),
                Buffer.from("\n%%EOF", "utf8")
              ]).toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-26T12:01:00.000Z",
              warning: null,
              providerStatus: {
                provider: "sandbox",
                state: "success",
                documentId: "doc-transform-1",
                documentTemplateId: "template-123",
                downloadUrl: "https://example.com/contract.pdf",
                previewUrl: null,
                failureCause: null,
                filename: input.filename,
                outputType: "pdf",
                status: "success",
                updatedAt: "2026-05-26T12:01:00.000Z"
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
        },
        async downloadObject() {
          return makePdfBytes();
        }
      } as never,
      makeSandboxMock() as never
    );
    mockExtractedPdfText(service, largeSourceText);
    const result = await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: JSON.stringify(createBundle()),
        job: {
          id: "job-transform-contract",
          docId: "doc-1",
          versionId: "version-1",
          surface: "web",
          chatId: "chat-1",
          provider: "sandbox",
          outputFormat: "pdf",
          sourceUserMessageId: "msg-1",
          sourceUserMessageText: "собери договор в PDF оформи красиво в цвете",
          sourceUserMessageCreatedAt: "2026-05-26T12:00:00.000Z"
        },
        attachments: [],
        sourceFiles: [
          {
            attachmentId: "att-contract",
            filename: "contract.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sizeBytes: Buffer.byteLength(largeSourceText, "utf8"),
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
          request: {
            prompt: "собери договор в PDF оформи красиво в цвете",
            transferMode: "transform",
            contentIntent: "preserve_content",
            requestedName: "contract"
          }
        }
      }
    });
    assert.equal(
      textGenerateCalls.filter((c) => c.classification === "document_pdf_outline").length,
      0,
      "transform on extracted source must not use chunked outline"
    );
    assert.match(largeSourceText.slice(0, 80), /Договорная/);
    assert.ok(result.structureJson !== null && result.structureJson !== undefined);
    assert.equal(result.editStrategy, "structured_large");
  });
  test("large attached source defaults to preserve_content when contentIntent is omitted", async () => {
    const textGenerateCalls: Array<{ classification: string }> = [];
    const contractParagraph = "Обязательный текст договора без сокращений. ";
    const largeSourceText = contractParagraph.repeat(1_100);
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { requestMetadata?: { classification?: string } }) {
          textGenerateCalls.push({
            classification: input.requestMetadata?.classification ?? "unknown"
          });
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: "{}",
            respondedAt: "2026-05-26T12:05:00.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: null
          };
        },
        async generateDocumentOutcome(input: ProviderGatewayDocumentGenerateRequest) {
          return {
            ok: true,
            result: {
              provider: "sandbox",
              outputFormat: "pdf",
              documentId: "doc-preserve-default-1",
              templateId: "template-123",
              filename: input.filename,
              bytesBase64: Buffer.concat([
                Buffer.from("%PDF-1.4\n", "utf8"),
                Buffer.alloc(1400, "Q"),
                Buffer.from("\n%%EOF", "utf8")
              ]).toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-26T12:06:00.000Z",
              warning: null,
              providerStatus: {
                provider: "sandbox",
                state: "success",
                documentId: "doc-preserve-default-1",
                documentTemplateId: "template-123",
                downloadUrl: "https://example.com/contract-default.pdf",
                previewUrl: null,
                failureCause: null,
                filename: input.filename,
                outputType: "pdf",
                status: "success",
                updatedAt: "2026-05-26T12:06:00.000Z"
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
        },
        async downloadObject() {
          return makePdfBytes();
        }
      } as never,
      makeSandboxMock() as never
    );
    mockExtractedPdfText(service, largeSourceText);
    const result = await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: JSON.stringify(createBundle()),
        job: {
          id: "job-preserve-default-contract",
          docId: "doc-1",
          versionId: "version-1",
          surface: "web",
          chatId: "chat-1",
          provider: "sandbox",
          outputFormat: "pdf",
          sourceUserMessageId: "msg-1",
          sourceUserMessageText: "собери договор в PDF",
          sourceUserMessageCreatedAt: "2026-05-26T12:05:00.000Z"
        },
        attachments: [],
        sourceFiles: [
          {
            attachmentId: "att-contract-default",
            filename: "contract.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sizeBytes: Buffer.byteLength(largeSourceText, "utf8"),
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
          request: {
            prompt: "собери договор в PDF",
            requestedName: "contract-default"
          }
        }
      }
    });
    assert.equal(
      textGenerateCalls.filter((c) => c.classification === "document_pdf_outline").length,
      0,
      "missing contentIntent must still preserve extracted large source text"
    );
    assert.ok(result.structureJson !== null && result.structureJson !== undefined);
    assert.equal(result.editStrategy, "structured_large");
  });
  // ─── ADR-097 Slice 2 — patch-revise tests ─────────────────────────────────
  function makePatchReviseEnvelope(patches: Array<{ search: string; replace: string }>): string {
    return JSON.stringify({ mode: "document_pdf_patch_revise", patches });
  }
  function createPatchReviseService(options: {
    llmResponse: string;
    onSandboxRender?: (args: { htmlContent: string; outputFileName: string }) => void;
    pdfValid?: boolean;
  }) {
    const savedObjects: Array<{ objectKey: string }> = [];
    const sandboxCalls: Array<{ htmlContent: string; outputFileName: string }> = [];
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
        },
        async downloadObject() {
          return makePdfBytes();
        }
      } as never,
      makeSandboxMock({
        waitForCompletion: async (...args: unknown[]) => {
          const input = args[0] as { args: { htmlContent: string; outputFileName: string } };
          sandboxCalls.push({
            htmlContent: input.args.htmlContent,
            outputFileName: input.args.outputFileName
          });
          if (options.onSandboxRender) options.onSandboxRender(input.args);
          return makeSandboxSuccessResult();
        }
      }) as never
    );
    service["extractPdfText"] = async () => ({
      text: "Enough PDF text to pass validation in the patch-revise sandbox output artifact now.",
      error: null
    });
    return { service, sandboxCalls, savedObjects };
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
        provider: "sandbox" as const,
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
    const { service, sandboxCalls } = createPatchReviseService({ llmResponse: envelope });
    const result = await service.run({
      bundle: createBundle(),
      request: makePatchReviseRequest(previousHtml)
    });
    assert.equal(result.artifacts.length, 1, "must produce one PDF artifact");
    assert.equal(sandboxCalls.length, 1, "must call sandbox render exactly once");
    assert.match(
      sandboxCalls[0]!.htmlContent,
      /New improved intro text/,
      "sandbox render must receive the patched HTML"
    );
    assert.equal(
      sandboxCalls[0]!.htmlContent.includes("Old intro text here"),
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
    const { service, sandboxCalls } = createPatchReviseService({ llmResponse: envelope });
    const result = await service.run({
      bundle: createBundle(),
      request: makePatchReviseRequest(previousHtml)
    });
    assert.equal(result.artifacts.length, 1, "must produce one artifact");
    assert.match(sandboxCalls[0]!.htmlContent, /Updated first paragraph/);
    assert.match(sandboxCalls[0]!.htmlContent, /Updated second paragraph/);
    assert.equal(sandboxCalls[0]!.htmlContent.includes("First paragraph."), false);
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
  test("large revise with style_only uses structured path and preserves text", async () => {
    const sectionText = "Alpha paragraph that must remain unchanged.";
    const filler = "Lorem ipsum dolor sit amet. ".repeat(1_500);
    const previousHtml = `<!DOCTYPE html><html><head></head><body><p>${filler}</p><p>${sectionText}</p></body></html>`;
    const styleEnvelope = JSON.stringify({
      mode: "document_style_patch",
      stylePatch: {
        typography: { bodyFontSizePt: 14 },
        colors: { accent: "#990000" }
      }
    });
    const { service, sandboxCalls } = createPatchReviseService({ llmResponse: styleEnvelope });
    const result = await service.run({
      bundle: createBundle(),
      request: {
        ...makePatchReviseRequest(previousHtml, "Improve visual styling only"),
        previousVersionEditStrategy: "structured_large",
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "revise_document",
          request: {
            prompt: "Improve visual styling only",
            editOperation: "style_only",
            requestedName: "Report"
          }
        }
      }
    });
    assert.equal(result.artifacts.length, 1);
    assert.match(sandboxCalls[0]!.htmlContent, /font-size: 14pt/);
    assert.match(sandboxCalls[0]!.htmlContent, new RegExp(sectionText));
    assert.equal(result.editStrategy, "structured_large");
    assert.ok(result.structureJson !== null && result.structureJson !== undefined);
  });
  test("structured revise maps metadata.preserveText to style_only", async () => {
    const filler = "Immutable thesis paragraph. ".repeat(1_500);
    const previousHtml = `<!DOCTYPE html><html><head></head><body><p>${filler}</p></body></html>`;
    let classification = "";
    const styleEnvelope = JSON.stringify({
      mode: "document_style_patch",
      stylePatch: { typography: { bodyFontSizePt: 12 } }
    });
    const { service } = createPatchReviseService({ llmResponse: styleEnvelope });
    const gateway = (
      service as unknown as {
        providerGatewayClientService: {
          generateText: (input: {
            requestMetadata?: { classification?: string };
          }) => Promise<unknown>;
        };
      }
    ).providerGatewayClientService;
    const originalGenerate = gateway.generateText.bind(gateway);
    gateway.generateText = async (input) => {
      classification = input.requestMetadata?.classification ?? "";
      return originalGenerate(input);
    };
    await service.run({
      bundle: createBundle(),
      request: {
        ...makePatchReviseRequest(previousHtml, "Restyle only"),
        previousVersionEditStrategy: "structured_large",
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "revise_document",
          request: {
            prompt: "Restyle only",
            requestedName: "Thesis",
            metadata: { preserveText: true }
          }
        }
      }
    });
    assert.equal(classification, "document_style_patch");
  });
  test("structured revise defaults to style_only when contentIntent and editOperation are omitted", async () => {
    const filler = "Unchanged contract clause. ".repeat(1_500);
    const previousHtml = `<!DOCTYPE html><html><head></head><body><p>${filler}</p></body></html>`;
    let classification = "";
    const styleEnvelope = JSON.stringify({
      mode: "document_style_patch",
      stylePatch: { colors: { accent: "#2255cc" } }
    });
    const { service } = createPatchReviseService({ llmResponse: styleEnvelope });
    const gateway = (
      service as unknown as {
        providerGatewayClientService: {
          generateText: (input: {
            requestMetadata?: { classification?: string };
          }) => Promise<unknown>;
        };
      }
    ).providerGatewayClientService;
    const originalGenerate = gateway.generateText.bind(gateway);
    gateway.generateText = async (input) => {
      classification = input.requestMetadata?.classification ?? "";
      return originalGenerate(input);
    };
    await service.run({
      bundle: createBundle(),
      request: {
        ...makePatchReviseRequest(previousHtml, "Make it prettier"),
        previousVersionEditStrategy: "structured_large",
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "revise_document",
          request: {
            prompt: "Make it prettier",
            requestedName: "Contract"
          }
        }
      }
    });
    assert.equal(classification, "document_style_patch");
  });
  // ---- ADR-102 Slice 8: worker LLM usage aggregation tests ----
  test("single-shot PDF with worker LLM usage returns non-null aggregated usage", async () => {
    const mockUsage = {
      providerKey: "openai",
      modelKey: "gpt-4.1-mini",
      inputTokens: 1200,
      cachedInputTokens: 0,
      outputTokens: 800,
      totalTokens: 2000
    };
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText() {
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: "<!DOCTYPE html><html><body><h1>Usage Test Doc</h1><p>Single-shot document body text that is long enough to pass the sandbox WeasyPrint HTML body-text minimum validation threshold for a successful document generation job run.</p></body></html>",
            respondedAt: "2026-05-30T10:00:00.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: mockUsage
          };
        },
        async generateDocumentOutcome(input: ProviderGatewayDocumentGenerateRequest) {
          return {
            ok: true as const,
            result: {
              provider: "sandbox",
              outputFormat: "pdf",
              documentId: "doc-usage-test-1",
              templateId: "template-1",
              filename: input.filename,
              bytesBase64: Buffer.concat([
                Buffer.from("%PDF-1.4\n", "utf8"),
                Buffer.alloc(1400, "U"),
                Buffer.from("\n%%EOF", "utf8")
              ]).toString("base64"),
              mimeType: "application/pdf",
              respondedAt: "2026-05-30T10:01:00.000Z",
              warning: null,
              providerStatus: {
                provider: "sandbox",
                state: "success",
                documentId: "doc-usage-test-1",
                documentTemplateId: "template-1",
                downloadUrl: "https://example.com/usage-test.pdf",
                previewUrl: null,
                failureCause: null,
                filename: input.filename,
                outputType: "pdf",
                status: "success",
                updatedAt: "2026-05-30T10:01:00.000Z"
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
        },
        async downloadObject() {
          return makePdfBytes();
        }
      } as never,
      makeSandboxMock() as never
    );
    service["extractPdfText"] = async () => ({
      text: "Usage test PDF text long enough to pass minimum validation requirements for a generated document.",
      error: null
    });
    const result = await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: "{}",
        job: {
          id: "job-usage-1",
          docId: "doc-usage-1",
          versionId: "version-usage-1",
          surface: "web",
          chatId: "chat-usage-1",
          provider: "sandbox",
          outputFormat: "pdf",
          sourceUserMessageId: "message-usage-1",
          sourceUserMessageText: "Generate a test PDF",
          sourceUserMessageCreatedAt: "2026-05-30T10:00:00.000Z"
        },
        attachments: [],
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_pdf_document",
          request: {
            prompt: "Generate a test document for usage tracking",
            requestedName: "Usage Test"
          }
        }
      }
    });
    assert.equal(result.artifacts.length, 1, "must produce one artifact");
    assert.notEqual(result.usage, null, "usage must be non-null when generateText returned usage");
    assert.equal(
      result.usage?.inputTokens,
      1200,
      "usage.inputTokens must match the generateText response"
    );
    assert.equal(
      result.usage?.outputTokens,
      800,
      "usage.outputTokens must match the generateText response"
    );
    assert.equal(
      result.usage?.totalTokens,
      2000,
      "usage.totalTokens must match the generateText response"
    );
    const usageSnapshot = result.usage as import("@persai/runtime-contract").RuntimeUsageSnapshot;
    assert.equal(usageSnapshot.providerKey, "openai");
    assert.equal(usageSnapshot.modelKey, "gpt-4.1-mini");
  });
  test("Gamma presentation path returns null usage (no worker LLM calls)", async () => {
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText() {
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: "<!DOCTYPE html><html><body><h1>Gamma</h1></body></html>",
            respondedAt: "2026-05-30T10:00:00.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: {
              providerKey: "openai",
              modelKey: "gpt-4.1-mini",
              inputTokens: 500,
              cachedInputTokens: 0,
              outputTokens: 200,
              totalTokens: 700
            }
          };
        },
        async generateDocumentOutcome(input: ProviderGatewayDocumentGenerateRequest) {
          return {
            ok: true as const,
            result: {
              provider: "gamma",
              outputFormat: "pptx",
              documentId: "gamma-usage-null-1",
              templateId: null,
              filename: input.filename,
              bytesBase64: Buffer.from("pptx-null-usage").toString("base64"),
              mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              respondedAt: "2026-05-30T10:01:00.000Z",
              warning: null,
              providerStatus: {
                provider: "gamma",
                state: "success",
                generationId: "gen-null-usage",
                gammaId: "g_null_usage",
                gammaUrl: "https://gamma.app/docs/g_null_usage",
                exportUrl: "https://gamma.app/export/g_null_usage.pptx",
                filename: input.filename,
                outputType: "pptx",
                status: "completed",
                updatedAt: "2026-05-30T10:01:00.000Z"
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
        },
        async downloadObject() {
          return makePdfBytes();
        }
      } as never,
      makeSandboxMock() as never
    );
    const result = await service.run({
      bundle: createBundle(),
      request: {
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        runtimeTier: "paid_shared_restricted",
        runtimeBundleDocument: "{}",
        job: {
          id: "job-gamma-usage-null",
          docId: "doc-gamma-usage-null",
          versionId: "version-gamma-usage-null",
          surface: "web",
          chatId: "chat-gamma-usage-null",
          provider: "gamma",
          outputFormat: "pptx",
          sourceUserMessageId: "message-gamma-usage-null",
          sourceUserMessageText: "Create a presentation",
          sourceUserMessageCreatedAt: "2026-05-30T10:00:00.000Z"
        },
        attachments: [],
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_presentation",
          request: {
            prompt: "Create a business overview presentation",
            requestedName: "Gamma Null Usage Test"
          }
        }
      }
    });
    assert.equal(result.artifacts.length, 1, "must produce one artifact");
    assert.equal(
      result.usage,
      null,
      "Gamma path must return null usage since it makes no worker LLM calls"
    );
  });
  test("patch-revise returns usage from worker LLM call", async () => {
    const patchUsage = {
      providerKey: "openai",
      modelKey: "gpt-4.1-mini",
      inputTokens: 2500,
      cachedInputTokens: 100,
      outputTokens: 1200,
      totalTokens: 3700
    };
    const envelope = makePatchReviseEnvelope([
      { search: "<p>Original paragraph.</p>", replace: "<p>Revised paragraph.</p>" }
    ]);
    const { service } = createPatchReviseService({ llmResponse: "" });
    const gateway = (
      service as unknown as {
        providerGatewayClientService: {
          generateText: () => Promise<unknown>;
        };
      }
    ).providerGatewayClientService;
    gateway.generateText = async () => ({
      provider: "openai",
      model: "gpt-4.1-mini",
      text: envelope,
      respondedAt: "2026-05-30T10:00:00.000Z",
      stopReason: "completed",
      toolCalls: [],
      usage: patchUsage
    });
    const previousHtml =
      "<!DOCTYPE html><html><head></head><body><p>Original paragraph.</p></body></html>";
    const result = await service.run({
      bundle: createBundle(),
      request: makePatchReviseRequest(previousHtml, "Update the paragraph")
    });
    assert.equal(result.artifacts.length, 1, "must produce one artifact");
    assert.notEqual(
      result.usage,
      null,
      "usage must be non-null when patch-revise LLM returned usage"
    );
    assert.equal(result.usage?.inputTokens, 2500);
    assert.equal(result.usage?.cachedInputTokens, 100);
    assert.equal(result.usage?.outputTokens, 1200);
    assert.equal(result.usage?.totalTokens, 3700);
  });
  // ---- end ADR-102 Slice 8 usage tests ----
  test("small revise keeps patch-revise path when below structured threshold", async () => {
    const previousHtml =
      "<!DOCTYPE html><html><head></head><body><h1>Intro</h1><p>Old intro text here.</p></body></html>";
    const envelope = makePatchReviseEnvelope([
      { search: "<p>Old intro text here.</p>", replace: "<p>New improved intro text.</p>" }
    ]);
    let patchClassification = "";
    const service = new RuntimeDocumentProviderAdapterService(
      {
        async generateText(input: { requestMetadata?: { classification?: string } }) {
          patchClassification = input.requestMetadata?.classification ?? "";
          return {
            provider: "openai",
            model: "gpt-4.1-mini",
            text: envelope,
            respondedAt: "2026-05-24T16:00:00.000Z",
            stopReason: "completed",
            toolCalls: [],
            usage: null
          };
        },
        async generateDocumentOutcome(input: ProviderGatewayDocumentGenerateRequest) {
          return {
            ok: true,
            result: {
              provider: "sandbox",
              outputFormat: "pdf",
              documentId: "doc-patch-small",
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
                provider: "sandbox",
                state: "success",
                documentId: "doc-patch-small",
                documentTemplateId: "template-123",
                downloadUrl: "https://example.com/patched-small.pdf",
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
        async saveObject() {
          return { objectKey: "k", sizeBytes: 1, mimeType: "application/pdf" };
        },
        async downloadObject() {
          return makePdfBytes();
        }
      } as never,
      makeSandboxMock() as never
    );
    service["extractPdfText"] = async () => ({ text: "x".repeat(120), error: null });
    await service.run({
      bundle: createBundle(),
      request: makePatchReviseRequest(previousHtml)
    });
    assert.equal(patchClassification, "document_pdf_patch_revise");
  });
  // ADR-102 Slice 8: document-worker LLM economics — usage aggregation tests
  describe("worker LLM usage aggregation (Slice 8)", () => {
    function makeMinimalPdfService(options: {
      generateTextUsage: Record<string, unknown> | null;
      htmlContent: string;
    }) {
      const service = new RuntimeDocumentProviderAdapterService(
        {
          async generateText() {
            return {
              provider: "openai",
              model: "gpt-4.1-mini",
              text: options.htmlContent,
              respondedAt: "2026-05-30T10:00:00.000Z",
              stopReason: "completed",
              toolCalls: [],
              usage: options.generateTextUsage
            };
          },
          async generateDocumentOutcome(input: ProviderGatewayDocumentGenerateRequest) {
            return {
              ok: true,
              result: {
                provider: "sandbox",
                outputFormat: "pdf",
                documentId: "doc-usage-1",
                templateId: "template-123",
                filename: input.filename,
                bytesBase64: Buffer.concat([
                  Buffer.from("%PDF-1.4\n", "utf8"),
                  Buffer.alloc(1400, "U"),
                  Buffer.from("\n%%EOF", "utf8")
                ]).toString("base64"),
                mimeType: "application/pdf",
                respondedAt: "2026-05-30T10:01:00.000Z",
                warning: null,
                providerStatus: { provider: "sandbox", state: "success" } as never
              }
            };
          }
        } as never,
        {
          buildRuntimeOutputObjectKey(input: { artifactId?: string; extension: string | null }) {
            return `runtime/${input.artifactId}.${input.extension}`;
          },
          async saveObject() {
            return { objectKey: "k", sizeBytes: 1, mimeType: "application/pdf" };
          },
          async downloadObject() {
            return makePdfBytes();
          }
        } as never,
        makeSandboxMock() as never
      );
      mockExtractedPdfText(
        service,
        "Document text for usage test. Document text for usage test. Document text for usage test. Document text for usage test. Document text for usage test. Document text for usage test. Document text for usage test."
      );
      return service;
    }
    function makeRequest() {
      return {
        job: {
          id: "job-usage-1",
          chatId: "chat-1",
          provider: "sandbox",
          outputFormat: "pdf"
        },
        directToolExecution: {
          toolCode: "document",
          descriptorMode: "create_pdf_document",
          request: {
            prompt: "Generate a document",
            requestedName: "Test Doc"
          }
        },
        sourceFiles: [],
        runtimeBundleDocument: JSON.stringify({ metadata: { assistantId: "assistant-1" } })
      };
    }
    test("single-shot PDF path returns generateText usage in result", async () => {
      const htmlContent =
        "<!DOCTYPE html><html><body><h1>Title</h1><p>This is enough body text for the PDF generation test to pass the minimum body text length requirement and avoid the too-little-body-text error threshold.</p></body></html>";
      const service = makeMinimalPdfService({
        generateTextUsage: {
          providerKey: "openai",
          modelKey: "gpt-4.1-mini",
          inputTokens: 500,
          cachedInputTokens: 0,
          outputTokens: 250,
          totalTokens: 750
        },
        htmlContent
      });
      const result = await service.run({
        bundle: createBundle(),
        request: makeRequest() as never
      });
      assert.ok(result.usage !== null, "usage must be non-null when generateText returned usage");
      const usage = result.usage as {
        inputTokens: number | null;
        outputTokens: number | null;
        totalTokens: number | null;
        providerKey: string | null;
      };
      assert.equal(usage.inputTokens, 500);
      assert.equal(usage.outputTokens, 250);
      assert.equal(usage.totalTokens, 750);
      assert.equal(usage.providerKey, "openai");
    });
    test("single-shot PDF path keeps usage null when generateText returns null usage", async () => {
      const htmlContent =
        "<!DOCTYPE html><html><body><h1>Title</h1><p>This is enough body text for the PDF generation test to pass the minimum body text length requirement and avoid the too-little-body-text error threshold.</p></body></html>";
      const service = makeMinimalPdfService({
        generateTextUsage: null,
        htmlContent
      });
      const result = await service.run({
        bundle: createBundle(),
        request: makeRequest() as never
      });
      assert.equal(result.usage, null, "usage must be null when generateText returned null");
    });
    test("Gamma path returns usage null (no worker LLM calls)", async () => {
      let generateTextCalled = false;
      const service = new RuntimeDocumentProviderAdapterService(
        {
          async generateText() {
            generateTextCalled = true;
            throw new Error("Gamma must not call generateText");
          },
          async generateDocumentOutcome(input: ProviderGatewayDocumentGenerateRequest) {
            return {
              ok: true,
              result: {
                provider: "gamma",
                outputFormat: "pptx",
                documentId: "gamma-1",
                templateId: null,
                filename: input.filename,
                bytesBase64: Buffer.concat([Buffer.alloc(100, "G")]).toString("base64"),
                mimeType:
                  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                respondedAt: "2026-05-30T10:01:00.000Z",
                warning: null,
                providerStatus: { provider: "gamma", state: "success" } as never
              }
            };
          }
        } as never,
        {
          buildRuntimeOutputObjectKey(input: { artifactId?: string; extension: string | null }) {
            return `runtime/${input.artifactId}.${input.extension}`;
          },
          async saveObject() {
            return {
              objectKey: "k",
              sizeBytes: 1,
              mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            };
          },
          async downloadObject() {
            return makePdfBytes();
          }
        } as never,
        makeSandboxMock() as never
      );
      const bundle = Object.assign({}, createBundle(), {
        governance: {
          toolCredentialRefs: {
            document: {
              refKey: "persai:persai-runtime:tool/document/gamma/api-key",
              secretRef: {
                source: "persai",
                provider: "persai-runtime",
                id: "tool/document/gamma/api-key"
              },
              configured: true,
              providerId: "gamma",
              fallbacks: []
            }
          }
        }
      }) as never;
      const result = await service.run({
        bundle,
        request: {
          job: {
            id: "job-gamma-usage-1",
            chatId: "chat-1",
            provider: "gamma",
            outputFormat: "pptx",
            sourceUserMessageText: "Create a presentation",
            sourceUserMessageCreatedAt: "2026-05-30T10:00:00.000Z"
          },
          directToolExecution: {
            toolCode: "document",
            descriptorMode: "create_presentation",
            request: {
              prompt: "Make a presentation",
              requestedName: "Test Pres",
              outputFormat: "pptx"
            }
          },
          sourceFiles: [],
          runtimeBundleDocument: JSON.stringify({ metadata: { assistantId: "assistant-1" } })
        } as never
      });
      assert.equal(result.usage, null, "Gamma path must return usage: null");
      assert.equal(generateTextCalled, false, "Gamma path must not call generateText");
    });
    test("patch-revise path returns generateText usage in result", async () => {
      const filler = "Contract body text for patch revise test. ".repeat(1_500);
      const previousHtml = `<!DOCTYPE html><html><head></head><body><p>${filler}</p></body></html>`;
      const envelope = JSON.stringify({
        mode: "document_pdf_patch_revise",
        patches: [{ search: "<p>", replace: "<p>" }]
      });
      const service = new RuntimeDocumentProviderAdapterService(
        {
          async generateText() {
            return {
              provider: "openai",
              model: "gpt-4.1-mini",
              text: envelope,
              respondedAt: "2026-05-30T10:00:00.000Z",
              stopReason: "completed",
              toolCalls: [],
              usage: {
                providerKey: "openai",
                modelKey: "gpt-4.1-mini",
                inputTokens: 4000,
                cachedInputTokens: 1000,
                outputTokens: 200,
                totalTokens: 4200
              }
            };
          },
          async generateDocumentOutcome(input: ProviderGatewayDocumentGenerateRequest) {
            return {
              ok: true,
              result: {
                provider: "sandbox",
                outputFormat: "pdf",
                documentId: "doc-patch-usage-1",
                templateId: "template-123",
                filename: input.filename,
                bytesBase64: Buffer.concat([
                  Buffer.from("%PDF-1.4\n", "utf8"),
                  Buffer.alloc(1400, "P"),
                  Buffer.from("\n%%EOF", "utf8")
                ]).toString("base64"),
                mimeType: "application/pdf",
                respondedAt: "2026-05-30T10:01:00.000Z",
                warning: null,
                providerStatus: { provider: "sandbox", state: "success" } as never
              }
            };
          }
        } as never,
        {
          buildRuntimeOutputObjectKey(input: { artifactId?: string; extension: string | null }) {
            return `runtime/${input.artifactId}.${input.extension}`;
          },
          async saveObject() {
            return { objectKey: "k", sizeBytes: 1, mimeType: "application/pdf" };
          },
          async downloadObject() {
            return makePdfBytes();
          }
        } as never,
        makeSandboxMock() as never
      );
      mockExtractedPdfText(
        service,
        "Contract body text for patch revise test. Contract body text for patch revise test. Contract body text for patch revise test."
      );
      const result = await service.run({
        bundle: createBundle(),
        request: {
          ...makePatchReviseRequest(previousHtml, "Improve the clause"),
          previousVersionEditStrategy: "fast_small"
        } as never
      });
      assert.ok(result.usage !== null, "patch-revise result.usage must be non-null");
      const usage = result.usage as {
        inputTokens: number | null;
        cachedInputTokens?: number | null;
        outputTokens: number | null;
      };
      assert.equal(usage.inputTokens, 4000, "inputTokens must match generateText usage");
      assert.equal(usage.cachedInputTokens, 1000, "cachedInputTokens must be propagated");
      assert.equal(usage.outputTokens, 200, "outputTokens must match generateText usage");
    });
  });
});

// ADR-123 Slice 6 — Documents mode B (model-writes-code / create_data_document).
function makeXlsxBytes(): Buffer {
  // ZIP local-file-header magic (PK\x03\x04) + padding above the 512-byte floor.
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(2048, 7)]);
}
function makeSandboxCodeResult(input: {
  exitCode: number;
  stderr?: string | null;
  objectKey?: string;
  relativePath?: string;
}) {
  const relativePath = input.relativePath ?? "Revenue.xlsx";
  return {
    status: "completed",
    exitCode: input.exitCode,
    reason: input.exitCode === 0 ? null : "process_failed",
    violationCode: null,
    violationMessage: null,
    stdout: null,
    stderr: input.stderr ?? null,
    content: null,
    files:
      input.exitCode === 0
        ? [
            {
              relativePath,
              displayName: relativePath,
              mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              sizeBytes: 2052,
              logicalSizeBytes: 2052,
              storagePath: input.objectKey ?? "sandbox-output/report.xlsx"
            }
          ]
        : []
  } as never;
}
function createModeBService(config: {
  generateProgram: (input: {
    classification: string;
    payloadText: string;
    developerInstructions: string | null;
  }) => string;
  waitForCompletion: (request: {
    toolCode: string;
    args: Record<string, unknown>;
  }) => Promise<unknown>;
  downloadObject?: (storagePath: string) => Promise<Buffer | null>;
}) {
  const generateCalls: Array<{ classification: string; payloadText: string }> = [];
  const sandboxCalls: Array<{
    toolCode: string;
    args: Record<string, unknown>;
  }> = [];
  const savedObjects: Array<{ storagePath: string; mimeType: string; bytes: Buffer }> = [];
  const service = new RuntimeDocumentProviderAdapterService(
    {
      async generateText(input: {
        developerInstructions?: string;
        messages: Array<{ content: Array<{ type: string; text: string }> }>;
        requestMetadata?: { classification?: string };
      }) {
        const classification = input.requestMetadata?.classification ?? "";
        const payloadText = input.messages?.[0]?.content?.[0]?.text ?? "";
        generateCalls.push({ classification, payloadText });
        const text = config.generateProgram({
          classification,
          payloadText,
          developerInstructions: input.developerInstructions ?? null
        });
        return {
          provider: "openai",
          model: "gpt-4.1-mini",
          text,
          respondedAt: "2026-06-21T10:00:00.000Z",
          stopReason: "completed",
          toolCalls: [],
          usage: null
        };
      }
    } as never,
    {
      async downloadByWorkspacePath(input: { workspaceId: string; storagePath: string }) {
        if (config.downloadObject) {
          return config.downloadObject(input.storagePath);
        }
        return makeXlsxBytes();
      },
      async downloadObject(storagePath: string) {
        if (config.downloadObject) {
          return config.downloadObject(storagePath);
        }
        return makeXlsxBytes();
      }
    } as never,
    {
      async waitForCompletion(request: { toolCode: string; args: Record<string, unknown> }) {
        sandboxCalls.push({
          toolCode: request.toolCode,
          args: request.args
        });
        return config.waitForCompletion(request);
      },
      async writeWorkspaceOutbound(input: {
        basename: string;
        contentBase64: string;
        mimeType: string;
        workspaceQuotaBytes?: number | null;
        sharedQuotaBytes?: number | null;
      }) {
        const bytes = Buffer.from(input.contentBase64, "base64");
        const storagePath = `/workspace/outbound/self/${input.basename}`;
        savedObjects.push({ storagePath, mimeType: input.mimeType, bytes });
        return { workspaceRelPath: storagePath, sizeBytes: bytes.length };
      }
    } as never
  );
  return { service, generateCalls, sandboxCalls, savedObjects };
}
function makeModeBRequest(overrides?: {
  outputFormat?: "xlsx" | "docx" | "pdf";
  attachments?: unknown[];
  sourceFiles?: unknown[];
}) {
  return {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    runtimeTier: "paid_shared_restricted",
    runtimeBundleDocument: "{}",
    job: {
      id: "job-codedoc-1",
      docId: "doc-1",
      versionId: "version-1",
      surface: "web",
      chatId: "chat-1",
      provider: "sandbox",
      outputFormat: overrides?.outputFormat ?? "xlsx",
      sourceUserMessageId: "message-1",
      sourceUserMessageText: "Build a spreadsheet of monthly revenue",
      sourceUserMessageCreatedAt: "2026-06-21T09:59:00.000Z"
    },
    attachments: overrides?.attachments ?? [],
    sourceFiles: overrides?.sourceFiles ?? [],
    directToolExecution: {
      toolCode: "document",
      descriptorMode: "create_data_document",
      request: {
        prompt: "Build a spreadsheet of monthly revenue",
        requestedName: "Revenue",
        outputFormat: overrides?.outputFormat ?? "xlsx"
      }
    }
  } as never;
}
describe("RuntimeDocumentProviderAdapterService — ADR-123 Slice 6 mode B", () => {
  test("create_data_document xlsx happy path persists artifact and deletes transient", async () => {
    const harness = createModeBService({
      generateProgram: () =>
        "import openpyxl\nwb = openpyxl.Workbook()\nwb.save('/workspace/report.xlsx')\n",
      async waitForCompletion() {
        return makeSandboxCodeResult({ exitCode: 0 });
      }
    });
    const result = await harness.service.run({
      bundle: createBundle(),
      request: makeModeBRequest({ outputFormat: "xlsx" })
    });
    assert.equal(harness.generateCalls.length, 1);
    assert.equal(harness.generateCalls[0]!.classification, "document_code_generation");
    assert.equal(harness.sandboxCalls.length, 1);
    assert.equal(harness.sandboxCalls[0]!.toolCode, "execute_document_code");
    assert.equal(typeof harness.sandboxCalls[0]!.args.programSource, "string");
    assert.equal(harness.sandboxCalls[0]!.args.outputFileName, "Revenue.xlsx");
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.providerStatus?.state, "success");
    assert.equal(result.renderedHtml ?? null, null);
    assert.equal(harness.savedObjects.length, 1);
  });

  test("self-repair: first sandbox failure triggers second LLM call and exec, then succeeds", async () => {
    let exec = 0;
    const harness = createModeBService({
      generateProgram: () =>
        "import openpyxl\nopenpyxl.Workbook().save('/workspace/report.xlsx')\n",
      async waitForCompletion() {
        exec += 1;
        if (exec === 1) {
          return makeSandboxCodeResult({
            exitCode: 1,
            stderr: "NameError: name 'opnpyxl' is not defined"
          });
        }
        return makeSandboxCodeResult({ exitCode: 0 });
      }
    });
    const result = await harness.service.run({
      bundle: createBundle(),
      request: makeModeBRequest({ outputFormat: "xlsx" })
    });
    assert.equal(harness.generateCalls.length, 2);
    assert.equal(harness.sandboxCalls.length, 2);
    // Second generation must include the previous stderr for repair.
    assert.ok(
      harness.generateCalls[1]!.payloadText.includes("NameError"),
      "repair LLM call should include previous stderr"
    );
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.providerStatus?.state, "success");
  });

  test("two sandbox failures yield non-retryable document_code_failed", async () => {
    const harness = createModeBService({
      generateProgram: () => "raise SystemExit(1)\n",
      async waitForCompletion() {
        return makeSandboxCodeResult({ exitCode: 1, stderr: "boom" });
      }
    });
    const result = await harness.service.run({
      bundle: createBundle(),
      request: makeModeBRequest({ outputFormat: "xlsx" })
    });
    assert.equal(harness.sandboxCalls.length, 2);
    assert.equal(result.artifacts.length, 0);
    assert.equal(result.providerStatus?.state, "failed");
    assert.equal(result.providerStatus?.errorCode, "document_code_failed");
    assert.equal(result.providerStatus?.retryable, false);
  });

  test("invalid artifact (not a real xlsx ZIP) fails office validation", async () => {
    const harness = createModeBService({
      generateProgram: () => "open('/workspace/report.xlsx','w').write('x'*1024)\n",
      async waitForCompletion() {
        return makeSandboxCodeResult({ exitCode: 0 });
      },
      async downloadObject() {
        // 1KB of non-ZIP content — passes the size floor, fails the PK magic check.
        return Buffer.alloc(1024, 0x41);
      }
    });
    const result = await harness.service.run({
      bundle: createBundle(),
      request: makeModeBRequest({ outputFormat: "xlsx" })
    });
    assert.equal(result.artifacts.length, 0);
    assert.equal(result.providerStatus?.state, "failed");
    assert.equal(result.providerStatus?.errorCode, "document_office_missing_magic");
  });

  test("digital PDF source is mounted with no OCR sidecar (Tier 1)", async () => {
    const harness = createModeBService({
      generateProgram: () =>
        "import openpyxl\nopenpyxl.Workbook().save('/workspace/report.xlsx')\n",
      async waitForCompletion() {
        return makeSandboxCodeResult({ exitCode: 0 });
      },
      async downloadObject(objectKey: string) {
        if (objectKey === "uploads/att-1/source.pdf") {
          return makePdfBytes();
        }
        return makeXlsxBytes();
      }
    });
    // Digital PDF: probe returns a substantial text layer.
    mockExtractedPdfText(
      harness.service,
      "This digital PDF has a real extractable text layer with plenty of alphanumeric characters."
    );
    const result = await harness.service.run({
      bundle: createBundle(),
      request: makeModeBRequest({
        outputFormat: "xlsx",
        attachments: [
          {
            attachmentId: "att-1",
            kind: "document",
            storagePath: "uploads/att-1/source.pdf",
            mimeType: "application/pdf",
            displayName: "source.pdf",
            sizeBytes: 4096
          }
        ],
        sourceFiles: [
          {
            attachmentId: "att-1",
            filename: "source.pdf",
            mimeType: "application/pdf",
            sizeBytes: 4096,
            text: "This digital PDF has a real extractable text layer.",
            markdown: null,
            note: null,
            provider: null,
            quality: null
          }
        ]
      })
    });
    assert.equal(result.providerStatus?.state, "success");
    const call = harness.sandboxCalls[0]!;
    assert.deepEqual(call.args.inputPaths, ["uploads/att-1/source.pdf"]);
    const sourceMounts = call.args.sourceMounts as Array<{
      storagePath: string;
      mountPath: string;
    }>;
    assert.equal(sourceMounts.length, 1);
    assert.equal(sourceMounts[0]!.storagePath, "uploads/att-1/source.pdf");
    assert.equal(sourceMounts[0]!.mountPath, "sources/source.pdf");
    const sidecars = call.args.textSidecars as Array<{ mountPath: string }>;
    assert.equal(sidecars.length, 0, "digital PDF must not get an OCR sidecar");
    // The code-gen prompt references the mounted path and pdfplumber, not inline text.
    assert.ok(harness.generateCalls[0]!.payloadText.includes("/workspace/sources/source.pdf"));
  });

  test("scanned PDF source gets an OCR text sidecar from extracted text (Tier 2)", async () => {
    const harness = createModeBService({
      generateProgram: () =>
        "import openpyxl\nopenpyxl.Workbook().save('/workspace/report.xlsx')\n",
      async waitForCompletion() {
        return makeSandboxCodeResult({ exitCode: 0 });
      },
      async downloadObject(objectKey: string) {
        if (objectKey === "uploads/att-2/scan.pdf") {
          return makePdfBytes();
        }
        return makeXlsxBytes();
      }
    });
    // Scanned PDF: probe returns ~no text layer.
    mockExtractedPdfText(harness.service, "");
    const result = await harness.service.run({
      bundle: createBundle(),
      request: makeModeBRequest({
        outputFormat: "xlsx",
        attachments: [
          {
            attachmentId: "att-2",
            kind: "document",
            storagePath: "uploads/att-2/scan.pdf",
            mimeType: "application/pdf",
            displayName: "scan.pdf",
            sizeBytes: 8192
          }
        ],
        sourceFiles: [
          {
            attachmentId: "att-2",
            filename: "scan.pdf",
            mimeType: "application/pdf",
            sizeBytes: 8192,
            text: "OCR EXTRACTED TEXT FROM THE SCANNED INVOICE",
            markdown: null,
            note: null,
            provider: {
              providerKey: "mistral",
              processorMode: "high_quality_fallback",
              attemptedProviderKeys: ["local", "mistral"]
            },
            quality: null
          }
        ]
      })
    });
    assert.equal(result.providerStatus?.state, "success");
    const call = harness.sandboxCalls[0]!;
    assert.deepEqual(call.args.inputPaths, ["uploads/att-2/scan.pdf"]);
    const sidecars = call.args.textSidecars as Array<{ mountPath: string; text: string }>;
    assert.equal(sidecars.length, 1);
    assert.equal(sidecars[0]!.mountPath, "sources/scan.pdf.ocr.txt");
    assert.equal(sidecars[0]!.text, "OCR EXTRACTED TEXT FROM THE SCANNED INVOICE");
    // The prompt tells the model an OCR sidecar is provided.
    assert.ok(harness.generateCalls[0]!.payloadText.includes("sources/scan.pdf.ocr.txt"));
  });
});
