import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AssistantDocumentJobSchedulerService } from "../src/modules/workspace-management/application/assistant-document-job-scheduler.service";

function buildSchedulerForPrivateAccess() {
  return new AssistantDocumentJobSchedulerService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  ) as unknown as {
    parseRequestPayload(value: unknown): unknown;
  };
}

describe("AssistantDocumentJobSchedulerService", () => {
  test("parses only presentation deferred document payloads", () => {
    const access = buildSchedulerForPrivateAccess();

    const presentation = access.parseRequestPayload({
      sourceUserMessageText: "make a deck",
      sourceUserMessageCreatedAt: "2026-06-29T10:00:00.000Z",
      descriptorMode: "create_presentation",
      sourceJson: {
        prompt: "Board deck",
        outputFormat: "pptx",
        requestedName: "board-deck"
      },
      sourceUserMessageAttachments: [
        {
          attachmentId: "attachment-1",
          kind: "file",
          storagePath: "/workspace/assistants/assistant-1/sessions/session-1/source.md",
          mimeType: "text/markdown",
          sizeBytes: 100,
          displayName: "source.md"
        }
      ]
    }) as {
      descriptorMode: string;
      sourceJson: { outputFormat: string | null; requestedName: string | null };
      sourceUserMessageAttachments: unknown[];
    } | null;

    assert.equal(presentation?.descriptorMode, "create_presentation");
    assert.equal(presentation?.sourceJson.outputFormat, "pptx");
    assert.equal(presentation?.sourceJson.requestedName, "board-deck");
    assert.equal(presentation?.sourceUserMessageAttachments.length, 1);

    const retired = access.parseRequestPayload({
      sourceUserMessageText: "make xlsx",
      sourceUserMessageCreatedAt: "2026-06-29T10:00:00.000Z",
      descriptorMode: "create_data_document",
      sourceJson: {
        prompt: "Workbook",
        outputFormat: "xlsx"
      }
    });

    assert.equal(retired, null);
  });
});
