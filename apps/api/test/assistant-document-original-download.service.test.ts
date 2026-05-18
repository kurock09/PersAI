import assert from "node:assert/strict";
import { GoneException, NotFoundException } from "@nestjs/common";
import { AssistantDocumentOriginalDownloadService } from "../src/modules/workspace-management/application/assistant-document-original-download.service";
import { TOOL_CREDENTIAL_IDS } from "../src/modules/workspace-management/application/tool-credential-settings";

async function run(): Promise<void> {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://api.gamma.app/export/docs/gamma-doc-1/pptx/url") {
        assert.equal(init?.method, "POST");
        assert.equal(
          (init?.headers as Record<string, string> | undefined)?.["X-API-KEY"],
          "secret"
        );
        return new Response(
          JSON.stringify({
            url: "https://assets.gamma.app/export/deck-original.pptx",
            exportId: "export-1"
          }),
          {
            status: 201,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
      assert.equal(url, "https://assets.gamma.app/export/deck-original.pptx");
      return new Response(Buffer.from("pptx-original"), {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        }
      });
    }) as typeof fetch;

    const service = new AssistantDocumentOriginalDownloadService(
      {
        assistantDocumentVersion: {
          findFirst: async () => ({
            sourceJson: {
              requestedName: "Board deck.pdf"
            },
            providerMappings: [
              {
                providerMetadataJson: {
                  provider: "gamma",
                  outputType: "pdf",
                  gammaId: "gamma-doc-1",
                  filename: "board-deck-original.pptx"
                }
              }
            ]
          })
        }
      } as never,
      {
        async resolveSecretValueById(secretId: string) {
          assert.equal(secretId, TOOL_CREDENTIAL_IDS.tool_document_gamma);
          return "secret";
        }
      } as never
    );

    const result = await service.downloadOriginalPresentation({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      docId: "doc-1",
      versionId: "version-1"
    });
    assert.equal(
      result.contentType,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
    assert.equal(result.filename, "board-deck-original.pptx");
    assert.equal(result.buffer.toString("utf8"), "pptx-original");
  } finally {
    globalThis.fetch = originalFetch;
  }

  try {
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      assert.equal(url, "https://assets.gamma.app/export/legacy-original.pptx");
      return new Response(Buffer.from("legacy-pptx-original"), {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        }
      });
    }) as typeof fetch;

    const fallbackService = new AssistantDocumentOriginalDownloadService(
      {
        assistantDocumentVersion: {
          findFirst: async () => ({
            sourceJson: {
              requestedName: "Board deck.pdf"
            },
            providerMappings: [
              {
                providerMetadataJson: {
                  provider: "gamma",
                  outputType: "pdf",
                  gammaId: "gamma-doc-legacy",
                  filename: "board-deck-original.pptx",
                  companionOriginal: {
                    format: "pptx",
                    status: "ready",
                    filename: "board-deck-original.pptx",
                    exportUrl: "https://assets.gamma.app/export/legacy-original.pptx"
                  }
                }
              }
            ]
          })
        }
      } as never,
      {
        async resolveSecretValueById(secretId: string) {
          assert.equal(secretId, TOOL_CREDENTIAL_IDS.tool_document_gamma);
          throw new Error(`missing secret for ${secretId}`);
        }
      } as never
    );

    const result = await fallbackService.downloadOriginalPresentation({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      docId: "doc-1",
      versionId: "version-1"
    });
    assert.equal(result.filename, "board-deck-original.pptx");
    assert.equal(result.buffer.toString("utf8"), "legacy-pptx-original");
  } finally {
    globalThis.fetch = originalFetch;
  }

  const expiredService = new AssistantDocumentOriginalDownloadService(
    {
      assistantDocumentVersion: {
        findFirst: async () => ({
          sourceJson: {
            requestedName: "Board deck.pdf"
          },
          providerMappings: [
            {
              providerMetadataJson: {
                provider: "gamma",
                outputType: "pdf",
                companionOriginal: {
                  format: "pptx",
                  status: "unavailable",
                  filename: "board-deck-original.pptx"
                }
              }
            }
          ]
        })
      }
    } as never,
    {} as never
  );
  await assert.rejects(
    () =>
      expiredService.downloadOriginalPresentation({
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        docId: "doc-1",
        versionId: "version-1"
      }),
    (error: unknown) => {
      assert.ok(error instanceof GoneException);
      return true;
    }
  );

  const invalidUrlService = new AssistantDocumentOriginalDownloadService(
    {
      assistantDocumentVersion: {
        findFirst: async () => ({
          sourceJson: {
            requestedName: "Board deck.pdf"
          },
          providerMappings: [
            {
              providerMetadataJson: {
                provider: "gamma",
                outputType: "pdf",
                companionOriginal: {
                  format: "pptx",
                  status: "ready",
                  filename: "board-deck-original.pptx",
                  exportUrl: "https://example.com/not-gamma.pptx"
                }
              }
            }
          ]
        })
      }
    } as never,
    {} as never
  );
  await assert.rejects(
    () =>
      invalidUrlService.downloadOriginalPresentation({
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        docId: "doc-1",
        versionId: "version-1"
      }),
    (error: unknown) => {
      assert.ok(error instanceof GoneException);
      return true;
    }
  );

  const missingService = new AssistantDocumentOriginalDownloadService(
    {
      assistantDocumentVersion: {
        findFirst: async () => null
      }
    } as never,
    {} as never
  );
  await assert.rejects(
    () =>
      missingService.downloadOriginalPresentation({
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        docId: "doc-1",
        versionId: "version-1"
      }),
    (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      return true;
    }
  );
}

void run();
