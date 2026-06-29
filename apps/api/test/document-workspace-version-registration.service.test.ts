import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DocumentWorkspaceVersionRegistrationService } from "../src/modules/workspace-management/application/document-workspace-version-registration.service";

describe("DocumentWorkspaceVersionRegistrationService", () => {
  test("registers a visible xlsx workspace version with inspection facts", async () => {
    const registeredInputs: unknown[] = [];
    const inspection = {
      schema: "persai.document.inspect.v1",
      format: "xlsx",
      counts: {
        pageCount: null,
        sheetCount: 2,
        formulaCount: 3,
        blankSheetCount: 0,
        paragraphCount: null,
        headingCount: null,
        tableCount: null,
        textCharCount: null
      },
      warnings: ["ok"]
    };
    const service = new DocumentWorkspaceVersionRegistrationService(
      {
        assistantChat: {
          async findFirst() {
            return { id: "chat-1" };
          }
        },
        assistant: {
          async findFirst() {
            return { userId: "user-1" };
          }
        }
      } as never,
      {
        async registerVisibleWorkspaceVersion(input: unknown) {
          registeredInputs.push(input);
          return {
            docId: "doc-1",
            versionId: "version-1",
            versionNumber: 1,
            descriptorMode: "create_data_document",
            documentType: "data_document",
            outputFormat: "xlsx"
          };
        }
      } as never,
      {
        async get(input: { path: string }) {
          if (
            input.path === "/workspace/model/output.xlsx" ||
            input.path === "/workspace/model/output.inspect.json"
          ) {
            return {
              workspaceId: "workspace-1",
              path: input.path,
              mimeType: input.path.endsWith(".xlsx")
                ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : "application/json",
              sizeBytes: BigInt(128),
              contentHash: null,
              shortDescription: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };
          }
          return null;
        }
      } as never,
      {
        buildWorkspaceObjectKey(input: { workspaceRelPath: string }) {
          return `gcs:${input.workspaceRelPath.replace(/^\/workspace\//, "")}`;
        },
        async downloadObject(objectKey: string) {
          if (objectKey === "gcs:model/output.inspect.json") {
            return {
              buffer: Buffer.from(JSON.stringify(inspection), "utf8"),
              contentType: "application/json"
            };
          }
          return null;
        }
      } as never
    );

    const outcome = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "thread-1",
      sourceUserMessageText: "register workbook",
      sourceUserMessageCreatedAt: "2026-06-29T12:00:00.000Z",
      descriptorMode: null,
      docId: null,
      requestedName: "output.xlsx",
      workspaceProjectPath: "/workspace/model",
      outputPath: "/workspace/model/output.xlsx",
      sourceManifestPath: null,
      inspectionPath: "/workspace/model/output.inspect.json"
    });

    assert.equal(outcome.accepted, true);
    if (!outcome.accepted) {
      return;
    }
    assert.equal(outcome.descriptorMode, "create_data_document");
    assert.equal(outcome.documentType, "data_document");
    assert.equal(outcome.outputFormat, "xlsx");
    assert.equal(registeredInputs.length, 1);
    const registered = registeredInputs[0] as {
      workspaceFacts: { inspectionSummary: { counts: { sheetCount: number | null } } | null };
    };
    assert.equal(registered.workspaceFacts.inspectionSummary?.counts.sheetCount, 2);
  });

  test("rejects old workspace subdirectories", async () => {
    const service = new DocumentWorkspaceVersionRegistrationService(
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    const outcome = await service.execute({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      channel: "web",
      externalThreadKey: "thread-1",
      sourceUserMessageText: "register workbook",
      sourceUserMessageCreatedAt: "2026-06-29T12:00:00.000Z",
      descriptorMode: null,
      docId: null,
      requestedName: null,
      workspaceProjectPath: null,
      outputPath: "/workspace/input/output.xlsx",
      sourceManifestPath: null,
      inspectionPath: null
    });

    assert.equal(outcome.accepted, false);
    if (outcome.accepted) {
      return;
    }
    assert.equal(outcome.code, "invalid_output_path");
  });
});
